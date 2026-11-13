//! The helper: a second agent session whose waiter says it is the helper. It does the background
//! jobs (file reading, graph work, sheets), so the teacher stays free for the learner. While a
//! teacher compacts its context (its PreCompact hook says so), the helper also takes the lesson
//! and Talk turns, including the one the teacher held.

use gs_base::clock;
use gs_base::events::EventKind;

use super::checkin::recent;
use super::work::CLAIM_TIMEOUT_MS;
use super::{Bridge, State, is_background};

/// A compaction that never reported its end stops counting after this long.
const COMPACTING_LIMIT_MS: i64 = 10 * 60_000;

/// The id of a helper whose client sends no session id, so it and the teacher stay apart.
pub const UNNAMED_HELPER: &str = "helper";

/// Whether this agent is compacting now (an old mark lapses).
pub(super) fn compacting_now(state: &State, agent: &str, now: i64) -> bool {
	state.compacting.get(agent).is_some_and(|since| now - since < COMPACTING_LIMIT_MS)
}

/// A teacher is compacting, so a helper answers for it.
pub(super) fn someone_compacting(state: &State, now: i64) -> bool {
	state.compacting.keys().any(|agent| compacting_now(state, agent, now))
}

fn is_helper(state: &State, agent: Option<&str>) -> bool {
	state.helpers.contains_key(agent.unwrap_or_default())
}

/// A helper holds an item whose claim has not run out.
fn busy(state: &State, now: i64) -> bool {
	state.items.iter().any(|i| i.claimed_at.is_some_and(|at| now - at <= CLAIM_TIMEOUT_MS) && is_helper(state, i.agent.as_deref()))
}

/// A helper checked in recently, or still works on an item (a long job has no check-ins).
pub(super) fn here(state: &State, now: i64) -> bool {
	state.helpers.values().any(|at| recent(*at, now)) || busy(state, now)
}

impl Bridge {
	pub fn helper_here(&self, now: i64) -> bool {
		here(&self.0.state.lock(), now)
	}

	/// The helper is answering lessons and Talk: a teacher is compacting and a helper is here.
	pub fn helper_covering(&self, now: i64) -> bool {
		let s = self.0.state.lock();
		someone_compacting(&s, now) && here(&s, now)
	}

	/// Whether this agent's waiter is a helper's (its turn hints say --helper).
	pub fn is_helper_agent(&self, agent: Option<&str>) -> bool {
		is_helper(&self.0.state.lock(), agent)
	}

	/// The agent started compacting its context (its PreCompact hook). With a helper here, the
	/// lesson and Talk turns it held go back in the queue for the helper; its late reply is then
	/// refused (the claim count).
	pub fn agent_compacting(&self, agent: &str, now: i64) {
		let mut s = self.0.state.lock();
		// The helper compacting has no one to answer for it.
		if s.helpers.contains_key(agent) {
			return;
		}
		s.compacting.insert(agent.to_owned(), now);
		if here(&s, now) {
			for item in s.items.iter_mut().filter(|i| i.agent.as_deref() == Some(agent) && !is_background(&i.conversation)) {
				item.claimed_at = None;
			}
		}
		drop(s);
		// The window hears when a mark that never ended lapses.
		let events = self.0.events.clone();
		tokio::spawn(async move {
			clock::sleep(COMPACTING_LIMIT_MS + 1000).await;
			events.emit(EventKind::AgentChanged, gs_json::json!({}));
		});
		self.emit(EventKind::AgentChanged);
		self.0.waiters.wake_all();
	}

	/// A helper checked in; the window hears when the first one does.
	pub(super) fn note_helper(&self, agent: Option<&str>, now: i64) {
		let mut s = self.0.state.lock();
		let was = here(&s, now);
		s.helpers.insert(agent.unwrap_or_default().to_owned(), now);
		drop(s);
		if !was {
			self.emit(EventKind::AgentChanged);
		}
	}

	/// A work-loop call about an item: its helper stays here, anyone else counts as teaching.
	pub(super) fn check_in_for(&self, work_id: &str) {
		let now = clock::now_ms();
		let helper = {
			let s = self.0.state.lock();
			super::work::open_item(&s, work_id).map(|i| s.items[i].agent.clone()).filter(|agent| is_helper(&s, agent.as_deref()))
		};
		match helper {
			Some(agent) => self.note_helper(agent.as_deref(), now),
			None => self.record_check_in(None, true, now),
		}
	}
}
