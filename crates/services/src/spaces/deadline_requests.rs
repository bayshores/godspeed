//! Deadline requests: the deadline page's asks, each one background run of the learner's agent
//! on one deadline. One request at a time per deadline, and none on a space godspeed checks
//! (`space_checks`); each start and end goes out as "deadline-request-changed". What godspeed
//! asked its agent about is kept in `data/deadline-requests.json` (`stores.asked`), with what the
//! old Talk chat asked.
//! A running request is background work: the activity feed lists it.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use gs_agent::subagents::deadline_request::{DeadlineRequest, run_deadline_request};
use gs_agent::subagents::pi_run::RunError;
use gs_agent::tools::fn_tool::FnTool;
use gs_agent::tools::space_actions::{SpaceActions, deadline_request_tools};
use gs_base::events::EventKind;
use gs_base::tasks::detach;
use gs_base::clock;
use gs_core::contracts::chat::TALK_CHAT_ID;
use gs_core::spaces::deadline_requests::{AskedRecord, RequestKind, RequestedDeadline, asked_deadline_ids, request_text, requested_deadline};
use gs_core::spaces::space_tools::ToolOutcome;
use gs_json::{Json, json, stringify};
use parking_lot::Mutex;

use super::space_actions::{Mark, space_actions};
use super::space_checks::CheckWrites;
use crate::App;
use crate::outcome::{Outcome, refuse};
use crate::turns::chat_handler::send_first_message;

/// Why a request changed nothing: the agent's own last line, or why its run stopped.
#[derive(Clone)]
enum Why {
	Said(String),
	Stopped(String),
}

struct Failed {
	kind: RequestKind,
	why: Why,
	links: String,
}

pub(crate) const BUSY: &str = "The teacher is still working on this deadline.";

/// What runs now.
#[derive(Default)]
pub(super) struct Running {
	/// Page requests by deadline id: their kind and space.
	pub deadlines: HashMap<String, (RequestKind, String)>,
	/// The space godspeed checks; one check at a time.
	pub checking: Option<String>,
}

/// The live requests, kept in memory only: a request does not outlive the server.
#[derive(Default)]
pub struct DeadlineRequestsState {
	pub(super) running: Mutex<Running>,
	/// Each running request's row in the activity feed, by its deadline's id (a check's by its
	/// space's).
	pub(super) rows: Mutex<Vec<Json>>,
	/// The last request from the page that changed nothing, why, and the deadline's links then.
	failed: Mutex<HashMap<String, Failed>>,
}

/// The deadline page asks for `kind` on one deadline.
pub fn request_deadline(app: &Arc<App>, space_id: &str, deadline_id: &str, kind: RequestKind) -> Outcome<()> {
	let Some(space) = app.stores.spaces.get_space(space_id) else { return refuse(404, "Unknown space") };
	let Some(deadline) = space["deadlines"].items().iter().find(|d| d["id"].as_str() == Some(deadline_id)) else { return refuse(404, "Unknown deadline") };
	if !start(app, kind, requested_deadline(&space, deadline)) {
		return refuse(409, BUSY);
	}
	Ok(())
}

/// The deadline's files and what it covers, to tell when the learner changed them.
fn links(app: &App, space_id: &str, deadline_id: &str) -> String {
	let space = app.stores.spaces.get_space(space_id);
	let deadline = space.as_ref().and_then(|s| s["deadlines"].items().iter().find(|d| d["id"].as_str() == Some(deadline_id)).cloned());
	let deadline = deadline.unwrap_or(Json::Null);
	stringify(&json!({ "fileIds": deadline["fileIds"], "leftOutIds": deadline["leftOutIds"], "source": deadline["source"], "aboutFileId": deadline["aboutFileId"] }))
}

/// What the deadline page shows: the request running on it (its kind), and the last one that
/// changed nothing, with what the agent said or why it stopped, until the deadline's files or
/// what it covers change.
pub fn deadline_request_view(app: &App, space_id: &str, deadline_id: &str) -> Json {
	let state = &app.spaces.requests;
	let running = state.running.lock().deadlines.get(deadline_id).map(|(kind, _)| kind.name());
	let mut failed = state.failed.lock();
	if failed.get(deadline_id).is_some_and(|f| f.links != links(app, space_id, deadline_id)) {
		failed.remove(deadline_id);
	}
	let failed = failed.get(deadline_id).map(|f| match &f.why {
		Why::Said(said) => json!({ "kind": f.kind.name(), "said": said }),
		Why::Stopped(error) => json!({ "kind": f.kind.name(), "error": error }),
	});
	json!({ "running": running, "failed": failed })
}

/// What godspeed asked its agent about, as saved.
pub(super) fn read_record(app: &App) -> AskedRecord {
	app.stores.asked.read()
}

/// Changes the record and saves it; a failed save is only logged.
pub(super) fn change_record(app: &App, change: impl FnOnce(&mut AskedRecord)) {
	app.stores.asked.update(change);
}

/// The deadline ids asked about: the record's and the old Talk chat's (read only, never written).
pub(super) fn asked(app: &App, record: &AskedRecord) -> HashSet<String> {
	let mut ids: HashSet<String> = record.asked.iter().cloned().collect();
	if let Some(talk) = app.stores.chats.get_chat(TALK_CHAT_ID) {
		ids.extend(asked_deadline_ids(talk["messages"].items()));
	}
	ids
}

/// The overdue deadlines the learner said Not yet to (Home asks about each once).
pub fn overdue_asked(app: &App) -> Vec<String> {
	read_record(app).overdue_asked.into_iter().collect()
}

/// The learner said Not yet to an overdue deadline: Home never asks about it again.
pub fn not_yet(app: &App, space_id: &str, deadline_id: &str) -> Outcome<()> {
	let Some(space) = app.stores.spaces.get_space(space_id) else { return refuse(404, "Unknown space") };
	if !space["deadlines"].items().iter().any(|d| d["id"].as_str() == Some(deadline_id)) {
		return refuse(404, "Unknown deadline");
	}
	change_record(app, |r| {
		r.overdue_asked.insert(deadline_id.to_owned());
	});
	Ok(())
}

/// The running requests and check as activity feed rows, `{ id, title, startedAt }`, oldest first.
pub fn deadline_request_rows(app: &App) -> Vec<Json> {
	app.spaces.requests.rows.lock().clone()
}

fn changed(app: &App, deadline: &RequestedDeadline) {
	app.events.emit(EventKind::DeadlineRequestChanged, json!({ "spaceId": deadline.space_id, "deadlineId": deadline.id }));
	app.events.emit(EventKind::ActivityChanged, json!({}));
}

/// Starts the run unless one already runs on the deadline or godspeed checks its space.
fn start(app: &Arc<App>, kind: RequestKind, deadline: RequestedDeadline) -> bool {
	{
		let mut running = app.spaces.requests.running.lock();
		if running.deadlines.contains_key(&deadline.id) || running.checking.as_deref() == Some(deadline.space_id.as_str()) {
			return false;
		}
		running.deadlines.insert(deadline.id.clone(), (kind, deadline.space_id.clone()));
	}
	app.spaces.requests.failed.lock().remove(&deadline.id);
	let label = format!("Deadline: {} {}", deadline.space_name, deadline.name);
	app.spaces.requests.rows.lock().push(json!({ "id": deadline.id, "title": label, "startedAt": clock::now_ms() }));
	changed(app, &deadline);

	let writes = Arc::new(RunWrites::default());
	let tools = deadline_request_tools(&writing_actions(app, writes.clone(), Mark::Asked), kind != RequestKind::Coverage);
	let request = DeadlineRequest { label, prompt: request_text(kind, std::slice::from_ref(&deadline)), tools: tools.into_iter().map(FnTool::into_arc).collect(), asked: true };
	let end = RequestEnd { app: app.clone(), deadline };
	detach("deadline-request", async move {
		let outcome = run_deadline_request(&end.app.bridge, request).await;
		ended(&end, kind, outcome, writes.wrote.load(Ordering::SeqCst));
	});
	true
}

/// A coverage run that ended counts its deadline as asked. One that changed nothing says why on
/// the page.
fn ended(end: &RequestEnd, kind: RequestKind, outcome: Result<String, RunError>, wrote: bool) {
	if outcome.is_ok() && kind == RequestKind::Coverage {
		change_record(&end.app, |r| {
			r.asked.insert(end.deadline.id.clone());
		});
	}
	let why = match outcome {
		Ok(_) if wrote => return,
		Ok(text) => last_line(&text).map_or_else(|| Why::Stopped("it changed nothing".to_owned()), |line| Why::Said(line.to_owned())),
		Err(err) => Why::Stopped(err.to_string()),
	};
	let d = &end.deadline;
	end.app.spaces.requests.failed.lock().insert(d.id.clone(), Failed { kind, why, links: links(&end.app, &d.space_id, &d.id) });
}

/// What one run wrote. A check also limits what it writes and keeps copies for Undo.
#[derive(Default)]
pub(super) struct RunWrites {
	pub wrote: AtomicBool,
	pub check: Option<CheckWrites>,
}

/// The space tools, as the learner's agent; `writes` learns of each change that goes through.
pub(super) fn writing_actions(app: &Arc<App>, writes: Arc<RunWrites>, mark: Mark) -> SpaceActions {
	let agent = app.bridge.agent_name(clock::now_ms());
	let actions = Arc::new(space_actions(app, agent.as_deref(), send_first_message(app), mark));
	let app = app.clone();
	Arc::new(move |name: &str, args: Json| {
		let (app, actions, name, writes) = (app.clone(), actions.clone(), name.to_owned(), writes.clone());
		Box::pin(async move {
			let before = match writes.check.as_ref().map(|check| check.before(&app, &name, &args)) {
				Some(Err(refusal)) => return ToolOutcome::Err(refusal),
				Some(Ok(before)) => before,
				None => None,
			};
			let outcome = actions.run(&name, &args).await.unwrap_or_else(|| ToolOutcome::Err(format!("{name} is not a space tool.")));
			if matches!(&outcome, ToolOutcome::Ok { changes, .. } if !changes.is_empty()) {
				writes.wrote.store(true, Ordering::SeqCst);
				if let (Some(check), Some(before)) = (&writes.check, before) {
					check.after(&app, &before);
				}
			}
			outcome
		})
	})
}

pub(super) fn last_line(text: &str) -> Option<&str> {
	text.lines().map(str::trim).rfind(|line| !line.is_empty())
}

/// Ends a request however its task ends: it is forgotten and the change announced.
struct RequestEnd {
	app: Arc<App>,
	deadline: RequestedDeadline,
}

impl Drop for RequestEnd {
	fn drop(&mut self) {
		let state = &self.app.spaces.requests;
		state.running.lock().deadlines.remove(&self.deadline.id);
		state.rows.lock().retain(|row| row["id"].as_str() != Some(&self.deadline.id));
		changed(&self.app, &self.deadline);
	}
}

#[cfg(test)]
mod tests {
	use gs_base::fsx;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	/// A space with one open exam and a ready study file: the app and the exam's id.
	fn one_exam(name: &str) -> (Arc<App>, String) {
		let app = test_app(&scratch_dir(name));
		let space = app.stores.spaces.create_space(&json!({ "name": "Wave Optics" })).unwrap();
		let id = space["id"].str_or_empty().to_owned();
		app.stores.spaces.save_files(&id, vec![json!({ "id": "f1", "origin": "copied", "name": "Notes.md", "path": "f1/Notes.md", "kind": "study", "contentFp": "x", "status": "ready", "addedAt": "2026-11-01T10:00:00.000Z" })], &[]).unwrap();
		let exam = app.stores.spaces.add_deadline(&id, &json!({ "kind": "exam", "name": "Final", "date": "2099-03-02" })).unwrap()["id"].str_or_empty().to_owned();
		(app, exam)
	}

	#[test]
	fn the_line_about_a_run_that_changed_nothing_goes_once_the_learner_links_files() {
		let (app, exam) = one_exam("deadline-requests-linked");
		let space = app.stores.spaces.list_space_records().remove(0);
		let space_id = space["id"].str_or_empty().to_owned();
		let end = RequestEnd { app: app.clone(), deadline: requested_deadline(&space, &space["deadlines"][0]) };
		ended(&end, RequestKind::Coverage, Ok("The files don't say.".to_owned()), false);
		drop(end);
		let said = r#"{"running":null,"failed":{"kind":"coverage","said":"The files don't say."}}"#;
		assert_eq!(stringify(&deadline_request_view(&app, &space_id, &exam)), said);
		assert_eq!(stringify(&deadline_request_view(&app, &space_id, &exam)), said, "it stays while nothing changes");
		assert!(read_record(&app).asked.contains(&exam), "a coverage run that ended counts as asked");
		app.stores.spaces.update_deadline(&space_id, &exam, &json!({ "fileIds": ["f1"] })).unwrap();
		assert_eq!(stringify(&deadline_request_view(&app, &space_id, &exam)), r#"{"running":null,"failed":null}"#);
	}

	#[test]
	fn a_page_request_waits_while_godspeed_checks_its_space() {
		let (app, exam) = one_exam("deadline-requests-checking");
		let space_id = app.stores.spaces.list_space_records()[0]["id"].str_or_empty().to_owned();
		app.spaces.requests.running.lock().checking = Some(space_id.clone());
		assert_eq!(request_deadline(&app, &space_id, &exam, RequestKind::Coverage), Err(crate::outcome::Stop::Refuse(409, BUSY.to_owned())));
	}

	#[test]
	fn not_yet_is_remembered_once_per_deadline() {
		let (app, exam) = one_exam("deadline-requests-not-yet");
		let space_id = app.stores.spaces.list_space_records()[0]["id"].str_or_empty().to_owned();
		fsx::write_json_atomic(&app.paths.data.join("deadline-requests.json"), &json!({ "version": 1, "asked": ["d_old"] })).unwrap();
		not_yet(&app, &space_id, &exam).unwrap();
		not_yet(&app, &space_id, &exam).unwrap();
		assert_eq!(overdue_asked(&app), [exam]);
		assert!(read_record(&app).asked.contains("d_old"), "a version 1 record keeps what it asked");
		assert_eq!(not_yet(&app, &space_id, "ddl_nope"), Err(crate::outcome::Stop::Refuse(404, "Unknown deadline".to_owned())));
	}
}
