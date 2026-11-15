//! Deadline requests: the deadline page's asks and godspeed's own, each one background run of the
//! learner's agent on one or more deadlines. One request at a time per deadline; each start and
//! end goes out as "deadline-request-changed". godspeed asks about each unlinked deadline once:
//! the ids asked are kept in `data/deadline-requests.json`, with those the old Talk chat asked.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use gs_agent::subagents::deadline_request::{DeadlineRequest, run_deadline_request};
use gs_agent::tools::fn_tool::FnTool;
use gs_agent::tools::space_actions::{SpaceActions, deadline_request_tools};
use gs_base::events::EventKind;
use gs_base::{clock, fsx};
use gs_core::contracts::chat::TALK_CHAT_ID;
use gs_core::spaces::deadline_requests::{RequestKind, RequestedDeadline, asked_deadline_ids, request_text, requested_deadline, unlinked_deadlines};
use gs_core::spaces::space_tools::ToolOutcome;
use gs_core::spaces::today_note::local_day;
use gs_json::{Json, json};
use parking_lot::Mutex;

use super::space_actions::space_actions;
use crate::App;
use crate::outcome::{Outcome, refuse};
use crate::turns::chat_handler::send_first_message;

const ASKED_FILE: &str = "deadline-requests.json";

/// Why a request changed nothing: the agent's own last line, or why its run stopped.
#[derive(Clone)]
enum Why {
	Said(String),
	Stopped(String),
}

pub(crate) const BUSY: &str = "Your agent is still working on this deadline.";

/// The live requests, kept in memory only: a request does not outlive the server.
#[derive(Default)]
pub struct DeadlineRequestsState {
	running: Mutex<HashMap<String, RequestKind>>,
	/// The last request from the page that changed nothing, and why.
	failed: Mutex<HashMap<String, (RequestKind, Why)>>,
	/// godspeed's own request is on its way.
	asking: AtomicBool,
	/// Held while `deadline-requests.json` is read and written.
	asked_file: Mutex<()>,
}

/// The deadline page asks for `kind` on one deadline.
pub fn request_deadline(app: &Arc<App>, space_id: &str, deadline_id: &str, kind: RequestKind) -> Outcome<()> {
	let Some(space) = app.stores.spaces.get_space(space_id) else { return refuse(404, "Unknown space") };
	let Some(deadline) = space["deadlines"].items().iter().find(|d| d["id"].as_str() == Some(deadline_id)) else { return refuse(404, "Unknown deadline") };
	let requested = requested_deadline(&space, deadline);
	if !start(app, kind, vec![requested], true) {
		return refuse(409, BUSY);
	}
	if kind == RequestKind::Coverage {
		remember_asked(app, &[deadline_id.to_owned()]);
	}
	Ok(())
}

/// What the deadline page shows: the request running on it (its kind), and the last one that
/// changed nothing, with what the agent said or why it stopped.
pub fn deadline_request_view(app: &App, deadline_id: &str) -> Json {
	let state = &app.spaces.requests;
	let running = state.running.lock().get(deadline_id).map(|kind| kind.name());
	let failed = state.failed.lock().get(deadline_id).map(|(kind, why)| match why {
		Why::Said(said) => json!({ "kind": kind.name(), "said": said }),
		Why::Stopped(error) => json!({ "kind": kind.name(), "error": error }),
	});
	json!({ "running": running, "failed": failed })
}

/// godspeed asks about open deadlines with nothing linked, each once, in one request.
pub fn ask_about_unlinked(app: &Arc<App>, now: i64) {
	let state = &app.spaces.requests;
	if state.asking.load(Ordering::SeqCst) {
		return;
	}
	let mut skip = asked(app);
	skip.extend(state.running.lock().keys().cloned());
	let deadlines = unlinked_deadlines(&app.stores.spaces.list_space_records(), &local_day(now), &skip);
	// One request at a time: two agents that start waiting together both get here.
	if deadlines.is_empty() || state.asking.swap(true, Ordering::SeqCst) {
		return;
	}
	remember_asked(app, &deadlines.iter().map(|d| d.id.clone()).collect::<Vec<_>>());
	if !start(app, RequestKind::Coverage, deadlines, false) {
		state.asking.store(false, Ordering::SeqCst);
	}
}

/// The ids asked about: the file's and the old Talk chat's (read only, never written).
fn asked(app: &App) -> HashSet<String> {
	let _held = app.spaces.requests.asked_file.lock();
	let mut ids = asked_in_file(app);
	if let Some(talk) = app.stores.chats.get_chat(TALK_CHAT_ID) {
		ids.extend(asked_deadline_ids(talk["messages"].items()));
	}
	ids
}

fn asked_in_file(app: &App) -> HashSet<String> {
	let saved = fsx::read_json(&app.paths.data.join(ASKED_FILE));
	saved.map(|s| s["asked"].items().iter().filter_map(|id| id.as_str().map(str::to_owned)).collect()).unwrap_or_default()
}

fn remember_asked(app: &App, ids: &[String]) {
	let _held = app.spaces.requests.asked_file.lock();
	let mut asked = asked_in_file(app);
	asked.extend(ids.iter().cloned());
	let mut asked: Vec<String> = asked.into_iter().collect();
	asked.sort();
	if let Err(err) = fsx::write_json_atomic(&app.paths.data.join(ASKED_FILE), &json!({ "version": 1, "asked": asked })) {
		eprintln!("[deadline-request] saving the asked deadlines failed: {err}");
	}
}

fn changed(app: &App, deadlines: &[RequestedDeadline]) {
	for d in deadlines {
		app.events.emit(EventKind::DeadlineRequestChanged, json!({ "spaceId": d.space_id, "deadlineId": d.id }));
	}
}

/// Starts the run unless one already runs on one of the deadlines. `from_page`: the learner
/// asked, so a run that changed nothing says why on the page.
fn start(app: &Arc<App>, kind: RequestKind, deadlines: Vec<RequestedDeadline>, from_page: bool) -> bool {
	{
		let mut running = app.spaces.requests.running.lock();
		if deadlines.iter().any(|d| running.contains_key(&d.id)) {
			return false;
		}
		running.extend(deadlines.iter().map(|d| (d.id.clone(), kind)));
	}
	let mut failed = app.spaces.requests.failed.lock();
	for d in &deadlines {
		failed.remove(&d.id);
	}
	drop(failed);
	changed(app, &deadlines);

	let wrote = Arc::new(AtomicBool::new(false));
	let tools = deadline_request_tools(&writing_actions(app, wrote.clone()), kind != RequestKind::Coverage);
	let label = match deadlines.as_slice() {
		[one] => format!("Deadline: {} {}", one.space_name, one.name),
		many => format!("Deadlines: {}", many.len()),
	};
	let request = DeadlineRequest { label, prompt: request_text(kind, &deadlines), tools: tools.into_iter().map(FnTool::into_arc).collect() };
	let end = RequestEnd { app: app.clone(), deadlines, from_page };
	tokio::spawn(async move {
		let outcome = run_deadline_request(&end.app.bridge, request).await;
		if !end.from_page {
			return;
		}
		let why = match outcome {
			Ok(_) if wrote.load(Ordering::SeqCst) => return,
			Ok(text) => last_line(&text).map_or_else(|| Why::Stopped("it changed nothing".to_owned()), |line| Why::Said(line.to_owned())),
			Err(err) => Why::Stopped(err.to_string()),
		};
		end.app.spaces.requests.failed.lock().extend(end.deadlines.iter().map(|d| (d.id.clone(), (kind, why.clone()))));
	});
	true
}

/// The space tools, as the learner's agent; `wrote` is set once a change goes through.
fn writing_actions(app: &Arc<App>, wrote: Arc<AtomicBool>) -> SpaceActions {
	let agent = app.bridge.agent_name(clock::now_ms());
	let actions = Arc::new(space_actions(app, agent.as_deref(), send_first_message(app), false));
	Arc::new(move |name: &str, args: Json| {
		let (actions, name, wrote) = (actions.clone(), name.to_owned(), wrote.clone());
		Box::pin(async move {
			let outcome = actions.run(&name, &args).await.unwrap_or_else(|| ToolOutcome::Err(format!("{name} is not a space tool.")));
			if matches!(&outcome, ToolOutcome::Ok { changes, .. } if !changes.is_empty()) {
				wrote.store(true, Ordering::SeqCst);
			}
			outcome
		})
	})
}

fn last_line(text: &str) -> Option<&str> {
	text.lines().map(str::trim).rfind(|line| !line.is_empty())
}

/// Ends a request however its task ends: it is forgotten and the change announced.
struct RequestEnd {
	app: Arc<App>,
	deadlines: Vec<RequestedDeadline>,
	from_page: bool,
}

impl Drop for RequestEnd {
	fn drop(&mut self) {
		let state = &self.app.spaces.requests;
		let mut running = state.running.lock();
		for d in &self.deadlines {
			running.remove(&d.id);
		}
		drop(running);
		if !self.from_page {
			state.asking.store(false, Ordering::SeqCst);
		}
		changed(&self.app, &self.deadlines);
	}
}

#[cfg(test)]
mod tests {
	use gs_base::fsx;
	use gs_json::stringify;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[tokio::test]
	async fn godspeed_asks_once_about_what_neither_it_nor_the_old_talk_chat_asked() {
		let root = scratch_dir("deadline-requests");
		let app = test_app(&root);
		let space = app.stores.spaces.create_space(&json!({ "name": "Wave Optics" })).unwrap();
		let id = space["id"].str_or_empty().to_owned();
		app.stores.spaces.save_files(&id, vec![json!({ "id": "f1", "origin": "copied", "name": "Notes.md", "path": "f1/Notes.md", "kind": "study", "contentFp": "x", "status": "ready", "addedAt": "2026-11-01T10:00:00.000Z" })], &[]).unwrap();
		let mut deadlines = Vec::new();
		for name in ["Quiz", "Midterm", "Final"] {
			deadlines.push(app.stores.spaces.add_deadline(&id, &json!({ "kind": "exam", "name": name, "date": "2099-03-02" })).unwrap()["id"].str_or_empty().to_owned());
		}
		let talk = json!({ "id": TALK_CHAT_ID, "kind": "talk", "updatedAt": "2026-11-01T10:00:00.000Z", "messages": [
			{ "role": "custom", "customType": "app-request", "details": { "deadlines": [{ "id": deadlines[0] }] } },
		] });
		let record = app.paths.chats.join("chat_talk.json");
		fsx::write_text_atomic(&record, &stringify(&talk)).unwrap();
		let before = std::fs::read(&record).unwrap();
		fsx::write_json_atomic(&app.paths.data.join(ASKED_FILE), &json!({ "version": 1, "asked": [deadlines[1]] })).unwrap();

		ask_about_unlinked(&app, clock::now_ms());
		let running: Vec<String> = app.spaces.requests.running.lock().keys().cloned().collect();
		assert_eq!(running, [deadlines[2].clone()]);
		assert_eq!(asked(&app), deadlines.iter().cloned().collect());
		assert_eq!(std::fs::read(&record).unwrap(), before, "the old Talk chat is only read");
		ask_about_unlinked(&app, clock::now_ms());
		assert_eq!(app.spaces.requests.running.lock().len(), 1, "one request at a time");
	}
}
