//! The agents' terminals in the desktop app. The shell says which terminal ids are live; an
//! agent started in one sends its id with every request. A request from an ended terminal is
//! refused, its wait ends, and what it had claimed goes back to the queue at once. When the
//! learner types to the agent in its terminal, the terminal's wait ends too, so the agent can
//! answer them there. The shell also says which live terminal is the teacher's.

use std::collections::HashSet;

use gs_base::clock;
use gs_base::events::EventKind;
use gs_base::tasks::detach;

use super::checkin::recent;
use super::{Bridge, State};

/// A typed message older than this no longer ends a wait: the agent read it some other way.
const TYPED_FRESH_MS: i64 = 120_000;

/// The page the window shows and its space (None: no space).
#[derive(Clone, Debug, PartialEq)]
pub struct WindowPage {
	pub path: String,
	pub space_id: Option<String>,
}

/// How long Enter on a talk page waits for its line to come through the prompt hook.
pub const LINE_WAIT_MS: i64 = 3_000;

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
	/// The shell's live terminal ids and the teacher's among them. Items claimed through an ended
	/// terminal are released, and every waiter looks again, so a stopped terminal's wait ends.
	pub fn set_live_terminals(&self, live: Vec<String>, teacher: Option<String>) {
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
		s.entered.retain(|id, _| live.contains(id));
		s.chatting.retain(|id| live.contains(id));
		s.terminal_chat.retain(|id, _| live.contains(id));
		s.prompting.retain(|id| live.contains(id));
		s.tool_at.retain(|id, _| live.contains(id));
		s.stop_at.retain(|id, _| live.contains(id));
		s.nudged.retain(|id, _| live.contains(id));
		s.waited.retain(|id, _| live.contains(id));
		s.teacher_terminal = teacher.filter(|id| live.contains(id));
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

	/// The request came from godspeed's own teacher terminal, not the helper's or an outside one.
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

	/// Keeps an agent in a long wait here. Its request already said it came, so no news.
	pub(super) fn keep_terminal_contact(&self, terminal: Option<&str>, now: i64) {
		touch(&mut self.0.state.lock(), terminal, now);
	}

	/// The learner pressed Enter in this live terminal with no question on its screen: its wait
	/// (now or next) ends with nothing. It says nothing about the agent until that wait reads it.
	/// On a talk page the teacher's line goes to the page instead, so the wait hears of it only if
	/// the line doesn't come through the prompt hook in time.
	pub fn typed(&self, terminal: &str, now: i64) {
		let mut s = self.0.state.lock();
		if !s.live_terminals.contains(terminal) {
			return;
		}
		if s.talk_page.is_some() && s.teacher_terminal.as_deref() == Some(terminal) {
			s.entered.insert(terminal.to_owned(), now);
			drop(s);
			let (bridge, id) = (self.clone(), terminal.to_owned());
			detach("bridge", async move {
				clock::sleep(LINE_WAIT_MS).await;
				let mut s = bridge.0.state.lock();
				if s.entered.get(&id) == Some(&now) {
					s.entered.remove(&id);
					drop(s);
					bridge.line_unsent(&id, now);
				}
			});
			return;
		}
		s.typed.insert(terminal.to_owned(), now);
		drop(s);
		self.0.waiters.wake_all();
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
	/// next stop is an answer to the learner there.
	pub fn chat_line(&self, terminal: &str) {
		let mut s = self.0.state.lock();
		if s.teacher_terminal.as_deref() == Some(terminal) {
			s.chatting.insert(terminal.to_owned());
		}
	}

	/// The agent in this terminal took a line and works on it until it stops.
	pub fn agent_prompted(&self, terminal: &str) {
		self.0.state.lock().prompting.insert(terminal.to_owned());
	}

	/// The agent in this terminal stopped (its Stop hook).
	pub fn agent_stopped(&self, terminal: &str, now: i64) {
		let mut s = self.0.state.lock();
		s.prompting.remove(terminal);
		s.stop_at.insert(terminal.to_owned(), now);
	}

	/// The agent in this terminal called one of godspeed's tools.
	pub fn agent_tool_call(&self, terminal: &str, now: i64) {
		self.0.state.lock().tool_at.insert(terminal.to_owned(), now);
	}

	/// godspeed asked the shell to type this line to the quiet teacher.
	pub fn nudge_sent(&self, terminal: &str, line: &str, now: i64) {
		self.0.state.lock().nudged.insert(terminal.to_owned(), (line.to_owned(), now));
	}

	/// The line from this terminal's prompt hook is godspeed's nudge, not the learner's: it is
	/// through, so the next one may go when needed.
	pub fn take_nudge_line(&self, terminal: &str, line: &str) -> bool {
		let mut s = self.0.state.lock();
		let ours = s.nudged.get(terminal).is_some_and(|(sent, _)| sent.trim() == line.trim());
		if ours {
			s.nudged.remove(terminal);
		}
		ours
	}

	/// The teacher's terminal, once its agent has reached godspeed.
	pub fn contacted_teacher_terminal(&self) -> Option<String> {
		let s = self.0.state.lock();
		s.teacher_terminal.clone().filter(|id| s.terminal_contact.contains_key(id))
	}

	/// The agent's chat (session id) this terminal runs now.
	pub fn set_terminal_chat(&self, terminal: &str, chat: &str) {
		self.0.state.lock().terminal_chat.insert(terminal.to_owned(), chat.to_owned());
	}

	pub fn terminal_chat(&self, terminal: &str) -> Option<String> {
		self.0.state.lock().terminal_chat.get(terminal).cloned()
	}

	/// The chat godspeed's own teacher terminal runs now.
	pub fn teacher_chat(&self) -> Option<String> {
		let s = self.0.state.lock();
		s.teacher_terminal.as_ref().and_then(|terminal| s.terminal_chat.get(terminal).cloned())
	}

	/// The agent in this terminal stopped: whether it was answering the learner there.
	pub fn take_chat(&self, terminal: &str) -> bool {
		self.0.state.lock().chatting.remove(terminal)
	}

	/// The line didn't reach the page: it was typed to the agent after all.
	pub fn line_unsent(&self, terminal: &str, now: i64) {
		self.0.state.lock().typed.insert(terminal.to_owned(), now);
		self.0.waiters.wake_all();
	}

	/// Whether the learner typed in this terminal lately; the wait that asks says so to the agent,
	/// so the next one waits again. When the teacher's own wait reads it, the teacher is busy with
	/// the learner there for the next minutes, so the window does not say it isn't teaching.
	pub fn take_typed(&self, terminal: Option<&str>, now: i64) -> bool {
		let mut s = self.0.state.lock();
		let lately = typed_lately(&s, terminal, now);
		if let Some(id) = terminal {
			s.typed.remove(id);
		}
		let teacher = lately && terminal.is_some() && s.teacher_terminal.as_deref() == terminal;
		drop(s);
		if teacher {
			self.record_check_in(None, true, now);
		}
		lately
	}

	/// The agent in this terminal had a turn after the learner typed, so it read what they typed
	/// and no wait needs to say so.
	pub fn drop_typed(&self, terminal: Option<&str>) {
		if let Some(id) = terminal {
			self.0.state.lock().typed.remove(id);
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
