//! Lesson deletion and the per-lesson coverage read (chats.ts). Deleting refuses while a turn or a
//! live job runs, true-cancels the lesson's extraction and waits it out, then purges the graph
//! traces, the jobs and the record under the lesson's lock.

use std::sync::Arc;

use gs_agent::subagents::aborts::is_job_live;
use gs_base::clock;
use gs_base::locks::LockKey;
use gs_core::graph::coverage::coverage_of;
use gs_core::graph::graph_deletion::ChatDeleteMode;
use gs_json::{Json, json};
use gs_store::graph::Ledger;

use super::turn_liveness::is_turn_running;
use super::turn_runs::clear_turn_failure;
use crate::App;
use crate::graph::extraction_runs::{abort_extraction, extraction_statuses, runs};
use crate::graph::graph::{delete_chat_from_graph, graph_revision};
use crate::jobs::discard_chat_deliveries;

/// How long the wind-down may take before the caller gets a retryable 503.
const WIND_DOWN_TIMEOUT_MS: i64 = 10_000;
const WIND_DOWN_POLL_MS: i64 = 50;

/// A refused delete or move: the route answers `{ error, code, jobIds? }` with `status`.
#[derive(Clone, Debug, PartialEq)]
pub struct Refusal {
	pub status: u16,
	pub code: &'static str,
	pub error: &'static str,
	/// Set for the 409s.
	pub job_ids: Option<Vec<String>>,
}

impl Refusal {
	pub fn to_json(&self) -> Json {
		let mut body = json!({ "error": self.error, "code": self.code });
		if let (Some(o), Some(ids)) = (body.as_obj_mut(), &self.job_ids) {
			o.insert("jobIds", ids.clone());
		}
		body
	}
}

/// What a delete did, for the route's 200.
pub struct Deleted {
	pub mode: ChatDeleteMode,
	pub stats: Json,
	pub jobs_removed: usize,
	pub graph_revision: f64,
}

/// The 409 when a turn or a live background job runs in this lesson.
pub fn running_work_blocker(app: &Arc<App>, chat_id: &str) -> Option<Refusal> {
	if is_turn_running(app, chat_id) {
		return Some(Refusal { status: 409, code: "turn_in_flight", error: "A turn is running in this lesson. Try again when it finishes.", job_ids: Some(Vec::new()) });
	}
	// A saved result without a live loop is pending data, not running work.
	let running: Vec<String> = app
		.stores
		.jobs
		.list_jobs(chat_id)
		.iter()
		.filter(|job| job["status"].as_str() == Some("running"))
		.filter(|job| !job["result"].truthy() || job_live(app, job))
		.filter_map(|job| job["id"].as_str().map(str::to_owned))
		.collect();
	if running.is_empty() {
		return None;
	}
	Some(Refusal { status: 409, code: "jobs_running", error: "Background jobs are still running in this lesson. Try again when they finish.", job_ids: Some(running) })
}

fn job_live(app: &Arc<App>, job: &Json) -> bool {
	job["id"].as_str().is_some_and(|id| is_job_live(&app.jobs.aborts, id))
}

/// An extraction of the lesson runs: from its claim, before it lists itself in the dock, to its
/// last batch.
fn extracting(app: &App, chat_id: &str) -> bool {
	runs(app).in_flight(chat_id) || extraction_statuses(app).iter().any(|run| run["chatId"].as_str() == Some(chat_id))
}

fn winding_down() -> Refusal {
	Refusal { status: 503, code: "extraction_winding_down", error: "This lesson is still finishing its graph work. Try again in a moment.", job_ids: None }
}

/// Quiesces one lesson before a graph rewrite (a delete or a space move): refuses while a turn or
/// job runs, aborts and waits out its extraction. None: take the lesson's lock and check
/// `rewrite_blocker` under it, since a turn or an extraction may start before the lock is taken.
pub async fn quiesce_chat_for_rewrite(app: &Arc<App>, chat_id: &str) -> Option<Refusal> {
	if let Some(blocker) = running_work_blocker(app, chat_id) {
		return Some(blocker);
	}
	let deadline = clock::now_ms() + WIND_DOWN_TIMEOUT_MS;
	while extracting(app, chat_id) {
		// Aborted on every pass: each batch lists itself with a new abort when it starts.
		abort_extraction(app, chat_id);
		if clock::now_ms() > deadline {
			return Some(winding_down());
		}
		clock::sleep(WIND_DOWN_POLL_MS).await;
	}
	// A result wake or a worker may have started during the wind-down.
	running_work_blocker(app, chat_id)
}

/// The last check before a rewrite, under the lesson's lock: a turn begins under it and an
/// extraction reads the lesson under it, so neither can start until the rewrite is done.
pub fn rewrite_blocker(app: &Arc<App>, chat_id: &str) -> Option<Refusal> {
	running_work_blocker(app, chat_id).or_else(|| extracting(app, chat_id).then(winding_down))
}

fn no_lesson() -> Refusal {
	Refusal { status: 404, code: "not_found", error: "No such lesson", job_ids: None }
}

/// Deletes a lesson: the gates, then ledgers, jobs and the record (last, so a crash leaves a
/// deletable lesson, never live traces of a deleted one).
pub async fn delete_chat_session(app: &Arc<App>, chat_id: &str, mode: ChatDeleteMode) -> Result<Result<Deleted, Refusal>, String> {
	// On its own task: a request whose client goes away is dropped at its next await, and once the
	// wind-down has aborted the lesson's extraction the delete must still finish.
	let (app, chat_id) = (app.clone(), chat_id.to_owned());
	tokio::spawn(async move { run_delete(&app, &chat_id, mode).await }).await.unwrap_or_else(|err| Err(err.to_string()))
}

async fn run_delete(app: &Arc<App>, chat_id: &str, mode: ChatDeleteMode) -> Result<Result<Deleted, Refusal>, String> {
	if app.stores.chats.get_chat(chat_id).is_none() {
		return Ok(Err(no_lesson()));
	}
	if let Some(blocker) = quiesce_chat_for_rewrite(app, chat_id).await {
		return Ok(Err(blocker));
	}
	// A turn begins under this lock, so none can start between the check and the removal. The
	// record is read again: a move may have changed its space during the wind-down.
	let _held = app.locks.lock(LockKey::Chat(chat_id));
	if let Some(blocker) = rewrite_blocker(app, chat_id) {
		return Ok(Err(blocker));
	}
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return Ok(Err(no_lesson())) };
	let scope = record["spaceId"].as_str();
	let stats = delete_chat_from_graph(app, scope, chat_id, mode)?;
	let jobs_removed = app.stores.jobs.delete_jobs_for_chat(chat_id);
	if app.stores.chats.delete_chat(chat_id) {
		discard_chat_deliveries(app, chat_id);
		clear_turn_failure(app, chat_id);
	}
	Ok(Ok(Deleted { mode, stats: stats.to_json(), jobs_removed, graph_revision: graph_revision(app, scope) }))
}

/// The sidebar menu's coverage block for one lesson, derived per request.
pub fn session_coverage(app: &Arc<App>, record: &Json) -> Result<Json, String> {
	let chat_id = record["id"].as_str().unwrap_or_default();
	let entries = app.stores.graphs.read(record["spaceId"].as_str(), Ledger::Coverage)?;
	let messages = record["messages"].as_arr().map_or(&[][..], Vec::as_slice);
	// Node's walk reads every message's role, so a null message fails the whole read.
	if messages.iter().any(Json::is_null) {
		return Err("Cannot read properties of null (reading 'role')".to_owned());
	}
	let cov = coverage_of(messages, &entries, chat_id);
	let mut last_folded_at: Option<&str> = None;
	for entry in entries.iter().filter(|e| e["chatId"].as_str() == Some(chat_id)) {
		let folded_at = entry["foldedAt"].as_str().unwrap_or_default();
		if last_folded_at.is_none_or(|last| folded_at > last) {
			last_folded_at = Some(folded_at);
		}
	}
	let running = extraction_statuses(app).iter().any(|run| run["kind"].as_str() == Some("chat") && run["chatId"].as_str() == Some(chat_id));
	Ok(json!({
		"totalMessages": cov.slots.len(),
		"coveredCount": cov.covered_count,
		"uncoveredCount": cov.uncovered_count,
		"coveredTokens": cov.covered_tokens,
		"uncoveredTokens": cov.uncovered_tokens,
		"running": running,
		"lastFoldedAt": last_folded_at,
	}))
}

#[cfg(test)]
mod tests {
	use std::time::Duration;

	use gs_json::stringify;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::turns::turn_liveness::begin_turn;

	fn fact(id: &str, chat_id: &str) -> Json {
		json!({ "id": id, "name": id, "statement": id, "createdAt": "2030-01-01T00:00:00.000Z", "aliases": [], "provenance": [{ "chatId": chat_id, "messageId": "m1" }] })
	}

	/// Runs the delete on its own thread, as a request would.
	fn delete_on_another_thread(app: &Arc<App>, chat_id: &str) -> std::thread::JoinHandle<Result<Deleted, Refusal>> {
		let (app, chat_id) = (app.clone(), chat_id.to_owned());
		std::thread::spawn(move || {
			let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
			runtime.block_on(delete_chat_session(&app, &chat_id, ChatDeleteMode::DeleteNodes)).unwrap()
		})
	}

	#[test]
	fn a_fact_merged_while_a_lesson_is_deleted_stays() {
		let root = scratch_dir("delete-merge");
		let app = test_app(&root);
		let chat_id = app.stores.chats.create_chat("Sets", None, None, None).unwrap()["id"].as_str().unwrap().to_owned();
		app.stores.graphs.append(None, Ledger::Nodes, &fact("n_gone", &chat_id)).unwrap();
		// An extraction's merge holds the graph while the delete arrives.
		let merging = app.locks.lock(LockKey::Graph(None));
		let delete = delete_on_another_thread(&app, &chat_id);
		std::thread::sleep(Duration::from_millis(100));
		app.stores.graphs.append(None, Ledger::Nodes, &fact("n_new", "chat_other")).unwrap();
		drop(merging);
		assert!(delete.join().unwrap().is_ok());
		let ids: Vec<String> = app.stores.graphs.read(None, Ledger::Nodes).unwrap().iter().map(|n| stringify(&n["id"])).collect();
		assert_eq!(ids, [r#""n_new""#]);
	}

	#[test]
	fn a_delete_waits_out_an_extraction_that_claimed_the_lesson_but_is_not_listed_yet() {
		let root = scratch_dir("delete-claimed");
		let app = test_app(&root);
		let chat_id = app.stores.chats.create_chat("Sets", None, None, None).unwrap()["id"].as_str().unwrap().to_owned();
		assert!(runs(&app).claim(&chat_id));
		let delete = delete_on_another_thread(&app, &chat_id);
		std::thread::sleep(Duration::from_millis(200));
		assert!(!delete.is_finished());
		runs(&app).release(&chat_id);
		assert!(delete.join().unwrap().is_ok());
	}

	#[tokio::test(flavor = "multi_thread")]
	async fn a_delete_whose_request_goes_away_during_the_wind_down_still_finishes() {
		let root = scratch_dir("delete-gone");
		let app = test_app(&root);
		let chat_id = app.stores.chats.create_chat("Sets", None, None, None).unwrap()["id"].as_str().unwrap().to_owned();
		assert!(runs(&app).claim(&chat_id));
		// The window closes while the delete waits out the extraction.
		tokio::select! {
			_ = delete_chat_session(&app, &chat_id, ChatDeleteMode::DeleteNodes) => panic!("the delete ended before the extraction"),
			() = clock::sleep(100) => {}
		}
		runs(&app).release(&chat_id);
		for _ in 0..200 {
			if app.stores.chats.get_chat(&chat_id).is_none() {
				break;
			}
			clock::sleep(10).await;
		}
		assert!(app.stores.chats.get_chat(&chat_id).is_none());
	}

	#[test]
	fn a_turn_that_starts_while_a_delete_waits_refuses_the_delete() {
		let root = scratch_dir("delete-turn");
		let app = test_app(&root);
		let chat_id = app.stores.chats.create_chat("Sets", None, None, None).unwrap()["id"].as_str().unwrap().to_owned();
		// The learner's message is being written ahead of its turn.
		let writing = app.locks.lock(LockKey::Chat(&chat_id));
		let delete = delete_on_another_thread(&app, &chat_id);
		std::thread::sleep(Duration::from_millis(100));
		assert!(begin_turn(&app, &chat_id));
		drop(writing);
		assert_eq!(delete.join().unwrap().err().map(|refusal| refusal.code), Some("turn_in_flight"));
		assert!(app.stores.chats.get_chat(&chat_id).is_some());
	}
}
