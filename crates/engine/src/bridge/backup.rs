//! The backup teacher: a second Claude Code session whose waiter says it is the backup. While a
//! main agent compacts its context (its PreCompact hook says so), the backup takes the lesson
//! and Talk turns, including the one the main agent held; otherwise it only waits.

use gs_base::clock;
use gs_base::events::EventKind;

use super::checkin::recent;
use super::{Bridge, State, is_background};

/// A compaction that never reported its end stops counting after this long.
const COMPACTING_LIMIT_MS: i64 = 10 * 60_000;

/// Whether this agent is compacting now (an old mark lapses).
pub(super) fn compacting_now(state: &State, agent: &str, now: i64) -> bool {
	state.compacting.get(agent).is_some_and(|since| now - since < COMPACTING_LIMIT_MS)
}

/// A main agent is compacting, so a backup answers for it.
pub(super) fn someone_compacting(state: &State, now: i64) -> bool {
	state.compacting.keys().any(|agent| compacting_now(state, agent, now))
}

fn connected(state: &State, now: i64) -> bool {
	state.backups.values().any(|at| recent(*at, now))
}

impl Bridge {
	/// A backup's waiter checked in recently.
	pub fn backup_connected(&self, now: i64) -> bool {
		connected(&self.0.state.lock(), now)
	}

	/// The backup is answering: a main agent is compacting and a backup waits.
	pub fn backup_answering(&self, now: i64) -> bool {
		let s = self.0.state.lock();
		someone_compacting(&s, now) && connected(&s, now)
	}

	/// Whether this agent's waiter is a backup's (its turn hints say --backup).
	pub fn is_backup_agent(&self, agent: Option<&str>) -> bool {
		self.0.state.lock().backups.contains_key(agent.unwrap_or_default())
	}

	/// The agent started compacting its context (its PreCompact hook). With a backup waiting,
	/// the lesson and Talk turns it held go back in the queue for the backup; its late reply is
	/// then refused (the claim count).
	pub fn agent_compacting(&self, agent: &str, now: i64) {
		let mut s = self.0.state.lock();
		// The backup compacting has no one to answer for it.
		if s.backups.contains_key(agent) {
			return;
		}
		s.compacting.insert(agent.to_owned(), now);
		if connected(&s, now) {
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

	/// A backup's waiter checked in; the window hears when the first one does.
	pub(super) fn note_backup(&self, agent: Option<&str>, now: i64) {
		let mut s = self.0.state.lock();
		let was = connected(&s, now);
		s.backups.insert(agent.unwrap_or_default().to_owned(), now);
		drop(s);
		if !was {
			self.emit(EventKind::AgentChanged);
		}
	}
}
