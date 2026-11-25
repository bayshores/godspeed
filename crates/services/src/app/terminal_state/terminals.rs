//! The agents' terminals in the desktop app. The shell says which terminal ids are live and which
//! is the teacher's; an agent started in one sends its id with every request, and a request from
//! an ended terminal is refused. When the learner presses Enter in the teacher's terminal while a
//! talk page is on screen, the line goes to that page.

use std::collections::HashSet;

use gs_base::clock;
use gs_base::events::EventKind;
use gs_base::tasks::detach;

use super::checkin::recent;
use super::steps::{begin_round, end_round_of};
use super::{State, TerminalState};

/// The page the window shows and its space (None: no space).
#[derive(Clone, Debug, PartialEq)]
pub struct WindowPage {
	pub path: String,
	pub space_id: Option<String>,
}

/// How long Enter on a talk page waits for its line to come through the prompt hook.
const LINE_WAIT_MS: i64 = 3_000;

/// The last contact before this one.
fn touch(state: &mut State, terminal: Option<&str>, now: i64) -> Option<i64> {
	match terminal {
		Some(id) => state.terminal_contact.insert(id.to_owned(), now),
		None => Some(std::mem::replace(&mut state.outside_contact, now)),
	}
}

impl TerminalState {
	/// The shell's live terminal ids and the teacher's among them. An ended terminal's round of
	/// work ends with it.
	pub fn set_live_terminals(&self, live: Vec<String>, teacher: Option<String>) {
		let live: HashSet<String> = live.into_iter().collect();
		let mut s = self.0.state.lock();
		s.terminal_contact.retain(|id, _| live.contains(id));
		s.entered.retain(|id, _| live.contains(id));
		s.chatting.retain(|id| live.contains(id));
		let gone = s.round.as_ref().and_then(|r| r.terminal()).is_some_and(|id| !live.contains(id));
		let round_ended = gone && s.round.take().is_some();
		s.teacher_terminal = teacher.filter(|id| live.contains(id));
		s.live_terminals = live;
		drop(s);
		if round_ended {
			self.emit(EventKind::TeacherWork);
		}
	}

	pub fn terminal_live(&self, id: &str) -> bool {
		self.0.state.lock().live_terminals.contains(id)
	}

	/// The request came from godspeed's own teacher terminal, not an outside one.
	pub fn is_teacher_terminal(&self, terminal: Option<&str>) -> bool {
		terminal.is_some_and(|id| self.0.state.lock().teacher_terminal.as_deref() == Some(id))
	}

	/// A request came from this terminal, or (None) from an agent outside the app.
	pub fn record_terminal_contact(&self, terminal: Option<&str>, now: i64) {
		let before = touch(&mut self.0.state.lock(), terminal, now);
		if before.is_none_or(|at| !recent(at, now)) {
			self.emit(EventKind::AgentChanged);
		}
	}

	/// The learner pressed Enter in this live terminal with no question on its screen. On a talk
	/// page in the teacher's terminal, the line goes to the page if it comes through the prompt
	/// hook in time.
	pub fn typed(&self, terminal: &str, now: i64) {
		let mut s = self.0.state.lock();
		if !s.live_terminals.contains(terminal) || s.talk_page.is_none() || s.teacher_terminal.as_deref() != Some(terminal) {
			return;
		}
		s.entered.insert(terminal.to_owned(), now);
		drop(s);
		let (state, id) = (self.clone(), terminal.to_owned());
		detach("terminal-line", async move {
			clock::sleep(LINE_WAIT_MS).await;
			let mut s = state.0.state.lock();
			if s.entered.get(&id) == Some(&now) {
				s.entered.remove(&id);
			}
		});
	}

	/// What the window shows: the page that takes the learner's lines, or None, and the page
	/// itself (None once the window is gone), which open_page compares with.
	pub fn set_talk_page(&self, page: Option<String>, window: Option<WindowPage>) {
		let mut s = self.0.state.lock();
		s.talk_page = page;
		s.window_page = window;
	}

	pub fn window_page(&self) -> Option<WindowPage> {
		self.0.state.lock().window_page.clone()
	}

	/// The line from this terminal's prompt hook: the talk page it goes to, when the learner just
	/// pressed Enter there on that page. One Enter gives one line.
	pub fn take_line(&self, terminal: Option<&str>, now: i64) -> Option<String> {
		let mut s = self.0.state.lock();
		let at = s.entered.remove(terminal?)?;
		if now - at > LINE_WAIT_MS {
			return None;
		}
		s.talk_page.clone()
	}

	/// A line the learner typed went to the agent in this terminal: when it is the teacher's, its
	/// next stop is an answer to the learner there, and its round of work begins.
	pub fn chat_line(&self, terminal: &str, now: i64) {
		let mut s = self.0.state.lock();
		if s.teacher_terminal.as_deref() != Some(terminal) {
			return;
		}
		s.chatting.insert(terminal.to_owned());
		begin_round(&mut s, Some(terminal), now);
		drop(s);
		self.round_began();
	}

	/// The agent in this terminal stopped (its Stop hook), which ends its round of work.
	pub fn agent_stopped(&self, terminal: &str) {
		if end_round_of(&mut self.0.state.lock(), Some(terminal)) {
			self.emit(EventKind::TeacherWork);
		}
	}

	/// The agent in this terminal stopped: whether it was answering the learner there.
	pub fn take_chat(&self, terminal: &str) -> bool {
		self.0.state.lock().chatting.remove(terminal)
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
