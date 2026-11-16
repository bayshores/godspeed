//! The quiet teacher in godspeed's terminal is nudged only while it sits idle and its wait would
//! take something: not before it reached godspeed, not while it works on a line or a tool call,
//! not again while the last nudge is not through.

use std::sync::Arc;

use gs_base::clock;
use gs_base::events::Events;
use gs_engine::bridge::Bridge;
use gs_engine::turn::abort::Abort;
use gs_json::json;

mod common;
use common::{Marks, park};

const TEACHER: &str = "0123456789abcdef0123456789abcdef";
const LINE: &str = "Your lesson is waiting.";

#[tokio::test]
async fn the_quiet_teacher_is_nudged_only_while_it_sits_idle_with_work_waiting() {
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	bridge.set_live_terminals(vec![TEACHER.to_owned()], Some(TEACHER.to_owned()));
	let now = clock::now_ms();
	let _turn = park(&bridge, vec![json!({ "role": "user", "content": "why?", "timestamp": 1 })], "chat_n1", &Abort::new());
	clock::sleep(5).await;
	assert_eq!(bridge.nudge_for_teacher(now), None, "its agent has not reached godspeed yet");

	bridge.record_terminal_contact(Some(TEACHER), now);
	assert_eq!(bridge.nudge_for_teacher(now), Some((TEACHER.to_owned(), true)), "a lesson turn waits");

	bridge.nudge_sent(TEACHER, LINE, now);
	assert_eq!(bridge.nudge_for_teacher(now + 1_000), None, "the last nudge is not through");
	assert!(!bridge.take_nudge_line(TEACHER, "something the learner typed"));
	assert!(bridge.take_nudge_line(TEACHER, LINE));
	bridge.agent_prompted(TEACHER);
	assert_eq!(bridge.nudge_for_teacher(now + 2_000), None, "it works on the nudge");
	bridge.agent_stopped(TEACHER, now + 3_000);
	assert!(bridge.nudge_for_teacher(now + 4_000).is_some(), "it stopped without waiting: again");
	bridge.agent_tool_call(TEACHER, now + 5_000);
	assert_eq!(bridge.nudge_for_teacher(now + 6_000), None, "a tool call since it stopped is work");
	bridge.agent_stopped(TEACHER, now + 7_000);
	assert!(bridge.nudge_for_teacher(now + 8_000).is_some());
	assert_eq!(bridge.contacted_teacher_terminal().as_deref(), Some(TEACHER));
}
