//! The teacher's round of work: how it begins (the learner's line in the teacher's terminal, an
//! asked job taken, an outside agent's first counted call, never godspeed's nudge), how it ends
//! (the Stop hook, the next wait, quiet or stale by time, a closed terminal; an outside agent is
//! not quiet while it holds the asked job its round began with), and the 40 steps it
//! keeps. Every time here is the app clock's now plus an offset, since the clock is shared by the
//! whole binary. Two tests move it 20 s each, which ends no other test's round early.

use std::sync::Arc;

use gs_base::clock;
use gs_base::events::{EventKind, Events};
use gs_core::session::teacher_steps::{STEPS_MAX, TeacherStep};
use gs_engine::bridge::{AgentReply, Bridge, OUTSIDE_QUIET_MS, ROUND_STALE_MS, WaitOptions};
use gs_engine::turn::abort::Abort;
use gs_json::{Json, json};
use tokio::sync::mpsc::UnboundedReceiver;

mod common;
use common::{Marks, park};

const TEACHER: &str = "0123456789abcdef0123456789abcdef";
const HELPER: &str = "fedcba9876543210fedcba9876543210";

fn bridge() -> (Bridge, UnboundedReceiver<gs_base::events::Event>) {
	let events = Events::new();
	let rx = events.subscribe();
	let bridge = Bridge::new(&events, Arc::new(Marks::default()));
	bridge.set_live_terminals(vec![TEACHER.to_owned(), HELPER.to_owned()], Some(TEACHER.to_owned()));
	(bridge, rx)
}

fn step(text: &str) -> Option<TeacherStep> {
	Some(TeacherStep { text: text.to_owned(), link: None })
}

/// The round's step words, or None when no round is live.
fn steps(bridge: &Bridge, now: i64) -> Option<Vec<String>> {
	let round = bridge.teacher_work(now);
	if round["live"] != Json::Bool(true) {
		assert_eq!(round, json!({ "live": false, "since": null, "steps": [] }), "an ended round keeps nothing");
		return None;
	}
	Some(round["steps"].items().iter().map(|s| s["text"].str_or_empty().to_owned()).collect())
}

/// How many "teacher-work" events went out since the last look.
fn told(rx: &mut UnboundedReceiver<gs_base::events::Event>) -> usize {
	std::iter::from_fn(|| rx.try_recv().ok()).filter(|e| e.kind == EventKind::TeacherWork).count()
}

#[tokio::test]
async fn the_learner_s_line_begins_the_teacher_s_round_and_its_stop_ends_it() {
	let (bridge, mut rx) = bridge();
	let now = clock::now_ms();
	bridge.teacher_call(Some(TEACHER), step("Looking at your spaces"), now);
	assert_eq!(steps(&bridge, now), None, "a call with no round from the teacher's terminal is no step");

	bridge.chat_line(HELPER, now);
	assert_eq!(steps(&bridge, now), None, "a line in the helper's terminal is not the learner's ask");
	bridge.chat_line(TEACHER, now);
	assert_eq!(told(&mut rx), 1);
	assert_eq!(bridge.teacher_work(now)["since"], json!(gs_base::time::iso(now)));
	bridge.teacher_call(Some(TEACHER), step("Looking at CSE 21"), now + 1);
	bridge.teacher_call(Some(TEACHER), None, now + 2);
	bridge.teacher_call(None, step("Searching your graph for “x”"), now + 3);
	bridge.teacher_call(Some(HELPER), step("Reading a file"), now + 4);
	assert_eq!(steps(&bridge, now + 5), Some(vec!["Looking at CSE 21".to_owned()]), "only the teacher's own calls, and a change is no step");
	assert_eq!(told(&mut rx), 1, "the step was news, the change was not");
	let step = &bridge.teacher_work(now)["steps"][0];
	assert!(step["id"].as_str().is_some_and(|id| !id.is_empty()) && step["at"] == json!(gs_base::time::iso(now + 1)) && step.get("link").is_none(), "{step:?}");

	bridge.agent_stopped(HELPER, now + 6);
	assert!(steps(&bridge, now + 6).is_some(), "the helper's stop is not the teacher's");
	bridge.agent_stopped(TEACHER, now + 7);
	assert_eq!(steps(&bridge, now + 7), None);
	assert_eq!(told(&mut rx), 1);
	bridge.agent_stopped(TEACHER, now + 8);
	assert_eq!(told(&mut rx), 0, "no round, no news");
}

#[tokio::test]
async fn godspeed_s_nudge_never_begins_a_round() {
	let (bridge, mut rx) = bridge();
	let now = clock::now_ms();
	bridge.nudge_sent(TEACHER, "Your lesson is waiting.", now);
	assert!(bridge.take_nudge_line(TEACHER, "Your lesson is waiting."));
	bridge.agent_prompted(TEACHER);
	bridge.teacher_call(Some(TEACHER), step("Looking at your lessons"), now + 1);
	assert_eq!(steps(&bridge, now + 1), None);
	assert_eq!(told(&mut rx), 0);
}

#[tokio::test]
async fn the_teacher_s_next_wait_ends_its_round_and_a_new_line_begins_a_new_one() {
	let (bridge, mut rx) = bridge();
	let now = clock::now_ms();
	bridge.chat_line(TEACHER, now);
	bridge.teacher_call(Some(TEACHER), step("Looking at CSE 21"), now + 1);
	bridge.chat_line(TEACHER, now + 2);
	assert_eq!(steps(&bridge, now + 2), Some(Vec::new()), "the next line is a new round");
	assert_eq!(bridge.teacher_work(now + 2)["since"], json!(gs_base::time::iso(now + 2)));
	told(&mut rx);
	bridge.teacher_waits(None);
	bridge.teacher_waits(Some(HELPER));
	assert!(steps(&bridge, now + 3).is_some(), "only a wait from the round's own agent");
	bridge.teacher_waits(Some(TEACHER));
	assert_eq!(steps(&bridge, now + 3), None);
	assert_eq!(told(&mut rx), 1);
}

#[tokio::test]
async fn a_round_with_no_step_for_five_minutes_has_ended() {
	let (bridge, mut rx) = bridge();
	let now = clock::now_ms();
	bridge.chat_line(TEACHER, now);
	assert!(steps(&bridge, now + ROUND_STALE_MS - 1).is_some());
	assert_eq!(steps(&bridge, now + ROUND_STALE_MS), None, "five minutes since it began");
	bridge.chat_line(TEACHER, now + 10);
	bridge.teacher_call(Some(TEACHER), step("Looking at CSE 21"), now + 1_000);
	bridge.teacher_call(Some(TEACHER), None, now + 2_000);
	assert!(steps(&bridge, now + 1_000 + ROUND_STALE_MS - 1).is_some(), "measured from the last step");
	assert_eq!(steps(&bridge, now + 1_000 + ROUND_STALE_MS), None, "a change is no step");
	told(&mut rx);
	bridge.teacher_call(Some(TEACHER), step("Late"), now + 1_000 + ROUND_STALE_MS);
	assert_eq!(steps(&bridge, now + 1_000 + ROUND_STALE_MS), None, "a call after the end ends it and adds nothing");
	assert_eq!(told(&mut rx), 1);
}

#[tokio::test]
async fn a_closed_teacher_terminal_ends_its_round() {
	let (bridge, mut rx) = bridge();
	let now = clock::now_ms();
	bridge.chat_line(TEACHER, now);
	told(&mut rx);
	bridge.set_live_terminals(vec![TEACHER.to_owned(), HELPER.to_owned()], Some(TEACHER.to_owned()));
	assert!(steps(&bridge, now).is_some());
	bridge.set_live_terminals(vec![HELPER.to_owned()], None);
	assert_eq!(steps(&bridge, now), None);
	assert_eq!(told(&mut rx), 1);
}

#[tokio::test]
async fn a_round_keeps_its_last_forty_steps() {
	let (bridge, _rx) = bridge();
	let now = clock::now_ms();
	bridge.chat_line(TEACHER, now);
	for n in 0..STEPS_MAX + 5 {
		bridge.teacher_call(Some(TEACHER), step(&format!("Step {n}")), now + n as i64);
	}
	let kept = steps(&bridge, now + 100).unwrap();
	assert_eq!(kept.len(), STEPS_MAX);
	assert_eq!((kept[0].as_str(), kept[STEPS_MAX - 1].as_str()), ("Step 5", "Step 44"));
}

#[tokio::test]
async fn the_teacher_taking_an_asked_job_begins_a_round_and_the_helper_never_does() {
	let (bridge, mut rx) = bridge();
	bridge.mark_asked("job_ask");
	let first = park(&bridge, vec![json!({ "role": "user", "content": "what does HW6 cover", "timestamp": 1 })], "job_ask", &Abort::new());
	clock::sleep(5).await;
	let helper = WaitOptions { agent: Some("helper-1".to_owned()), helper: true, terminal: Some(HELPER.to_owned()), ..WaitOptions::default() };
	let teacher = WaitOptions { agent: Some("main-1".to_owned()), and_others: true, terminal: Some(TEACHER.to_owned()), ..WaitOptions::default() };
	let work = bridge.wait_for_work(0, teacher.clone()).await.unwrap();
	assert_eq!(work.conversation, "job_ask");
	let since = bridge.teacher_work(clock::now_ms())["since"].clone();
	assert!(since.as_str().is_some() && told(&mut rx) == 1);
	bridge.teacher_call(Some(TEACHER), step("Reading HW6.pdf"), clock::now_ms());
	told(&mut rx);

	// The same job's next work item goes on in the same round.
	bridge.respond_to_work(&work.work_id, AgentReply { text: Some("Limits.".to_owned()), tool_calls: Vec::new() }, 0).unwrap();
	first.await.unwrap();
	let _second = park(&bridge, vec![json!({ "role": "user", "content": "and HW7?", "timestamp": 2 })], "job_ask", &Abort::new());
	clock::sleep(5).await;
	let again = bridge.wait_for_work(0, teacher).await.unwrap();
	assert_eq!(again.conversation, "job_ask");
	assert_eq!(bridge.teacher_work(clock::now_ms())["since"], since, "not a new round");
	assert_eq!(steps(&bridge, clock::now_ms()), Some(vec!["Reading HW6.pdf".to_owned()]));
	assert_eq!(told(&mut rx), 0);

	bridge.teacher_waits(Some(TEACHER));
	bridge.mark_asked("job_other");
	let _other = park(&bridge, vec![json!({ "role": "user", "content": "sum it up", "timestamp": 3 })], "job_other", &Abort::new());
	clock::sleep(5).await;
	// The helper takes an asked job once it waited 20 s untaken.
	clock::advance(20_000);
	assert_eq!(bridge.wait_for_work(0, helper).await.unwrap().conversation, "job_other");
	assert_eq!(steps(&bridge, clock::now_ms()), None, "the helper's work is no round");
}

#[tokio::test]
async fn an_outside_agent_begins_a_round_with_its_first_call_and_ends_it_by_going_quiet() {
	let (bridge, mut rx) = bridge();
	let now = clock::now_ms();
	bridge.teacher_call(None, None, now);
	assert_eq!(steps(&bridge, now), Some(Vec::new()), "a change begins it too");
	assert_eq!(told(&mut rx), 1);
	bridge.teacher_call(None, step("Looking at CSE 21"), now + 10_000);
	assert!(steps(&bridge, now + 10_000 + OUTSIDE_QUIET_MS - 1).is_some(), "measured from its last call");
	assert_eq!(steps(&bridge, now + 10_000 + OUTSIDE_QUIET_MS), None);
	told(&mut rx);

	bridge.teacher_call(None, step("Looking at your spaces"), now + 10_000 + OUTSIDE_QUIET_MS);
	assert_eq!(steps(&bridge, now + 10_000 + OUTSIDE_QUIET_MS), Some(vec!["Looking at your spaces".to_owned()]), "its next call begins a new round");
	assert_eq!(told(&mut rx), 1, "one word for the old round's end and the new round");
	bridge.teacher_call(Some(TEACHER), step("Looking at CSE 21"), now + 10_001 + OUTSIDE_QUIET_MS);
	bridge.chat_line(HELPER, now);
	assert_eq!(steps(&bridge, now + 10_001 + OUTSIDE_QUIET_MS).map(|s| s.len()), Some(1), "the teacher's terminal has no round of its own here");
	bridge.teacher_waits(None);
	assert_eq!(steps(&bridge, now + 10_001 + OUTSIDE_QUIET_MS), None, "its wait ends it");
	told(&mut rx);

	// Once the clock passes the end, the window hears without asking. This test alone moves it.
	bridge.teacher_call(None, step("Looking at CSE 21"), clock::now_ms());
	assert_eq!(told(&mut rx), 1);
	clock::sleep(5).await;
	clock::advance(OUTSIDE_QUIET_MS);
	for _ in 0..100 {
		if bridge.teacher_work(clock::now_ms())["live"] == Json::Bool(false) && told(&mut rx) == 1 {
			return;
		}
		clock::sleep(10).await;
	}
	panic!("the round's end by time never went out");
}

#[tokio::test]
async fn an_outside_agent_holding_an_asked_job_keeps_its_round_until_it_answers() {
	let (bridge, _rx) = bridge();
	bridge.mark_asked("job_outside");
	let job = park(&bridge, vec![json!({ "role": "user", "content": "what does HW7 cover", "timestamp": 1 })], "job_outside", &Abort::new());
	clock::sleep(5).await;
	let taken = clock::now_ms();
	let work = bridge.wait_for_work(0, WaitOptions { agent: Some("outside-1".to_owned()), and_others: true, ..WaitOptions::default() }).await.unwrap();
	assert_eq!(work.conversation, "job_outside");
	assert!(steps(&bridge, taken + OUTSIDE_QUIET_MS + 5_000).is_some(), "not quiet while it holds the job");

	let answered = clock::now_ms();
	bridge.respond_to_work(&work.work_id, AgentReply { text: Some("Graphs.".to_owned()), tool_calls: Vec::new() }, 0).unwrap();
	let live = steps(&bridge, answered + OUTSIDE_QUIET_MS - 1).is_some();
	// Another test may move the clock 20 s at any moment, which rightly ends the round by its quiet.
	assert!(live || clock::now_ms() - answered >= OUTSIDE_QUIET_MS, "its quiet counts from the answer, so the job's next item can go on in the round");
	job.await.unwrap();
	assert_eq!(steps(&bridge, clock::now_ms() + OUTSIDE_QUIET_MS), None, "quiet once it holds the job no more");
}
