//! The wake pipeline: delivers finished sub-agent jobs (and probe handoffs) into their lesson.
//!
//! One registry per chat, two vehicles. While a turn streams, pending markers go into the live
//! agent's steering queue and land at its next turn boundary; settlement (`settle_steers`) then
//! resolves what the run persisted and returns the rest to pending. With no live turn the pump
//! waits for the chat to go idle (no turn, no open question) and fires one wake turn carrying
//! every pending marker. A marker already in the transcript is never delivered twice.
//!
//! Job records own the obligation (`delivery: pending`), so recovery after a restart rebuilds
//! the registry from them; learner steers (`steer_live_chat`) are memory-only.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use gs_agent::subagents::aborts::{fire_job_abort, is_job_live};
use gs_base::clock;
use gs_base::events::EventKind;
use gs_base::locks::LockKey;
use gs_core::messages::input_events::messages_of;
use gs_core::messages::native_messages::{dangling_question_of, ends_in_dismissal, open_question_held};
use gs_core::session::jobs::{build_abort_steer, build_subagent_steer, is_subagent_failure, steer_delivered};
use gs_engine::turn::agent::Agent;
use gs_json::{Json, json};

use crate::App;
use crate::turns::turn_liveness::is_turn_running;

/// Fires one server-side turn for a chat with this input (`{type: "steers", steers}`) and
/// answers its HTTP status. A turn that crashed answers 500.
pub type TurnRunner = Arc<dyn Fn(String, Json) -> Pin<Box<dyn Future<Output = u16> + Send>> + Send + Sync>;

/// Re-runs a job's sub-agent loop (recovery of a job whose process died).
pub type JobRespawn = Arc<dyn Fn(String) + Send + Sync>;

const POLL_MS: i64 = 400;
/// After the gates open, a learner's answer POST may still be in flight: wait a beat so the wake
/// does not 409 it. A miss heals itself through the 409 backoff.
const GRACE_MS: i64 = 750;
/// 409 backoff, capped so a busy client cannot spin the pump.
const RETRY_BACKOFF_MS: [i64; 4] = [500, 1000, 2000, 5000];
const SWEEP_THROTTLE_MS: i64 = 30_000;

struct QueuedSteer {
	/// Tells entries apart while the lock is let go (the TS compares objects).
	seq: u64,
	steer: Json,
	/// Wake cargo: still owned here, but never steered into its own run.
	waking: bool,
	/// The wake's agent, once its turn registered it. Until then only the pump frees `waking`.
	wake_agent: Option<Arc<Agent>>,
	/// A failed start waits for a learner run or a restart, not a timer.
	deferred: bool,
	/// The live agent this marker was steered into; cleared at settlement if it never landed.
	handed_to: Option<Arc<Agent>>,
}

/// A learner steer parked until a run persists it.
struct UserSteer {
	message: Json,
	handed_to: Option<Arc<Agent>>,
}

#[derive(Default)]
pub struct Wake {
	turn_runner: Option<TurnRunner>,
	respawn: Option<JobRespawn>,
	/// chat id → markers awaiting delivery, in arrival order.
	queues: HashMap<String, Vec<QueuedSteer>>,
	/// chat id → learner steers awaiting a run that persists them.
	user_steers: HashMap<String, Vec<UserSteer>>,
	/// chat id → the agent of the turn streaming now.
	live_agents: HashMap<String, Arc<Agent>>,
	/// Chats whose pump runs (one per chat).
	pumping: HashSet<String>,
	last_sweep_at: i64,
	next_seq: u64,
}

impl Wake {
	fn queue(&self, chat_id: &str) -> &[QueuedSteer] {
		self.queues.get(chat_id).map_or(&[], Vec::as_slice)
	}

	fn entry(&mut self, chat_id: &str, seq: u64) -> Option<&mut QueuedSteer> {
		self.queues.get_mut(chat_id)?.iter_mut().find(|e| e.seq == seq)
	}

	fn remove_entry(&mut self, chat_id: &str, seq: u64) -> Option<QueuedSteer> {
		let queue = self.queues.get_mut(chat_id)?;
		let at = queue.iter().position(|e| e.seq == seq)?;
		let entry = queue.remove(at);
		if queue.is_empty() {
			self.queues.remove(chat_id);
		}
		Some(entry)
	}
}

fn held_by(handed: &Option<Arc<Agent>>, agent: &Arc<Agent>) -> bool {
	handed.as_ref().is_some_and(|h| Arc::ptr_eq(h, agent))
}

fn is_probe_handoff(steer: &Json) -> bool {
	steer["customType"].as_str() == Some("probe-handoff")
}

/// The job a steer belongs to; None for a probe handoff.
fn job_id_of(steer: &Json) -> Option<&str> {
	steer["details"]["jobId"].as_str()
}

fn steer_id(steer: &Json) -> &str {
	steer["id"].as_str().unwrap_or_default()
}

/// The chat handler wires its adapter around `handle_chat_input` here.
pub fn set_turn_runner(app: &App, run: TurnRunner) {
	app.jobs.wake.lock().turn_runner = Some(run);
}

/// The chat handler wires its job runner's `run_job` here.
pub fn set_job_respawn(app: &App, respawn: JobRespawn) {
	app.jobs.wake.lock().respawn = Some(respawn);
}

/// Call only after the conversation is saved: acknowledges every job marker in `persisted` and
/// drops the registry entries it holds. Streaming visibility is not acceptance.
pub fn note_steers_durable(app: &App, chat_id: &str, persisted: &[Json]) {
	for message in persisted.iter().filter(|m| m["role"].as_str() == Some("custom")) {
		finalize_steer(app, message);
	}
	let ids: HashSet<&str> = persisted.iter().filter_map(|m| m["id"].as_str()).collect();
	let done: Vec<u64> = app.jobs.wake.lock().queue(chat_id).iter().filter(|e| ids.contains(steer_id(&e.steer))).map(|e| e.seq).collect();
	for seq in done {
		complete_entry(app, chat_id, seq);
	}
}

fn complete_entry(app: &App, chat_id: &str, seq: u64) {
	let steer = app.jobs.wake.lock().entry(chat_id, seq).map(|e| e.steer.clone());
	if let Some(steer) = steer {
		finalize_steer(app, &steer);
		app.jobs.wake.lock().remove_entry(chat_id, seq);
	}
}

/// A deleted chat drops its obligations and is never woken.
pub fn discard_chat_deliveries(app: &App, chat_id: &str) {
	let mut wake = app.jobs.wake.lock();
	wake.queues.remove(chat_id);
	wake.user_steers.remove(chat_id);
}

fn finalize_steer(app: &App, steer: &Json) {
	if let Some(job_id) = job_id_of(steer) {
		finalize_job(app, job_id);
	}
}

/// Queues one delivery per steer id (a duplicate shares the entry) and starts the pump. Nothing
/// waits for it: the job record keeps the obligation until the marker is saved.
pub fn deliver_job_result(app: &Arc<App>, steer: Json) {
	let chat_id = chat_id_of(app, &steer);
	queue_steer(app, &chat_id, steer);
	pump(app, chat_id);
}

fn queue_steer(app: &App, chat_id: &str, steer: Json) {
	let mut wake = app.jobs.wake.lock();
	if wake.queue(chat_id).iter().any(|e| steer_id(&e.steer) == steer_id(&steer)) {
		return;
	}
	wake.next_seq += 1;
	let seq = wake.next_seq;
	wake.queues.entry(chat_id.to_owned()).or_default().push(QueuedSteer { seq, steer, waking: false, wake_agent: None, deferred: false, handed_to: None });
}

/// Steers every eligible pending marker, then every parked learner steer, into a live agent
/// (once per agent). Probe handoffs never ride a live run: they must start the teacher's run.
fn hand_off_eligible(app: &App, chat_id: &str, agent: &Arc<Agent>) {
	let mut wake = app.jobs.wake.lock();
	if let Some(queue) = wake.queues.get_mut(chat_id) {
		for entry in queue.iter_mut().filter(|e| !e.waking && !e.deferred && !held_by(&e.handed_to, agent) && !is_probe_handoff(&e.steer)) {
			agent.steer(entry.steer.clone());
			entry.handed_to = Some(agent.clone());
		}
	}
	if let Some(queue) = wake.user_steers.get_mut(chat_id) {
		for entry in queue.iter_mut().filter(|e| !held_by(&e.handed_to, agent)) {
			agent.steer(entry.message.clone());
			entry.handed_to = Some(agent.clone());
		}
	}
}

/// Registers the agent of the turn about to stream (before it starts, so its first steering
/// poll sees the markers) and steers pending markers into it. `allow_deferred` frees markers
/// a failed wake left waiting; `wake_steer_ids` names the cargo this turn itself carries.
pub fn register_live_agent(app: &App, chat_id: &str, agent: &Arc<Agent>, allow_deferred: bool, wake_steer_ids: Option<&HashSet<String>>) -> Result<(), String> {
	app.jobs.wake.lock().live_agents.insert(chat_id.to_owned(), agent.clone());
	restore_pending_deliveries(app, chat_id)?;
	if let Some(queue) = app.jobs.wake.lock().queues.get_mut(chat_id) {
		for entry in queue.iter_mut() {
			if allow_deferred {
				entry.deferred = false;
			}
			if entry.waking && wake_steer_ids.is_some_and(|ids| ids.contains(steer_id(&entry.steer))) {
				entry.wake_agent = Some(agent.clone());
			}
		}
	}
	hand_off_eligible(app, chat_id, agent);
	Ok(())
}

/// The agent of the chat's turn, while one is registered.
pub fn live_agent(app: &App, chat_id: &str) -> Option<Arc<Agent>> {
	app.jobs.wake.lock().live_agents.get(chat_id).cloned()
}

/// The steer route's hand-off: false when no turn is live (the route answers 409). The parked
/// copy rides the chat's next run if this one ends before persisting it.
pub fn steer_live_chat(app: &App, chat_id: &str, message: Json) -> bool {
	let mut wake = app.jobs.wake.lock();
	let Some(agent) = wake.live_agents.get(chat_id).cloned() else { return false };
	agent.steer(message.clone());
	wake.user_steers.entry(chat_id.to_owned()).or_default().push(UserSteer { message, handed_to: Some(agent) });
	true
}

/// At settlement: learner steers the run persisted drop, the rest stay parked.
pub fn reconcile_user_steers(app: &App, chat_id: &str, persisted: &[Json]) {
	let mut wake = app.jobs.wake.lock();
	let Some(queue) = wake.user_steers.get_mut(chat_id) else { return };
	let ids: HashSet<Option<&str>> = persisted.iter().map(|m| m["id"].as_str()).collect();
	queue.retain(|e| !ids.contains(&e.message["id"].as_str()));
	if queue.is_empty() {
		wake.user_steers.remove(chat_id);
	}
}

/// Clears the live agent at settlement, before `settle_steers`, so its re-pump cannot hand a
/// marker to the dying agent.
pub fn unregister_live_agent(app: &App, chat_id: &str) {
	app.jobs.wake.lock().live_agents.remove(chat_id);
}

/// At settlement, with the run's persisted messages: markers it delivered are acknowledged;
/// markers handed to it (or carried by it) that never landed return to pending, deferred when
/// the run failed, and the pump restarts.
pub fn settle_steers(app: &Arc<App>, chat_id: &str, persisted: &[Json], failed: bool, settled_agent: Option<&Arc<Agent>>) {
	let delivered_ids: HashSet<&str> = persisted.iter().filter_map(|m| m["id"].as_str()).filter(|id| !id.is_empty()).collect();
	let (delivered, any_left) = {
		let mut wake = app.jobs.wake.lock();
		let Some(queue) = wake.queues.remove(chat_id).filter(|q| !q.is_empty()) else { return };
		let mut delivered = Vec::new();
		let mut remaining = Vec::new();
		for mut entry in queue {
			if delivered_ids.contains(steer_id(&entry.steer)) {
				delivered.push(entry.steer);
				continue;
			}
			let handed_here = entry.handed_to.as_ref().is_some_and(|h| settled_agent.is_none_or(|a| Arc::ptr_eq(h, a)));
			let wake_here = settled_agent.is_some_and(|a| held_by(&entry.wake_agent, a));
			if handed_here {
				entry.handed_to = None;
			}
			if wake_here {
				entry.waking = false;
				entry.wake_agent = None;
			}
			if failed && (handed_here || wake_here) && job_id_of(&entry.steer).is_some() {
				entry.deferred = true;
			}
			remaining.push(entry);
		}
		let any_left = !remaining.is_empty();
		if any_left {
			wake.queues.insert(chat_id.to_owned(), remaining);
		}
		(delivered, any_left)
	};
	for steer in &delivered {
		finalize_steer(app, steer);
	}
	if any_left {
		pump(app, chat_id.to_owned());
	}
}

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

/// A probe handoff names its chat; a job steer's chat is on its job record.
fn chat_id_of(app: &App, steer: &Json) -> String {
	if is_probe_handoff(steer) {
		return steer["details"]["chatId"].as_str().unwrap_or_default().to_owned();
	}
	job_id_of(steer).and_then(|id| app.stores.jobs.get_job(id)).and_then(|job| job["chatId"].as_str().map(str::to_owned)).unwrap_or_default()
}

/// Starts the chat's pump unless one runs. The pump clears dead weight, then hands every
/// eligible marker to a live turn, or waits for idle and fires one wake turn.
fn pump(app: &Arc<App>, chat_id: String) {
	if chat_id.is_empty() || !app.jobs.wake.lock().pumping.insert(chat_id.clone()) {
		return;
	}
	let app = app.clone();
	tokio::spawn(async move {
		let parked = run_pump(&app, &chat_id).await;
		let restart = {
			let mut wake = app.jobs.wake.lock();
			wake.pumping.remove(&chat_id);
			// A marker that arrived after the last check. Handed markers are settlement's to revive.
			!parked && wake.queue(&chat_id).iter().any(|e| e.handed_to.is_none() && !e.waking && !e.deferred)
		};
		if restart {
			pump(&app, chat_id);
		}
	});
}

/// The pump's loop; true when it parked (the queue waits for something other than time).
async fn run_pump(app: &Arc<App>, chat_id: &str) -> bool {
	let mut attempt = 0;
	loop {
		{
			let mut wake = app.jobs.wake.lock();
			if wake.queue(chat_id).is_empty() {
				wake.queues.remove(chat_id);
				return false;
			}
		}
		let Some(record) = app.stores.chats.get_chat(chat_id) else {
			let gone = app.jobs.wake.lock().queues.remove(chat_id).unwrap_or_default();
			for entry in gone {
				eprintln!("chat {chat_id} not found \u{2014} cannot deliver steer {}", steer_id(&entry.steer));
			}
			continue;
		};
		// Markers already in the transcript resolve without firing anything.
		note_steers_durable(app, chat_id, messages_of(&record));
		let still_pending: Vec<u64> = app.jobs.wake.lock().queue(chat_id).iter().filter(|e| !e.waking && !e.deferred).map(|e| e.seq).collect();
		if still_pending.is_empty() {
			return true;
		}

		// The live run: its agent takes every eligible marker; settlement re-pumps the rest.
		let live = live_agent(app, chat_id);
		if let Some(live) = live
			&& is_turn_running(app, chat_id)
		{
			hand_off_eligible(app, chat_id, &live);
			let (handable, handoff_waits) = {
				let wake = app.jobs.wake.lock();
				let pending: Vec<&QueuedSteer> = wake.queue(chat_id).iter().filter(|e| still_pending.contains(&e.seq)).collect();
				(pending.iter().any(|e| held_by(&e.handed_to, &live)), pending.iter().any(|e| is_probe_handoff(&e.steer)))
			};
			if handable && !handoff_waits {
				return false;
			}
			if handable {
				clock::sleep(POLL_MS).await;
				wait_for_idle(app, chat_id).await;
				continue;
			}
		}

		// The idle wake: one server-side turn carrying every pending marker.
		wait_for_idle(app, chat_id).await;
		// Read again: the wait may have outlasted a quiz answer the wake must not clobber.
		let Some(fresh) = app.stores.chats.get_chat(chat_id) else { continue };
		let runner = app.jobs.wake.lock().turn_runner.clone();
		let Some(runner) = runner else {
			for seq in still_pending {
				defer_or_reject(app, chat_id, seq, "wake pipeline: no turn runner wired (setTurnRunner)");
			}
			return true;
		};
		// A live run may have delivered some while the gates were closed.
		note_steers_durable(app, chat_id, messages_of(&fresh));
		let fire: Vec<u64> = app.jobs.wake.lock().queue(chat_id).iter().filter(|e| !e.waking && !e.deferred && e.handed_to.is_none()).map(|e| e.seq).collect();
		if fire.is_empty() {
			return false;
		}
		// A record ending in a dismissal waits for the learner: their next send carries the markers.
		if ends_in_dismissal(messages_of(&fresh)) {
			return true;
		}
		let steers: Vec<Json> = {
			let mut wake = app.jobs.wake.lock();
			fire.iter()
				.filter_map(|seq| {
					let entry = wake.entry(chat_id, *seq)?;
					entry.waking = true;
					Some(entry.steer.clone())
				})
				.collect()
		};
		let status = runner(chat_id.to_owned(), json!({ "type": "steers", "steers": steers })).await;
		if let Some(saved) = app.stores.chats.get_chat(chat_id) {
			note_steers_durable(app, chat_id, messages_of(&saved));
		}
		let owned: Vec<u64> = {
			let wake = app.jobs.wake.lock();
			fire.into_iter().filter(|seq| wake.queue(chat_id).iter().any(|e| e.seq == *seq)).collect()
		};
		if status == 403 || status == 409 {
			{
				let mut wake = app.jobs.wake.lock();
				for seq in &owned {
					if let Some(entry) = wake.entry(chat_id, *seq) {
						entry.waking = false;
						entry.wake_agent = None;
					}
				}
			}
			if status == 403 {
				return true;
			}
			clock::sleep(RETRY_BACKOFF_MS[attempt.min(RETRY_BACKOFF_MS.len() - 1)]).await;
			attempt += 1;
			continue;
		}
		attempt = 0;
		for seq in owned {
			let is_job = app.jobs.wake.lock().entry(chat_id, seq).map(|e| job_id_of(&e.steer).is_some());
			let Some(is_job) = is_job else { continue };
			if status == 200 && !is_job {
				// A probe handoff is accepted with its turn.
				complete_entry(app, chat_id, seq);
			} else if status != 200 || !is_turn_running(app, chat_id) {
				defer_or_reject(app, chat_id, seq, &format!("wake turn did not persist steer (status {status})"));
			}
			// An accepted live turn owns its cargo until the save or settlement.
		}
	}
}

/// A job marker that failed to start stays pending (deferred); a probe handoff is dropped.
fn defer_or_reject(app: &App, chat_id: &str, seq: u64, error: &str) {
	let mut wake = app.jobs.wake.lock();
	let Some(entry) = wake.entry(chat_id, seq) else { return };
	entry.waking = false;
	entry.wake_agent = None;
	if job_id_of(&entry.steer).is_some() {
		entry.deferred = true;
		eprintln!("[steer {}] delivery remains pending: {error}", steer_id(&entry.steer));
	} else {
		wake.remove_entry(chat_id, seq);
	}
}

/// Acknowledges delivery on the job record without changing the worker's outcome. The
/// conversation is already saved, so a failure here is only logged.
fn finalize_job(app: &App, job_id: &str) {
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
	let failed = is_subagent_failure(job["kind"].as_str().unwrap_or_default(), &job["result"]);
	let patch = json!({
		"status": if failed { "error" } else { "done" },
		"activity": if failed { "failed" } else { "finished" },
		"delivery": { "kind": "result", "status": "pending" },
	});
	let id = job["id"].as_str().unwrap_or_default().to_owned();
	Ok(app.stores.jobs.update_job(&id, &patch)?.unwrap_or(job))
}

/// Puts the chat's known pending deliveries back in the registry; terminal records without
/// delivery metadata are never replayed.
fn restore_pending_deliveries(app: &App, chat_id: &str) -> Result<(), String> {
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return Ok(()) };
	let messages = messages_of(&record);
	note_steers_durable(app, chat_id, messages);
	for stored in app.stores.jobs.list_jobs(chat_id) {
		let stored = (*stored).clone();
		let job = if is_job_live(&app.jobs.aborts, stored["id"].as_str().unwrap_or_default()) { stored } else { normalize_legacy_result(app, stored)? };
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

/// Waits until the chat can take a wake turn: no turn running and no open question (its answer
/// arrives as the call's result, and no turn may run in between). Meanwhile a figure or demo
/// finished while a side question holds the open question is shown at once (`show_held_artifacts`). The
/// record is parsed again only when its file changed.
async fn wait_for_idle(app: &Arc<App>, chat_id: &str) {
	// The record's version, whether a question waits, and whether a side question holds it.
	let mut seen: Option<(String, bool, bool)> = None;
	// None when the chat is gone.
	let mut question_waits = || -> Option<(bool, bool)> {
		let version = app.stores.chats.chat_version(chat_id)?;
		if seen.as_ref().is_none_or(|(v, _, _)| *v != version) {
			let record = app.stores.chats.get_chat(chat_id)?;
			let messages = messages_of(&record);
			seen = Some((version, dangling_question_of(messages).is_some(), open_question_held(messages)));
		}
		seen.as_ref().map(|(_, dangling, held)| (*dangling, *held))
	};
	loop {
		let Some((question, held)) = question_waits() else { return };
		let fireable = app.jobs.wake.lock().queue(chat_id).iter().any(|e| !e.waking && !e.deferred && e.handed_to.is_none());
		if !fireable {
			return;
		}
		if held && !is_turn_running(app, chat_id) && show_held_artifacts(app, chat_id) {
			continue;
		}
		if !is_turn_running(app, chat_id) && !question {
			clock::sleep(GRACE_MS).await;
			if !is_turn_running(app, chat_id) && question_waits().is_some_and(|(question, _)| !question) {
				return;
			}
		}
		clock::sleep(POLL_MS).await;
	}
}

/// A finished figure's or demo's result marker (not its abort notice): what the window draws.
fn is_artifact(steer: &Json) -> bool {
	steer["customType"].as_str() == Some("subagent-steer") && matches!(steer["details"]["kind"].as_str(), Some("visual" | "demo"))
}

/// Writes the waiting figures and demos into the lesson with no turn while a side question holds
/// the open question: the learner sees each at once, the question stays as it is, and the teacher
/// reads them with the answer. Under the chat lock the turn start takes, so no turn begins in
/// between. True when it wrote any.
fn show_held_artifacts(app: &App, chat_id: &str) -> bool {
	let waiting = |wake: &Wake| -> Vec<Json> { wake.queue(chat_id).iter().filter(|e| !e.waking && !e.deferred && e.handed_to.is_none() && is_artifact(&e.steer)).map(|e| e.steer.clone()).collect() };
	// Other markers can wait here for long: the record is read only when a figure or demo waits.
	if waiting(&app.jobs.wake.lock()).is_empty() {
		return false;
	}
	{
		let _guard = app.locks.lock(LockKey::Chat(chat_id));
		if is_turn_running(app, chat_id) {
			return false;
		}
		let Some(record) = app.stores.chats.get_chat(chat_id) else { return false };
		let mut messages = messages_of(&record).to_vec();
		if !open_question_held(&messages) {
			return false;
		}
		let artifacts: Vec<Json> = waiting(&app.jobs.wake.lock()).into_iter().filter(|s| !steer_delivered(&messages, steer_id(s))).collect();
		if artifacts.is_empty() {
			return false;
		}
		messages.extend(artifacts);
		if let Err(err) = app.stores.chats.save_messages(chat_id, &messages) {
			eprintln!("[chat {chat_id}] figure or demo could not be saved: {err}");
			return false;
		}
		note_steers_durable(app, chat_id, &messages);
	}
	app.events.emit(EventKind::RecordChanged, json!({ "chatId": chat_id }));
	true
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
		let id = job["id"].as_str().unwrap_or_default();
		let chat_id = job["chatId"].as_str().unwrap_or_default();
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

#[cfg(test)]
#[path = "jobs_tests.rs"]
mod tests;
