//! The outside-agent bridge. An external agent (Claude Code,
//! Codex, any MCP client) plays the model: each model request of a turn, a background job or the
//! extraction pipeline is parked here as a work item, the MCP layer hands it to the connected
//! agent (`wait_for_work`), and the agent's answer (`respond_to_work`) becomes an ordinary
//! assistant message. Requests wait for an agent with no time limit, so work queued while no
//! agent is connected starts once one connects.
//!
//! Check-ins: every authorized MCP request counts as the agent being connected; only the work
//! loop (wait, respond, read) counts as teaching. Status changes go out as "agent-changed".
//! A backup teacher answers while a main agent compacts its context (`backup`).

mod backup;
mod checkin;
mod render;
mod stream;
mod view;
mod waiters;
mod work;

use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Arc;

use gs_base::events::{EventKind, Events};
use gs_core::contracts::chat::CHAT_ID_PREFIX;
use gs_core::records::agent_seen::{SeenMark, SeenStore};
use gs_json::{Json, json};
use parking_lot::Mutex;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use waiters::Waiters;

pub use checkin::display_agent_name;
pub use stream::agent_model;
pub use view::WorkView;
pub use work::{AgentReply, Answered, ReplyCall, WaitOptions};

/// The work queue the outside agent drains. Cloning shares it.
#[derive(Clone)]
pub struct Bridge(Arc<Inner>);

struct Inner {
	state: Mutex<State>,
	events: Events,
	/// Where lesson marks of agents with an id are saved (data/agent-seen.json).
	seen: Arc<dyn SeenStore>,
	/// The `wait_for_work` callers, in line.
	waiters: Waiters,
}

/// One parked model request.
struct WorkItem {
	id: String,
	/// The caller's session id (the chat id for lessons): groups requests into one conversation
	/// so the agent gets only what is new.
	conversation: String,
	created_at: i64,
	context: Arc<Vec<Json>>,
	/// Set when an agent takes the item; cleared if it never answers.
	claimed_at: Option<i64>,
	/// The session id of the agent that took it, when its client sends one.
	agent: Option<String>,
	/// How often it was taken. The workId ends in this count, so a late reply to an earlier
	/// claim cannot answer for the latest.
	claims: u64,
	/// The agent lost its context while holding it: its reply does not count as seen.
	agent_forgot: bool,
	/// The item as the agent reads it, in pages of text blocks; page 1 goes out with the item.
	pages: Vec<Vec<String>>,
	/// Pages not read yet; a reply waits until none are left.
	unread: BTreeSet<usize>,
	reply: Option<oneshot::Sender<Json>>,
}

#[derive(Default)]
struct Known {
	/// Instructions hash → the workId that carried them.
	instructions: HashMap<String, String>,
	tools: HashSet<String>,
}

#[derive(Default)]
struct State {
	items: Vec<WorkItem>,
	/// conversation → agent ("" = no id) → what that agent has seen of it.
	seen_by: HashMap<String, HashMap<String, SeenMark>>,
	/// Last time an MCP client sent any request.
	last_contact: i64,
	/// Last time an agent called the work loop.
	last_work: i64,
	/// What each agent already has from other conversations.
	known: HashMap<String, Known>,
	agent_name: Option<String>,
	/// Fires "agent-changed" when the connection lapses.
	lapse: Option<JoinHandle<()>>,
	/// Counts lapse timers, so a replaced one that already woke does nothing.
	lapse_number: u64,
	/// conversation → the background task's name.
	labels: HashMap<String, String>,
	/// conversation → until when its next item is held for the agent that just answered it.
	held: HashMap<String, i64>,
	/// Background conversations whose run has not ended.
	background_runs: HashSet<String>,
	/// agent ("" = no id) → the lesson its waiter stays on.
	staying_on: HashMap<String, String>,
	/// agent → when it started compacting its context.
	compacting: HashMap<String, i64>,
	/// backup agent ("" = no id) → its last check-in.
	backups: HashMap<String, i64>,
}

/// Lessons use their chat id as the conversation; everything else is a background job.
fn is_background(conversation: &str) -> bool {
	!conversation.starts_with(CHAT_ID_PREFIX)
}

impl Bridge {
	/// `events` carries "agent-changed"; `seen` saves what each agent has seen of each lesson.
	pub fn new(events: &Events, seen: Arc<dyn SeenStore>) -> Bridge {
		Bridge(Arc::new(Inner { state: Mutex::new(State::default()), events: events.clone(), seen, waiters: Waiters::default() }))
	}

	/// Names a background conversation for the agent (a run with a task label).
	pub fn label_conversation(&self, conversation: &str, label: &str) {
		self.0.state.lock().labels.insert(conversation.to_owned(), label.to_owned());
	}

	/// Drops a finished background run's state; a reply still waiting for its next item stops.
	pub fn forget_conversation(&self, conversation: &str) {
		let mut s = self.0.state.lock();
		s.labels.remove(conversation);
		s.seen_by.remove(conversation);
		s.held.remove(conversation);
		let ended = s.background_runs.remove(conversation);
		drop(s);
		if ended {
			self.0.waiters.wake_all();
		}
	}

	/// Lessons whose current request an agent took and has not answered, with when.
	pub fn claimed_lessons(&self) -> Vec<Json> {
		let s = self.0.state.lock();
		s.items
			.iter()
			.filter(|i| !is_background(&i.conversation))
			.filter_map(|i| i.claimed_at.map(|at| json!({ "lessonId": i.conversation, "claimedAt": gs_base::time::iso(at) })))
			.collect()
	}

	/// How many requests wait for (or are being handled by) the agent.
	pub fn pending_work_count(&self) -> usize {
		self.0.state.lock().items.len()
	}

	/// Remembers the lesson an agent's waiter stays on (none: any work), so a Talk reply can
	/// send it back there.
	pub fn stay_on(&self, agent: Option<&str>, lesson_id: Option<&str>) {
		let mut s = self.0.state.lock();
		let key = agent.unwrap_or_default().to_owned();
		match lesson_id.filter(|l| !l.is_empty()) {
			Some(lesson) => s.staying_on.insert(key, lesson.to_owned()),
			None => s.staying_on.remove(&key),
		};
	}

	pub fn staying_on(&self, agent: Option<&str>) -> Option<String> {
		self.0.state.lock().staying_on.get(agent.unwrap_or_default()).cloned()
	}

	/// Ends a `respond_to_work` hold (the answering agent stopped waiting).
	pub fn release_conversation(&self, conversation: &str) {
		if self.0.state.lock().held.remove(conversation).is_some() {
			self.0.waiters.wake_all();
		}
	}

	fn emit(&self, kind: EventKind) {
		self.0.events.emit(kind, json!({}));
	}
}
