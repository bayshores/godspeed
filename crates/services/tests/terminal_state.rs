//! The terminal state: a line the learner types in the teacher's terminal while a talk page (a
//! lesson, a cheat sheet) is shown goes to that page through the prompt hook, once and only in
//! time; and the teacher's round of work, how it begins (a teacher panel chat's turn, the learner's
//! line in the teacher's terminal, an outside agent's first counted call), how it ends (the turn's
//! end, the Stop hook, quiet or stale by time, a closed terminal) and the 40 steps it keeps. Every time here is the app clock's now plus
//! an offset; one test moves the clock, in its own binary.

use gs_base::clock;
use gs_base::events::{Event, EventKind, Events};
use gs_core::session::teacher_steps::{STEPS_MAX, TeacherStep};
use gs_json::{Json, json};
use gs_services::app::terminal_state::{OUTSIDE_QUIET_MS, ROUND_STALE_MS, TerminalState};
use tokio::sync::mpsc::UnboundedReceiver;

const TEACHER: &str = "0123456789abcdef0123456789abcdef";
const OTHER: &str = "fedcba9876543210fedcba9876543210";

fn terminals() -> (TerminalState, UnboundedReceiver<Event>) {
	let events = Events::new();
	let rx = events.subscribe();
	let state = TerminalState::new(&events);
	state.set_live_terminals(vec![TEACHER.to_owned(), OTHER.to_owned()], Some(TEACHER.to_owned()));
	(state, rx)
}

fn step(text: &str) -> Option<TeacherStep> {
	Some(TeacherStep { text: text.to_owned(), link: None })
}

/// The round's step words, or None when no round is live.
fn steps(state: &TerminalState, now: i64) -> Option<Vec<String>> {
	let round = state.teacher_work(now);
	if round["live"] != Json::Bool(true) {
		assert_eq!(round, json!({ "live": false, "since": null, "steps": [] }), "an ended round keeps nothing");
		return None;
	}
	Some(round["steps"].items().iter().map(|s| s["text"].str_or_empty().to_owned()).collect())
}

/// How many "teacher-work" events went out since the last look.
fn told(rx: &mut UnboundedReceiver<Event>) -> usize {
	std::iter::from_fn(|| rx.try_recv().ok()).filter(|e| e.kind == EventKind::TeacherWork).count()
}

#[tokio::test]
async fn a_line_on_a_talk_page_goes_to_the_page_once_and_only_in_time() {
	let (state, _rx) = terminals();
	let now = clock::now_ms();

	// No talk page: Enter is the agent's, and no line is taken.
	state.typed(TEACHER, now);
	assert_eq!(state.take_line(Some(TEACHER), now), None);

	// A lesson is shown: the line goes to the lesson once.
	state.set_talk_page(Some("lesson".to_owned()), None);
	state.typed(TEACHER, now);
	assert_eq!(state.take_line(Some(TEACHER), now + 100).as_deref(), Some("lesson"));
	assert_eq!(state.take_line(Some(TEACHER), now + 100), None, "one Enter, one line");

	// Another terminal, an outside agent, and a line with no Enter never go to the page.
	state.typed(OTHER, now);
	assert_eq!(state.take_line(Some(OTHER), now), None);
	assert_eq!(state.take_line(None, now), None);
	assert_eq!(state.take_line(Some(TEACHER), now), None);

	// A line that comes more than 3 s after Enter went to the agent: the page doesn't take it.
	state.typed(TEACHER, now);
	assert_eq!(state.take_line(Some(TEACHER), now + 3_001), None);

	// The page closed: Enter is the agent's again.
	state.set_talk_page(None, None);
	state.typed(TEACHER, now);
	assert_eq!(state.take_line(Some(TEACHER), now), None);
}

#[test]
fn only_the_teachers_stop_after_a_typed_line_is_an_answer_to_the_learner() {
	let (state, _rx) = terminals();
	assert!(!state.take_chat(TEACHER), "a stop with no line typed is not one");
	state.chat_line(TEACHER, 0);
	state.chat_line(OTHER, 0);
	assert!(state.take_chat(TEACHER));
	assert!(!state.take_chat(TEACHER), "one line, one answer");
	assert!(!state.take_chat(OTHER), "another terminal's never is");
	state.chat_line(TEACHER, 0);
	state.set_live_terminals(vec![OTHER.to_owned()], None);
	assert!(!state.take_chat(TEACHER), "a stopped terminal forgets it");
}

#[tokio::test]
async fn the_learner_s_line_begins_the_teacher_s_round_and_its_stop_ends_it() {
	let (state, mut rx) = terminals();
	let now = clock::now_ms();
	state.teacher_call(Some(TEACHER), step("Looking at your spaces"), now);
	assert_eq!(steps(&state, now), None, "a call with no round from the teacher's terminal is no step");

	state.chat_line(OTHER, now);
	assert_eq!(steps(&state, now), None, "a line in another terminal is not the learner's ask");
	state.chat_line(TEACHER, now);
	assert_eq!(told(&mut rx), 1);
	assert_eq!(state.teacher_work(now)["since"], json!(gs_base::time::iso(now)));
	state.teacher_call(Some(TEACHER), step("Looking at CSE 21"), now + 1);
	state.teacher_call(Some(TEACHER), None, now + 2);
	state.teacher_call(None, step("Searching your graph for “x”"), now + 3);
	state.teacher_call(Some(OTHER), step("Reading a file"), now + 4);
	assert_eq!(steps(&state, now + 5), Some(vec!["Looking at CSE 21".to_owned()]), "only the teacher's own calls, and a change is no step");
	assert_eq!(told(&mut rx), 1, "the step was news, the change was not");
	let step = &state.teacher_work(now)["steps"][0];
	assert!(step["id"].as_str().is_some_and(|id| !id.is_empty()) && step["at"] == json!(gs_base::time::iso(now + 1)) && step.get("link").is_none(), "{step:?}");

	state.agent_stopped(OTHER);
	assert!(steps(&state, now + 6).is_some(), "another terminal's stop is not the teacher's");
	state.agent_stopped(TEACHER);
	assert_eq!(steps(&state, now + 7), None);
	assert_eq!(told(&mut rx), 1);
	state.agent_stopped(TEACHER);
	assert_eq!(told(&mut rx), 0, "no round, no news");
}

#[tokio::test]
async fn a_teacher_panel_chat_s_turn_is_a_round_of_its_own_until_the_turn_ends() {
	let (state, mut rx) = terminals();
	let now = clock::now_ms();
	state.talk_step("chat_a", step("Looking at your spaces").unwrap(), now);
	assert_eq!(steps(&state, now), None, "no turn, no round");

	state.talk_began("chat_a", now);
	assert_eq!(state.teacher_work(now)["chatId"], json!("chat_a"));
	state.talk_step("chat_a", step("Looking at your spaces").unwrap(), now + 1);
	state.talk_step("chat_b", step("Reading a file").unwrap(), now + 2);
	state.teacher_call(Some(TEACHER), step("Looking at CSE 21"), now + 3);
	assert_eq!(steps(&state, now + 3), Some(vec!["Looking at your spaces".to_owned()]), "only that chat's steps");
	state.talk_ended("chat_b");
	assert!(steps(&state, now + 3).is_some(), "another chat's end leaves it");
	state.talk_ended("chat_a");
	assert_eq!(steps(&state, now + 3), None);
	assert_eq!(told(&mut rx), 3, "began, one step, ended");

	// A line in the teacher's terminal begins a round of its own, which a chat's end leaves alone.
	state.talk_began("chat_a", now + 4);
	state.chat_line(TEACHER, now + 5);
	state.talk_ended("chat_a");
	assert_eq!(state.teacher_work(now + 5)["chatId"], Json::Null);
}

#[tokio::test]
async fn a_new_line_begins_a_new_round() {
	let (state, _rx) = terminals();
	let now = clock::now_ms();
	state.chat_line(TEACHER, now);
	state.teacher_call(Some(TEACHER), step("Looking at CSE 21"), now + 1);
	state.chat_line(TEACHER, now + 2);
	assert_eq!(steps(&state, now + 2), Some(Vec::new()));
	assert_eq!(state.teacher_work(now + 2)["since"], json!(gs_base::time::iso(now + 2)));
}

#[tokio::test]
async fn a_round_with_no_step_for_five_minutes_has_ended() {
	let (state, mut rx) = terminals();
	let now = clock::now_ms();
	state.chat_line(TEACHER, now);
	assert!(steps(&state, now + ROUND_STALE_MS - 1).is_some());
	assert_eq!(steps(&state, now + ROUND_STALE_MS), None, "five minutes since it began");
	state.chat_line(TEACHER, now + 10);
	state.teacher_call(Some(TEACHER), step("Looking at CSE 21"), now + 1_000);
	state.teacher_call(Some(TEACHER), None, now + 2_000);
	assert!(steps(&state, now + 1_000 + ROUND_STALE_MS - 1).is_some(), "measured from the last step");
	assert_eq!(steps(&state, now + 1_000 + ROUND_STALE_MS), None, "a change is no step");
	told(&mut rx);
	state.teacher_call(Some(TEACHER), step("Late"), now + 1_000 + ROUND_STALE_MS);
	assert_eq!(steps(&state, now + 1_000 + ROUND_STALE_MS), None, "a call after the end ends it and adds nothing");
	assert_eq!(told(&mut rx), 1);
}

#[tokio::test]
async fn a_closed_teacher_terminal_ends_its_round() {
	let (state, mut rx) = terminals();
	let now = clock::now_ms();
	state.chat_line(TEACHER, now);
	told(&mut rx);
	state.set_live_terminals(vec![TEACHER.to_owned(), OTHER.to_owned()], Some(TEACHER.to_owned()));
	assert!(steps(&state, now).is_some());
	state.set_live_terminals(vec![OTHER.to_owned()], None);
	assert_eq!(steps(&state, now), None);
	assert_eq!(told(&mut rx), 1);
}

#[tokio::test]
async fn a_round_keeps_its_last_forty_steps() {
	let (state, _rx) = terminals();
	let now = clock::now_ms();
	state.chat_line(TEACHER, now);
	for n in 0..STEPS_MAX + 5 {
		state.teacher_call(Some(TEACHER), step(&format!("Step {n}")), now + n as i64);
	}
	let kept = steps(&state, now + 100).unwrap();
	assert_eq!(kept.len(), STEPS_MAX);
	assert_eq!((kept[0].as_str(), kept[STEPS_MAX - 1].as_str()), ("Step 5", "Step 44"));
}

#[tokio::test]
async fn an_outside_agent_begins_a_round_with_its_first_call_and_ends_it_by_going_quiet() {
	let (state, mut rx) = terminals();
	let now = clock::now_ms();
	state.teacher_call(None, None, now);
	assert_eq!(steps(&state, now), Some(Vec::new()), "a change begins it too");
	assert_eq!(told(&mut rx), 1);
	state.teacher_call(None, step("Looking at CSE 21"), now + 10_000);
	assert!(steps(&state, now + 10_000 + OUTSIDE_QUIET_MS - 1).is_some(), "measured from its last call");
	assert_eq!(steps(&state, now + 10_000 + OUTSIDE_QUIET_MS), None);
	told(&mut rx);

	state.teacher_call(None, step("Looking at your spaces"), now + 10_000 + OUTSIDE_QUIET_MS);
	assert_eq!(steps(&state, now + 10_000 + OUTSIDE_QUIET_MS), Some(vec!["Looking at your spaces".to_owned()]), "its next call begins a new round");
	assert_eq!(told(&mut rx), 1, "one word for the old round's end and the new round");
	state.teacher_call(Some(TEACHER), step("Looking at CSE 21"), now + 10_001 + OUTSIDE_QUIET_MS);
	state.chat_line(OTHER, now);
	assert_eq!(steps(&state, now + 10_001 + OUTSIDE_QUIET_MS).map(|s| s.len()), Some(1), "the teacher's terminal has no round of its own here");
}

#[tokio::test]
async fn the_window_hears_when_a_round_ends_by_time() {
	let (state, mut rx) = terminals();
	state.teacher_call(None, step("Looking at CSE 21"), clock::now_ms());
	assert_eq!(told(&mut rx), 1);
	clock::sleep(5).await;
	clock::advance(OUTSIDE_QUIET_MS);
	for _ in 0..100 {
		if state.teacher_work(clock::now_ms())["live"] == Json::Bool(false) && told(&mut rx) == 1 {
			return;
		}
		clock::sleep(10).await;
	}
	panic!("the round's end by time never went out");
}
