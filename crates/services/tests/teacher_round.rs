//! The teacher's round of work: a teacher panel chat's turn begins it, the turn's end or five
//! minutes with no step ends it, and it keeps its last 40 steps. Every time here is the app
//! clock's now plus an offset; one test moves the clock, in its own binary.

use gs_base::clock;
use gs_base::events::{Event, EventKind, Events};
use gs_core::session::teacher_steps::{STEPS_MAX, TeacherStep};
use gs_json::{Json, json};
use gs_services::app::teacher_round::{ROUND_STALE_MS, TeacherRound};
use tokio::sync::mpsc::UnboundedReceiver;

fn round() -> (TeacherRound, UnboundedReceiver<Event>) {
	let events = Events::new();
	let rx = events.subscribe();
	(TeacherRound::new(&events), rx)
}

fn step(text: &str) -> TeacherStep {
	TeacherStep { text: text.to_owned(), link: None }
}

/// The round's step words, or None when no round is live.
fn steps(round: &TeacherRound, now: i64) -> Option<Vec<String>> {
	let view = round.view(now);
	if view["live"] != Json::Bool(true) {
		assert_eq!(view, json!({ "live": false, "since": null, "steps": [] }), "an ended round keeps nothing");
		return None;
	}
	Some(view["steps"].items().iter().map(|s| s["text"].str_or_empty().to_owned()).collect())
}

/// How many "teacher-work" events went out since the last look.
fn told(rx: &mut UnboundedReceiver<Event>) -> usize {
	std::iter::from_fn(|| rx.try_recv().ok()).filter(|e| e.kind == EventKind::TeacherWork).count()
}

#[tokio::test]
async fn a_chat_s_turn_is_a_round_of_its_own_until_the_turn_ends() {
	let (round, mut rx) = round();
	let now = clock::now_ms();
	round.step("chat_a", step("Looking at your spaces"), now);
	assert_eq!(steps(&round, now), None, "no turn, no round");

	round.began("chat_a", now);
	assert_eq!(round.view(now)["chatId"], json!("chat_a"));
	assert_eq!(round.view(now)["since"], json!(gs_base::time::iso(now)));
	round.step("chat_a", step("Looking at your spaces"), now + 1);
	round.step("chat_b", step("Reading a file"), now + 2);
	assert_eq!(steps(&round, now + 3), Some(vec!["Looking at your spaces".to_owned()]), "only that chat's steps");
	let first = &round.view(now)["steps"][0];
	assert!(first["id"].as_str().is_some_and(|id| !id.is_empty()) && first["at"] == json!(gs_base::time::iso(now + 1)) && first.get("link").is_none(), "{first:?}");
	round.ended("chat_b");
	assert!(steps(&round, now + 3).is_some(), "another chat's end leaves it");
	round.ended("chat_a");
	assert_eq!(steps(&round, now + 3), None);
	assert_eq!(told(&mut rx), 3, "began, one step, ended");
	round.ended("chat_a");
	assert_eq!(told(&mut rx), 0, "no round, no news");
}

#[tokio::test]
async fn a_new_turn_begins_a_new_round() {
	let (round, _rx) = round();
	let now = clock::now_ms();
	round.began("chat_a", now);
	round.step("chat_a", step("Looking at CSE 21"), now + 1);
	round.began("chat_b", now + 2);
	assert_eq!(steps(&round, now + 2), Some(Vec::new()));
	assert_eq!(round.view(now + 2)["since"], json!(gs_base::time::iso(now + 2)));
	round.ended("chat_a");
	assert!(steps(&round, now + 2).is_some(), "the replaced chat's end leaves the new round");
}

#[tokio::test]
async fn a_round_with_no_step_for_five_minutes_has_ended() {
	let (round, _rx) = round();
	let now = clock::now_ms();
	round.began("chat_a", now);
	assert!(steps(&round, now + ROUND_STALE_MS - 1).is_some());
	assert_eq!(steps(&round, now + ROUND_STALE_MS), None, "five minutes since it began");
	round.began("chat_a", now + 10);
	round.step("chat_a", step("Looking at CSE 21"), now + 1_000);
	assert!(steps(&round, now + 1_000 + ROUND_STALE_MS - 1).is_some(), "measured from the last step");
	assert_eq!(steps(&round, now + 1_000 + ROUND_STALE_MS), None);
}

#[tokio::test]
async fn a_round_keeps_its_last_forty_steps() {
	let (round, _rx) = round();
	let now = clock::now_ms();
	round.began("chat_a", now);
	for n in 0..STEPS_MAX + 5 {
		round.step("chat_a", step(&format!("Step {n}")), now + n as i64);
	}
	let kept = steps(&round, now + 100).unwrap();
	assert_eq!(kept.len(), STEPS_MAX);
	assert_eq!((kept[0].as_str(), kept[STEPS_MAX - 1].as_str()), ("Step 5", "Step 44"));
}

#[tokio::test]
async fn the_window_hears_when_a_round_ends_by_time() {
	let (round, mut rx) = round();
	round.began("chat_a", clock::now_ms());
	assert_eq!(told(&mut rx), 1);
	clock::sleep(5).await;
	clock::advance(ROUND_STALE_MS);
	for _ in 0..100 {
		if round.view(clock::now_ms())["live"] == Json::Bool(false) && told(&mut rx) == 1 {
			return;
		}
		clock::sleep(10).await;
	}
	panic!("the round's end by time never went out");
}
