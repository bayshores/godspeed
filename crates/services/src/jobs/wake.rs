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

use gs_core::messages::role::{Role, is_custom};
use gs_engine::turn::agent::Agent;
use gs_json::Json;

use super::lifecycle::{finalize_job, restore_pending_deliveries};
use super::pump::{chat_id_of, pump};
use crate::App;

/// Fires one server-side turn for a chat with this input (`{type: "steers", steers}`) and
/// answers its HTTP status. A turn that crashed answers 500.
pub type TurnRunner = Arc<dyn Fn(String, Json) -> Pin<Box<dyn Future<Output = u16> + Send>> + Send + Sync>;

/// Re-runs a job's sub-agent loop (recovery of a job whose process died).
pub type JobRespawn = Arc<dyn Fn(String) + Send + Sync>;

pub(super) struct QueuedSteer {
	/// Tells entries apart while the lock is let go (the TS compares objects).
	pub(super) seq: u64,
	pub(super) steer: Json,
	/// Wake cargo: still owned here, but never steered into its own run.
	pub(super) waking: bool,
	/// The wake's agent, once its turn registered it. Until then only the pump frees `waking`.
	pub(super) wake_agent: Option<Arc<Agent>>,
	/// A failed start waits for a learner run or a restart, not a timer.
	pub(super) deferred: bool,
	/// The live agent this marker was steered into; cleared at settlement if it never landed.
	pub(super) handed_to: Option<Arc<Agent>>,
}

/// A learner steer parked until a run persists it.
pub(super) struct UserSteer {
	message: Json,
	pub(super) handed_to: Option<Arc<Agent>>,
}

#[derive(Default)]
pub struct Wake {
	pub(super) turn_runner: Option<TurnRunner>,
	pub(super) respawn: Option<JobRespawn>,
	/// chat id → markers awaiting delivery, in arrival order.
	pub(super) queues: HashMap<String, Vec<QueuedSteer>>,
	/// chat id → learner steers awaiting a run that persists them.
	pub(super) user_steers: HashMap<String, Vec<UserSteer>>,
	/// chat id → the agent of the turn streaming now.
	pub(super) live_agents: HashMap<String, Arc<Agent>>,
	/// Chats whose pump runs (one per chat).
	pub(super) pumping: HashSet<String>,
	pub(super) last_sweep_at: i64,
	next_seq: u64,
}

impl Wake {
	pub(super) fn queue(&self, chat_id: &str) -> &[QueuedSteer] {
		self.queues.get(chat_id).map_or(&[], Vec::as_slice)
	}

	pub(super) fn entry(&mut self, chat_id: &str, seq: u64) -> Option<&mut QueuedSteer> {
		self.queues.get_mut(chat_id)?.iter_mut().find(|e| e.seq == seq)
	}

	pub(super) fn remove_entry(&mut self, chat_id: &str, seq: u64) -> Option<QueuedSteer> {
		let queue = self.queues.get_mut(chat_id)?;
		let at = queue.iter().position(|e| e.seq == seq)?;
		let entry = queue.remove(at);
		if queue.is_empty() {
			self.queues.remove(chat_id);
		}
		Some(entry)
	}
}

pub(super) fn held_by(handed: &Option<Arc<Agent>>, agent: &Arc<Agent>) -> bool {
	handed.as_ref().is_some_and(|h| Arc::ptr_eq(h, agent))
}

pub(super) fn is_probe_handoff(steer: &Json) -> bool {
	is_custom(steer, "probe-handoff")
}

/// The job a steer belongs to; None for a probe handoff.
pub(super) fn job_id_of(steer: &Json) -> Option<&str> {
	steer["details"]["jobId"].as_str()
}

pub(super) fn steer_id(steer: &Json) -> &str {
	steer["id"].str_or_empty()
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
	for message in persisted.iter().filter(|m| Role::Custom.is(m)) {
		finalize_steer(app, message);
	}
	let ids: HashSet<&str> = persisted.iter().filter_map(|m| m["id"].as_str()).collect();
	let done: Vec<u64> = app.jobs.wake.lock().queue(chat_id).iter().filter(|e| ids.contains(steer_id(&e.steer))).map(|e| e.seq).collect();
	for seq in done {
		complete_entry(app, chat_id, seq);
	}
}

pub(super) fn complete_entry(app: &App, chat_id: &str, seq: u64) {
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

pub(super) fn finalize_steer(app: &App, steer: &Json) {
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

pub(super) fn queue_steer(app: &App, chat_id: &str, steer: Json) {
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
pub(super) fn hand_off_eligible(app: &App, chat_id: &str, agent: &Arc<Agent>) {
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
