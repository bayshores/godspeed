//! The wake pipeline on a fresh data folder. Tests run on tokio's single-thread runtime, so a
//! spawned pump only moves while the test awaits.

use std::sync::Arc;

use gs_base::locks::LockKey;
use gs_base::{clock, fsx};
use gs_engine::turn::agent::{Agent, AgentOptions};
use gs_engine::turn::models::agent_engine;
use gs_json::{Json, json, stringify_pretty};
use parking_lot::Mutex;

use super::*;
use crate::app::test_support::{scratch_dir, test_app};
use crate::turns::turn_liveness::{begin_turn, end_turn};

const CHAT: &str = "chat_jobtest1_00000001";

fn write_chat(app: &App, id: &str, messages: Vec<Json>) {
	std::fs::create_dir_all(&app.paths.chats).unwrap();
	let record = json!({ "id": id, "title": "Test", "createdAt": "2030-01-01T00:00:00.000Z", "updatedAt": "2030-01-01T00:00:00.000Z", "messages": messages, "kind": "study", "version": 1 });
	fsx::write_text_atomic(&app.paths.chats.join(format!("{id}.json")), &stringify_pretty(&record, "\t")).unwrap();
}

fn write_job(app: &App, id: &str, fields: Json) {
	let dir = app.paths.data.join("jobs");
	std::fs::create_dir_all(&dir).unwrap();
	let mut job = json!({ "id": id, "kind": "research", "chatId": CHAT, "toolCallId": format!("call_{id}"), "status": "running", "activity": "researching", "createdAt": "2030-01-01T00:00:00.000Z", "updatedAt": "2030-01-01T00:00:00.000Z" });
	for (key, value) in fields.as_obj().unwrap().iter() {
		job.as_obj_mut().unwrap().insert(key.clone(), value.clone());
	}
	fsx::write_text_atomic(&dir.join(format!("{id}.json")), &stringify_pretty(&job, "\t")).unwrap();
}

/// A finished job whose result still owes its delivery.
fn finished_job(app: &App, id: &str) {
	write_job(app, id, json!({ "status": "done", "activity": "finished", "result": { "brief": "ok", "sources": [] }, "delivery": { "kind": "result", "status": "pending" } }));
}

fn agent(app: &App) -> Arc<Agent> {
	Agent::new(AgentOptions::new(agent_engine(&app.bridge)))
}

fn steer_for(app: &App, job_id: &str) -> Json {
	let job = app.stores.jobs.get_job(job_id).unwrap();
	build_subagent_steer(&job, &job["result"])
}

/// Each queued marker: (id, waking, deferred, handed to `to`).
fn queued(app: &App, to: Option<&Arc<Agent>>) -> Vec<(String, bool, bool, bool)> {
	let wake = app.jobs.wake.lock();
	wake.queue(CHAT).iter().map(|e| (steer_id(&e.steer).to_owned(), e.waking, e.deferred, to.is_some_and(|a| held_by(&e.handed_to, a)))).collect()
}

fn delivery_status(app: &App, job_id: &str) -> String {
	app.stores.jobs.get_job(job_id).unwrap()["delivery"]["status"].as_str().unwrap_or_default().to_owned()
}

/// A turn runner that saves every steer into the record like the chat handler, and answers `status`.
fn saving_runner(app: &Arc<App>, status: u16) -> Arc<Mutex<Vec<Json>>> {
	let calls = Arc::new(Mutex::new(Vec::new()));
	let seen = calls.clone();
	let weak = Arc::downgrade(app);
	set_turn_runner(
		app,
		Arc::new(move |chat_id, input| {
			seen.lock().push(input.clone());
			let app = weak.upgrade().unwrap();
			Box::pin(async move {
				if status == 200 {
					let mut messages = app.stores.chats.get_chat(&chat_id).unwrap()["messages"].as_arr().unwrap().clone();
					messages.extend(input["steers"].as_arr().unwrap().iter().cloned());
					write_chat(&app, &chat_id, messages.clone());
					note_steers_durable(&app, &chat_id, &messages);
				}
				status
			})
		}),
	);
	calls
}

#[tokio::test]
async fn registration_hands_pending_markers_to_the_live_agent_but_not_probe_handoffs() {
	let root = scratch_dir("jobs");
	let app = test_app(&root);
	write_chat(&app, CHAT, Vec::new());
	finished_job(&app, "job_a");
	queue_steer(&app, CHAT, json!({ "id": "handoff_1", "role": "custom", "customType": "probe-handoff", "details": { "chatId": CHAT } }));
	let live = agent(&app);
	register_live_agent(&app, CHAT, &live, true, None).unwrap();
	assert_eq!(queued(&app, Some(&live)), [("handoff_1".into(), false, false, false), ("steer_job_a".into(), false, false, true)]);
	// A second registration of the same agent hands nothing twice; a new agent takes it again.
	let next = agent(&app);
	register_live_agent(&app, CHAT, &next, true, None).unwrap();
	assert_eq!(queued(&app, Some(&next)), [("handoff_1".into(), false, false, false), ("steer_job_a".into(), false, false, true)]);
}

#[tokio::test]
async fn settlement_acknowledges_delivered_markers_and_returns_stranded_ones() {
	let root = scratch_dir("jobs");
	let app = test_app(&root);
	write_chat(&app, CHAT, Vec::new());
	finished_job(&app, "job_a");
	finished_job(&app, "job_b");
	let live = agent(&app);
	register_live_agent(&app, CHAT, &live, true, None).unwrap();
	unregister_live_agent(&app, CHAT);
	let delivered = steer_for(&app, "job_a");
	settle_steers(&app, CHAT, &[delivered], true, Some(&live));
	assert_eq!(delivery_status(&app, "job_a"), "delivered");
	assert_eq!(delivery_status(&app, "job_b"), "pending");
	// Stranded in a failed run: back to pending, deferred until a learner run.
	assert_eq!(queued(&app, Some(&live)), [("steer_job_b".into(), false, true, false)]);
}

#[tokio::test]
async fn settlement_of_another_agent_leaves_a_marker_handed_elsewhere() {
	let root = scratch_dir("jobs");
	let app = test_app(&root);
	write_chat(&app, CHAT, Vec::new());
	finished_job(&app, "job_a");
	let live = agent(&app);
	register_live_agent(&app, CHAT, &live, true, None).unwrap();
	settle_steers(&app, CHAT, &[], false, Some(&agent(&app)));
	assert_eq!(queued(&app, Some(&live)), [("steer_job_a".into(), false, false, true)]);
	settle_steers(&app, CHAT, &[], false, None);
	assert_eq!(queued(&app, Some(&live)), [("steer_job_a".into(), false, false, false)]);
}

#[tokio::test]
async fn learner_steers_stay_parked_until_a_run_persists_them() {
	let root = scratch_dir("jobs");
	let app = test_app(&root);
	write_chat(&app, CHAT, Vec::new());
	let message = json!({ "id": "msg_steer", "role": "user", "content": "wait" });
	assert!(!steer_live_chat(&app, CHAT, message.clone()), "no live turn");
	let first = agent(&app);
	register_live_agent(&app, CHAT, &first, true, None).unwrap();
	assert!(steer_live_chat(&app, CHAT, message.clone()));
	unregister_live_agent(&app, CHAT);
	reconcile_user_steers(&app, CHAT, &[]);
	let second = agent(&app);
	register_live_agent(&app, CHAT, &second, true, None).unwrap();
	let handed = |a: &Arc<Agent>| app.jobs.wake.lock().user_steers[CHAT].iter().map(|e| held_by(&e.handed_to, a)).collect::<Vec<_>>();
	assert_eq!(handed(&second), [true]);
	reconcile_user_steers(&app, CHAT, &[message]);
	assert!(!app.jobs.wake.lock().user_steers.contains_key(CHAT));
}

#[tokio::test]
async fn discarding_a_chat_drops_its_obligations() {
	let root = scratch_dir("jobs");
	let app = test_app(&root);
	write_chat(&app, CHAT, Vec::new());
	finished_job(&app, "job_a");
	let live = agent(&app);
	register_live_agent(&app, CHAT, &live, true, None).unwrap();
	steer_live_chat(&app, CHAT, json!({ "id": "msg_steer", "role": "user", "content": "x" }));
	discard_chat_deliveries(&app, CHAT);
	let wake = app.jobs.wake.lock();
	assert!(!wake.queues.contains_key(CHAT) && !wake.user_steers.contains_key(CHAT));
}

#[tokio::test]
async fn a_live_turn_takes_markers_without_a_wake() {
	let root = scratch_dir("jobs");
	let app = test_app(&root);
	write_chat(&app, CHAT, Vec::new());
	finished_job(&app, "job_a");
	let calls = saving_runner(&app, 200);
	assert!(begin_turn(&app, CHAT));
	let live = agent(&app);
	app.jobs.wake.lock().live_agents.insert(CHAT.into(), live.clone());
	deliver_job_result(&app, steer_for(&app, "job_a"));
	clock::sleep(50).await;
	assert_eq!(queued(&app, Some(&live)), [("steer_job_a".into(), false, false, true)]);
	assert!(calls.lock().is_empty());
	assert!(!app.jobs.wake.lock().pumping.contains(CHAT));
	end_turn(&app, CHAT);
}

#[tokio::test]
async fn an_idle_chat_gets_one_wake_turn_carrying_every_marker() {
	let root = scratch_dir("jobs");
	let app = test_app(&root);
	write_chat(&app, CHAT, Vec::new());
	finished_job(&app, "job_a");
	finished_job(&app, "job_b");
	let calls = saving_runner(&app, 200);
	deliver_job_result(&app, steer_for(&app, "job_a"));
	deliver_job_result(&app, steer_for(&app, "job_b"));
	deliver_job_result(&app, steer_for(&app, "job_b"));
	clock::sleep(GRACE_MS + 300).await;
	let calls = calls.lock().clone();
	assert_eq!(calls.len(), 1);
	assert_eq!(calls[0]["type"], json!("steers"));
	let ids: Vec<&str> = calls[0]["steers"].as_arr().unwrap().iter().map(steer_id).collect();
	assert_eq!(ids, ["steer_job_a", "steer_job_b"]);
	assert!(queued(&app, None).is_empty());
	assert_eq!((delivery_status(&app, "job_a"), delivery_status(&app, "job_b")), ("delivered".into(), "delivered".into()));
}

#[tokio::test]
async fn a_dismissed_question_holds_the_wake() {
	let root = scratch_dir("jobs");
	let app = test_app(&root);
	write_chat(&app, CHAT, vec![json!({ "id": "msg_1", "role": "toolResult", "toolCallId": "c1", "toolName": "question", "details": { "dismissed": true } })]);
	finished_job(&app, "job_a");
	let calls = saving_runner(&app, 200);
	deliver_job_result(&app, steer_for(&app, "job_a"));
	clock::sleep(GRACE_MS + 300).await;
	assert!(calls.lock().is_empty());
	assert_eq!(queued(&app, None), [("steer_job_a".into(), false, false, false)]);
	assert!(!app.jobs.wake.lock().pumping.contains(CHAT), "parked, not polling");
}

#[tokio::test]
async fn a_refused_wake_parks_and_a_failed_one_defers_job_markers_and_drops_handoffs() {
	let root = scratch_dir("jobs");
	let app = test_app(&root);
	write_chat(&app, CHAT, Vec::new());
	finished_job(&app, "job_a");
	let calls = saving_runner(&app, 403);
	deliver_job_result(&app, steer_for(&app, "job_a"));
	clock::sleep(GRACE_MS + 300).await;
	assert_eq!(calls.lock().len(), 1);
	assert_eq!(queued(&app, None), [("steer_job_a".into(), false, false, false)]);

	let calls = saving_runner(&app, 500);
	deliver_job_result(&app, json!({ "id": "handoff_1", "role": "custom", "customType": "probe-handoff", "details": { "chatId": CHAT } }));
	clock::sleep(GRACE_MS + 300).await;
	assert_eq!(calls.lock().len(), 1);
	assert_eq!(queued(&app, None), [("steer_job_a".into(), false, true, false)]);
	// A learner run frees the deferred marker and takes it.
	let live = agent(&app);
	register_live_agent(&app, CHAT, &live, true, None).unwrap();
	assert_eq!(queued(&app, Some(&live)), [("steer_job_a".into(), false, false, true)]);
}

#[tokio::test]
async fn the_wake_turn_owns_its_cargo_until_settlement() {
	let root = scratch_dir("jobs");
	let app = test_app(&root);
	write_chat(&app, CHAT, Vec::new());
	finished_job(&app, "job_a");
	let wake_agent = agent(&app);
	let seen = wake_agent.clone();
	let weak = Arc::downgrade(&app);
	// Like the handler: the wake's turn registers its agent (with its cargo ids) and starts.
	set_turn_runner(
		&app,
		Arc::new(move |chat_id, input| {
			let app = weak.upgrade().unwrap();
			let ids = input["steers"].as_arr().unwrap().iter().map(|s| steer_id(s).to_owned()).collect();
			register_live_agent(&app, &chat_id, &seen, false, Some(&ids)).unwrap();
			begin_turn(&app, &chat_id);
			Box::pin(async { 200 })
		}),
	);
	deliver_job_result(&app, steer_for(&app, "job_a"));
	clock::sleep(GRACE_MS + 300).await;
	assert_eq!(queued(&app, Some(&wake_agent)), [("steer_job_a".into(), true, false, false)], "waking cargo is never steered into its own run");
	// The run failed before saving it: the marker waits, deferred.
	end_turn(&app, CHAT);
	unregister_live_agent(&app, CHAT);
	settle_steers(&app, CHAT, &[], true, Some(&wake_agent));
	assert_eq!(queued(&app, None), [("steer_job_a".into(), false, true, false)]);
}

#[tokio::test]
async fn aborting_a_running_job_queues_its_notice() {
	let root = scratch_dir("jobs");
	let app = test_app(&root);
	write_chat(&app, CHAT, Vec::new());
	write_job(&app, "job_a", json!({}));
	assert_eq!(abort_job(&app, "job_a").unwrap(), Ok(()));
	let wake = app.jobs.wake.lock();
	let entry = &wake.queue(CHAT)[0];
	assert_eq!((steer_id(&entry.steer), entry.steer["customType"].as_str()), ("steer_job_a", Some("subagent-abort")));
	drop(wake);
	assert_eq!(abort_job(&app, "job_a").unwrap(), Err(AbortRefusal::NotRunning));
	assert_eq!(abort_job(&app, "job_none").unwrap(), Err(AbortRefusal::NotFound));
}

#[tokio::test]
async fn an_abort_that_lands_as_the_job_finishes_leaves_the_result_alone() {
	let root = scratch_dir("jobs");
	let app = test_app(&root);
	write_chat(&app, CHAT, Vec::new());
	write_job(&app, "job_a", json!({}));
	// The abort has checked the job and waits for its lock while the finish writes.
	let held = app.locks.lock(LockKey::AppFile("jobs/job_a.json"));
	let (aborting, runtime) = (app.clone(), tokio::runtime::Handle::current());
	let abort = std::thread::spawn(move || {
		let _entered = runtime.enter();
		abort_job(&aborting, "job_a").unwrap()
	});
	std::thread::sleep(std::time::Duration::from_millis(100));
	app.stores.jobs.update_job("job_a", &json!({ "status": "done", "result": { "brief": "ok", "sources": [] } })).unwrap();
	drop(held);
	assert_eq!(abort.join().unwrap(), Err(AbortRefusal::NotRunning));
	assert_eq!(app.stores.jobs.get_job("job_a").unwrap()["status"].as_str(), Some("done"));
	assert!(queued(&app, None).is_empty());
}

#[tokio::test]
async fn recovery_reruns_orphans_at_most_every_30_seconds() {
	let root = scratch_dir("jobs");
	let app = test_app(&root);
	write_chat(&app, CHAT, Vec::new());
	write_job(&app, "job_orphan", json!({}));
	write_job(&app, "job_live", json!({}));
	write_job(&app, "job_lessonless", json!({ "chatId": "chat_gone0000_00000000" }));
	app.jobs.aborts.register_job_abort("job_live", gs_engine::turn::abort::Abort::new());
	let respawned = Arc::new(Mutex::new(Vec::new()));
	let seen = respawned.clone();
	set_job_respawn(&app, Arc::new(move |id| seen.lock().push(id)));
	list_jobs(&app, CHAT);
	list_all_jobs(&app);
	assert_eq!(*respawned.lock(), ["job_orphan"]);
	assert_eq!(app.stores.jobs.get_job("job_orphan").unwrap()["activity"], json!("recovering: re-running"));
	assert_eq!(app.stores.jobs.get_job("job_lessonless").unwrap()["activity"], json!("researching"));
	app.jobs.wake.lock().last_sweep_at -= SWEEP_THROTTLE_MS;
	list_jobs(&app, CHAT);
	assert_eq!(*respawned.lock(), ["job_orphan", "job_orphan"]);
}
