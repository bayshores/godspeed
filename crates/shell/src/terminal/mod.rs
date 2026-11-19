//! The agents' terminals, in memory only: at most one live record per role (teacher, helper).
//! Each runs one start script in a pseudo-terminal (spawn.rs); the shell keeps its screen
//! (screen.rs), sends its output only to the window that shows it (one at a time, by label), and
//! tells the server which terminal ids are live, so an agent whose terminal ended is refused.

mod attach;
pub mod commands;
mod input;
mod registry;
mod screen;
mod spawn;
#[cfg(test)]
mod tests;

use std::sync::mpsc::Sender;
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use portable_pty::MasterPty;
use serde_json::{Value, json};

use crate::lock::lock;
pub use registry::Terminals;
pub use screen::Prompt;
use screen::{Screen, Settle};
pub use spawn::{Agent, Role};

/// How long a shown terminal's output waits to go out with what follows it: a program that
/// prints without pause costs the window one push a frame.
const FRAME: Duration = Duration::from_millis(16);
/// More output than this in one frame is sent as the screen it drew instead.
const FRAME_BYTES: usize = 64 * 1024;
/// On the screen when the shell could not draw a terminal's output.
const BROKEN: &str = "godspeed couldn't read this terminal's screen, so it stopped it. Start it again to go on.";

pub const NOT_SET_UP: &str = "The godspeed folder isn't set up yet.";
const NO_START: &str = "godspeed couldn't start the terminal.";
const NOT_THERE: &str = "That terminal isn't running.";
const NOT_SHOWN: &str = "Show the terminal and click in it first.";
const NOT_SENT: &str = "Clear what you typed in the terminal, then try again.";

/// Which window a push is for.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum To<'a> {
	/// Every window that can show a terminal.
	All,
	/// The window with this label.
	Window(&'a str),
}

/// Where a terminal's news goes: the page, the server and the log.
pub trait Outlet: Send + Sync + 'static {
	fn push(&self, to: To, channel: &str, payload: Value);
	/// The live terminal ids changed; `teacher` is the teacher's among them.
	fn live(&self, ids: Vec<String>, teacher: Option<String>);
	/// The learner sent a message to the agent in this terminal.
	fn typed(&self, id: &str);
	fn log(&self, line: &str);
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Ended {
	/// The learner clicked Stop, godspeed quit, or (the helper) the teacher ended.
	Stopped,
	Exited(u32),
	/// The shell could not draw its output, and stopped it.
	Broken,
}

struct Terminal {
	id: String,
	role: Role,
	agent: Agent,
	started_at: i64,
	pid: Option<u32>,
	#[cfg(windows)]
	job: crate::win::job::Job,
	state: Mutex<State>,
	/// Wakes the terminal's clock: output came, or the terminal ended.
	wake: Condvar,
}

/// The terminal's input, queued in order, and its page end, kept open until the script ends.
struct Io {
	input: Sender<Vec<u8>>,
	master: Box<dyn MasterPty + Send>,
}

struct State {
	io: Option<Io>,
	screen: Screen,
	settle: Settle,
	/// What the page was last told.
	shown: (Option<Prompt>, bool),
	/// The label of the window showing the terminal. A newer window takes it over from an older.
	attached: Option<String>,
	/// Output for the page, sent once a frame; `overflow` sends the screen instead.
	pending: Vec<u8>,
	overflow: bool,
	/// When the pending output goes to the page.
	flush_at: Option<Instant>,
	stopping: bool,
	broken: bool,
	ended: Option<Ended>,
	/// The process group the shell may still signal. Dropped once its leftovers were killed,
	/// since its pid may belong to another program after that.
	#[cfg(unix)]
	group: Option<u32>,
}

impl Terminal {
	fn state(&self) -> MutexGuard<'_, State> {
		lock(&self.state)
	}

	fn ended_json(ended: Option<Ended>) -> Value {
		match ended {
			None => Value::Null,
			Some(Ended::Stopped) => json!({ "stopped": true, "code": null }),
			Some(Ended::Exited(code)) => json!({ "stopped": false, "code": code }),
			Some(Ended::Broken) => json!({ "stopped": false, "code": null }),
		}
	}

	fn state_json(&self, state: &State) -> Value {
		json!({ "id": self.id, "ended": Self::ended_json(state.ended), "prompt": state.shown.0.map(Prompt::name), "url": state.shown.1 })
	}

	/// Tells the page when the question or the web address on the screen changed.
	fn push_state(&self, state: &mut State, outlet: &dyn Outlet, now: Instant) {
		let shown = state.settle.shown(now);
		if shown != state.shown {
			state.shown = shown;
			outlet.push(To::All, "terminal-state", self.state_json(state));
		}
	}

	/// Draws output and queues it for the page; false once the screen broke on it (the terminal
	/// is to be stopped then, while its output is still read and dropped).
	fn output(&self, bytes: &[u8], outlet: &dyn Outlet) -> bool {
		let mut state = self.state();
		if state.broken {
			return true;
		}
		let drawn = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| state.screen.process(bytes)));
		let Ok(replies) = drawn else {
			state.broken = true;
			state.screen = Screen::default();
			state.screen.process(BROKEN.as_bytes());
			state.overflow = true;
			self.flush(&mut state, outlet);
			return false;
		};
		if let Some(io) = state.io.as_ref().filter(|_| !replies.is_empty()) {
			let _ = io.input.send(replies);
		}
		if state.attached.is_some() {
			if state.overflow || state.pending.len() + bytes.len() > FRAME_BYTES {
				state.pending.clear();
				state.overflow = true;
			} else {
				state.pending.extend_from_slice(bytes);
			}
			state.flush_at.get_or_insert_with(|| Instant::now() + FRAME);
			// The clock has stopped: what the script printed last goes out now.
			if state.ended.is_some() {
				self.flush(&mut state, outlet);
			}
		}
		let seen = state.screen.seen();
		let now = Instant::now();
		state.settle.update(seen, now);
		self.push_state(&mut state, outlet, now);
		self.wake.notify_one();
		true
	}

	/// Sends the page the frame's output, or the screen when there was too much of it.
	fn flush(&self, state: &mut State, outlet: &dyn Outlet) {
		state.flush_at = None;
		let Some(window) = state.attached.clone() else { return };
		if std::mem::take(&mut state.overflow) {
			state.pending.clear();
			let snapshot = gs_base::base64::encode(state.screen.snapshot().as_bytes());
			outlet.push(To::Window(&window), "terminal-output", json!({ "id": self.id, "snapshot": snapshot }));
		} else if !state.pending.is_empty() {
			let data = gs_base::base64::encode(&std::mem::take(&mut state.pending));
			outlet.push(To::Window(&window), "terminal-output", json!({ "id": self.id, "data": data }));
		}
	}

	/// Stops everything the script started: the process group, or the job on Windows.
	fn hang_up(&self) {
		#[cfg(unix)]
		if let Some(pid) = self.state().group {
			spawn::signal_group(pid, rustix::process::Signal::HUP);
		}
		#[cfg(windows)]
		self.job.kill();
	}

	#[cfg(unix)]
	fn kill(&self) {
		if let Some(pid) = self.state().group.take() {
			spawn::signal_group(pid, rustix::process::Signal::KILL);
		}
	}

	/// Queues input for the terminal's writer, which never blocks the caller.
	fn write(&self, bytes: &[u8]) -> Result<(), String> {
		let state = self.state();
		let io = state.io.as_ref().filter(|_| !state_ended(&state)).ok_or(NOT_THERE)?;
		io.input.send(bytes.to_vec()).map_err(|_| NOT_THERE.to_owned())
	}
}

impl State {
	/// No window shows the terminal: nothing is sent until one attaches.
	fn hide(&mut self) {
		self.attached = None;
		self.pending.clear();
		self.overflow = false;
		self.flush_at = None;
	}

	/// Whether keys from `window` (the window that has the focus, if any) may go to the terminal:
	/// only the window that shows it.
	fn typed_from(&self, window: Option<&str>) -> bool {
		window.is_some() && self.attached.as_deref() == window
	}
}

/// When the clock has work next: pending output to send, or a question about to have stayed
/// on the screen long enough. None sleeps until output comes, so an idle terminal never ticks.
fn next_tick(state: &State, now: Instant) -> Option<Instant> {
	state.flush_at.into_iter().chain(state.settle.due(now)).min()
}

fn state_ended(state: &State) -> bool {
	state.ended.is_some() || state.stopping
}
