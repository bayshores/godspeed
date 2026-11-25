//! What godspeed knows of the agents in its terminals and outside it, for the terminal's free talk:
//! whether an agent is connected and its name (`checkin`), which terminals live and which is the
//! teacher's, the page on screen that takes the learner's lines (`terminals`), and the teacher's
//! round of work for Follow's slip (`steps`). Status changes go out as "agent-changed".

mod checkin;
mod steps;
mod terminals;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use gs_base::events::{EventKind, Events};
use gs_json::json;
use parking_lot::Mutex;
use tokio::task::JoinHandle;

pub use checkin::display_agent_name;
pub use terminals::WindowPage;

/// The agents' state. Cloning shares it.
#[derive(Clone)]
pub struct TerminalState(Arc<Inner>);

struct Inner {
	state: Mutex<State>,
	events: Events,
}

#[derive(Default)]
struct State {
	/// Last time an MCP client sent any request.
	last_contact: i64,
	agent_name: Option<String>,
	/// Fires "agent-changed" when the connection lapses.
	lapse: Option<JoinHandle<()>>,
	/// Counts lapse timers, so a replaced one that already woke does nothing.
	lapse_number: u64,
	/// The app's terminals that run now, as the shell says.
	live_terminals: HashSet<String>,
	/// The teacher's terminal among them.
	teacher_terminal: Option<String>,
	/// terminal id → its last request.
	terminal_contact: HashMap<String, i64>,
	/// What the window shows that takes the learner's lines ("lesson", "cheat sheet"), if anything.
	talk_page: Option<String>,
	/// The page the window shows, as it last said; None while it says nothing (closed).
	window_page: Option<WindowPage>,
	/// teacher terminal → when the learner pressed Enter there on a talk page, until the line comes
	/// through the prompt hook.
	entered: HashMap<String, i64>,
	/// Teacher terminals whose agent is answering a line the learner typed to it there.
	chatting: HashSet<String>,
	/// teacher terminal → the agent's chat (session id) it runs now.
	terminal_chat: HashMap<String, String>,
	/// The last request from an agent outside the app's terminals.
	outside_contact: i64,
	/// The teacher's round of work, while it lasts.
	round: Option<steps::Round>,
	/// Counts rounds, so each has its own number.
	rounds: u64,
}

impl TerminalState {
	pub fn new(events: &Events) -> TerminalState {
		TerminalState(Arc::new(Inner { state: Mutex::new(State::default()), events: events.clone() }))
	}

	fn emit(&self, kind: EventKind) {
		self.0.events.emit(kind, json!({}));
	}
}
