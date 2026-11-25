//! godspeed checks its spaces by itself. Each minute, and at once when a deadline is added, the
//! first space with a reason (`core::spaces::deadline_requests`) gets one background run of the
//! learner's agent with all its reasons, titled "Check: {space}". One check
//! runs at a time, never on a space with a page request running. A run that ends well marks its
//! reasons asked, even when it changed nothing; one that fails marks nothing and leaves its space
//! alone for an hour. A run that changed something keeps, in memory, each changed deadline's copy
//! before its first change and after its last, goes out as "space-checked", and can be undone.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

use gs_agent::subagents::deadline_request::{DeadlineRequest, run_deadline_request};
use gs_agent::tools::fn_tool::FnTool;
use gs_agent::tools::space_actions::space_check_tools;
use gs_base::events::EventKind;
use gs_base::tasks::detach;
use gs_base::{clock, ids, time};
use gs_core::spaces::check_lines::{DeadlineChange, FieldChange, change_lines};
use gs_core::spaces::deadline_requests::{Reason, check_text, space_reasons};
use gs_core::spaces::today_note::local_day;
use gs_engine::turn::job_session::RunError;
use gs_json::{Json, Obj, json};
use parking_lot::Mutex;

use super::deadline_requests::{RunWrites, asked, change_record, last_line, read_record, writing_actions};
use super::lifecycle::update_space;
use super::space_actions::Mark;
use crate::App;
use crate::app::agent_actions::record_check_undo;
use crate::app::settings_record::teacher_name;
use crate::graph::study_start::path_for;
use crate::jobs::job_agent::job_agent;
use crate::outcome::{Outcome, Stop, refuse};

/// A space whose check failed is not checked again for this long.
const COOL_MS: i64 = 60 * 60_000;
/// The newest runs kept for Undo.
const RUNS_KEPT: usize = 20;

/// What a check may write: each tool with the arguments it may give. `update_space` is among its
/// tools only when the path is a reason.
const CHECK_WRITES: [(&str, &[&str]); 3] = [
	("add_space_deadline", &["space_id", "deadlines"]),
	("update_space_deadline", &["space_id", "deadline_id", "kind", "name", "date", "time", "file_ids", "left_out_ids", "source", "assignment_file_id", "about_file_id"]),
	("update_space", &["space_id", "path", "description"]),
];

/// The space fields a check may change, kept before and after like its deadlines.
const CHECK_FIELDS: [&str; 2] = ["path", "description"];

const GONE: &str = "This change can no longer be undone.";

/// What one run changed: each deadline by id, and each space field.
#[derive(Default)]
struct Copies {
	deadlines: Vec<(String, DeadlineChange)>,
	fields: Vec<FieldChange>,
}

impl Copies {
	fn is_empty(&self) -> bool {
		self.deadlines.is_empty() && self.fields.is_empty()
	}
}

struct CheckRun {
	id: String,
	space_id: String,
	copies: Copies,
}

/// The checks' state, in memory only: Undo is gone after a restart.
#[derive(Default)]
pub struct SpaceChecksState {
	/// Spaces whose last check failed, and when they may be checked again.
	cooling: Mutex<HashMap<String, i64>>,
	/// The newest runs that changed something, oldest first.
	runs: Mutex<VecDeque<CheckRun>>,
	/// When the spaces were last scanned for reasons.
	scanned_at: Mutex<Option<i64>>,
}

/// A check's writes: only to its space, only with the arguments `CHECK_WRITES` lists.
pub(super) struct CheckWrites {
	space_id: String,
	copies: Mutex<Copies>,
}

impl CheckWrites {
	fn new(space_id: &str) -> CheckWrites {
		CheckWrites { space_id: space_id.to_owned(), copies: Mutex::new(Copies::default()) }
	}

	/// Err refuses the call; for a write, the space as it is before it.
	pub(super) fn before(&self, app: &App, name: &str, args: &Json) -> Result<Option<Json>, String> {
		let Some((_, allowed)) = CHECK_WRITES.iter().find(|(tool, _)| *tool == name) else { return Ok(None) };
		if args["space_id"].as_str() != Some(self.space_id.as_str()) {
			return Err(format!("This check changes only space {}.", self.space_id));
		}
		if let Some(key) = args.as_obj().into_iter().flat_map(Obj::keys).find(|key| !allowed.contains(&key.as_str())) {
			return Err(format!("{key} is not for this check."));
		}
		Ok(app.stores.spaces.get_space(&self.space_id))
	}

	/// After a write went through: each deadline and field it changed, against `before`.
	pub(super) fn after(&self, app: &App, before: &Json) {
		let Some(after) = app.stores.spaces.get_space(&self.space_id) else { return };
		let mut copies = self.copies.lock();
		for d in after["deadlines"].items() {
			let id = d["id"].str_or_empty();
			let was = before["deadlines"].items().iter().find(|b| b["id"].as_str() == Some(id));
			if was == Some(d) {
				continue;
			}
			match copies.deadlines.iter_mut().find(|(seen, _)| seen == id) {
				Some((_, change)) => change.after = d.clone(),
				None => copies.deadlines.push((id.to_owned(), DeadlineChange { before: was.cloned(), after: d.clone() })),
			}
		}
		for key in CHECK_FIELDS {
			if before[key] == after[key] {
				continue;
			}
			match copies.fields.iter_mut().find(|f| f.key == key) {
				Some(change) => change.after = after[key].clone(),
				None => copies.fields.push(FieldChange { key, before: before[key].clone(), after: after[key].clone() }),
			}
		}
	}
}

/// The spaces are scanned at most this often.
const SCAN_MS: i64 = 60_000;

/// The minute's scan: `check_spaces_now`, unless the spaces were scanned less than `SCAN_MS` ago.
pub fn check_spaces(app: &Arc<App>, now: i64) {
	if app.spaces.checks.scanned_at.lock().is_some_and(|at| now - at < SCAN_MS) {
		return;
	}
	check_spaces_now(app, now);
}

/// godspeed checks the first space that has a reason, unless a check runs. The first call after
/// this version came writes `since`, so files from before it are never checked.
pub fn check_spaces_now(app: &Arc<App>, now: i64) {
	if app.spaces.requests.running.lock().checking.is_some() {
		return;
	}
	*app.spaces.checks.scanned_at.lock() = Some(now);
	let mut record = read_record(app);
	if record.since.is_none() {
		change_record(app, |r| {
			r.since.get_or_insert_with(|| time::iso(now));
		});
		record = read_record(app);
	}
	let mut skip = asked(app, &record);
	let busy: HashSet<String> = {
		let running = app.spaces.requests.running.lock();
		skip.extend(running.deadlines.keys().cloned());
		running.deadlines.values().map(|(_, space)| space.clone()).collect()
	};
	let cooling = app.spaces.checks.cooling.lock().clone();
	let today = local_day(now);
	for space in app.stores.spaces.list_space_records() {
		let id = space["id"].str_or_empty();
		if busy.contains(id) || cooling.get(id).is_some_and(|until| now < *until) {
			continue;
		}
		let path = match path_for(app, id) {
			Ok(path) => path,
			Err(err) => {
				eprintln!("[space-check] reading the path of {id} failed: {err}");
				None
			}
		};
		let reasons = space_reasons(&space, path.as_ref(), &today, &record, &skip);
		if !reasons.is_empty() {
			start_check(app, &space, reasons);
			return;
		}
	}
}

fn start_check(app: &Arc<App>, space: &Json, reasons: Vec<Reason>) {
	let space_id = space["id"].str_or_empty().to_owned();
	{
		let mut running = app.spaces.requests.running.lock();
		// Two agents that start waiting together both get here.
		if running.checking.is_some() || running.deadlines.values().any(|(_, s)| *s == space_id) {
			return;
		}
		running.checking = Some(space_id.clone());
	}
	let label = format!("Check: {}", space["name"].str_or_empty());
	app.spaces.requests.rows.lock().push(json!({ "id": space_id, "title": label, "startedAt": clock::now_ms() }));
	app.events.emit(EventKind::ActivityChanged, json!({}));

	let writes = Arc::new(RunWrites { check: Some(CheckWrites::new(&space_id)), ..RunWrites::default() });
	let path = reasons.iter().any(|r| matches!(r, Reason::Path { .. }));
	let actions = writing_actions(app, writes.clone(), Mark::Background);
	let tools = space_check_tools(&actions, path);
	let agent = teacher_name(app);
	let request = DeadlineRequest { label, prompt: check_text(space, &reasons), tools: tools.into_iter().map(FnTool::into_arc).collect(), asked: false };
	let end = CheckEnd { app: app.clone(), space_id };
	detach("space-check", async move {
		let outcome = run_deadline_request(job_agent(&end.app).as_ref(), request).await;
		check_ended(&end, &reasons, outcome, &writes, &agent);
	});
}

fn check_ended(end: &CheckEnd, reasons: &[Reason], outcome: Result<String, RunError>, writes: &RunWrites, agent: &str) {
	let said = match outcome {
		Ok(text) => {
			change_record(&end.app, |r| r.mark(reasons));
			last_line(&text).map(str::to_owned)
		}
		Err(err) => {
			eprintln!("[space-check] the check of {} stopped: {err}", end.space_id);
			end.app.spaces.checks.cooling.lock().insert(end.space_id.clone(), clock::now_ms() + COOL_MS);
			None
		}
	};
	if let Some(check) = &writes.check {
		keep_run(&end.app, &end.space_id, std::mem::take(&mut *check.copies.lock()), agent, said);
	}
}

/// A run that changed something is kept for Undo and announced with its lines.
fn keep_run(app: &App, space_id: &str, mut copies: Copies, agent: &str, said: Option<String>) {
	copies.deadlines.retain(|(_, c)| c.before.as_ref() != Some(&c.after));
	copies.fields.retain(|f| f.before != f.after);
	if copies.is_empty() {
		return;
	}
	let record = app.stores.spaces.get_space(space_id).unwrap_or_default();
	let names: HashMap<String, String> = record["files"].items().iter().map(|f| (f["id"].str_or_empty().to_owned(), f["name"].str_or_empty().to_owned())).collect();
	let changes: Vec<DeadlineChange> = copies.deadlines.iter().map(|(_, c)| c.clone()).collect();
	let lines = change_lines(&changes, &copies.fields, &names);
	let id = ids::uuid_hex("chk", 12);
	let mut runs = app.spaces.checks.runs.lock();
	runs.push_back(CheckRun { id: id.clone(), space_id: space_id.to_owned(), copies });
	if runs.len() > RUNS_KEPT {
		runs.pop_front();
	}
	drop(runs);
	app.events.emit(EventKind::SpaceChecked, json!({ "run": id, "spaceId": space_id, "agent": agent, "lines": lines, "said": said }));
}

/// The deadline has a mock or a cheat sheet, which removing it would delete.
fn has_work(app: &App, space_id: &str, deadline_id: &str) -> Result<bool, String> {
	let mocks = app.stores.mocks.list_mocks(space_id)?;
	Ok(mocks.iter().any(|m| m["deadlineId"].as_str() == Some(deadline_id)) || app.stores.cheat_sheets.read_cheat_sheet(space_id, deadline_id)?.is_some())
}

/// Undoes a check's changes that are still as it left them: a deadline it added is removed, any
/// other goes back to its copy from before. `{ undone, changedSince, inUse }`: how many went
/// back, the names of deadlines (or keys of fields) changed since, and the names of added
/// deadlines kept for their mock or cheat sheet. A run is undone once, and the activity log
/// lists it as the learner's.
pub fn undo_check(app: &Arc<App>, space_id: &str, run_id: &str) -> Outcome<Json> {
	let run = {
		let mut runs = app.spaces.checks.runs.lock();
		let Some(at) = runs.iter().position(|r| r.id == run_id && r.space_id == space_id) else { return refuse(404, GONE) };
		runs.remove(at)
	};
	let Some(run) = run else { return refuse(404, GONE) };
	let (mut undone, mut changed_since, mut in_use) = (0, Vec::new(), Vec::new());
	for (id, change) in &run.copies.deadlines {
		let name = change.after["name"].str_or_empty().to_owned();
		if change.before.is_none() && has_work(app, space_id, id)? {
			in_use.push(name);
			continue;
		}
		if app.stores.spaces.restore_deadline(space_id, id, &change.after, change.before.as_ref())? {
			undone += 1;
		} else {
			changed_since.push(name);
		}
	}
	for FieldChange { key, before, after } in &run.copies.fields {
		let now = app.stores.spaces.get_space(space_id).map(|s| s[*key].clone());
		if now.as_ref() != Some(after) {
			changed_since.push((*key).to_owned());
			continue;
		}
		let mut patch = Obj::new();
		patch.insert(*key, before.clone());
		update_space(app, space_id, &Json::Obj(patch)).map_err(|f| Stop::Throw(f.error))?;
		undone += 1;
	}
	let name = app.stores.spaces.get_space(space_id).map(|s| s["name"].str_or_empty().to_owned()).unwrap_or_default();
	record_check_undo(app, space_id, &name);
	Ok(json!({ "undone": undone, "changedSince": changed_since, "inUse": in_use }))
}

/// Ends a check however its task ends: it is forgotten and the change announced.
struct CheckEnd {
	app: Arc<App>,
	space_id: String,
}

impl Drop for CheckEnd {
	fn drop(&mut self) {
		let state = &self.app.spaces.requests;
		state.running.lock().checking = None;
		state.rows.lock().retain(|row| row["id"].as_str() != Some(&self.space_id));
		self.app.events.emit(EventKind::ActivityChanged, json!({}));
	}
}

#[cfg(test)]
mod tests {
	use gs_base::fsx;
	use gs_core::spaces::deadline_requests::requested_deadline;
	use gs_core::spaces::space_tools::ToolOutcome;
	use gs_runtime::fake::{FakeAgent, FakeStep};

	use super::*;
	use crate::app::agent_actions::recent_agent_actions;
	use crate::app::agents::pick_stand_in;
	use crate::app::test_support::{scratch_dir, test_app};

	/// A space with a ready study file and an open exam with nothing linked: its id and the exam's.
	fn space_with_exam(app: &Arc<App>) -> (String, String) {
		let id = app.stores.spaces.create_space(&json!({ "name": "Wave Optics" })).unwrap()["id"].str_or_empty().to_owned();
		app.stores.spaces.save_files(&id, vec![json!({ "id": "f1", "origin": "copied", "name": "Notes.md", "path": "f1/Notes.md", "kind": "study", "contentFp": "x", "status": "ready", "addedAt": "2026-11-01T10:00:00.000Z" })], &[]).unwrap();
		let exam = app.stores.spaces.add_deadline(&id, &json!({ "kind": "exam", "name": "Final", "date": "2099-03-02" })).unwrap()["id"].str_or_empty().to_owned();
		(id, exam)
	}

	#[tokio::test]
	async fn the_first_check_writes_since_and_one_space_is_checked_at_a_time() {
		let root = scratch_dir("space-checks-start");
		let app = test_app(&root);
		let (space_id, _) = space_with_exam(&app);
		let other = app.stores.spaces.create_space(&json!({ "name": "Algebra" })).unwrap()["id"].str_or_empty().to_owned();
		fsx::write_json_atomic(&app.paths.data.join("deadline-requests.json"), &json!({ "version": 1, "asked": [] })).unwrap();
		check_spaces(&app, clock::now_ms());
		assert!(read_record(&app).since.is_some());
		assert_eq!(app.spaces.requests.running.lock().checking.as_deref(), Some(space_id.as_str()));
		let rows = crate::spaces::deadline_requests::deadline_request_rows(&app);
		assert_eq!((rows.len(), rows[0]["id"].as_str(), rows[0]["title"].as_str()), (1, Some(space_id.as_str()), Some("Check: Wave Optics")));
		app.stores.spaces.add_deadline(&other, &json!({ "kind": "exam", "name": "Quiz", "date": "2099-03-02" })).unwrap();
		check_spaces_now(&app, clock::now_ms());
		assert_eq!(app.spaces.requests.running.lock().checking.as_deref(), Some(space_id.as_str()), "one check at a time");
	}

	#[tokio::test]
	async fn waits_scan_at_most_once_a_minute_and_a_new_deadline_scans_at_once() {
		let root = scratch_dir("space-checks-throttle");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Wave Optics" })).unwrap()["id"].str_or_empty().to_owned();
		let t = clock::now_ms();
		check_spaces(&app, t);
		assert_eq!(*app.spaces.checks.scanned_at.lock(), Some(t), "nothing to check yet");
		app.stores.spaces.save_files(&space_id, vec![json!({ "id": "f1", "origin": "copied", "name": "Notes.md", "path": "f1/Notes.md", "kind": "study", "contentFp": "x", "status": "ready", "addedAt": "2026-11-01T10:00:00.000Z" })], &[]).unwrap();
		app.stores.spaces.add_deadline(&space_id, &json!({ "kind": "exam", "name": "Final", "date": "2099-03-02" })).unwrap();
		check_spaces(&app, t + SCAN_MS - 1);
		assert!(app.spaces.requests.running.lock().checking.is_none(), "a wait within the minute scans nothing");
		check_spaces(&app, t + SCAN_MS);
		assert_eq!(app.spaces.requests.running.lock().checking.as_deref(), Some(space_id.as_str()));
		app.spaces.requests.running.lock().checking = None;
		*app.spaces.checks.scanned_at.lock() = Some(t + SCAN_MS);
		check_spaces_now(&app, t + SCAN_MS + 1);
		assert_eq!(app.spaces.requests.running.lock().checking.as_deref(), Some(space_id.as_str()), "a new deadline scans at once");
	}

	#[test]
	fn a_space_with_a_page_request_or_a_failed_check_waits() {
		let root = scratch_dir("space-checks-wait");
		let app = test_app(&root);
		let (space_id, exam) = space_with_exam(&app);
		let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
		runtime.block_on(async {
			app.spaces.requests.running.lock().deadlines.insert("ddl_other".to_owned(), (gs_core::spaces::deadline_requests::RequestKind::Guide, space_id.clone()));
			check_spaces(&app, clock::now_ms());
			assert!(app.spaces.requests.running.lock().checking.is_none(), "a page request runs on the space");
			app.spaces.requests.running.lock().deadlines.clear();
		});
		drop(runtime);

		let space = app.stores.spaces.get_space(&space_id).unwrap();
		let reasons = vec![Reason::Unlinked(requested_deadline(&space, &space["deadlines"][0]))];
		let writes = RunWrites::default();
		let end = CheckEnd { app: app.clone(), space_id: space_id.clone() };
		check_ended(&end, &reasons, Err(RunError::Failed("the agent went away".to_owned())), &writes, "Claude Code");
		assert!(read_record(&app).asked.is_empty(), "a failed run marks nothing");
		let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
		runtime.block_on(async {
			check_spaces_now(&app, clock::now_ms());
			assert!(app.spaces.requests.running.lock().checking.is_none(), "the space cools for an hour");
			check_spaces(&app, clock::now_ms() + COOL_MS);
			assert_eq!(app.spaces.requests.running.lock().checking.as_deref(), Some(space_id.as_str()), "and is checked after it");
		});
		drop(runtime);
		check_ended(&end, &reasons, Ok("Linked nothing.".to_owned()), &writes, "Claude Code");
		assert_eq!(read_record(&app).asked.into_iter().collect::<Vec<_>>(), [exam], "a run that ended well marks its reasons");
	}

	fn check_run(app: &Arc<App>, space_id: &str) -> (Arc<RunWrites>, gs_agent::tools::space_actions::SpaceActions) {
		let writes = Arc::new(RunWrites { check: Some(CheckWrites::new(space_id)), ..RunWrites::default() });
		let actions = writing_actions(app, writes.clone(), Mark::Background);
		(writes, actions)
	}

	fn refusal(outcome: ToolOutcome) -> String {
		match outcome {
			ToolOutcome::Err(error) => error,
			ToolOutcome::Ok { .. } => panic!("it went through"),
		}
	}

	#[tokio::test]
	async fn a_check_writes_only_its_space_with_its_arguments_and_its_changes_are_marked_background() {
		let root = scratch_dir("space-checks-limits");
		let app = test_app(&root);
		let (space_id, exam) = space_with_exam(&app);
		let (other, _) = space_with_exam(&app);
		let (writes, actions) = check_run(&app, &space_id);
		let done = actions("update_space_deadline", json!({ "space_id": space_id, "deadline_id": exam, "done": true })).await;
		assert_eq!(refusal(done), "done is not for this check.");
		let elsewhere = actions("add_space_deadline", json!({ "space_id": other, "deadlines": [{ "kind": "quiz", "name": "Quiz", "date": "2099-01-01" }] })).await;
		assert_eq!(refusal(elsewhere), format!("This check changes only space {space_id}."));
		assert!(!writes.wrote.load(std::sync::atomic::Ordering::SeqCst));
		let read = actions("read_space", json!({ "space_id": other })).await;
		assert!(matches!(read, ToolOutcome::Ok { .. }), "reading is not limited");
		let moved = actions("update_space_deadline", json!({ "space_id": space_id, "deadline_id": exam, "date": "2099-03-04" })).await;
		assert!(matches!(moved, ToolOutcome::Ok { .. }));
		let action = recent_agent_actions(&app).into_iter().find(|a| a["label"].as_str() == Some("Moving Final")).unwrap();
		assert_eq!(action["background"], json!(true));
	}

	#[tokio::test]
	async fn undo_puts_back_what_is_still_as_the_check_left_it() {
		let root = scratch_dir("space-checks-undo");
		let app = test_app(&root);
		let (space_id, exam) = space_with_exam(&app);
		let quiz = app.stores.spaces.add_deadline(&space_id, &json!({ "kind": "quiz", "name": "Quiz 1", "date": "2099-01-10" })).unwrap();
		let quiz_id = quiz["id"].str_or_empty().to_owned();
		let before = app.stores.spaces.get_space(&space_id).unwrap();
		let mut events = app.events.subscribe();
		let (writes, actions) = check_run(&app, &space_id);
		let add = |name: &str, date: &str| json!({ "space_id": space_id, "deadlines": [{ "kind": "homework", "name": name, "date": date, "time": "23:59" }] });
		let added = |outcome: ToolOutcome| match outcome {
			ToolOutcome::Ok { value, .. } => value["deadlines"][0]["id"].str_or_empty().to_owned(),
			ToolOutcome::Err(error) => panic!("{error}"),
		};
		let hw5 = added(actions("add_space_deadline", add("HW 5", "2099-01-20")).await);
		let hw6 = added(actions("add_space_deadline", add("HW 6", "2099-01-27")).await);
		actions("update_space_deadline", json!({ "space_id": space_id, "deadline_id": exam, "file_ids": ["f1"] })).await;
		actions("update_space_deadline", json!({ "space_id": space_id, "deadline_id": exam, "date": "2099-03-05" })).await;
		actions("update_space_deadline", json!({ "space_id": space_id, "deadline_id": quiz_id, "name": "Quiz one" })).await;
		let end = CheckEnd { app: app.clone(), space_id: space_id.clone() };
		check_ended(&end, &[], Ok("Added HW 5 and HW 6.".to_owned()), &writes, "Claude Code");
		drop(end);
		let checked = std::iter::from_fn(|| events.try_recv().ok()).find(|e| e.kind == EventKind::SpaceChecked).expect("announced");
		let run = checked.payload["run"].str_or_empty().to_owned();
		assert_eq!(checked.payload["lines"], json!(["Added HW 5, due Tue Jan 20 11:59 PM", "Added HW 6, due Tue Jan 27 11:59 PM", "Moved Final to Thu Mar 5", "Linked Notes.md to Final", "Renamed Quiz 1 to Quiz one"]));
		assert_eq!((checked.payload["agent"].as_str(), checked.payload["said"].as_str(), checked.payload["spaceId"].as_str()), (Some("Claude Code"), Some("Added HW 5 and HW 6."), Some(space_id.as_str())));

		// Since the check: the learner renamed the quiz again, and HW 6 got a mock.
		app.stores.spaces.update_deadline(&space_id, &quiz_id, &json!({ "name": "Quiz 1b" })).unwrap();
		app.stores.mocks.write_mock(&space_id, &gs_core::mocks::mock::new_mock("mock_00000001", &hw6, 1.0, &json!({ "questions": 1 }), "t")).unwrap();
		assert_eq!(undo_check(&app, &space_id, "chk_nope"), Err(Stop::Refuse(404, GONE.to_owned())));
		let undone = undo_check(&app, &space_id, &run).unwrap();
		assert_eq!(undone, json!({ "undone": 2, "changedSince": ["Quiz one"], "inUse": ["HW 6"] }));
		let after = app.stores.spaces.get_space(&space_id).unwrap();
		let find = |id: &str| after["deadlines"].items().iter().find(|d| d["id"].as_str() == Some(id)).cloned();
		assert_eq!(find(&exam), before["deadlines"].items().iter().find(|d| d["id"].as_str() == Some(&exam)).cloned(), "the exam is as it was");
		assert!(find(&hw5).is_none() && find(&hw6).is_some());
		assert_eq!(find(&quiz_id).unwrap()["name"], json!("Quiz 1b"));
		assert_eq!(undo_check(&app, &space_id, &run), Err(Stop::Refuse(404, GONE.to_owned())), "a run is undone once");
	}

	#[test]
	fn a_changed_space_field_goes_back_like_a_deadline_and_only_the_newest_runs_are_kept() {
		let root = scratch_dir("space-checks-fields");
		let app = test_app(&root);
		let (space_id, _) = space_with_exam(&app);
		app.stores.spaces.update_space(&space_id, &json!({ "description": "Grown" })).unwrap();
		for n in 0..=RUNS_KEPT {
			let copies = Copies { fields: vec![FieldChange { key: "description", before: json!(""), after: json!(format!("Grown {n}")) }], ..Copies::default() };
			keep_run(&app, &space_id, copies, "Claude Code", None);
		}
		let runs: Vec<String> = app.spaces.checks.runs.lock().iter().map(|r| r.id.clone()).collect();
		assert_eq!(runs.len(), RUNS_KEPT);
		let copies = Copies { fields: vec![FieldChange { key: "description", before: json!(""), after: json!("Grown") }], ..Copies::default() };
		keep_run(&app, &space_id, copies, "Claude Code", None);
		let newest = app.spaces.checks.runs.lock().back().unwrap().id.clone();
		assert_eq!(undo_check(&app, &space_id, &runs[0]), Err(Stop::Refuse(404, GONE.to_owned())), "the oldest went");
		assert_eq!(undo_check(&app, &space_id, &runs[1]).unwrap(), json!({ "undone": 0, "changedSince": ["description"], "inUse": [] }));
		assert_eq!(undo_check(&app, &space_id, &newest).unwrap(), json!({ "undone": 1, "changedSince": [], "inUse": [] }));
		assert_eq!(app.stores.spaces.get_space(&space_id).unwrap()["description"], json!(""));
		let logged = recent_agent_actions(&app).into_iter().filter(|a| a["label"].as_str() == Some("Undid the check of Wave Optics")).collect::<Vec<_>>();
		assert_eq!(logged.len(), 1, "one entry per undo, as the learner's (repeats within minutes fold)");
		assert_eq!(logged[0]["agent"], json!("you"));
	}

	#[tokio::test]
	async fn a_path_running_low_is_checked_grown_and_undone() {
		let root = scratch_dir("space-checks-path");
		let app = test_app(&root);
		let topic = |i: usize| json!({ "id": format!("pth_{i}"), "name": format!("Topic {i}"), "covers": "c" });
		let path = json!({ "goal": "backend developer", "topics": (0..3).map(topic).collect::<Vec<_>>() });
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Backend", "path": path })).unwrap()["id"].str_or_empty().to_owned();
		check_spaces(&app, clock::now_ms());
		assert_eq!(app.spaces.requests.running.lock().checking.as_deref(), Some(space_id.as_str()), "3 topics, none strong");

		let (writes, actions) = check_run(&app, &space_id);
		let renamed = actions("update_space", json!({ "space_id": space_id, "name": "Backend 2" })).await;
		assert_eq!(refusal(renamed), "name is not for this check.");
		let grown = json!({ "goal": "backend developer", "topics": (0..5).map(|i| json!({ "name": format!("Topic {i}"), "covers": "c" })).collect::<Vec<_>>() });
		let went = actions("update_space", json!({ "space_id": space_id, "path": grown, "description": "From roadmap.sh" })).await;
		assert!(matches!(went, ToolOutcome::Ok { .. }));
		let mut events = app.events.subscribe();
		let end = CheckEnd { app: app.clone(), space_id: space_id.clone() };
		check_ended(&end, &[], Ok("Added 2 topics.".to_owned()), &writes, "Claude Code");
		drop(end);
		let checked = std::iter::from_fn(|| events.try_recv().ok()).find(|e| e.kind == EventKind::SpaceChecked).expect("announced");
		assert_eq!(checked.payload["lines"], json!(["Added 2 path topics", "Updated the description"]));
		assert_eq!(undo_check(&app, &space_id, checked.payload["run"].str_or_empty()).unwrap()["undone"], json!(2));
		let back = app.stores.spaces.get_space(&space_id).unwrap();
		assert_eq!((back["path"]["topics"].items().len(), back["description"].clone()), (3, json!("")));
	}

	#[tokio::test]
	async fn a_check_runs_on_the_learner_s_agent_with_its_own_tools() {
		let root = scratch_dir("space-checks-agent");
		let app = test_app(&root);
		let (space_id, exam) = space_with_exam(&app);
		let call = |args: Json| FakeStep::Tool { name: "update_space_deadline".to_owned(), args };
		let agent = FakeAgent::new(vec![vec![
			call(json!({ "space_id": space_id, "deadline_id": exam, "done": true })),
			call(json!({ "space_id": space_id, "deadline_id": exam, "file_ids": ["f1"] })),
			FakeStep::Text("Linked Notes.md.".to_owned()),
		]]);
		pick_stand_in(&app, agent.runtime());
		let mut events = app.events.subscribe();
		check_spaces(&app, clock::now_ms());
		let checked = tokio::time::timeout(std::time::Duration::from_secs(10), async {
			loop {
				let event = events.recv().await.expect("the app is alive");
				if event.kind == EventKind::SpaceChecked {
					return event;
				}
			}
		});
		let checked = checked.await.expect("the check ends");
		assert_eq!(checked.payload["lines"], json!(["Linked Notes.md to Final"]));
		assert_eq!((checked.payload["agent"].as_str(), checked.payload["said"].as_str()), (Some("Teacher"), Some("Linked Notes.md.")), "the work is the teacher's");
		let results: Vec<Json> = agent.sent().into_iter().filter(|m| m["type"].as_str() == Some("tool_result")).collect();
		assert_eq!((results[0]["isError"].clone(), results[0]["content"][0]["text"].clone()), (json!(true), json!("done is not for this check.")));
		assert_eq!(recent_agent_actions(&app)[0]["background"], json!(true));
	}
}
