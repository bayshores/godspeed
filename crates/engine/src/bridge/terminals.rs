//! The agents' terminals in the desktop app. The shell says which terminal ids are live; an
//! agent started in one sends its id with every request. A request from an ended terminal is
//! refused, its wait ends, and what it had claimed goes back to the queue at once.

use std::collections::HashSet;

use gs_base::events::EventKind;

use super::checkin::recent;
use super::{Bridge, State};

/// The terminal a wait came from has ended.
pub(super) fn closed(state: &State, terminal: Option<&str>) -> bool {
	terminal.is_some_and(|id| !state.live_terminals.contains(id))
}

impl Bridge {
	/// The shell's live terminal ids. Items claimed through an ended terminal are released, and
	/// every waiter looks again, so a stopped terminal's wait ends.
	pub fn set_live_terminals(&self, live: Vec<String>) {
		let live: HashSet<String> = live.into_iter().collect();
		let mut s = self.0.state.lock();
		let mut released = false;
		for item in s.items.iter_mut().filter(|item| item.terminal.as_ref().is_some_and(|id| !live.contains(id))) {
			item.claimed_at = None;
			item.terminal = None;
			released = true;
		}
		s.terminal_contact.retain(|id, _| live.contains(id));
		s.live_terminals = live;
		drop(s);
		if released {
			self.emit(EventKind::AgentChanged);
		}
		self.0.waiters.wake_all();
	}

	pub fn terminal_live(&self, id: &str) -> bool {
		self.0.state.lock().live_terminals.contains(id)
	}

	/// A request came from this terminal, or (None) from an agent outside the app.
	pub fn record_terminal_contact(&self, terminal: Option<&str>, now: i64) {
		let mut s = self.0.state.lock();
		let before = match terminal {
			Some(id) => s.terminal_contact.insert(id.to_owned(), now),
			None => Some(std::mem::replace(&mut s.outside_contact, now)),
		};
		drop(s);
		if before.is_none_or(|at| !recent(at, now)) {
			self.emit(EventKind::AgentChanged);
		}
	}

	/// Every live terminal, and whether a request came from it lately.
	pub fn terminals_here(&self, now: i64) -> Vec<(String, bool)> {
		let s = self.0.state.lock();
		let mut ids: Vec<&String> = s.live_terminals.iter().collect();
		ids.sort();
		ids.into_iter().map(|id| (id.clone(), s.terminal_contact.get(id).is_some_and(|at| recent(*at, now)))).collect()
	}

	/// An agent outside the app's terminals sent a request lately.
	pub fn outside_here(&self, now: i64) -> bool {
		recent(self.0.state.lock().outside_contact, now)
	}
}
