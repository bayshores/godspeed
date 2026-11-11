//! Bridge behaviour the scripted golden cannot show: a waiting agent woken by new work, and what
//! an agent has seen surviving a server restart (lessons only).

use std::sync::Arc;
use std::time::Instant;

use gs_base::clock;
use gs_base::events::Events;
use gs_engine::bridge::{AgentReply, Bridge, WaitOptions};
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
