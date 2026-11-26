//! The teacher's round of work, for Follow's slip: the steps a teacher panel chat's turn took
//! since it began, as its desk shows them. A step is a read or a note; changes are left out, since
//! the activity log has them. In memory only, so a restart loses it, and an ended round keeps
//! nothing. Its start, each step and its end go out as "teacher-work". The chat code reaches it
//! only through `chat_turn_began`, `chat_step` and `chat_turn_ended`.

use std::collections::VecDeque;
use std::sync::Arc;

use gs_base::events::{EventKind, Events};
use gs_base::tasks::detach;
use gs_base::{clock, time};
use gs_core::session::teacher_steps::{TeacherStep, keep_step, step_head};
use gs_json::{Json, json};
use parking_lot::Mutex;

use crate::App;

/// A round with no step for this long has ended, though nothing said so.
pub const ROUND_STALE_MS: i64 = 5 * 60_000;

/// The round's state. Cloning shares it.
#[derive(Clone)]
pub struct TeacherRound(Arc<Inner>);

struct Inner {
	state: Mutex<State>,
	events: Events,
}

#[derive(Default)]
struct State {
	/// The round, while it lasts.
	round: Option<Round>,
	/// Counts rounds, so each has its own number.
	rounds: u64,
}

struct Round {
	/// Its number among the rounds, so its watch ends with it.
	number: u64,
	/// The teacher panel chat whose turn it is.
	chat_id: String,
	since: i64,
	last_step: i64,
	steps: VecDeque<Json>,
}

impl Round {
	fn ends_at(&self) -> i64 {
		self.last_step + ROUND_STALE_MS
	}
}

/// The live round, unless it is over by time.
fn live(s: &State, now: i64) -> Option<&Round> {
	s.round.as_ref().filter(|r| now < r.ends_at())
}

fn step_json(step: TeacherStep, now: i64) -> Json {
	let mut out = step_head(step.text, now);
	if let Some(link) = step.link {
		out.insert("link", link);
	}
	Json::Obj(out)
}

/// Ends the round once it is over by time and tells the window. It sleeps until the round's end
/// as it stands, and again when a step moved that end later.
fn watch(inner: &Arc<Inner>) {
	let Some(number) = inner.state.lock().round.as_ref().map(|r| r.number) else { return };
	let weak = Arc::downgrade(inner);
	detach("teacher-work", async move {
		loop {
			let due = weak.upgrade().and_then(|inner| inner.state.lock().round.as_ref().filter(|r| r.number == number).map(Round::ends_at));
			let Some(due) = due else { return };
			clock::sleep_until(due).await;
			let Some(inner) = weak.upgrade() else { return };
			let over = {
				let mut s = inner.state.lock();
				s.round.as_ref().is_some_and(|r| r.number == number && clock::now_ms() >= r.ends_at()) && s.round.take().is_some()
			};
			if over {
				TeacherRound(inner).emit();
				return;
			}
		}
	});
}

impl TeacherRound {
	pub fn new(events: &Events) -> TeacherRound {
		TeacherRound(Arc::new(Inner { state: Mutex::new(State::default()), events: events.clone() }))
	}

	fn emit(&self) {
		self.0.events.emit(EventKind::TeacherWork, json!({}));
	}

	/// A turn of the teacher panel chat `chat_id` began: its round begins and replaces any other,
	/// the window hears, and its end by time is watched.
	pub fn began(&self, chat_id: &str, now: i64) {
		{
			let mut s = self.0.state.lock();
			s.rounds += 1;
			s.round = Some(Round { number: s.rounds, chat_id: chat_id.to_owned(), since: now, last_step: now, steps: VecDeque::new() });
		}
		watch(&self.0);
		self.emit();
	}

	/// A step of the running turn of the teacher panel chat `chat_id`, as its desk shows it.
	pub fn step(&self, chat_id: &str, step: TeacherStep, now: i64) {
		let mut s = self.0.state.lock();
		let Some(round) = s.round.as_mut().filter(|r| r.chat_id == chat_id) else { return };
		round.last_step = now;
		keep_step(&mut round.steps, step_json(step, now));
		drop(s);
		self.emit();
	}

	/// The turn of the teacher panel chat `chat_id` ended, however it ended: so does its round.
	pub fn ended(&self, chat_id: &str) {
		let ended = {
			let mut s = self.0.state.lock();
			s.round.as_ref().is_some_and(|r| r.chat_id == chat_id) && s.round.take().is_some()
		};
		if ended {
			self.emit();
		}
	}

	/// GET /api/teacher-work: `{live, since, chatId, steps: [{id, at, text, link?}]}`. A round over
	/// by time reads as ended; its wake tells the window.
	pub fn view(&self, now: i64) -> Json {
		let s = self.0.state.lock();
		match live(&s, now) {
			Some(round) => json!({ "live": true, "since": time::iso(round.since), "chatId": round.chat_id.as_str(), "steps": round.steps.iter().cloned().collect::<Vec<_>>() }),
			None => json!({ "live": false, "since": null, "steps": [] }),
		}
	}
}

pub(crate) fn chat_turn_began(app: &App, chat_id: &str, now: i64) {
	app.teacher_round.began(chat_id, now);
}

pub(crate) fn chat_step(app: &App, chat_id: &str, step: TeacherStep, now: i64) {
	app.teacher_round.step(chat_id, step, now);
}

pub(crate) fn chat_turn_ended(app: &App, chat_id: &str) {
	app.teacher_round.ended(chat_id);
}
