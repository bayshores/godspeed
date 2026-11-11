//! Lesson deletion and the per-lesson coverage read (chats.ts). Deleting refuses while a turn or a
//! live job runs, true-cancels the lesson's extraction and waits it out, then purges the graph
//! traces, the jobs and the record in one synchronous block.

use std::sync::Arc;

use gs_agent::subagents::aborts::is_job_live;
use gs_base::clock;
use gs_core::graph::coverage::coverage_of;
use gs_core::graph::graph_deletion::{ChatDeleteMode, delete_chat_traces};
use gs_json::{Json, json};
use gs_store::graph::Ledger;

use super::turn_liveness::is_turn_running;
use super::turn_runs::clear_turn_failure;
use crate::App;
use crate::graph::extraction_runs::{abort_extraction, extraction_statuses};
use crate::graph::graph::{graph_revision, graph_store_for};
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

/// Quiesces one lesson before a synchronous graph rewrite (a delete or a class move): refuses
/// while a turn or job runs, aborts and waits out its extraction. None: run the rewrite now,
/// with no await in between.
pub async fn quiesce_chat_for_rewrite(app: &Arc<App>, chat_id: &str) -> Option<Refusal> {
	if let Some(blocker) = running_work_blocker(app, chat_id) {
		return Some(blocker);
	}
	let extracting = |app: &Arc<App>| extraction_statuses(app).iter().any(|run| run["chatId"].as_str() == Some(chat_id));
	if extracting(app) {
		abort_extraction(app, chat_id);
		let deadline = clock::now_ms() + WIND_DOWN_TIMEOUT_MS;
		while extracting(app) {
			if clock::now_ms() > deadline {
				return Some(Refusal { status: 503, code: "extraction_winding_down", error: "This lesson is still finishing its graph work. Try again in a moment.", job_ids: None });
			}
			clock::sleep(WIND_DOWN_POLL_MS).await;
		}
	}
	// A result wake or a worker may have started during the wind-down.
	running_work_blocker(app, chat_id)
}

/// Deletes a lesson: the gates, then ledgers, jobs and the record (last, so a crash leaves a
/// deletable lesson, never live traces of a deleted one).
pub async fn delete_chat_session(app: &Arc<App>, chat_id: &str, mode: ChatDeleteMode) -> Result<Result<Deleted, Refusal>, String> {
	let Some(record) = app.stores.chats.get_chat(chat_id) else {
		return Ok(Err(Refusal { status: 404, code: "not_found", error: "No such lesson", job_ids: None }));
	};
	if let Some(blocker) = quiesce_chat_for_rewrite(app, chat_id).await {
		return Ok(Err(blocker));
	}
	let scope = record["classId"].as_str();
	let stats = delete_chat_traces(graph_store_for(app, scope).as_ref(), chat_id, mode)?;
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
	let entries = app.stores.graphs.read(record["classId"].as_str(), Ledger::Coverage)?;
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
