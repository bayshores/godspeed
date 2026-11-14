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
	WaitOptions { agent: Some("main-1".to_owned()), and_others: true, ..WaitOptions::default() }
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
async fn a_teacher_thinking_on_a_turn_stays_connected_until_its_claim_runs_out() {
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	let lesson = park(&bridge, vec![user("hi")], "chat_l1", &Abort::new());
	clock::sleep(5).await;
	let turn = bridge.wait_for_work(0, teacher()).await.unwrap();
	let minutes = |n: i64| clock::now_ms() + n * 60_000;
	assert!(bridge.agent_teaching(minutes(4)) && bridge.agent_connected(minutes(4)), "no check-in for 4 minutes, but the turn is still its");
	assert!(!bridge.agent_teaching(minutes(11)) && !bridge.agent_connected(minutes(11)), "the claim ran out");

	bridge.respond_to_work(&turn.work_id, reply("Hi."), 0).unwrap();
	lesson.await.unwrap();
	assert!(!bridge.agent_teaching(minutes(4)), "nothing held after the reply");
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

fn staying_on(agent: &str, lesson: &str) -> WaitOptions {
	WaitOptions { conversation: Some(lesson.to_owned()), agent: Some(agent.to_owned()), and_others: true, ..WaitOptions::default() }
}

fn waiting(bridge: &Bridge, opts: WaitOptions) -> tokio::task::JoinHandle<Option<gs_engine::bridge::WorkView>> {
	let bridge = bridge.clone();
	tokio::spawn(async move { bridge.wait_for_work(60_000, opts).await })
}

#[tokio::test]
async fn an_agent_staying_on_a_lesson_takes_a_new_lessons_first_turn_at_once() {
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	let waiter = waiting(&bridge, staying_on("main-1", "chat_l1"));
	clock::sleep(50).await;
	let asked = Instant::now();
	let call = park(&bridge, vec![user("teach me ridge")], "chat_l2", &Abort::new());
	let view = waiter.await.unwrap().unwrap();
	assert!(asked.elapsed().as_millis() < 1_000);
	assert_eq!(view.conversation, "chat_l2");
	bridge.respond_to_work(&view.work_id, reply("Hi."), 0).unwrap();
	call.await.unwrap();
}

#[tokio::test]
async fn two_agents_staying_on_their_own_lessons_each_take_their_own() {
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	// The first in line looks first, and the older item is the other agent's.
	let first = waiting(&bridge, staying_on("main-1", "chat_l1"));
	clock::sleep(50).await;
	let second = waiting(&bridge, staying_on("main-2", "chat_l2"));
	clock::sleep(50).await;
	let l2 = park(&bridge, vec![user("for two")], "chat_l2", &Abort::new());
	clock::sleep(50).await;
	let l1 = park(&bridge, vec![user("for one")], "chat_l1", &Abort::new());
	let (one, two) = (first.await.unwrap().unwrap(), second.await.unwrap().unwrap());
	assert_eq!((one.conversation.as_str(), two.conversation.as_str()), ("chat_l1", "chat_l2"));
	bridge.respond_to_work(&one.work_id, reply("One."), 0).unwrap();
	bridge.respond_to_work(&two.work_id, reply("Two."), 0).unwrap();
	l1.await.unwrap();
	l2.await.unwrap();
}

#[tokio::test]
async fn another_lessons_turn_goes_to_a_waiter_that_takes_any_work() {
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	let staying = waiting(&bridge, staying_on("main-1", "chat_l1"));
	clock::sleep(50).await;
	let any = waiting(&bridge, WaitOptions { agent: Some("main-2".to_owned()), ..teacher() });
	clock::sleep(50).await;
	let call = park(&bridge, vec![user("hi")], "chat_l2", &Abort::new());
	let view = any.await.unwrap().unwrap();
	assert_eq!(view.conversation, "chat_l2");
	bridge.respond_to_work(&view.work_id, reply("Hi."), 0).unwrap();
	call.await.unwrap();
	assert!(!staying.is_finished(), "the agent staying on chat_l1 still waits");
	staying.abort();
}

#[tokio::test]
async fn an_agent_staying_on_a_lesson_still_takes_talk() {
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	let waiter = waiting(&bridge, staying_on("main-1", "chat_l1"));
	let other = waiting(&bridge, staying_on("main-2", "chat_l2"));
	clock::sleep(50).await;
	let call = park(&bridge, vec![user("a quick question")], "chat_talk", &Abort::new());
	let view = waiter.await.unwrap().unwrap();
	assert_eq!(view.conversation, "chat_talk");
	bridge.respond_to_work(&view.work_id, reply("Sure."), 0).unwrap();
	call.await.unwrap();
	other.abort();
}

const TERMINAL: &str = "0123456789abcdef0123456789abcdef";

fn in_terminal() -> WaitOptions {
	WaitOptions { terminal: Some(TERMINAL.to_owned()), ..teacher() }
}

#[tokio::test]
async fn a_wait_from_a_stopped_terminal_ends_and_claims_nothing() {
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	bridge.set_live_terminals(vec![TERMINAL.to_owned()]);
	let wait = waiting(&bridge, in_terminal());
	clock::sleep(5).await;
	let stopped = Instant::now();
	bridge.set_live_terminals(Vec::new());
	assert!(wait.await.unwrap().is_none());
	assert!(stopped.elapsed().as_millis() < 1_000, "ended at the stop, not at the next slice");

	let lesson = park(&bridge, vec![user("hi")], "chat_l1", &Abort::new());
	clock::sleep(5).await;
	assert!(bridge.wait_for_work(60_000, in_terminal()).await.is_none());
	assert!(bridge.claimed_lessons().is_empty(), "the turn waits for a live agent");
	let view = bridge.wait_for_work(0, agent_a()).await.unwrap();
	bridge.respond_to_work(&view.work_id, reply("Hi."), 0).unwrap();
	lesson.await.unwrap();
}

#[tokio::test]
async fn what_a_stopped_terminal_claimed_goes_back_at_once() {
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	bridge.set_live_terminals(vec![TERMINAL.to_owned()]);
	let lesson = park(&bridge, vec![user("hi")], "chat_l1", &Abort::new());
	clock::sleep(5).await;
	let taken = bridge.wait_for_work(0, in_terminal()).await.unwrap();
	assert_eq!(bridge.claimed_lessons().len(), 1);
	assert!(bridge.wait_for_work(0, agent_a()).await.is_none(), "held while the terminal runs");
	bridge.set_live_terminals(Vec::new());
	assert!(bridge.claimed_lessons().is_empty());
	let view = bridge.wait_for_work(0, agent_a()).await.expect("free well before the 10 minute hold");
	assert_eq!(view.messages, taken.messages);
	bridge.respond_to_work(&view.work_id, reply("Hi."), 0).unwrap();
	lesson.await.unwrap();
}

#[test]
fn each_live_terminal_says_whether_its_agent_checked_in() {
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	let other = "f".repeat(32);
	bridge.set_live_terminals(vec![other.clone(), TERMINAL.to_owned()]);
	let now = 10_000_000;
	assert!(!bridge.outside_here(now));
	bridge.record_terminal_contact(Some(TERMINAL), now);
	assert_eq!(bridge.terminals_here(now + 1000), vec![(TERMINAL.to_owned(), true), (other.clone(), false)]);
	assert!(!bridge.outside_here(now + 1000), "a terminal's agent is not an outside one");
	bridge.record_terminal_contact(None, now);
	assert!(bridge.outside_here(now + 1000));
	assert_eq!(bridge.terminals_here(now + 3 * 60_000)[0], (TERMINAL.to_owned(), false), "three minutes later it is not here");
	assert!(!bridge.outside_here(now + 3 * 60_000));
	bridge.set_live_terminals(vec![other.clone()]);
	assert!(!bridge.terminal_live(TERMINAL) && bridge.terminal_live(&other));
	assert_eq!(bridge.terminals_here(now), vec![(other, false)]);
}
