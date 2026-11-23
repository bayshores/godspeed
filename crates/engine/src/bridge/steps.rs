//! The teacher's round of work, for Follow's slip: the steps it took since the learner's line
//! reached it in godspeed's terminal, since it took a job the learner asked for, or (an agent
//! outside godspeed's terminal) since its first counted call. A step is a read or a note; changes
//! are left out, since the activity log has them. In memory only, so a restart loses it, and an
//! ended round keeps nothing. Its start, each step and its end go out as "teacher-work".

use std::collections::VecDeque;
use std::sync::Arc;

use gs_base::events::EventKind;
use gs_base::tasks::detach;
use gs_base::{clock, ids, time};
use gs_core::session::teacher_steps::TeacherStep;
use gs_json::{Json, Obj, json};

use super::{Bridge, Inner, State};

/// A round keeps this many steps; the oldest go first.
pub const ROUND_STEPS_MAX: usize = 40;
/// An agent outside godspeed's terminal has no Stop hook: its round ends this long after its last
/// counted call.
pub const OUTSIDE_QUIET_MS: i64 = 20_000;
/// A round with no step for this long has ended, though nothing said so.
pub const ROUND_STALE_MS: i64 = 5 * 60_000;

pub(super) struct Round {
	/// Its number among the rounds, so its watch ends with it.
	number: u64,
	/// The app terminal its agent runs in; None for an agent outside godspeed.
	terminal: Option<String>,
	since: i64,
	/// The asked job it began with, so that job's next work item goes on in the same round.
	asked: Option<String>,
	last_call: i64,
	last_step: i64,
	steps: VecDeque<Json>,
}

impl Round {
	pub(super) fn terminal(&self) -> Option<&str> {
		self.terminal.as_deref()
	}

	fn ends_at(&self) -> i64 {
		let stale = self.last_step + ROUND_STALE_MS;
		if self.terminal.is_none() { stale.min(self.last_call + OUTSIDE_QUIET_MS) } else { stale }
	}

	fn over(&self, now: i64) -> bool {
		now >= self.ends_at()
	}
}

fn begin(s: &mut State, terminal: Option<&str>, asked: Option<&str>, now: i64) {
	s.rounds += 1;
	s.round = Some(Round { number: s.rounds, terminal: terminal.map(str::to_owned), since: now, asked: asked.map(str::to_owned), last_call: now, last_step: now, steps: VecDeque::new() });
}

/// Ends the round: true when one was live.
pub(super) fn end_round(s: &mut State) -> bool {
	s.round.take().is_some()
}

fn step_json(step: TeacherStep, now: i64) -> Json {
	let mut out = Obj::new();
	out.insert("id", ids::uuid_hex("step", 12));
	out.insert("at", time::iso(now));
	out.insert("text", step.text);
	if let Some(link) = step.link {
		out.insert("link", link);
	}
	Json::Obj(out)
}

/// Ends the round once it is over by time and tells the window. It sleeps until the round's end
/// as it stands, and again when a call moved that end later.
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
				s.round.as_ref().is_some_and(|r| r.number == number && r.over(clock::now_ms())) && end_round(&mut s)
			};
			if over {
				Bridge(inner).emit(EventKind::TeacherWork);
				return;
			}
		}
	});
}

/// The learner's line reached the teacher in its terminal, or the teacher took a job the learner
/// asked for: a new round, true. That job's next work item goes on in the round it began.
pub(super) fn begin_round(s: &mut State, terminal: Option<&str>, asked: Option<&str>, now: i64) -> bool {
	let same_job = |r: &Round| asked.is_some() && r.asked.as_deref() == asked && r.terminal.as_deref() == terminal && !r.over(now);
	if let Some(round) = s.round.as_mut().filter(|r| same_job(r)) {
		round.last_call = now;
		return false;
	}
	begin(s, terminal, asked, now);
	true
}

/// The round of the agent in `terminal` (None: outside godspeed) ends: true when it was live.
pub(super) fn end_round_of(s: &mut State, terminal: Option<&str>) -> bool {
	s.round.as_ref().is_some_and(|r| r.terminal.as_deref() == terminal) && end_round(s)
}

impl Bridge {
	/// A round began: the window hears, and its end by time is watched.
	pub(super) fn round_began(&self) {
		watch(&self.0);
		self.emit(EventKind::TeacherWork);
	}

	/// The teacher (in `terminal`, or None: outside godspeed) waits for work again: it is done.
	pub fn teacher_waits(&self, terminal: Option<&str>) {
		let ended = end_round_of(&mut self.0.state.lock(), terminal);
		if ended {
			self.emit(EventKind::TeacherWork);
		}
	}

	/// A counted godspeed call from the teacher, with its step when it is one. It goes in that
	/// agent's live round; an agent outside godspeed's terminal begins one with its first call.
	pub fn teacher_call(&self, terminal: Option<&str>, step: Option<TeacherStep>, now: i64) {
		let mut s = self.0.state.lock();
		let ended = s.round.as_ref().is_some_and(|r| r.over(now)) && end_round(&mut s);
		let began = s.round.is_none() && terminal.is_none();
		if began {
			begin(&mut s, None, None, now);
		}
		let Some(round) = s.round.as_mut().filter(|r| r.terminal.as_deref() == terminal) else {
			drop(s);
			if ended {
				self.emit(EventKind::TeacherWork);
			}
			return;
		};
		round.last_call = now;
		let stepped = step.is_some();
		if let Some(step) = step {
			round.last_step = now;
			round.steps.push_back(step_json(step, now));
			if round.steps.len() > ROUND_STEPS_MAX {
				round.steps.pop_front();
			}
		}
		drop(s);
		if began {
			self.round_began();
		} else if ended || stepped {
			self.emit(EventKind::TeacherWork);
		}
	}

	/// GET /api/teacher-work: `{live, since, steps: [{id, at, text, link?}]}`. A round over by time
	/// reads as ended; its wake tells the window.
	pub fn teacher_work(&self, now: i64) -> Json {
		let s = self.0.state.lock();
		match s.round.as_ref().filter(|r| !r.over(now)) {
			Some(round) => json!({ "live": true, "since": time::iso(round.since), "steps": round.steps.iter().cloned().collect::<Vec<_>>() }),
			None => json!({ "live": false, "since": null, "steps": [] }),
		}
	}
}
