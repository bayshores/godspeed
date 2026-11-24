//! The pump: one per chat, it waits for the chat to go idle and fires the wake turn that carries
//! every pending marker.

use std::sync::Arc;

use gs_base::clock;
use gs_base::events::EventKind;
use gs_base::locks::LockKey;
use gs_base::tasks::detach;
use gs_core::messages::role::is_custom;
use gs_core::messages::native_messages::{dangling_question_of, open_question_held};
use gs_core::session::jobs::steer_delivered;
use gs_json::{Json, json};

use super::wake::{QueuedSteer, Wake, complete_entry, hand_off_eligible, held_by, is_probe_handoff, job_id_of, live_agent, note_steers_durable, steer_id};
use crate::App;
use crate::turns::turn_liveness::is_turn_running;

pub(super) const POLL_MS: i64 = 400;

/// After the gates open, a learner's answer POST may still be in flight: wait a beat so the wake
/// does not 409 it. A miss heals itself through the 409 backoff.
pub(super) const GRACE_MS: i64 = 750;

/// 409 backoff, capped so a busy client cannot spin the pump.
const RETRY_BACKOFF_MS: [i64; 4] = [500, 1000, 2000, 5000];

/// A probe handoff names its chat; a job steer's chat is on its job record.
pub(super) fn chat_id_of(app: &App, steer: &Json) -> String {
	if is_probe_handoff(steer) {
		return steer["details"]["chatId"].str_or_empty().to_owned();
	}
	job_id_of(steer).and_then(|id| app.stores.jobs.get_job(id)).and_then(|job| job["chatId"].as_str().map(str::to_owned)).unwrap_or_default()
}

/// Starts the chat's pump unless one runs. The pump clears dead weight, then hands every
/// eligible marker to a live turn, or waits for idle and fires one wake turn.
pub(super) fn pump(app: &Arc<App>, chat_id: String) {
	if chat_id.is_empty() || !app.jobs.wake.lock().pumping.insert(chat_id.clone()) {
		return;
	}
	let app = app.clone();
	detach("jobs", async move {
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
		note_steers_durable(app, chat_id, record["messages"].items());
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
		note_steers_durable(app, chat_id, fresh["messages"].items());
		let fire: Vec<u64> = app.jobs.wake.lock().queue(chat_id).iter().filter(|e| !e.waking && !e.deferred && e.handed_to.is_none()).map(|e| e.seq).collect();
		if fire.is_empty() {
			return false;
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
			note_steers_durable(app, chat_id, saved["messages"].items());
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

/// Waits until the chat can take a wake turn: no turn running and no open question (its answer
/// arrives as the call's result, and no turn may run in between). Meanwhile a demo
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
			let messages = record["messages"].items();
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

/// A finished demo's result marker (not its abort notice): what the window draws.
fn is_artifact(steer: &Json) -> bool {
	is_custom(steer, "subagent-steer") && steer["details"]["kind"].as_str() == Some("demo")
}

/// Writes the waiting demos into the lesson with no turn while a side question holds
/// the open question: the learner sees each at once, the question stays as it is, and the teacher
/// reads them with the answer. Under the chat lock the turn start takes, so no turn begins in
/// between. True when it wrote any.
fn show_held_artifacts(app: &App, chat_id: &str) -> bool {
	let waiting = |wake: &Wake| -> Vec<Json> { wake.queue(chat_id).iter().filter(|e| !e.waking && !e.deferred && e.handed_to.is_none() && is_artifact(&e.steer)).map(|e| e.steer.clone()).collect() };
	// Other markers can wait here for long: the record is read only when a demo waits.
	if waiting(&app.jobs.wake.lock()).is_empty() {
		return false;
	}
	{
		let _guard = app.locks.lock(LockKey::Chat(chat_id));
		if is_turn_running(app, chat_id) {
			return false;
		}
		let Some(record) = app.stores.chats.get_chat(chat_id) else { return false };
		let mut messages = record["messages"].items().to_vec();
		if !open_question_held(&messages) {
			return false;
		}
		let artifacts: Vec<Json> = waiting(&app.jobs.wake.lock()).into_iter().filter(|s| !steer_delivered(&messages, steer_id(s))).collect();
		if artifacts.is_empty() {
			return false;
		}
		messages.extend(artifacts);
		if let Err(err) = app.stores.chats.save_messages(chat_id, &messages) {
			eprintln!("[chat {chat_id}] demo could not be saved: {err}");
			return false;
		}
		note_steers_durable(app, chat_id, &messages);
	}
	app.events.emit(EventKind::RecordChanged, json!({ "chatId": chat_id }));
	true
}
