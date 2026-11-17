//! A line the learner types in the teacher's terminal while a talk page (a lesson, a cheat sheet)
//! is shown goes to that page through the prompt hook, so the agent's wait doesn't hear of it;
//! a line that doesn't come in time is typed to the agent after all. On the app clock: one test,
//! because the clock is shared by the whole binary.

use std::sync::Arc;

use gs_base::clock;
use gs_base::events::Events;
use gs_engine::bridge::{AgentReply, Bridge, WaitOptions};
use gs_engine::turn::abort::Abort;
use gs_json::json;

mod common;
use common::{Marks, park};

const TEACHER: &str = "0123456789abcdef0123456789abcdef";
const HELPER: &str = "ffffffffffffffffffffffffffffffff";

/// Lets spawned tasks reach their next timer before the clock jumps.
async fn settle() {
	clock::sleep(5).await;
}

#[tokio::test]
async fn a_line_on_a_talk_page_goes_to_the_page_unless_it_comes_late() {
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	bridge.set_live_terminals(vec![TEACHER.to_owned(), HELPER.to_owned()], Some(TEACHER.to_owned()));

	// No talk page: Enter is typed to the agent, and no line is taken.
	bridge.typed(TEACHER, clock::now_ms());
	assert_eq!(bridge.take_line(Some(TEACHER), clock::now_ms()), None);
	assert!(bridge.take_typed(Some(TEACHER), clock::now_ms()));

	// A lesson is shown: Enter waits for its line, and the line goes to the lesson once.
	bridge.set_talk_page(Some("lesson".to_owned()), None);
	bridge.typed(TEACHER, clock::now_ms());
	assert!(!bridge.take_typed(Some(TEACHER), clock::now_ms()), "the wait doesn't hear of it");
	let turn = park(&bridge, vec![json!({ "role": "user", "content": "why?", "timestamp": 1 })], "chat_l1", &Abort::new());
	settle().await;
	let wait = WaitOptions { agent: Some("main-1".to_owned()), terminal: Some(TEACHER.to_owned()), ..WaitOptions::default() };
	let view = bridge.wait_for_work(0, wait).await.expect("the teacher's wait takes the lesson's turn");
	bridge.respond_to_work(&view.work_id, AgentReply { text: Some("Because.".to_owned()), tool_calls: Vec::new() }, 0).unwrap();
	turn.await.unwrap();
	assert_eq!(bridge.take_line(Some(TEACHER), clock::now_ms() + 100).as_deref(), Some("lesson"));
	assert_eq!(bridge.take_line(Some(TEACHER), clock::now_ms() + 100), None, "one Enter, one line");
	settle().await;
	clock::advance(3_000);
	settle().await;
	assert!(!bridge.take_typed(Some(TEACHER), clock::now_ms()), "a line that came stays the page's");

	// The helper's terminal, an outside agent, and a line with no Enter never go to the page.
	bridge.typed(HELPER, clock::now_ms());
	assert!(bridge.take_typed(Some(HELPER), clock::now_ms()));
	assert_eq!(bridge.take_line(Some(HELPER), clock::now_ms()), None);
	assert_eq!(bridge.take_line(None, clock::now_ms()), None);
	assert_eq!(bridge.take_line(Some(TEACHER), clock::now_ms()), None);

	// No line within 3 s: it was typed to the agent, and a late line is not taken.
	bridge.typed(TEACHER, clock::now_ms());
	settle().await;
	clock::advance(3_000);
	settle().await;
	assert!(bridge.take_typed(Some(TEACHER), clock::now_ms()));
	assert_eq!(bridge.take_line(Some(TEACHER), clock::now_ms()), None);

	// A line the page didn't confirm is typed to the agent.
	bridge.typed(TEACHER, clock::now_ms());
	assert!(bridge.take_line(Some(TEACHER), clock::now_ms()).is_some());
	bridge.line_unsent(TEACHER, clock::now_ms());
	assert!(bridge.take_typed(Some(TEACHER), clock::now_ms()));

	// The page closed: Enter is typed to the agent again.
	bridge.set_talk_page(None, None);
	bridge.typed(TEACHER, clock::now_ms());
	assert!(bridge.take_typed(Some(TEACHER), clock::now_ms()));
}

#[test]
fn only_the_teachers_stop_after_a_typed_line_is_an_answer_to_the_learner() {
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	bridge.set_live_terminals(vec![TEACHER.to_owned(), HELPER.to_owned()], Some(TEACHER.to_owned()));
	assert!(!bridge.take_chat(TEACHER), "a stop with no line typed (a lesson's reply) is not one");
	bridge.chat_line(TEACHER);
	bridge.chat_line(HELPER);
	assert!(bridge.take_chat(TEACHER));
	assert!(!bridge.take_chat(TEACHER), "one line, one answer");
	assert!(!bridge.take_chat(HELPER), "the helper's terminal never is");
	bridge.chat_line(TEACHER);
	bridge.set_live_terminals(vec![HELPER.to_owned()], None);
	assert!(!bridge.take_chat(TEACHER), "a stopped terminal forgets it");
}
