//! The MCP-facing operations: take work, answer it, read its pages.

use gs_base::events::EventKind;
use gs_base::text::trim;
use gs_base::{clock, ids, shutdown};
use gs_core::contracts::chat::{CHAT_ID_PREFIX, TALK_CHAT_ID};
use gs_core::records::agent_seen::seen_mark;
use gs_json::Json;

use super::helper::{self, compacting_now, someone_compacting};
use super::terminals::closed;
use super::render::{instructions_and_tools, prints_of};
use super::view::{WorkView, remember_seen};
use super::{Bridge, State, WorkItem, is_background};
use crate::turn::messages::faux_assistant_message;

/// A claimed item with no reply after this long goes back in the queue (the agent crashed or
/// lost track of it).
pub(super) const CLAIM_TIMEOUT_MS: i64 = 10 * 60_000;

/// A wait wakes at least this often to look again.
const WAIT_SLICE_MS: i64 = 15_000;

/// Who asks for work.
#[derive(Clone, Default)]
pub struct WaitOptions {
	/// Stay on this conversation: its items (and Talk's, for a lesson) first.
	pub conversation: Option<String>,
	/// The asking agent's session id, when its client sends one.
	pub agent: Option<String>,
	/// Present the item in full even if the agent saw it before.
	pub full: bool,
	/// With a conversation, also take what nobody else would: another lesson's turns while no
	/// other waiter waits for them, and background jobs while no helper is here.
	pub and_others: bool,
	/// The helper's waiter.
	pub helper: bool,
	/// The app terminal the asking agent runs in; once it ends, the wait ends with nothing.
	pub terminal: Option<String>,
}

/// One tool call in an agent's reply.
#[derive(Clone, Debug)]
pub struct ReplyCall {
	pub name: String,
	pub arguments: Json,
}

/// What the agent sends back for one work item.
#[derive(Clone, Debug, Default)]
pub struct AgentReply {
	pub text: Option<String>,
	pub tool_calls: Vec<ReplyCall>,
}

/// The answered item's conversation and agent.
#[derive(Clone, Debug, PartialEq)]
pub struct Answered {
	pub conversation: String,
	pub agent: Option<String>,
}

fn no_item(work_id: &str) -> String {
	format!("No open work item \"{work_id}\" — it was already answered or the request was cancelled. Call wait_for_work for the current one.")
}

/// The open item a workId names, only while that claim is its latest.
pub(super) fn open_item(state: &State, work_id: &str) -> Option<usize> {
	let (id, claims) = work_id.rsplit_once('_')?;
	state.items.iter().position(|i| i.id == id && i.claims.to_string() == claims)
}

fn claimable(state: &State, item: &WorkItem, now: i64, taker: &WaitOptions) -> bool {
	let agent = taker.agent.as_deref();
	if agent.is_some_and(|a| compacting_now(state, a, now)) {
		return false;
	}
	let held = Some(item.conversation.as_str()) != taker.conversation.as_deref() && state.held.get(&item.conversation).is_some_and(|until| *until > now);
	// The helper answers a compacting teacher's lessons and Talk, so those holds do not count.
	let covers = taker.helper && !is_background(&item.conversation) && someone_compacting(state, now);
	if held && !covers {
		return false;
	}
	// An agent may take its own item again (a compaction lost its workId).
	if agent.is_some() && item.agent.as_deref() == agent {
		return true;
	}
	item.claimed_at.is_none_or(|at| now - at > CLAIM_TIMEOUT_MS)
}

/// The oldest claimable item that `keep` accepts, so jobs are answered in the order asked.
fn oldest(state: &State, now: i64, opts: &WaitOptions, keep: impl Fn(&WorkItem) -> bool) -> Option<usize> {
	let mut order: Vec<usize> = (0..state.items.len()).collect();
	order.sort_by_key(|&i| state.items[i].created_at);
	order.into_iter().find(|&i| {
		let item = &state.items[i];
		keep(item) && claimable(state, item, now, opts)
	})
}

/// No other wait is under way for this lesson: none stays on it, and none takes any work.
fn unwaited(state: &State, lesson: &str) -> bool {
	!state.waiting.iter().any(|(_, on)| on.as_deref().is_none_or(|on| on == lesson))
}

/// The next item. A teacher: any, or its conversation's (a lesson also takes Talk's, oldest first,
/// so Talk never waits on a lesson, and when asked another lesson's no one else waits for, so one
/// agent takes turns), then background jobs when asked; it leaves background jobs to a helper that
/// is here. A helper: background jobs, and what it began.
fn pick(state: &State, now: i64, opts: &WaitOptions) -> Option<usize> {
	if opts.helper {
		// A compacting teacher's lesson and Talk turns come first, so they wait one job step at most.
		let covered = if someone_compacting(state, now) { oldest(state, now, opts, |i| !is_background(&i.conversation)) } else { None };
		return covered.or_else(|| match opts.conversation.as_deref() {
			Some(conversation) => oldest(state, now, opts, |i| i.conversation == conversation),
			None => oldest(state, now, opts, |i| is_background(&i.conversation)),
		});
	}
	let alone = !helper::here(state, now);
	let Some(conversation) = opts.conversation.as_deref() else { return oldest(state, now, opts, |i| alone || !is_background(&i.conversation)) };
	let with_talk = conversation.starts_with(CHAT_ID_PREFIX);
	let others = with_talk && opts.and_others;
	oldest(state, now, opts, |i| i.conversation == conversation || (with_talk && i.conversation == TALK_CHAT_ID) || (others && !is_background(&i.conversation) && unwaited(state, &i.conversation)))
		.or_else(|| if opts.and_others && alone { oldest(state, now, opts, |i| is_background(&i.conversation)) } else { None })
}

/// A teacher's wait under way, in `State::waiting` until it ends however it ends.
struct Waiting<'a> {
	bridge: &'a Bridge,
	id: u64,
}

impl<'a> Waiting<'a> {
	fn start(bridge: &'a Bridge, on: Option<String>) -> Waiting<'a> {
		let mut s = bridge.0.state.lock();
		s.waits += 1;
		let id = s.waits;
		s.waiting.push((id, on));
		Waiting { bridge, id }
	}
}

impl Drop for Waiting<'_> {
	fn drop(&mut self) {
		self.bridge.0.state.lock().waiting.retain(|(id, _)| *id != self.id);
	}
}

enum Claim {
	Taken(Box<WorkView>),
	/// The background run this waiter stays on ended, or the waiter's terminal did: it sends
	/// nothing more.
	Ended,
	Nothing,
}

impl Bridge {
	/// Takes the next item for `opts`, if any.
	fn claim(&self, now: i64, opts: &WaitOptions) -> Claim {
		let mut s = self.0.state.lock();
		if closed(&s, opts.terminal.as_deref()) {
			return Claim::Ended;
		}
		let Some(i) = pick(&s, now, opts) else {
			let ended = opts.conversation.as_deref().is_some_and(|c| is_background(c) && !s.background_runs.contains(c));
			return if ended { Claim::Ended } else { Claim::Nothing };
		};
		let item = &mut s.items[i];
		item.claimed_at = Some(now);
		item.claims += 1;
		item.agent = opts.agent.clone();
		item.terminal = opts.terminal.clone();
		item.agent_forgot = false;
		let background = is_background(&item.conversation);
		let view = self.view(&mut s, i, opts.full);
		drop(s);
		self.emit(if background { EventKind::ActivityChanged } else { EventKind::AgentChanged });
		Claim::Taken(Box::new(view))
	}

	/// Waits up to `timeout_ms` for a request, claims it and presents it. None when nothing
	/// came, its background run or its terminal ended, or the server is stopping.
	pub async fn wait_for_work(&self, timeout_ms: i64, opts: WaitOptions) -> Option<WorkView> {
		// An empty lesson_id is no conversation in the TS (a falsy string).
		let opts = WaitOptions { conversation: opts.conversation.filter(|c| !c.is_empty()), ..opts };
		let deadline = clock::now_ms() + timeout_ms;
		// A helper's wait does not count: it takes lessons only while it covers for a teacher.
		let _waiting = (!opts.helper).then(|| Waiting::start(self, opts.conversation.clone()));
		// Held from a wake until this waiter's claim is done, so woken waiters claim in line.
		let mut ticket = None;
		loop {
			if shutdown::is_stopping() || closed(&self.0.state.lock(), opts.terminal.as_deref()) {
				return None;
			}
			let now = clock::now_ms();
			// A helper is not teaching: lessons still need the teacher.
			if opts.helper {
				self.note_helper(opts.agent.as_deref(), now);
			} else {
				self.record_check_in(None, true, now);
			}
			let seen = self.0.waiters.wakes();
			let claimed = self.claim(now, &opts);
			drop(ticket.take());
			match claimed {
				Claim::Taken(view) => return Some(*view),
				Claim::Ended => return None,
				Claim::Nothing => {}
			}
			let remaining = deadline - now;
			if remaining <= 0 {
				return None;
			}
			ticket = Some(self.0.waiters.wait(seen, clock::sleep(remaining.min(WAIT_SLICE_MS)), shutdown::wait()).await);
		}
	}

	/// Answers a work item. The conversation's next item is held for the answering agent for
	/// `hold_ms` (it waits for it right after; `release_conversation` ends the hold).
	pub fn respond_to_work(&self, work_id: &str, reply: AgentReply, hold_ms: i64) -> Result<Answered, String> {
		self.check_in_for(work_id);
		let mut s = self.0.state.lock();
		let i = open_item(&s, work_id).ok_or_else(|| no_item(work_id))?;
		let item = &s.items[i];
		if let Some(first) = item.unread.first() {
			let listed: Vec<String> = item.unread.iter().map(usize::to_string).collect();
			return Err(format!(
				"Read the rest of this work item first: page(s) {} of {} are unread. Call read_work with work_id \"{work_id}\" and page {first}.",
				listed.join(", "),
				item.pages.len()
			));
		}
		let names: Vec<String> = instructions_and_tools(&item.context).1.iter().map(|t| t["name"].as_str().unwrap_or("undefined").to_owned()).collect();
		let unknown: Vec<&str> = reply.tool_calls.iter().map(|c| c.name.as_str()).filter(|n| !names.iter().any(|k| k == n)).collect();
		if !unknown.is_empty() {
			let available = if names.is_empty() { "none".to_owned() } else { names.join(", ") };
			return Err(format!("Unknown tool(s): {}. Available: {available}.", unknown.join(", ")));
		}
		if reply.text.as_deref().is_none_or(|t| trim(t).is_empty()) && reply.tool_calls.is_empty() {
			return Err("A reply needs text, tool calls, or both.".to_owned());
		}
		let message = to_assistant(reply);
		let mut item = s.items.remove(i);
		// The agent knows its own reply: the next delivery here starts at the tool results.
		if !item.agent_forgot {
			let (prints, lead) = prints_of(&item.context, Some(&message));
			remember_seen(&mut s, self.0.seen.as_ref(), item.agent.as_deref(), &item.conversation, seen_mark(&prints, &lead));
		}
		s.held.insert(item.conversation.clone(), clock::now_ms() + hold_ms);
		drop(s);
		self.emit(EventKind::AgentChanged);
		if let Some(tx) = item.reply.take() {
			let _ = tx.send(message);
		}
		// The TS leaves out an empty agent id.
		Ok(Answered { conversation: item.conversation, agent: item.agent.filter(|a| !a.is_empty()) })
	}

	/// The conversation of an open work item.
	pub fn work_conversation(&self, work_id: &str) -> Option<String> {
		let s = self.0.state.lock();
		open_item(&s, work_id).map(|i| s.items[i].conversation.clone())
	}

	/// Keeps a presented item's pages; page 1 went out with it.
	pub fn set_work_pages(&self, work_id: &str, pages: Vec<Vec<String>>) {
		let mut s = self.0.state.lock();
		let Some(i) = open_item(&s, work_id) else { return };
		let item = &mut s.items[i];
		item.unread = (2..=pages.len()).collect();
		item.pages = pages;
	}

	/// One page of an open item (its text blocks) and the page count; the page counts as read.
	pub fn read_work_page(&self, work_id: &str, page: i64) -> Result<(Vec<String>, usize), String> {
		self.check_in_for(work_id);
		let mut s = self.0.state.lock();
		let i = open_item(&s, work_id).ok_or_else(|| no_item(work_id))?;
		let item = &mut s.items[i];
		let count = item.pages.len();
		if page < 1 || page as usize > count {
			return Err(format!("Work item \"{work_id}\" has page(s) 1 to {count}."));
		}
		item.unread.remove(&(page as usize));
		Ok((item.pages[page as usize - 1].clone(), count))
	}

	/// The open item a workId names, presented again in full: instructions, every tool and the
	/// whole transcript (the agent lost track of it).
	pub fn full_work_view(&self, work_id: &str) -> Result<WorkView, String> {
		self.check_in_for(work_id);
		let mut s = self.0.state.lock();
		let i = open_item(&s, work_id).ok_or_else(|| no_item(work_id))?;
		s.items[i].agent_forgot = false;
		Ok(self.view(&mut s, i, true))
	}

	/// The agent lost its context (compacted or cleared): its next items come in full. A
	/// cleared session is gone for good, so the items it held go to the next agent at once.
	pub fn forget_agent(&self, agent: &str, cleared: bool) {
		let mut s = self.0.state.lock();
		// It came back from compacting: the work is its own again.
		let back = s.compacting.remove(agent).is_some();
		for by_agent in s.seen_by.values_mut() {
			by_agent.remove(agent);
		}
		s.known.remove(agent);
		let mut released = false;
		for item in s.items.iter_mut().filter(|i| i.agent.as_deref() == Some(agent)) {
			item.agent_forgot = true;
			if cleared && item.claimed_at.is_some() {
				item.claimed_at = None;
				released = true;
			}
		}
		drop(s);
		if back {
			self.emit(EventKind::AgentChanged);
		}
		self.0.seen.forget_agent(agent);
		if released {
			self.emit(EventKind::AgentChanged);
		}
		if cleared {
			self.0.waiters.wake_all();
		}
	}
}

/// The reply as an assistant message (the outside agent's own call ids).
fn to_assistant(reply: AgentReply) -> Json {
	let mut blocks = Vec::new();
	if let Some(text) = reply.text.filter(|t| !trim(t).is_empty()) {
		blocks.push(crate::turn::messages::text_block(&text));
	}
	let stop = if reply.tool_calls.is_empty() { "stop" } else { "toolUse" };
	for call in reply.tool_calls {
		blocks.push(gs_json::json!({ "type": "toolCall", "id": ids::uuid_head("agent", 12), "name": call.name, "arguments": call.arguments }));
	}
	faux_assistant_message(blocks, stop)
}
