//! The agents' terminals in the desktop app. The shell says which terminal ids are live; an
//! agent started in one sends its id with every request. A request from an ended terminal is
//! refused, its wait ends, and what it had claimed goes back to the queue at once. When the
//! learner types to the agent in its terminal, the terminal's wait ends too, so the agent can
//! answer them there.

use std::collections::HashSet;

use gs_base::events::EventKind;

use super::checkin::recent;
use super::{Bridge, State};

/// A typed message older than this no longer ends a wait: the agent read it some other way.
const TYPED_FRESH_MS: i64 = 120_000;

/// The last contact before this one.
fn touch(state: &mut State, terminal: Option<&str>, now: i64) -> Option<i64> {
	match terminal {
		Some(id) => state.terminal_contact.insert(id.to_owned(), now),
		None => Some(std::mem::replace(&mut state.outside_contact, now)),
	}
}

/// The terminal a wait came from has ended.
pub(super) fn closed(state: &State, terminal: Option<&str>) -> bool {
	terminal.is_some_and(|id| !state.live_terminals.contains(id))
}

/// The learner typed to the agent in this terminal lately, and no wait from it has said so yet.
pub(super) fn typed_lately(state: &State, terminal: Option<&str>, now: i64) -> bool {
	terminal.and_then(|id| state.typed.get(id)).is_some_and(|at| now - at < TYPED_FRESH_MS)
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
		s.typed.retain(|id, _| live.contains(id));
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
		let before = touch(&mut self.0.state.lock(), terminal, now);
		if before.is_none_or(|at| !recent(at, now)) {
			self.emit(EventKind::AgentChanged);
		}
	}

	/// Keeps an agent in a long wait here. Its request already said it came, so no news.
	pub(super) fn keep_terminal_contact(&self, terminal: Option<&str>, now: i64) {
		touch(&mut self.0.state.lock(), terminal, now);
	}

	/// The learner pressed Enter in this terminal with no question on its screen: its agent is
	/// here and busy with them for the next minutes, and its wait (now or next) ends with nothing.
	pub fn typed(&self, terminal: &str, now: i64) {
		self.0.state.lock().typed.insert(terminal.to_owned(), now);
		self.record_terminal_contact(Some(terminal), now);
		self.record_check_in(None, true, now);
		self.0.waiters.wake_all();
	}

	/// Whether the learner typed in this terminal lately; the wait that asks says so to the agent,
	/// so the next one waits again.
	pub fn take_typed(&self, terminal: Option<&str>, now: i64) -> bool {
		let mut s = self.0.state.lock();
		let lately = typed_lately(&s, terminal, now);
		if let Some(id) = terminal {
			s.typed.remove(id);
		}
		lately
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
