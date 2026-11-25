//! Whether an agent is connected, and its name.

use std::sync::Arc;

use gs_base::clock;
use gs_base::events::EventKind;
use gs_base::re::Re;
use gs_base::text::{slice16, trim};
use gs_json::Json;

use super::{Inner, TerminalState};

/// An agent counts as connected if it checked in within this window.
const CONNECTED_WINDOW_MS: i64 = 3 * 60_000;

pub(super) fn recent(at: i64, now: i64) -> bool {
	now - at < CONNECTED_WINDOW_MS
}

/// A readable name for an MCP client's `clientInfo` ("claude-code" → "Claude Code"). Unknown
/// clients keep their own title or name.
pub fn display_agent_name(client_info: &Json) -> Option<String> {
	let field = |key: &str| client_info[key].as_str().map_or_else(String::new, |s| trim(s).to_owned());
	let (name, title) = (field("name"), field("title"));
	if Re::new("claude[-_ ]?code", "i").test(&name) {
		return Some("Claude Code".to_owned());
	}
	if Re::new("codex", "i").test(&name) {
		return Some("Codex".to_owned());
	}
	let shown = slice16(if title.is_empty() { &name } else { &title }, 0, Some(60));
	(!shown.is_empty()).then_some(shown)
}

impl TerminalState {
	pub fn agent_connected(&self, now: i64) -> bool {
		recent(self.0.state.lock().last_contact, now)
	}

	/// The agent's name, while it is connected.
	pub fn agent_name(&self, now: i64) -> Option<String> {
		let s = self.0.state.lock();
		recent(s.last_contact, now).then(|| s.agent_name.clone()).flatten()
	}

	/// An agent sent an authorized MCP request. `name` comes from the request's client info;
	/// requests without one keep the last name.
	pub fn record_check_in(&self, name: Option<&str>, now: i64) {
		let was_connected = self.agent_connected(now);
		let mut s = self.0.state.lock();
		let name_before = s.agent_name.clone();
		s.last_contact = now;
		if let Some(name) = name.filter(|n| !n.is_empty()) {
			s.agent_name = Some(name.to_owned());
		}
		let renamed = s.agent_name != name_before;
		drop(s);
		schedule_lapse(&self.0, now);
		if !was_connected || renamed {
			self.emit(EventKind::AgentChanged);
		}
	}
}

/// Fires "agent-changed" a second after the connection lapses.
fn schedule_lapse(inner: &Arc<Inner>, now: i64) {
	let mut s = inner.state.lock();
	if let Some(timer) = s.lapse.take() {
		timer.abort();
	}
	s.lapse_number += 1;
	let number = s.lapse_number;
	let lapses = s.last_contact + CONNECTED_WINDOW_MS;
	if lapses <= now {
		return;
	}
	let weak = Arc::downgrade(inner);
	s.lapse = Some(gs_base::tasks::spawn("checkin", async move {
		clock::sleep(lapses - now + 1000).await;
		let Some(inner) = weak.upgrade() else { return };
		// A newer check-in replaced this timer after it woke.
		if inner.state.lock().lapse_number != number {
			return;
		}
		TerminalState(inner).emit(EventKind::AgentChanged);
	}));
}
