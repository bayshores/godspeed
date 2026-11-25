//! Each lesson's agent session: the one it goes on with, a new one when it rolls over, and what
//! each turn sends it. The record keeps `agentSession {agent, id, promptHash, seen}`: the agent
//! and its session that hold the lesson, the hash of the instructions and tools it opened with,
//! and the last message it saw. A changed agent or hash, a cut (compaction) after `seen`, a
//! session the agent no longer has, or Try again start a new session, which gets the summary and
//! the kept tail. An open session stays open between turns and closes after 10 idle minutes.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use gs_base::hash::sha256_text;
use gs_base::{clock, tasks};
use gs_core::messages::compaction_marks::active_compaction_of;
use gs_engine::turn::session_turn::{OpenFn, Opened, Opening, input_of};
use gs_json::{Json, json, stringify};
use gs_runtime::{Part, Runtime, Session, SessionSpec, ToolSpec};

use crate::App;
use crate::app::agent_folder::agent_folder;

const IDLE_CLOSE_MS: i64 = 10 * 60_000;

/// A lesson's open session, and the number of its last use.
pub(super) struct Kept {
	session: Arc<Session>,
	used: u64,
}

static USES: AtomicU64 = AtomicU64::new(0);

/// What a lesson's turn opens its session with and sends it.
pub(super) struct SessionPlan {
	pub chat_id: String,
	pub runtime: Arc<Runtime>,
	/// The folder the agent works in.
	pub cwd: PathBuf,
	/// The model the learner picked for new lessons; None is the agent's own default.
	pub model: Option<String>,
	pub prompt: String,
	pub tools: Vec<ToolSpec>,
	/// The record's `agentSession`.
	pub stored: Json,
	/// The record the turn runs on.
	pub messages: Vec<Json>,
	/// Try again: a new session, from before the failed or stopped reply.
	pub fresh: bool,
	/// The notes on the teacher's last reply, sent first.
	pub notes: Option<String>,
	/// The learner's rules, sent last to a session that read them only when it opened.
	pub rules: String,
	/// The time now and the time due, for a homework lesson on the day it is due: no stored
	/// message keeps it current, so every turn ends with it.
	pub due_today: Option<String>,
}

/// The folder the agent works in: the godspeed folder, made when it is missing.
pub(super) fn agent_cwd(app: &App) -> Result<PathBuf, String> {
	let folder = PathBuf::from(agent_folder(app));
	std::fs::create_dir_all(&folder).map_err(|err| format!("cannot make the godspeed folder {}: {err}", folder.display()))?;
	Ok(folder)
}

/// What a turn's settle needs of its plan.
pub(super) struct SessionPlanFacts {
	pub agent: &'static str,
	pub hash: String,
}

/// The hash of a session's instructions and tools: a change opens a new session.
fn prompt_hash(prompt: &str, tools: &[ToolSpec]) -> String {
	let specs: Vec<Json> = tools.iter().map(|t| json!({ "name": t.name, "description": t.description, "inputSchema": t.input_schema })).collect();
	sha256_text(&format!("{prompt}\0{}", stringify(&Json::Arr(specs))))[..32].to_owned()
}

impl SessionPlan {
	fn hash(&self) -> String {
		prompt_hash(&self.prompt, &self.tools)
	}

	pub(super) fn facts(&self) -> SessionPlanFacts {
		SessionPlanFacts { agent: self.runtime.agent().name(), hash: self.hash() }
	}

	/// The stored session and the last message it saw, when the lesson goes on with it.
	fn goes_on(&self) -> Option<(&str, &str)> {
		let stored = &self.stored;
		let same = stored["agent"].as_str() == Some(self.runtime.agent().name()) && stored["promptHash"].as_str() == Some(self.hash().as_str());
		if self.fresh || !same {
			return None;
		}
		let (id, seen) = (stored["id"].as_str()?, stored["seen"].as_str()?);
		let at = self.messages.iter().position(|m| m["id"].as_str() == Some(seen))?;
		let cut = active_compaction_of(&self.messages).and_then(|marker| self.messages.iter().position(|m| m["id"] == marker["id"]));
		cut.is_none_or(|cut| cut < at).then_some((id, seen))
	}

	fn spec(&self, resume: Option<&str>) -> SessionSpec {
		SessionSpec { cwd: self.cwd.clone(), model: self.model.clone(), instructions: self.prompt.clone(), tools: self.tools.clone(), resume: resume.map(str::to_owned), persist: true }
	}

	/// The notes, what the session has not seen, the rules for a session that goes on, and the
	/// clock on the day a homework lesson is due.
	fn input(&self, seen: Option<&str>) -> Vec<Part> {
		let notes = self.notes.iter().map(|notes| Part::Text(notes.clone()));
		let rules = seen.map(|_| Part::Text(self.rules.clone()));
		let due_today = self.due_today.iter().map(|line| Part::Text(line.clone()));
		notes.chain(input_of(&self.messages, seen)).chain(rules).chain(due_today).collect()
	}
}

/// The lesson's open session, when it is the one named `id`.
fn kept(app: &App, chat_id: &str, id: &str) -> Option<Arc<Session>> {
	let mut sessions = app.turns.sessions.lock();
	let kept = sessions.get_mut(chat_id).filter(|k| k.session.native_id() == id)?;
	kept.used = USES.fetch_add(1, Ordering::SeqCst);
	Some(kept.session.clone())
}

fn keep(app: &App, chat_id: &str, session: &Arc<Session>) {
	let used = USES.fetch_add(1, Ordering::SeqCst);
	app.turns.sessions.lock().insert(chat_id.to_owned(), Kept { session: session.clone(), used });
}

/// How a lesson's turn opens its session.
pub(super) fn opener(app: &Arc<App>, plan: SessionPlan) -> OpenFn {
	let (app, plan) = (Arc::downgrade(app), Arc::new(plan));
	Box::new(move |opening| {
		let (app, plan) = (app.clone(), plan.clone());
		Box::pin(async move {
			let app = app.upgrade().ok_or("godspeed is closing")?;
			open(&app, &plan, opening).await
		})
	})
}

async fn open(app: &App, plan: &SessionPlan, opening: Opening) -> Result<Opened, String> {
	let chat_id = plan.chat_id.as_str();
	if let Some((id, seen)) = plan.goes_on().filter(|_| opening == Opening::GoOn) {
		let session = match kept(app, chat_id, id) {
			Some(session) => Ok(session),
			None => plan.runtime.open(plan.spec(Some(id))).await.map(Arc::new),
		};
		match session {
			Ok(session) => {
				keep(app, chat_id, &session);
				return Ok(Opened { session, input: plan.input(Some(seen)), knew: true });
			}
			Err(err) => eprintln!("[chat {chat_id}] the lesson's session could not go on ({err}); a new one starts"),
		}
	}
	let session = Arc::new(plan.runtime.open(plan.spec(None)).await?);
	keep(app, chat_id, &session);
	Ok(Opened { session, input: plan.input(None), knew: false })
}

/// After a turn: the session that ran it is saved on the record with the last message it saw (a
/// turn that wrote nothing keeps the record as it was, and one whose agent compacted its own
/// history forgets it, so the next turn rolls over), and it closes after 10 idle minutes.
pub(super) fn settle_session(app: &Arc<App>, chat_id: &str, facts: &SessionPlanFacts, native_id: Option<String>, seen: Option<&str>, compacted: bool) {
	if let Some(id) = native_id.filter(|_| seen.is_some() || compacted) {
		let stored = if compacted { Json::Null } else { json!({ "agent": facts.agent, "id": id, "promptHash": facts.hash, "seen": seen }) };
		if let Err(err) = app.stores.chats.set_agent_session(chat_id, &stored) {
			eprintln!("[chat {chat_id}] saving the lesson's agent session failed: {err}");
		}
	}
	close_when_idle(app, chat_id);
}

fn close_when_idle(app: &Arc<App>, chat_id: &str) {
	let Some(used) = app.turns.sessions.lock().get(chat_id).map(|k| k.used) else { return };
	let (app, chat_id) = (Arc::downgrade(app), chat_id.to_owned());
	tasks::detach("lesson session", async move {
		clock::sleep(IDLE_CLOSE_MS).await;
		let Some(app) = app.upgrade() else { return };
		let mut sessions = app.turns.sessions.lock();
		if sessions.get(&chat_id).is_some_and(|k| k.used == used) {
			sessions.remove(&chat_id);
		}
	});
}
