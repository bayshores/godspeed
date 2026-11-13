//! Bridge behaviour the scripted golden cannot show: a waiting agent woken by new work, what an
//! agent has seen surviving a server restart (lessons only), and who takes what with a helper.

use std::sync::Arc;
use std::time::Instant;

use gs_base::clock;
use gs_base::events::Events;
use gs_engine::bridge::{AgentReply, Bridge, UNNAMED_HELPER, WaitOptions};
use gs_engine::turn::abort::Abort;
use gs_json::{Json, json};

mod common;
use common::{Marks, park};

fn user(text: &str) -> Json {
	json!({ "role": "user", "content": text, "timestamp": 1 })
}

fn agent_a() -> WaitOptions {
	WaitOptions { agent: Some("agent-A".to_owned()), ..WaitOptions::default() }
}

fn helper() -> WaitOptions {
	WaitOptions { agent: Some("helper-1".to_owned()), helper: true, ..WaitOptions::default() }
}

fn teacher() -> WaitOptions {
	WaitOptions { agent: Some("main-1".to_owned()), and_background: true, ..WaitOptions::default() }
}

fn reply(text: &str) -> AgentReply {
	AgentReply { text: Some(text.to_owned()), tool_calls: Vec::new() }
}

#[tokio::test]
async fn a_waiting_agent_takes_new_work_at_once() {
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	let waiting = tokio::spawn({
		let bridge = bridge.clone();
		async move { bridge.wait_for_work(60_000, agent_a()).await }
	});
	clock::sleep(5).await;
	let asked = Instant::now();
	let call = park(&bridge, vec![user("hi")], "chat_l1", &Abort::new());
	let view = waiting.await.unwrap().unwrap();
	// Well before the 15 s slice that would otherwise find it.
	assert!(asked.elapsed().as_millis() < 1_000);
	assert_eq!(view.messages, [json!({ "role": "user", "text": "hi" })]);
	bridge.respond_to_work(&view.work_id, reply("Hi."), 0).unwrap();
	call.await.unwrap();
}

#[tokio::test]
async fn a_restarted_server_sends_only_what_the_agent_has_not_seen() {
	let events = Events::new();
	let marks = Arc::new(Marks::default());
	let system = json!({ "role": "system", "content": "Teach well.", "timestamp": 0 });
	let before = Bridge::new(&events, marks.clone());
	let lesson = park(&before, vec![system.clone(), user("hi")], "chat_l1", &Abort::new());
	let job = park(&before, vec![user("group these")], "job_topics", &Abort::new());
	clock::sleep(5).await;
	for _ in 0..2 {
		let view = before.wait_for_work(0, agent_a()).await.unwrap();
		before.respond_to_work(&view.work_id, reply("Done."), 0).unwrap();
	}
	let answer = lesson.await.unwrap();
	job.await.unwrap();
	// Background jobs never come back after a restart, so only the lesson is saved.
	assert_eq!(marks.0.lock().iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(), ["agent-A chat_l1"]);

	let after = Bridge::new(&events, marks.clone());
	let next = park(&after, vec![system, user("hi"), answer, user("more")], "chat_l1", &Abort::new());
	clock::sleep(5).await;
	let view = after.wait_for_work(0, agent_a()).await.unwrap();
	assert!(view.continued);
	assert_eq!(view.instructions, None);
	assert_eq!(view.messages, [json!({ "role": "user", "text": "more" })]);
	after.respond_to_work(&view.work_id, reply("Sure."), 0).unwrap();
	next.await.unwrap();
}

#[tokio::test]
async fn a_dropped_model_call_leaves_no_work_behind() {
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	let call = park(&bridge, vec![user("hi")], "chat_l1", &Abort::new());
	clock::sleep(5).await;
	assert_eq!(bridge.pending_work_count(), 1);
	call.abort();
	assert!(call.await.unwrap_err().is_cancelled());
	assert_eq!(bridge.pending_work_count(), 0);
}

#[tokio::test]
async fn an_empty_lesson_id_takes_any_work() {
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	let call = park(&bridge, vec![user("group these")], "job_topics", &Abort::new());
	clock::sleep(5).await;
	let opts = WaitOptions { conversation: Some(String::new()), ..agent_a() };
	let view = bridge.wait_for_work(0, opts).await.unwrap();
	assert_eq!(view.conversation, "job_topics");
	bridge.respond_to_work(&view.work_id, reply("Grouped."), 0).unwrap();
	call.await.unwrap();
}

#[tokio::test]
async fn the_helper_does_the_background_jobs_and_the_teacher_the_lessons() {
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	let job = park(&bridge, vec![user("read this file")], "job_read", &Abort::new());
	let lesson = park(&bridge, vec![user("hi")], "chat_l1", &Abort::new());
	clock::sleep(5).await;
	let work = bridge.wait_for_work(0, helper()).await.unwrap();
	assert_eq!(work.conversation, "job_read");
	bridge.respond_to_work(&work.work_id, reply("Read."), 0).unwrap();
	job.await.unwrap();
	assert!(bridge.wait_for_work(0, helper()).await.is_none(), "the lesson waits for the teacher");
	assert!(!bridge.agent_teaching(clock::now_ms()), "a helper never counts as teaching");

	let turn = bridge.wait_for_work(0, teacher()).await.unwrap();
	assert_eq!(turn.conversation, "chat_l1");
	bridge.respond_to_work(&turn.work_id, reply("Hi."), 0).unwrap();
	lesson.await.unwrap();

	// A job that arrives while the helper is here is left for it.
	let next = park(&bridge, vec![user("group these")], "job_topics", &Abort::new());
	clock::sleep(5).await;
	assert!(bridge.wait_for_work(0, teacher()).await.is_none());
	let work = bridge.wait_for_work(0, helper()).await.unwrap();
	bridge.respond_to_work(&work.work_id, reply("Grouped."), 0).unwrap();
	next.await.unwrap();
}

#[tokio::test]
async fn a_helper_in_a_job_answers_a_compacting_teachers_lesson_first() {
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	let step_one = park(&bridge, vec![user("read this file")], "job_read", &Abort::new());
	clock::sleep(5).await;
	let step = bridge.wait_for_work(0, helper()).await.unwrap();
	let lesson = park(&bridge, vec![user("hi")], "chat_l1", &Abort::new());
	clock::sleep(5).await;
	let held = bridge.wait_for_work(0, teacher()).await.unwrap();
	bridge.agent_compacting("main-1", clock::now_ms());

	bridge.respond_to_work(&step.work_id, reply("Read."), 30_000).unwrap();
	step_one.await.unwrap();
	let step_two = park(&bridge, vec![user("read the next part")], "job_read", &Abort::new());
	clock::sleep(5).await;
	let staying = || WaitOptions { conversation: Some("job_read".to_owned()), ..helper() };
	let turn = bridge.wait_for_work(0, staying()).await.unwrap();
	assert_eq!(turn.conversation, "chat_l1", "the lesson goes before the job's next step");
	assert!(bridge.respond_to_work(&held.work_id, reply("late"), 0).is_err());
	bridge.respond_to_work(&turn.work_id, reply("Hi."), 0).unwrap();
	lesson.await.unwrap();

	bridge.forget_agent("main-1", false);
	let step = bridge.wait_for_work(0, staying()).await.unwrap();
	assert_eq!(step.conversation, "job_read");
	bridge.respond_to_work(&step.work_id, reply("Done."), 0).unwrap();
	step_two.await.unwrap();
}

#[tokio::test]
async fn the_helper_leaves_a_job_the_teacher_is_in_the_middle_of() {
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	let step_one = park(&bridge, vec![user("read this file")], "job_read", &Abort::new());
	clock::sleep(5).await;
	let step = bridge.wait_for_work(0, teacher()).await.unwrap();
	bridge.respond_to_work(&step.work_id, reply("Read."), 30_000).unwrap();
	step_one.await.unwrap();
	let step_two = park(&bridge, vec![user("read the next part")], "job_read", &Abort::new());
	clock::sleep(5).await;
	assert!(bridge.wait_for_work(0, helper()).await.is_none(), "held for the teacher that just answered");
	bridge.release_conversation("job_read");
	let step = bridge.wait_for_work(0, helper()).await.unwrap();
	bridge.respond_to_work(&step.work_id, reply("Done."), 0).unwrap();
	step_two.await.unwrap();
}

#[tokio::test]
async fn a_helper_without_a_session_id_saves_no_lesson_marks() {
	let marks = Arc::new(Marks::default());
	let bridge = Bridge::new(&Events::new(), marks.clone());
	let lesson = park(&bridge, vec![user("hi")], "chat_l1", &Abort::new());
	clock::sleep(5).await;
	bridge.agent_compacting("main-1", clock::now_ms());
	let unnamed = WaitOptions { agent: Some(UNNAMED_HELPER.to_owned()), helper: true, ..WaitOptions::default() };
	let turn = bridge.wait_for_work(0, unnamed).await.unwrap();
	bridge.respond_to_work(&turn.work_id, reply("Hi."), 0).unwrap();
	lesson.await.unwrap();
	assert!(marks.0.lock().is_empty());
}
