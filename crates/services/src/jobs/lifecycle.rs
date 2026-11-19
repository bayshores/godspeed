//! A job's lifecycle: the dock's END, the delivery acknowledgement, and the lazy recovery of jobs
//! a process death left running.

use std::collections::HashSet;
use std::sync::Arc;

use gs_agent::subagents::aborts::{fire_job_abort, is_job_live};
use gs_base::clock;
use gs_core::session::jobs::{build_abort_steer, build_subagent_steer, is_subagent_failure, steer_delivered};
use gs_json::{Json, json};

use super::pump::pump;
use super::wake::{deliver_job_result, finalize_steer, note_steers_durable, queue_steer, steer_id};
use crate::App;
use crate::turns::turn_liveness::is_turn_running;

pub(super) const SWEEP_THROTTLE_MS: i64 = 30_000;

/// Why an abort was refused; the route maps it to 404 or 409.
#[derive(Debug, PartialEq, Eq)]
pub enum AbortRefusal {
	NotFound,
	NotRunning,
}

impl AbortRefusal {
	pub fn reason(&self) -> &'static str {
		match self {
			AbortRefusal::NotFound => "not_found",
			AbortRefusal::NotRunning => "not_running",
		}
	}
}

/// The dock's END on a job: kills the running loop, saves "Aborted by learner" with a pending
/// abort notice, and delivers that notice so the teacher learns no result is coming. A job whose
/// computation already finished is refused: its result belongs to the session.
pub fn abort_job(app: &Arc<App>, job_id: &str) -> Result<Result<(), AbortRefusal>, String> {
	let Some(job) = app.stores.jobs.get_job(job_id) else { return Ok(Err(AbortRefusal::NotFound)) };
	if job["status"].as_str() != Some("running") {
		return Ok(Err(AbortRefusal::NotRunning));
	}
	if job["result"].truthy() {
		normalize_legacy_result(app, (*job).clone())?;
		return Ok(Err(AbortRefusal::NotRunning));
	}
	// The job may have finished since the check above: then its result stands and nothing is aborted.
	let aborted = app.stores.jobs.update_job_if(
		job_id,
		&json!({ "status": "error", "error": "Aborted by learner", "activity": "aborted", "delivery": { "kind": "abort", "status": "pending" } }),
		|now| now["status"].as_str() == Some("running") && !now["result"].truthy(),
	)?;
	if aborted.is_none() {
		return Ok(Err(AbortRefusal::NotRunning));
	}
	fire_job_abort(&app.jobs.aborts, job_id);
	deliver_job_result(app, build_abort_steer(&job));
	Ok(Ok(()))
}

/// Acknowledges delivery on the job record without changing the worker's outcome. The
/// conversation is already saved, so a failure here is only logged.
pub(super) fn finalize_job(app: &App, job_id: &str) {
	let Some(stored) = app.stores.jobs.get_job(job_id) else { return };
	let mut job = (*stored).clone();
	if !job["delivery"].truthy() {
		match normalize_legacy_result(app, job) {
			Ok(normalized) => job = normalized,
			Err(error) => return eprintln!("[job {job_id}] delivery acknowledgement failed: {error}"),
		}
	}
	if job["delivery"]["status"].as_str() != Some("pending") {
		return;
	}
	let mut delivery = job["delivery"].clone();
	if let Some(obj) = delivery.as_obj_mut() {
		obj.insert("status", "delivered");
	}
	if let Err(error) = app.stores.jobs.update_job(job_id, &json!({ "delivery": delivery })) {
		eprintln!("[job {job_id}] delivery acknowledgement failed: {error}");
	}
}

/// A running record that already holds its result (saved by an older build) finishes now and
/// owes a result delivery.
fn normalize_legacy_result(app: &App, job: Json) -> Result<Json, String> {
	if job["delivery"].truthy() || job["status"].as_str() != Some("running") || !job["result"].truthy() {
		return Ok(job);
	}
	let failed = is_subagent_failure(job["kind"].str_or_empty(), &job["result"]);
	let patch = json!({
		"status": if failed { "error" } else { "done" },
		"activity": if failed { "failed" } else { "finished" },
		"delivery": { "kind": "result", "status": "pending" },
	});
	let id = job["id"].str_or_empty().to_owned();
	Ok(app.stores.jobs.update_job(&id, &patch)?.unwrap_or(job))
}

/// Puts the chat's known pending deliveries back in the registry; terminal records without
/// delivery metadata are never replayed.
pub(super) fn restore_pending_deliveries(app: &App, chat_id: &str) -> Result<(), String> {
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return Ok(()) };
	let messages = record["messages"].items();
	note_steers_durable(app, chat_id, messages);
	for stored in app.stores.jobs.list_jobs(chat_id) {
		let stored = (*stored).clone();
		let job = if is_job_live(&app.jobs.aborts, stored["id"].str_or_empty()) { stored } else { normalize_legacy_result(app, stored)? };
		if job["delivery"]["status"].as_str() != Some("pending") {
			continue;
		}
		let steer = if job["delivery"]["kind"].as_str() == Some("abort") {
			build_abort_steer(&job)
		} else if job["result"].truthy() {
			build_subagent_steer(&job, &job["result"])
		} else {
			continue;
		};
		if steer_delivered(messages, steer_id(&steer)) {
			finalize_steer(app, &steer);
		} else {
			queue_steer(app, chat_id, steer);
		}
	}
	Ok(())
}

/// Lazy crash recovery, at most once every 30 s, off the job and activity reads. A running job
/// with no live loop is an orphan of a process death: its saved result is delivered, or its loop
/// re-runs. A job with a live loop is never touched, however old.
fn recover_stale_jobs(app: &Arc<App>) {
	{
		let mut wake = app.jobs.wake.lock();
		let now = clock::now_ms();
		if now - wake.last_sweep_at < SWEEP_THROTTLE_MS {
			return;
		}
		wake.last_sweep_at = now;
	}
	if let Err(error) = sweep(app) {
		eprintln!("[jobs] stale-job recovery sweep failed: {error}");
	}
}

fn sweep(app: &Arc<App>) -> Result<(), String> {
	let chat_ids: HashSet<String> = app.stores.chats.list_chats().iter().filter_map(|c| c["id"].as_str().map(str::to_owned)).collect();
	for stored in app.stores.jobs.list_all_jobs() {
		let job = (*stored).clone();
		let id = job["id"].str_or_empty();
		let chat_id = job["chatId"].str_or_empty();
		let running = job["status"].as_str() == Some("running");
		if !running && job["delivery"]["status"].as_str() != Some("pending") {
			continue;
		}
		if !chat_ids.contains(chat_id) || is_job_live(&app.jobs.aborts, id) || is_turn_running(app, chat_id) {
			continue;
		}
		let recovered = normalize_legacy_result(app, job.clone())?;
		if recovered["delivery"]["status"].as_str() == Some("pending") {
			restore_pending_deliveries(app, chat_id)?;
			pump(app, chat_id.to_owned());
		} else if running && !job["result"].truthy() {
			let respawn = app.jobs.wake.lock().respawn.clone();
			let Some(respawn) = respawn else { continue };
			app.stores.jobs.update_job(id, &json!({ "activity": "recovering: re-running" }))?;
			respawn(id.to_owned());
		}
	}
	Ok(())
}

/// GET /api/jobs: one chat's jobs, after the lazy recovery.
pub fn list_jobs(app: &Arc<App>, chat_id: &str) -> Vec<Arc<Json>> {
	recover_stale_jobs(app);
	app.stores.jobs.list_jobs(chat_id)
}

/// The activity feed: every job, after the lazy recovery.
pub fn list_all_jobs(app: &Arc<App>) -> Vec<Arc<Json>> {
	recover_stale_jobs(app);
	app.stores.jobs.list_all_jobs()
}
