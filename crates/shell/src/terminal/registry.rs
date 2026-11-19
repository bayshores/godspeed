//! The registry of terminals: starting one, its three threads, what the page and the server may do
//! with it, and stopping it.

use std::ffi::OsString;
use std::io::Read;
use std::io::Write;
use std::path::Path;
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

use portable_pty::{Child, PtySize};
use serde_json::{Value, json};

use super::input::{clear_input, enter_on_yes, nudge_input, type_line};
use super::screen::{self, Prompt, Screen, Settle, Trust};
use super::spawn::{self, Agent, Role};
use super::{Ended, Io, NO_START, NOT_SENT, NOT_SET_UP, NOT_SHOWN, NOT_THERE, Outlet, State, Terminal, next_tick, state_ended};
use crate::lock::lock;

/// The fewest and the most columns and rows a page may size a terminal to.
const COLS_RANGE: (u16, u16) = (40, 200);
const ROWS_RANGE: (u16, u16) = (10, 100);
/// How long a stopped agent gets to close before it is killed.
const STOP_GRACE: Duration = Duration::from_secs(2);

type List = Mutex<Vec<Arc<Terminal>>>;

/// The ids of the terminals that run and were not stopped, and the teacher's among them.
fn live_ids(list: &[Arc<Terminal>]) -> (Vec<String>, Option<String>) {
	let live: Vec<&Arc<Terminal>> = list.iter().filter(|t| !state_ended(&t.state())).collect();
	let teacher = live.iter().find(|t| t.role == Role::Teacher).map(|t| t.id.clone());
	(live.into_iter().map(|t| t.id.clone()).collect(), teacher)
}

/// Tells the server the live ids. Sent under the list's lock, so two changes at once reach it
/// in the order they happened.
fn tell_live(list: &List, outlet: &dyn Outlet) {
	let list = lock(list);
	let (ids, teacher) = live_ids(&list);
	outlet.live(ids, teacher);
}

/// The terminals (managed state).
pub struct Terminals {
	pub(super) list: Arc<List>,
	outlet: Arc<dyn Outlet>,
}

impl Terminals {
	pub fn new(outlet: impl Outlet) -> Terminals {
		Terminals { list: Arc::default(), outlet: Arc::new(outlet) }
	}

	pub(super) fn find(&self, id: &str) -> Result<Arc<Terminal>, String> {
		lock(&self.list).iter().find(|t| t.id == id).cloned().ok_or_else(|| NOT_THERE.to_owned())
	}

	pub fn live(&self) -> (Vec<String>, Option<String>) {
		live_ids(&lock(&self.list))
	}

	/// Tells a server that just started which terminals are live.
	pub fn tell_live(&self) {
		tell_live(&self.list, &*self.outlet);
	}

	/// Runs the folder's start script for `role` and `agent`: the new terminal's id. `env` is the
	/// app's environment; `data` is this app's data folder.
	pub fn start(&self, role: Role, agent: Agent, folder: &str, env: Vec<(OsString, OsString)>, data: &Path, resume: Option<&str>) -> Result<String, String> {
		// Only the teacher goes back to a chat, and only to one named by a session id.
		let resume = resume.filter(|_| role == Role::Teacher).filter(|chat| gs_base::ids::is_uuid(chat));
		let mut list = lock(&self.list);
		if list.iter().any(|t| t.role == role && !state_ended(&t.state())) {
			return Err(format!("The {} is already running.", role.name()));
		}
		let os = std::env::consts::OS;
		let script = spawn::script(folder, role, agent, os).ok_or(NOT_SET_UP)?;
		let id = crate::server::random_hex::<16>();
		let shell = spawn::shell(&env, os);
		#[cfg_attr(not(windows), allow(unused_mut))]
		let mut env = spawn::environment(env, &id, data, os, resume);
		#[cfg(windows)]
		crate::win::path::refresh(&mut env);
		let spawned = spawn::spawn(spawn::argv(&script, &shell, os), env, Path::new(folder)).map_err(|err| {
			self.outlet.log(&format!("terminal could not start: {} {}: {err}", role.name(), agent.name()));
			NO_START.to_owned()
		})?;
		let (input, queued) = mpsc::channel::<Vec<u8>>();
		let mut writer = spawned.writer;
		std::thread::spawn(move || {
			for bytes in queued {
				if writer.write_all(&bytes).and_then(|()| writer.flush()).is_err() {
					return;
				}
			}
		});
		let terminal = Arc::new(Terminal {
			id: id.clone(),
			role,
			agent,
			started_at: gs_base::clock::now_ms(),
			pid: spawned.child.process_id(),
			#[cfg(windows)]
			job: spawned.job,
			state: Mutex::new(State {
				io: Some(Io { input, master: spawned.master }),
				screen: Screen::default(),
				settle: Settle::default(),
				shown: (None, false),
				attached: false,
				pending: Vec::new(),
				overflow: false,
				flush_at: None,
				stopping: false,
				broken: false,
				ended: None,
				#[cfg(unix)]
				group: spawned.child.process_id(),
			}),
			wake: Condvar::new(),
		});
		// An ended record stays until the next start for its role.
		list.retain(|t| t.role != role);
		list.push(terminal.clone());
		let (ids, teacher) = live_ids(&list);
		self.outlet.live(ids, teacher);
		drop(list);
		self.outlet.log(&format!("terminal started: {} {} pid {}", role.name(), agent.name(), terminal.pid.unwrap_or_default()));
		self.run(terminal, spawned.reader, spawned.child);
		Ok(id)
	}

	/// The terminal's other three threads: its output, its exit and its clock.
	fn run(&self, terminal: Arc<Terminal>, mut reader: Box<dyn Read + Send>, mut child: Box<dyn Child + Send + Sync>) {
		let (outlet, list, reading) = (self.outlet.clone(), self.list.clone(), terminal.clone());
		// Dropped when the output ends, so the exit waits for the last lines it reads.
		let (read_all, output_ended) = std::sync::mpsc::channel::<()>();
		std::thread::spawn(move || {
			let _read_all = read_all;
			let mut buffer = [0u8; 8192];
			while let Ok(read @ 1..) = reader.read(&mut buffer) {
				if !reading.output(&buffer[..read], &*outlet) {
					stop(reading.clone(), &*outlet, &list);
				}
			}
		});
		let (outlet, list, ticking) = (self.outlet.clone(), self.list.clone(), terminal.clone());
		std::thread::spawn(move || {
			let code = child.wait().map_or(1, |status| status.exit_code());
			// "No conversation found" is often the last line before the exit; a child the script left
			// running keeps the output open, so the wait is short.
			let _ = output_ended.recv_timeout(Duration::from_millis(500));
			ended(terminal, code, &*outlet, &list);
		});
		let outlet = self.outlet.clone();
		std::thread::spawn(move || {
			let mut state = ticking.state();
			while state.ended.is_none() {
				let now = Instant::now();
				if state.flush_at.is_some_and(|at| at <= now) {
					ticking.flush(&mut state, &*outlet);
				}
				ticking.push_state(&mut state, &*outlet, now);
				state = match next_tick(&state, now) {
					Some(at) => ticking.wake.wait_timeout(state, at - now).unwrap_or_else(PoisonError::into_inner).0,
					None => ticking.wake.wait(state).unwrap_or_else(PoisonError::into_inner),
				};
			}
		});
	}

	/// Shows a terminal: the page gets its screen as it is, then everything it prints.
	pub fn attach(&self, id: &str) -> Result<(), String> {
		let terminal = self.find(id)?;
		let mut state = terminal.state();
		state.attached = true;
		state.pending.clear();
		state.overflow = false;
		state.flush_at = None;
		let snapshot = gs_base::base64::encode(state.screen.snapshot().as_bytes());
		self.outlet.push("terminal-output", json!({ "id": id, "snapshot": snapshot }));
		Ok(())
	}

	/// Sizes a running terminal to the screen the page shows it on, so its program draws for
	/// that screen: the size now in force. An ended terminal keeps the size it ended at.
	pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(u16, u16), String> {
		let terminal = self.find(id)?;
		let mut state = terminal.state();
		let (cols, rows) = (cols.clamp(COLS_RANGE.0, COLS_RANGE.1), rows.clamp(ROWS_RANGE.0, ROWS_RANGE.1));
		let (now_rows, now_cols) = state.screen.size();
		if state_ended(&state) || (now_cols, now_rows) == (cols, rows) {
			return Ok((now_cols, now_rows));
		}
		let io = state.io.as_ref().ok_or(NOT_THERE)?;
		io.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|_| NOT_THERE.to_owned())?;
		state.screen.resize(rows, cols);
		Ok((cols, rows))
	}

	pub fn detach(&self, id: &str) -> Result<(), String> {
		let terminal = self.find(id)?;
		let mut state = terminal.state();
		state.attached = false;
		state.pending.clear();
		state.overflow = false;
		state.flush_at = None;
		Ok(())
	}

	/// Keys the learner typed in the shown terminal, only while the window has the focus. The
	/// page's terminal answering a question the shell already answered is dropped.
	pub fn write(&self, id: &str, data: &str, focused: bool) -> Result<(), String> {
		let terminal = self.find(id)?;
		if !focused || !terminal.state().attached {
			return Err(NOT_SHOWN.to_owned());
		}
		if screen::is_reply(data) {
			return Ok(());
		}
		// Only Enter on its own sends the learner's message: Alt+Enter and Shift+Enter (the screen
		// sends it as a line feed) add a line,
		// and a paste is not sent yet. With no question on the screen the server hears it, so the
		// agent's wait for work ends and it can answer the learner.
		let message = data == "\r" && terminal.state().screen.seen().prompt.is_none();
		terminal.write(data.as_bytes())?;
		if message {
			self.outlet.typed(&terminal.id);
		}
		Ok(())
	}

	/// The trust or Enter button, only while the shell itself still sees that question. Trust
	/// moves the pointer to "Yes" when it is on "No", and sends Enter once the shell sees it there.
	pub fn answer(&self, id: &str, kind: Prompt) -> Result<(), String> {
		let terminal = self.find(id)?;
		let (seen, trust) = {
			let state = terminal.state();
			(state.screen.seen().prompt, state.screen.trust())
		};
		match (kind, trust) {
			(Prompt::Trust, Some(Trust::OnYes)) => terminal.write(b"\r"),
			(Prompt::Trust, Some(Trust::OnNo)) => {
				terminal.write(b"\x1b[B")?;
				std::thread::spawn(move || enter_on_yes(&terminal));
				Ok(())
			}
			(Prompt::Enter, _) if seen == Some(Prompt::Enter) => terminal.write(b"\r"),
			_ => Err("That question isn't on the screen anymore.".to_owned()),
		}
	}

	/// The learner's line went to the page on screen, and Claude Code put it back in its input
	/// after the prompt hook blocked it: clear it there, only once the input holds exactly that
	/// line. Codex leaves its input empty.
	pub fn clear_line(&self, id: &str, line: &str) {
		let Ok(terminal) = self.find(id) else { return };
		if terminal.role == Role::Teacher && terminal.agent == Agent::Claude {
			let line = line.to_owned();
			std::thread::spawn(move || clear_input(&terminal, &line));
		}
	}

	/// The quiet teacher has work waiting: godspeed's line goes into its input and is sent.
	pub fn nudge(&self, id: &str, line: &str) {
		let Ok(terminal) = self.find(id) else { return };
		if terminal.role == Role::Teacher {
			let line = line.to_owned();
			std::thread::spawn(move || nudge_input(&terminal, &line));
		}
	}

	/// A starter key: the line typed into the teacher's input and sent as the learner's message,
	/// only once the input reads exactly that line, so it never sends what the learner had typed
	/// there. Only while the window has the focus, the screen is shown and asks nothing.
	pub fn send(&self, id: &str, line: &str, focused: bool) -> Result<(), String> {
		let terminal = self.find(id)?;
		let (attached, asked, ended) = {
			let state = terminal.state();
			(state.attached, state.screen.seen().prompt.is_some(), state_ended(&state))
		};
		if ended {
			return Err(NOT_THERE.to_owned());
		}
		if !focused || !attached {
			return Err(NOT_SHOWN.to_owned());
		}
		if terminal.role != Role::Teacher || asked || line.chars().any(char::is_control) || !type_line(&terminal, line) {
			return Err(NOT_SENT.to_owned());
		}
		self.outlet.typed(&terminal.id);
		Ok(())
	}

	/// Paste: the clipboard's text, bracketed when the program asked for that, without escape
	/// characters that could end the bracket early.
	pub fn paste(&self, id: &str, text: &str, focused: bool) -> Result<(), String> {
		let terminal = self.find(id)?;
		let (attached, bracketed) = {
			let state = terminal.state();
			(state.attached, state.screen.bracketed_paste())
		};
		if !focused || !attached {
			return Err(NOT_SHOWN.to_owned());
		}
		let text = text.replace('\x1b', "");
		let pasted = if bracketed { format!("\x1b[200~{text}\x1b[201~") } else { text };
		terminal.write(pasted.as_bytes())
	}
	pub fn stop(&self, id: &str) -> Result<(), String> {
		stop(self.find(id)?, &*self.outlet, &self.list);
		Ok(())
	}

	/// At quit: every terminal hangs up at once, one already stopping too, and after the grace
	/// every group is killed, also what a script that ended within the grace left behind: their
	/// own kill threads end with the app. A group killed before is not signalled again.
	pub fn stop_all(&self) {
		let all: Vec<Arc<Terminal>> = lock(&self.list).clone();
		for terminal in &all {
			stopping(terminal);
			terminal.hang_up();
		}
		let deadline = Instant::now() + STOP_GRACE;
		while Instant::now() < deadline && all.iter().any(|t| t.state().ended.is_none()) {
			std::thread::sleep(Duration::from_millis(50));
		}
		#[cfg(unix)]
		for terminal in &all {
			terminal.kill();
		}
	}

	/// Every terminal, for a page that reloaded.
	pub fn list(&self) -> Value {
		let list = lock(&self.list);
		Value::Array(
			list.iter()
				.map(|t| {
					let mut item = t.state_json(&t.state());
					item["role"] = t.role.name().into();
					item["agent"] = t.agent.name().into();
					item["startedAt"] = t.started_at.into();
					item
				})
				.collect(),
		)
	}
}

/// Marks a running terminal as stopping; false when it already ended or was stopped.
fn stopping(terminal: &Terminal) -> bool {
	let mut state = terminal.state();
	let was = state_ended(&state);
	state.stopping = true;
	!was
}

/// What Claude Code and Codex say when the chat to go back to is gone.
const CHAT_GONE: [&str; 2] = ["No conversation found with session ID", "No saved session found"];
/// The code the window reads as that chat being gone (the start scripts use 3 and 4).
pub(super) const EXIT_CHAT_GONE: u32 = 5;

/// The script exited: the record keeps its screen, and whatever it left running is stopped.
fn ended(terminal: Arc<Terminal>, code: u32, outlet: &dyn Outlet, list: &List) {
	let (ended, stopped) = {
		let mut state = terminal.state();
		let stopped = state.stopping;
		let gone = code != 0 && {
			let text = state.screen.text();
			CHAT_GONE.iter().any(|said| text.contains(said))
		};
		let ended = match (state.broken, stopped) {
			(true, _) => Ended::Broken,
			(false, true) => Ended::Stopped,
			(false, false) => Ended::Exited(if gone { EXIT_CHAT_GONE } else { code }),
		};
		state.ended = Some(ended);
		state.io = None;
		terminal.wake.notify_one();
		terminal.flush(&mut state, outlet);
		outlet.push("terminal-state", terminal.state_json(&state));
		(ended, stopped)
	};
	let how = match ended {
		Ended::Exited(code) => format!("code {code}"),
		Ended::Stopped => "stopped".to_owned(),
		Ended::Broken => "screen broke".to_owned(),
	};
	outlet.log(&format!("terminal ended: {} {} pid {} {how}", terminal.role.name(), terminal.agent.name(), terminal.pid.unwrap_or_default()));
	if !stopped {
		tell_live(list, outlet);
		hang_up_then_kill(terminal.clone());
	}
	// The helper stops with the teacher here, not in the page, which may be gone by then.
	if terminal.role == Role::Teacher {
		let helper = lock(list).iter().find(|t| t.role == Role::Helper).cloned();
		if let Some(helper) = helper {
			stop(helper, outlet, list);
		}
	}
}

/// Hangs up a running terminal, tells the server at once, and kills what is left after the grace.
fn stop(terminal: Arc<Terminal>, outlet: &dyn Outlet, list: &List) {
	if !stopping(&terminal) {
		return;
	}
	tell_live(list, outlet);
	hang_up_then_kill(terminal);
}

fn hang_up_then_kill(terminal: Arc<Terminal>) {
	terminal.hang_up();
	#[cfg(unix)]
	std::thread::spawn(move || {
		std::thread::sleep(STOP_GRACE);
		terminal.kill();
	});
}
