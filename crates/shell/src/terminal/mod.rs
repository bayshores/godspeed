//! The agents' terminals, in memory only: at most one live record per role (teacher, helper).
//! Each runs one start script in a pseudo-terminal (spawn.rs); the shell keeps its screen
//! (screen.rs), sends its output to the page only while the page shows it, and tells the server
//! which terminal ids are live, so an agent whose terminal ended is refused.

pub mod commands;
mod screen;
mod spawn;

use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use portable_pty::{Child, MasterPty, PtySize};
use serde_json::{Value, json};

pub use screen::Prompt;
use screen::{Screen, Settle, Trust};
pub use spawn::{Agent, Role};

/// The fewest and the most columns and rows a page may size a terminal to.
const COLS_RANGE: (u16, u16) = (40, 200);
const ROWS_RANGE: (u16, u16) = (10, 100);
/// How long a stopped agent gets to close before it is killed.
const STOP_GRACE: Duration = Duration::from_secs(2);
/// How long the trust button waits for the pointer to reach "Yes" after its Down key.
const TRUST_MOVE: Duration = Duration::from_secs(1);
/// How long a blocked line has to come back into Claude Code's input.
const LINE_BACK: Duration = Duration::from_secs(3);
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
/// The largest file Attach takes.
const ATTACH_MAX: usize = 20 * 1024 * 1024;
const ATTACH_TOO_BIG: &str = "That file is over 20 MB.";
const ATTACH_KINDS: &str = "Attach takes pictures (PNG, JPEG, GIF or WebP) and PDFs.";
const ATTACH_TEACHER: &str = "Attach is for the teacher's screen.";
const ATTACH_NOT_SAVED: &str = "godspeed couldn't save that file in its folder.";
const ATTACH_UNTYPABLE: &str = "godspeed's folder has a line break in its path, so Attach can't type it.";

/// Where a terminal's news goes: the page, the server and the log.
pub trait Outlet: Send + Sync + 'static {
	fn push(&self, channel: &str, payload: Value);
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
	attached: bool,
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
			outlet.push("terminal-state", self.state_json(state));
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
		if state.attached {
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
		if !state.attached {
			return;
		}
		if std::mem::take(&mut state.overflow) {
			state.pending.clear();
			let snapshot = gs_base::base64::encode(state.screen.snapshot().as_bytes());
			outlet.push("terminal-output", json!({ "id": self.id, "snapshot": snapshot }));
		} else if !state.pending.is_empty() {
			let data = gs_base::base64::encode(&std::mem::take(&mut state.pending));
			outlet.push("terminal-output", json!({ "id": self.id, "data": data }));
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

/// When the clock has work next: pending output to send, or a question about to have stayed
/// on the screen long enough. None sleeps until output comes, so an idle terminal never ticks.
fn next_tick(state: &State, now: Instant) -> Option<Instant> {
	state.flush_at.into_iter().chain(state.settle.due(now)).min()
}

fn state_ended(state: &State) -> bool {
	state.ended.is_some() || state.stopping
}

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
	list: Arc<List>,
	outlet: Arc<dyn Outlet>,
}

impl Terminals {
	pub fn new(outlet: impl Outlet) -> Terminals {
		Terminals { list: Arc::default(), outlet: Arc::new(outlet) }
	}

	fn find(&self, id: &str) -> Result<Arc<Terminal>, String> {
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

	/// Attach: a picture or a PDF saved in the godspeed folder, where the agent reads it without
	/// asking, and its path typed into the teacher's input like a paste (escaped as a Finder drag
	/// types it), then a space and no Enter, so the learner adds words and sends. Answers the
	/// saved path. The terminal must be shown, but the window need not have the focus: a file
	/// dropped from Finder leaves Finder in front, and what is typed is only a path the shell
	/// saved itself.
	pub fn add_file(&self, id: &str, name: &str, bytes: &[u8], folder: &Path) -> Result<String, String> {
		let terminal = self.find(id)?;
		if terminal.role != Role::Teacher {
			return Err(ATTACH_TEACHER.to_owned());
		}
		let attached = terminal.state().attached;
		// Shown, but no focus check: a Finder drop leaves Finder in front. Safe, since only a path
		// the shell saved itself is typed, never a line break.
		if !attached {
			return Err(NOT_SHOWN.to_owned());
		}
		if bytes.len() > ATTACH_MAX {
			return Err(ATTACH_TOO_BIG.to_owned());
		}
		if !attachable(bytes) {
			return Err(ATTACH_KINDS.to_owned());
		}
		let dir = folder.join(".godspeed").join("attachments");
		let file = dir.join(attachment_name(name, bytes));
		let path = file.to_string_lossy().into_owned();
		if path.chars().any(char::is_control) {
			return Err(ATTACH_UNTYPABLE.to_owned());
		}
		let existed = file.exists();
		std::fs::create_dir_all(&dir).and_then(|()| gs_base::fsx::write_atomic(&file, bytes, None)).map_err(|_| ATTACH_NOT_SAVED.to_owned())?;
		send_attachment(&terminal, &file, existed)?;
		Ok(path)
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
const EXIT_CHAT_GONE: u32 = 5;

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

/// Enter on the trust question once its pointer reached "Yes"; nothing if the screen changed.
fn enter_on_yes(terminal: &Terminal) {
	let deadline = Instant::now() + TRUST_MOVE;
	while Instant::now() < deadline {
		std::thread::sleep(Duration::from_millis(20));
		let trust = terminal.state().screen.trust();
		match trust {
			Some(Trust::OnYes) => {
				let _ = terminal.write(b"\r");
				return;
			}
			Some(Trust::OnNo) => {}
			None => return,
		}
	}
}

/// Waits for the blocked line to come back into Claude Code's input, then takes it out a row at
/// a time: Ctrl+U clears the row, Backspace joins the row above. Each key only while what is
/// left is still the start of that line, so nothing the learner typed since is touched.
fn clear_input(terminal: &Terminal, line: &str) {
	let squash = |text: &str| text.split_whitespace().collect::<String>();
	let line = squash(line);
	let deadline = Instant::now() + LINE_BACK;
	let mut cleared = false;
	while Instant::now() < deadline {
		std::thread::sleep(Duration::from_millis(30));
		let Some(input) = terminal.state().screen.input().map(|input| squash(&input)) else { continue };
		if !cleared {
			if input == line {
				let _ = terminal.write(b"\x15");
				cleared = true;
			}
			continue;
		}
		if input.is_empty() || !line.starts_with(&input) {
			return;
		}
		let _ = terminal.write(b"\x7f\x15");
	}
}

/// How long a nudge keeps trying while a question shows or the learner's text stays in the box.
const NUDGE_TRIES: Duration = Duration::from_secs(60);

/// The agent's input box, as its own screen shows it.
fn input_of(terminal: &Terminal) -> Option<String> {
	let state = terminal.state();
	match terminal.agent {
		Agent::Claude => state.screen.input(),
		Agent::Codex => state.screen.codex_input(),
	}
}

/// Types the line and sends it only once the box reads exactly that line, so it never sends what
/// the learner had typed there: otherwise the line is taken out again. True when it was sent.
fn type_line(terminal: &Terminal, line: &str) -> bool {
	let squash = |text: &str| text.split_whitespace().collect::<String>();
	if terminal.write(line.as_bytes()).is_err() {
		return false;
	}
	std::thread::sleep(Duration::from_millis(300));
	if input_of(terminal).is_some_and(|text| squash(&text) == squash(line)) {
		return terminal.write(b"\r").is_ok();
	}
	let _ = terminal.write("\x7f".repeat(line.chars().count()).as_bytes());
	false
}

/// Types the nudge (type_line), trying once a second until it is sent. Never while the screen
/// asks the learner something.
fn nudge_input(terminal: &Terminal, line: &str) {
	let deadline = Instant::now() + NUDGE_TRIES;
	while Instant::now() < deadline {
		std::thread::sleep(Duration::from_secs(1));
		{
			let state = terminal.state();
			if state_ended(&state) {
				return;
			}
			if state.screen.seen().prompt.is_some() {
				continue;
			}
		}
		if type_line(terminal, line) {
			return;
		}
	}
}

fn hang_up_then_kill(terminal: Arc<Terminal>) {
	terminal.hang_up();
	#[cfg(unix)]
	std::thread::spawn(move || {
		std::thread::sleep(STOP_GRACE);
		terminal.kill();
	});
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
	mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// An attached file's bytes from the page's base64 text. The text's length bounds the bytes, so
/// a file over the limit is refused before it is decoded.
pub fn attachment_bytes(data: &str) -> Result<Vec<u8>, String> {
	if data.len() / 4 * 3 > ATTACH_MAX + 2 {
		return Err(ATTACH_TOO_BIG.to_owned());
	}
	Ok(gs_base::base64::decode(data))
}

/// Types a saved attachment's path, if the terminal is still shown and running: the save took a
/// while, off the main thread. When it is not, a copy this attach made goes again.
fn send_attachment(terminal: &Terminal, file: &Path, existed: bool) -> Result<(), String> {
	let typed = typed_path(&file.to_string_lossy());
	let sent = {
		let state = terminal.state();
		let typed = if state.screen.bracketed_paste() { format!("\x1b[200~{typed}\x1b[201~ ") } else { format!("{typed} ") };
		if state.attached { state.io.as_ref().filter(|_| !state_ended(&state)).ok_or(NOT_THERE).and_then(|io| io.input.send(typed.into_bytes()).map_err(|_| NOT_THERE)) } else { Err(NOT_SHOWN) }
	};
	if sent.is_err() && !existed {
		let _ = std::fs::remove_file(file);
	}
	sent.map_err(str::to_owned)
}

/// A path as a drag from the file manager types it into a terminal: on Windows in quotes when it
/// has a space, elsewhere with a backslash before each space and character a shell reads.
fn typed_path(path: &str) -> String {
	if cfg!(windows) {
		return if path.contains(' ') { format!("\"{path}\"") } else { path.to_owned() };
	}
	let mut typed = String::with_capacity(path.len());
	for c in path.chars() {
		if c.is_whitespace() || "\\!\"#$&'()*;<>?[]^`{|}~".contains(c) {
			typed.push('\\');
		}
		typed.push(c);
	}
	typed
}

/// A picture (PNG, JPEG, GIF, WebP) or a PDF, by its first bytes.
fn attachable(bytes: &[u8]) -> bool {
	let webp = bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP".as_slice());
	webp || [b"\x89PNG\r\n\x1a\n".as_slice(), b"\xff\xd8\xff", b"GIF8", b"%PDF-"].iter().any(|magic| bytes.starts_with(magic))
}

/// `<sha12>-<name>`: the name's last part, every character but letters, digits, `.`, `-` and `_`
/// as `_`, so the typed path needs no quotes in any agent or shell. The same file keeps its name.
fn attachment_name(name: &str, bytes: &[u8]) -> String {
	let last = name.rsplit(['/', '\\']).next().unwrap_or_default();
	let clean: String = last.chars().map(|c| if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' }).collect();
	let clean = clean.trim_start_matches('.');
	let hash = gs_base::hash::sha256_hex(bytes);
	format!("{}-{}", &hash[..12], if clean.is_empty() { "file" } else { clean })
}

#[cfg(test)]
mod tests {
	use std::path::PathBuf;
	use std::sync::atomic::{AtomicBool, Ordering};

	use super::*;

	/// What a terminal sent to the page, the server and the log.
	#[derive(Default)]
	struct Heard {
		pushes: Mutex<Vec<(String, Value)>>,
		live: Mutex<Vec<Vec<String>>>,
		/// The teacher's id in the last live message.
		teacher: Mutex<Option<String>>,
		typed: Mutex<Vec<String>>,
		log: Mutex<Vec<String>>,
		/// The next live message takes a while to send, and `sending` says when it began.
		slow: AtomicBool,
		sending: AtomicBool,
	}

	impl Outlet for Arc<Heard> {
		fn push(&self, channel: &str, payload: Value) {
			lock(&self.pushes).push((channel.to_owned(), payload));
		}

		fn live(&self, ids: Vec<String>, teacher: Option<String>) {
			if self.slow.swap(false, Ordering::SeqCst) {
				self.sending.store(true, Ordering::SeqCst);
				std::thread::sleep(Duration::from_millis(300));
			}
			lock(&self.live).push(ids);
			*lock(&self.teacher) = teacher;
		}

		fn typed(&self, id: &str) {
			lock(&self.typed).push(id.to_owned());
		}

		fn log(&self, line: &str) {
			lock(&self.log).push(line.to_owned());
		}
	}

	const SECRET: &str = "s3cret-word";

	/// A godspeed folder whose teacher start script for Claude is `script`, a shell (or cmd) script.
	fn folder(name: &str, script: &str) -> PathBuf {
		let dir = std::env::temp_dir().join(format!("gs-shell-terminal-{name}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(dir.join(".godspeed")).unwrap();
		write_script(&dir, Role::Teacher, script);
		dir
	}

	fn write_script(dir: &Path, role: Role, script: &str) {
		let helper = if role == Role::Helper { "-helper" } else { "" };
		let extension = match std::env::consts::OS {
			"macos" => "command",
			"windows" => "cmd",
			_ => "sh",
		};
		let file = dir.join(".godspeed").join(format!("start-claude{helper}.{extension}"));
		gs_base::fsx::write_text_atomic(&file, script).unwrap();
		#[cfg(unix)]
		{
			use std::os::unix::fs::PermissionsExt;
			std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
		}
	}

	/// A plain environment: the learner's dotfiles stay out of the test.
	fn env(home: &Path) -> Vec<(OsString, OsString)> {
		let mut env: Vec<(OsString, OsString)> = vec![("HOME".into(), home.into()), ("SHELL".into(), "/bin/sh".into()), ("SECRET_TOKEN".into(), SECRET.into())];
		for key in ["PATH", "SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP", "USERPROFILE"] {
			if let Some(value) = std::env::var_os(key) {
				env.push((key.into(), value));
			}
		}
		env
	}

	fn start(terminals: &Terminals, dir: &Path) -> String {
		terminals.start(Role::Teacher, Agent::Claude, dir.to_str().unwrap(), env(dir), Path::new("/data"), None).unwrap()
	}

	fn text(terminals: &Terminals, id: &str) -> String {
		terminals.find(id).unwrap().state().screen.text()
	}

	/// Waits up to 10 s for `done`.
	fn until(what: &str, done: impl Fn() -> bool) {
		let deadline = Instant::now() + Duration::from_secs(10);
		while !done() {
			assert!(Instant::now() < deadline, "timed out waiting for {what}");
			std::thread::sleep(Duration::from_millis(20));
		}
	}

	fn ended_of(terminals: &Terminals, id: &str) -> Option<Ended> {
		terminals.find(id).unwrap().state().ended
	}

	#[cfg(unix)]
	const ECHO: &str = "#!/bin/sh\nprintf 'ready %s\\n' \"$GODSPEED_TERMINAL\"\nread line\nprintf 'got %s\\n' \"$line\"\nsleep 1\n";
	#[cfg(windows)]
	const ECHO: &str = "@echo off\r\necho ready %GODSPEED_TERMINAL%\r\nset /p line=\r\necho got %line%\r\nping -n 2 127.0.0.1 >nul\r\n";

	#[cfg(unix)]
	#[test]
	fn an_agent_that_says_the_chat_is_gone_ends_with_its_own_code() {
		let dir = folder("gone", "#!/bin/sh\nprintf 'resume %s\\n' \"$GODSPEED_RESUME\"\necho 'No conversation found with session ID: x'\nexit 1\n");
		let terminals = Terminals::new(Arc::new(Heard::default()));
		let chat = "0f8fad5b-d9cb-469f-a165-70867728950e";
		let id = terminals.start(Role::Teacher, Agent::Claude, dir.to_str().unwrap(), env(&dir), Path::new("/data"), Some(chat)).unwrap();
		until("the end", || ended_of(&terminals, &id).is_some());
		assert_eq!(ended_of(&terminals, &id), Some(Ended::Exited(EXIT_CHAT_GONE)));
		assert!(text(&terminals, &id).contains(&format!("resume {chat}")), "the script was told the chat");
	}

	/// A godspeed folder whose Codex teacher shows Codex's input mark, reads one line and echoes it.
	#[cfg(unix)]
	fn codex_folder(name: &str) -> PathBuf {
		let dir = std::env::temp_dir().join(format!("gs-shell-terminal-{name}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(dir.join(".godspeed")).unwrap();
		let extension = if std::env::consts::OS == "macos" { "command" } else { "sh" };
		let script = dir.join(".godspeed").join(format!("start-codex.{extension}"));
		gs_base::fsx::write_text_atomic(&script, "#!/bin/sh\nprintf '› '\nread line\nprintf 'got %s\\n' \"$line\"\nsleep 1\n").unwrap();
		std::fs::set_permissions(&script, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
		dir
	}

	#[cfg(unix)]
	#[test]
	fn a_nudge_is_typed_then_sent_once_the_box_holds_it() {
		let dir = codex_folder("nudge");
		let heard = Arc::new(Heard::default());
		let terminals = Terminals::new(heard.clone());
		let id = terminals.start(Role::Teacher, Agent::Codex, dir.to_str().unwrap(), env(&dir), Path::new("/data"), None).unwrap();
		terminals.nudge(&id, "Your lesson is waiting.");
		until("the sent nudge", || text(&terminals, &id).contains("got Your lesson is waiting."));
		assert!(lock(&heard.typed).is_empty(), "godspeed's own line is not the learner's message");
	}

	#[cfg(unix)]
	#[test]
	fn a_starter_is_typed_sent_and_heard_as_the_learners_line() {
		let dir = codex_folder("starter");
		let heard = Arc::new(Heard::default());
		let terminals = Terminals::new(heard.clone());
		let id = terminals.start(Role::Teacher, Agent::Codex, dir.to_str().unwrap(), env(&dir), Path::new("/data"), None).unwrap();
		until("the input", || text(&terminals, &id).contains('›'));
		assert_eq!(terminals.send(&id, "What's due?", true), Err(NOT_SHOWN.to_owned()), "not shown yet");
		terminals.attach(&id).unwrap();
		assert_eq!(terminals.send(&id, "What's due?", false), Err(NOT_SHOWN.to_owned()), "the window is not focused");
		assert_eq!(terminals.send(&id, "What's due?\nrm -rf ~", true), Err(NOT_SENT.to_owned()), "a line break is never typed");
		terminals.write(&id, "half", true).unwrap();
		assert_eq!(terminals.send(&id, "What's due?", true), Err(NOT_SENT.to_owned()), "the learner's own text is in the box");
		until("the starter taken out again", || terminals.find(&id).unwrap().state().screen.codex_input().as_deref() == Some("half"));
		assert!(lock(&heard.typed).is_empty());
		terminals.write(&id, "\x15", true).unwrap();
		terminals.send(&id, "What's due?", true).unwrap();
		assert_eq!(*lock(&heard.typed), vec![id.clone()], "the learner's message");
		until("the sent line", || text(&terminals, &id).contains("got What's due?"));
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn a_starter_is_only_for_the_teachers_running_terminal() {
		let dir = folder("starter-helper", ECHO);
		write_script(&dir, Role::Helper, WAITS);
		let terminals = Terminals::new(Arc::new(Heard::default()));
		let teacher = start(&terminals, &dir);
		let helper = terminals.start(Role::Helper, Agent::Claude, dir.to_str().unwrap(), env(&dir), Path::new("/data"), None).unwrap();
		until("ready", || text(&terminals, &helper).contains("ready"));
		terminals.attach(&helper).unwrap();
		assert_eq!(terminals.send(&helper, "What's due?", true), Err(NOT_SENT.to_owned()), "background work's terminal");
		terminals.stop(&teacher).unwrap();
		until("the end", || ended_of(&terminals, &teacher).is_some());
		terminals.attach(&teacher).unwrap();
		assert_eq!(terminals.send(&teacher, "What's due?", true), Err(NOT_THERE.to_owned()), "it ended");
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn a_start_script_draws_and_echoes_through_the_terminal() {
		let dir = folder("echo", ECHO);
		let heard = Arc::new(Heard::default());
		let terminals = Terminals::new(heard.clone());
		let id = start(&terminals, &dir);
		assert_eq!(id.len(), 32);
		assert!(id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
		assert_eq!(*lock(&heard.live), vec![vec![id.clone()]]);
		until("ready", || text(&terminals, &id).contains(&format!("ready {id}")));

		assert_eq!(terminals.write(&id, SECRET, true), Err(NOT_SHOWN.to_owned()), "not shown yet");
		terminals.attach(&id).unwrap();
		assert_eq!(terminals.write(&id, SECRET, false), Err(NOT_SHOWN.to_owned()), "the window is not focused");
		terminals.write(&id, "a", true).unwrap();
		terminals.write(&id, SECRET, true).unwrap();
		assert!(lock(&heard.typed).is_empty(), "keys without Enter send nothing yet");
		terminals.write(&id, "\r", true).unwrap();
		assert_eq!(*lock(&heard.typed), vec![id.clone()], "Enter with no question on the screen is a message to the agent");
		until("the echo", || text(&terminals, &id).contains(&format!("got a{SECRET}")));
		until("the end", || ended_of(&terminals, &id) == Some(Ended::Exited(0)));

		let pushes = lock(&heard.pushes);
		let (channel, snapshot) = pushes.iter().find(|(channel, _)| channel == "terminal-output").unwrap();
		assert_eq!((channel.as_str(), snapshot["id"].as_str()), ("terminal-output", Some(id.as_str())));
		let drawn = String::from_utf8(gs_base::base64::decode(snapshot["snapshot"].as_str().unwrap())).unwrap();
		assert!(drawn.contains("ready"), "the snapshot redraws the screen");
		let output: Vec<u8> = pushes.iter().filter_map(|(_, p)| p["data"].as_str()).flat_map(gs_base::base64::decode).collect();
		assert!(String::from_utf8_lossy(&output).contains(&format!("got a{SECRET}")), "output after the attach");
		let last = &pushes.iter().rfind(|(channel, _)| channel == "terminal-state").unwrap().1;
		assert_eq!(last["ended"], json!({ "stopped": false, "code": 0 }));
		assert_eq!(lock(&heard.live).last(), Some(&Vec::new()), "the server hears it ended");
		assert_eq!(terminals.write(&id, "x", true), Err(NOT_THERE.to_owned()));
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[cfg(unix)]
	#[test]
	fn a_running_terminal_takes_the_size_of_its_screen_and_an_ended_one_keeps_its_own() {
		let dir = folder("size", "#!/bin/sh\nprintf 'ready\\n'\nread line\nstty size\nsleep 1\n");
		let heard = Arc::new(Heard::default());
		let terminals = Terminals::new(heard.clone());
		let id = start(&terminals, &dir);
		until("ready", || text(&terminals, &id).contains("ready"));
		assert_eq!(terminals.resize(&id, 5, 500), Ok((40, 100)), "kept inside the range");
		assert_eq!(terminals.resize(&id, 50, 34), Ok((50, 34)));
		terminals.attach(&id).unwrap();
		terminals.write(&id, "\r", true).unwrap();
		until("the program's own size", || text(&terminals, &id).contains("34 50"));
		until("the end", || ended_of(&terminals, &id).is_some());
		assert_eq!(terminals.resize(&id, 80, 30), Ok((50, 34)), "an ended screen keeps its size");
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn attach_saves_a_picture_in_the_folder_and_types_its_path_without_enter() {
		let dir = folder("attach", ECHO);
		let terminals = Terminals::new(Arc::new(Heard::default()));
		let id = start(&terminals, &dir);
		until("ready", || text(&terminals, &id).contains("ready"));
		let png = b"\x89PNG\r\n\x1a\nmade-up picture";
		assert_eq!(terminals.add_file(&id, "week 3.png", png, &dir), Err(NOT_SHOWN.to_owned()), "not shown yet");
		terminals.attach(&id).unwrap();
		assert_eq!(terminals.add_file(&id, "notes.txt", b"plain words", &dir), Err(ATTACH_KINDS.to_owned()));
		assert_eq!(terminals.add_file(&id, "big.pdf", &[b"%PDF-".as_slice(), &vec![0; ATTACH_MAX]].concat(), &dir), Err(ATTACH_TOO_BIG.to_owned()));

		let odd = dir.join("line\nbreak");
		assert_eq!(terminals.add_file(&id, "a.png", png, &odd), Err(ATTACH_UNTYPABLE.to_owned()), "a path with a line break is never typed");
		assert!(!odd.exists(), "nor saved");
		let spaced = dir.join("Lab folder");
		let path = terminals.add_file(&id, "../week 3.png", png, &spaced).unwrap();
		let saved = spaced.join(".godspeed").join("attachments").join(format!("{}-week_3.png", &gs_base::hash::sha256_hex(png)[..12]));
		assert_eq!(Path::new(&path), saved, "inside the folder, the name's last part, spaces as _");
		assert_eq!(std::fs::read(&saved).unwrap(), png);
		std::thread::sleep(Duration::from_millis(300));
		assert!(!text(&terminals, &id).contains("got "), "no Enter: the line is still being typed");
		terminals.write(&id, "\r", true).unwrap();
		until("the echo", || text(&terminals, &id).contains("-week_3.png"));
		let spaced_typed = if cfg!(windows) { "Lab folder" } else { "Lab\\ folder" };
		// Windows' terminal may break the long line anywhere.
		assert!(text(&terminals, &id).replace('\n', "").contains(spaced_typed), "the folder's space typed as a drag types it");
		until("the end", || ended_of(&terminals, &id).is_some());
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn an_attachment_saved_after_its_screen_was_hidden_or_ended_is_not_typed_and_goes() {
		let dir = folder("attach-late", ECHO);
		let terminals = Terminals::new(Arc::new(Heard::default()));
		let id = start(&terminals, &dir);
		until("ready", || text(&terminals, &id).contains("ready"));
		let terminal = terminals.find(&id).unwrap();
		let saved = dir.join("late.png");
		gs_base::fsx::write_atomic(&saved, b"made-up", None).unwrap();
		assert_eq!(send_attachment(&terminal, &saved, true), Err(NOT_SHOWN.to_owned()));
		assert!(saved.exists(), "a copy an earlier attach made stays");
		assert_eq!(send_attachment(&terminal, &saved, false), Err(NOT_SHOWN.to_owned()), "hidden while it was saved");
		assert!(!saved.exists(), "this attach's copy goes");
		terminals.attach(&id).unwrap();
		terminals.stop(&id).unwrap();
		gs_base::fsx::write_atomic(&saved, b"made-up", None).unwrap();
		assert_eq!(send_attachment(&terminal, &saved, false), Err(NOT_THERE.to_owned()), "stopped while it was saved");
		assert!(!saved.exists());
		until("the end", || ended_of(&terminals, &id).is_some());
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn attach_knows_pictures_and_pdfs_by_their_first_bytes() {
		for file in [b"\x89PNG\r\n\x1a\n".as_slice(), b"\xff\xd8\xff\xe0", b"GIF89a", b"RIFF\0\0\0\0WEBPVP8 ", b"%PDF-1.7"] {
			assert!(attachable(file), "{file:?}");
		}
		for file in [b"".as_slice(), b"RIFF\0\0\0\0WAVE", b"<svg>", b"PK\x03\x04"] {
			assert!(!attachable(file), "{file:?}");
		}
		assert_eq!(&attachment_name("C:\\Users\\ada\\Lab $1 (final).pdf", b"x")[12..], "-Lab__1__final_.pdf");
		assert_eq!(&attachment_name("..", b"x")[12..], "-file");
		assert_eq!(&attachment_name("notes\r\nrm -rf ~.png", b"x")[12..], "-notes__rm_-rf__.png", "no line break reaches the input");
		assert_eq!(attachment_name("a.png", b"x"), attachment_name("a.png", b"x"), "the same file keeps its name");
	}

	#[test]
	fn an_attached_path_is_typed_as_a_drag_types_it() {
		let path = "/Users/ada/God Speed/.godspeed/attachments/0123456789ab-a.png";
		if cfg!(windows) {
			assert_eq!(typed_path(path), format!("\"{path}\""));
		} else {
			assert_eq!(typed_path(path), "/Users/ada/God\\ Speed/.godspeed/attachments/0123456789ab-a.png");
			assert_eq!(typed_path("/a/$x (1)'s;b"), "/a/\\$x\\ \\(1\\)\\'s\\;b");
		}
	}

	#[test]
	fn an_attachment_over_the_limit_is_refused_before_it_is_decoded() {
		assert_eq!(attachment_bytes(&"A".repeat(ATTACH_MAX / 3 * 4 + 8)), Err(ATTACH_TOO_BIG.to_owned()));
		assert_eq!(attachment_bytes(&gs_base::base64::encode(b"%PDF-")), Ok(b"%PDF-".to_vec()));
	}

	#[test]
	fn nothing_from_the_screen_or_the_environment_is_logged() {
		let dir = folder("log", ECHO);
		let heard = Arc::new(Heard::default());
		let terminals = Terminals::new(heard.clone());
		let id = start(&terminals, &dir);
		terminals.attach(&id).unwrap();
		until("ready", || text(&terminals, &id).contains("ready"));
		terminals.paste(&id, &format!("{SECRET}\r"), true).unwrap();
		assert!(lock(&heard.typed).is_empty(), "a paste is not a message yet, even with a line break");
		until("the end", || ended_of(&terminals, &id).is_some());
		let log = lock(&heard.log).join("\n");
		assert!(log.contains("terminal started: teacher claude pid ") && log.contains(" code 0"), "{log}");
		for kept_out in [SECRET, "ready", id.as_str(), dir.to_str().unwrap()] {
			assert!(!log.contains(kept_out), "{kept_out} in {log}");
		}
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn a_second_live_terminal_for_a_role_is_refused() {
		let dir = folder("second", ECHO);
		let terminals = Terminals::new(Arc::new(Heard::default()));
		let id = start(&terminals, &dir);
		assert_eq!(terminals.start(Role::Teacher, Agent::Codex, dir.to_str().unwrap(), env(&dir), Path::new("/data"), None), Err("The teacher is already running.".to_owned()));
		assert_eq!(terminals.start(Role::Helper, Agent::Claude, dir.to_str().unwrap(), env(&dir), Path::new("/data"), None), Err(NOT_SET_UP.to_owned()), "the helper has no script here");
		terminals.stop(&id).unwrap();
		until("the stop", || ended_of(&terminals, &id) == Some(Ended::Stopped));
		let again = start(&terminals, &dir);
		assert_eq!(lock(&terminals.list).len(), 1, "the ended record made way");
		terminals.stop(&again).unwrap();
		until("the stop", || ended_of(&terminals, &again).is_some());
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[cfg(unix)]
	const WAITS: &str = "#!/bin/sh\nprintf 'ready\\n'\nsleep 300\n";
	#[cfg(windows)]
	const WAITS: &str = "@echo off\r\necho ready\r\nping -n 300 127.0.0.1 >nul\r\n";

	#[test]
	fn the_helper_stops_when_the_teacher_ends_or_is_stopped() {
		let dir = folder("helper", ECHO);
		write_script(&dir, Role::Helper, WAITS);
		let heard = Arc::new(Heard::default());
		let terminals = Terminals::new(heard.clone());
		let start_helper = || terminals.start(Role::Helper, Agent::Claude, dir.to_str().unwrap(), env(&dir), Path::new("/data"), None).unwrap();

		let teacher = start(&terminals, &dir);
		let helper = start_helper();
		assert_eq!(*lock(&heard.teacher), Some(teacher.clone()), "the server hears which one is the teacher's");
		until("ready", || text(&terminals, &teacher).contains("ready") && text(&terminals, &helper).contains("ready"));
		terminals.attach(&teacher).unwrap();
		terminals.write(&teacher, "bye\r", true).unwrap();
		until("the teacher's own end", || ended_of(&terminals, &teacher) == Some(Ended::Exited(0)));
		until("the helper's stop", || ended_of(&terminals, &helper) == Some(Ended::Stopped));
		assert_eq!(lock(&heard.live).last(), Some(&Vec::new()), "the server hears both ended");
		assert_eq!(*lock(&heard.teacher), None);

		let teacher = start(&terminals, &dir);
		let helper = start_helper();
		until("ready", || text(&terminals, &helper).contains("ready"));
		terminals.stop(&teacher).unwrap();
		until("the helper's stop", || ended_of(&terminals, &helper) == Some(Ended::Stopped));
		assert_eq!(lock(&heard.live).last(), Some(&Vec::new()));
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn only_enter_on_its_own_is_a_message_to_the_agent() {
		let dir = folder("enter", WAITS);
		let heard = Arc::new(Heard::default());
		let terminals = Terminals::new(heard.clone());
		let id = start(&terminals, &dir);
		terminals.attach(&id).unwrap();
		until("ready", || text(&terminals, &id).contains("ready"));
		terminals.write(&id, "\x1b\r", true).unwrap();
		assert!(lock(&heard.typed).is_empty(), "Alt or Shift with Enter adds a line");
		terminals.write(&id, "\x1b[200~two\rlines\x1b[201~", true).unwrap();
		assert!(lock(&heard.typed).is_empty(), "a bracketed paste the page typed");
		terminals.paste(&id, "two\rlines", true).unwrap();
		assert!(lock(&heard.typed).is_empty(), "a paste");
		terminals.write(&id, "\r", true).unwrap();
		assert_eq!(*lock(&heard.typed), vec![id.clone()]);
		terminals.stop(&id).unwrap();
		// Windows keeps the folder in use until the stopped script is gone.
		until("the end", || ended_of(&terminals, &id).is_some());
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn the_server_hears_the_live_terminals_in_the_order_they_changed() {
		let dir = folder("order", WAITS);
		write_script(&dir, Role::Helper, WAITS);
		let heard = Arc::new(Heard::default());
		let terminals = Arc::new(Terminals::new(heard.clone()));
		let helper = terminals.start(Role::Helper, Agent::Claude, dir.to_str().unwrap(), env(&dir), Path::new("/data"), None).unwrap();
		heard.slow.store(true, Ordering::SeqCst);
		let stopping = std::thread::spawn({
			let (terminals, helper) = (terminals.clone(), helper.clone());
			move || terminals.stop(&helper).unwrap()
		});
		until("the slow send", || heard.sending.load(Ordering::SeqCst));
		let teacher = start(&terminals, &dir);
		stopping.join().unwrap();
		assert_eq!(lock(&heard.live).last(), Some(&vec![teacher.clone()]), "the stop's message came first");
		terminals.stop(&teacher).unwrap();
		until("the stops", || ended_of(&terminals, &teacher).is_some() && ended_of(&terminals, &helper).is_some());
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[cfg(unix)]
	const FLOOD: &str = "#!/bin/sh\nprintf 'ready\\n'\nread line\ni=0\nwhile [ $i -lt 4000 ]; do printf '%0100d\\n' $i; i=$((i+1)); done\nprintf 'done\\n'\nread line\n";
	#[cfg(windows)]
	const FLOOD: &str = "@echo off\r\necho ready\r\nset /p line=\r\nfor /l %%i in (1,1,4000) do echo 000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000%%i\r\necho done\r\nset /p line=\r\n";

	#[test]
	fn a_flood_of_output_reaches_the_page_in_a_few_pushes() {
		let dir = folder("flood", FLOOD);
		let heard = Arc::new(Heard::default());
		let terminals = Terminals::new(heard.clone());
		let id = start(&terminals, &dir);
		until("ready", || text(&terminals, &id).contains("ready"));
		terminals.attach(&id).unwrap();
		let began = Instant::now();
		terminals.write(&id, "go\r", true).unwrap();
		until("the end of the flood", || text(&terminals, &id).contains("done"));
		std::thread::sleep(FRAME * 4);
		let frames = began.elapsed().as_millis() / FRAME.as_millis() + 2;
		let pushes = lock(&heard.pushes);
		let output: Vec<&Value> = pushes.iter().filter(|(channel, _)| channel == "terminal-output").map(|(_, p)| p).collect();
		assert!(output.len() as u128 <= frames, "{} pushes in {frames} frames", output.len());
		assert!(output.iter().all(|p| p["data"].as_str().is_none_or(|data| data.len() <= FRAME_BYTES.div_ceil(3) * 4)), "no push holds more than a frame");
		let mut page = Screen::default();
		for push in &output {
			if let Some(snapshot) = push["snapshot"].as_str() {
				page = Screen::default();
				page.process(&gs_base::base64::decode(snapshot));
			} else {
				page.process(&gs_base::base64::decode(push["data"].as_str().unwrap()));
			}
		}
		assert_eq!(page.text(), text(&terminals, &id), "the page ends up with the shell's screen");
		drop(pushes);
		terminals.stop(&id).unwrap();
		until("the stop", || ended_of(&terminals, &id).is_some());
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[cfg(unix)]
	const BREAKS_THE_SCREEN: &str = "#!/bin/sh\nprintf 'ready\\n'\nread line\nprintf 'gs-test-breaks-the-screen\\n'\nwhile :; do printf 'more\\n'; sleep 0.05; done\n";
	#[cfg(windows)]
	const BREAKS_THE_SCREEN: &str = "@echo off\r\necho ready\r\nset /p line=\r\necho gs-test-breaks-the-screen\r\n:more\r\necho more\r\nping -n 1 127.0.0.1 >nul\r\ngoto more\r\n";

	#[test]
	fn a_screen_that_breaks_stops_its_terminal_and_says_so() {
		let dir = folder("broken", BREAKS_THE_SCREEN);
		let heard = Arc::new(Heard::default());
		let terminals = Terminals::new(heard.clone());
		let id = start(&terminals, &dir);
		until("ready", || text(&terminals, &id).contains("ready"));
		terminals.attach(&id).unwrap();
		terminals.write(&id, "go\r", true).unwrap();
		until("the end", || ended_of(&terminals, &id) == Some(Ended::Broken));
		assert!(text(&terminals, &id).contains(BROKEN));
		assert_eq!(terminals.list()[0]["ended"], json!({ "stopped": false, "code": null }));
		assert_eq!(lock(&heard.live).last(), Some(&Vec::new()), "the server hears it ended");
		let pushes = lock(&heard.pushes);
		let snapshot = pushes.iter().rev().find_map(|(_, p)| p["snapshot"].as_str()).unwrap();
		assert!(String::from_utf8(gs_base::base64::decode(snapshot)).unwrap().contains("couldn't read"));
		drop(pushes);
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[cfg(unix)]
	fn running(pid: &str) -> bool {
		// Where nothing reaps orphans (a container with no init), a killed one stays a zombie that still takes a signal.
		#[cfg(target_os = "linux")]
		if std::fs::read_to_string(format!("/proc/{pid}/stat")).is_ok_and(|stat| stat.rsplit(')').next().is_some_and(|rest| rest.trim_start().starts_with('Z'))) {
			return false;
		}
		std::process::Command::new("/bin/kill").args(["-0", pid]).stderr(std::process::Stdio::null()).status().is_ok_and(|status| status.success())
	}

	#[cfg(unix)]
	#[test]
	fn stop_ends_the_script_and_everything_it_started() {
		let dir = folder("stop", "#!/bin/sh\nsleep 300 &\necho $! > \"$0.pid\"\nprintf 'ready\\n'\nwait\n");
		let heard = Arc::new(Heard::default());
		let terminals = Terminals::new(heard.clone());
		let id = start(&terminals, &dir);
		until("ready", || text(&terminals, &id).contains("ready"));
		let pid_file = dir.join(".godspeed/start-claude").with_extension(if cfg!(target_os = "macos") { "command.pid" } else { "sh.pid" });
		let child = std::fs::read_to_string(pid_file).unwrap().trim().to_owned();
		assert!(running(&child));
		terminals.stop(&id).unwrap();
		assert_eq!(lock(&heard.live).last(), Some(&Vec::new()), "the server hears it at once");
		until("the stop", || ended_of(&terminals, &id) == Some(Ended::Stopped));
		until("the child's end", || !running(&child));
		assert_eq!(terminals.list()[0]["ended"], json!({ "stopped": true, "code": null }));
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[cfg(unix)]
	#[test]
	fn what_an_ended_script_left_running_is_killed_after_the_grace_and_then_never_signalled() {
		// The child ignores the hang-up, as an agent may. The script ends only once the child ignores it, or the hang-up can beat the trap.
		let dir = folder("leftover", "#!/bin/sh\n(trap '' HUP; touch \"$0.trapped\"; exec sleep 300) &\necho $! > \"$0.pid\"\nuntil [ -e \"$0.trapped\" ]; do sleep 0.05; done\nprintf 'ready\\n'\n");
		let terminals = Terminals::new(Arc::new(Heard::default()));
		let id = start(&terminals, &dir);
		until("the end", || ended_of(&terminals, &id) == Some(Ended::Exited(0)));
		let pid_file = dir.join(".godspeed/start-claude").with_extension(if cfg!(target_os = "macos") { "command.pid" } else { "sh.pid" });
		let child = std::fs::read_to_string(pid_file).unwrap().trim().to_owned();
		// The hang-up came as the script ended; a slow machine may already be near the kill, so no wait here.
		assert!(running(&child), "the hang-up alone left it");
		assert!(terminals.find(&id).unwrap().state().group.is_some(), "quit still signals it within the grace");
		until("the kill", || !running(&child));
		assert_eq!(terminals.find(&id).unwrap().state().group, None, "its pid may be reused, so quit signals it no more");
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[cfg(unix)]
	#[test]
	fn an_idle_terminal_schedules_nothing() {
		let dir = folder("idle", "#!/bin/sh\nprintf ' > 1. Yes\\n   2. No\\n'\nread line\n");
		let terminals = Terminals::new(Arc::new(Heard::default()));
		let id = start(&terminals, &dir);
		terminals.attach(&id).unwrap();
		until("the menu", || text(&terminals, &id).contains("2. No"));
		let terminal = terminals.find(&id).unwrap();
		assert!(next_tick(&terminal.state(), Instant::now()).is_some(), "the question has yet to stay");
		until("the question shows", || terminals.list()[0]["prompt"] == "menu");
		assert_eq!(next_tick(&terminal.state(), Instant::now()), None, "nothing to send and nothing to wait for");
		terminals.stop(&id).unwrap();
		until("the stop", || ended_of(&terminals, &id).is_some());
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[cfg(unix)]
	#[test]
	fn quit_kills_a_terminal_that_was_already_stopping() {
		let dir = folder("quit", "#!/bin/sh\ntrap '' HUP\nprintf 'ready\\n'\nwhile :; do sleep 1; done\n");
		let terminals = Terminals::new(Arc::new(Heard::default()));
		let id = start(&terminals, &dir);
		until("ready", || text(&terminals, &id).contains("ready"));
		terminals.stop(&id).unwrap();
		terminals.stop_all();
		std::thread::sleep(Duration::from_millis(300));
		assert!(ended_of(&terminals, &id).is_some(), "killed before quit returned, not by a thread the app takes along");
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[cfg(unix)]
	#[test]
	fn the_trust_button_moves_to_yes_and_sends_enter_only_while_the_shell_sees_the_question() {
		// Draws the trust question on "No", moves to "Yes" on Down, and says what Enter chose.
		let draw = |no: &str, yes: &str| format!("printf '\\033[2J\\033[H Is this a project you created or one you trust?\\r\\n\\r\\n{no} No, exit\\r\\n{yes} Yes, I trust this folder\\r\\n\\r\\n Enter to confirm \\302\\267 Esc to cancel\\r\\n'");
		let question = format!(
			"#!/bin/sh\nstty raw -echo\n{}\nkey=$(dd bs=3 count=1 2>/dev/null)\n[ \"$key\" = \"$(printf '\\033[B')\" ] && {}\nkey=$(dd bs=1 count=1 2>/dev/null)\n[ \"$key\" = \"$(printf '\\r')\" ] && printf '\\033[2J\\033[Htrusted\\r\\n'\nsleep 30\n",
			draw(" \\342\\235\\257", "  "),
			draw("  ", " \\342\\235\\257"),
		);
		let dir = folder("trust", &question);
		let heard = Arc::new(Heard::default());
		let terminals = Terminals::new(heard.clone());
		let id = start(&terminals, &dir);
		until("the question", || terminals.find(&id).unwrap().state().screen.trust() == Some(Trust::OnNo));
		assert!(terminals.answer(&id, Prompt::Enter).is_err(), "no Press Enter line");
		assert!(terminals.answer(&id, Prompt::Menu).is_err(), "a plain menu has no button");
		terminals.answer(&id, Prompt::Trust).unwrap();
		until("the answer", || text(&terminals, &id).contains("trusted"));
		assert!(terminals.answer(&id, Prompt::Trust).is_err(), "the question is gone");
		assert!(lock(&heard.typed).is_empty(), "godspeed's own answer is not the learner talking");
		terminals.stop(&id).unwrap();
		until("the stop", || ended_of(&terminals, &id).is_some());
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[cfg(unix)]
	#[test]
	fn enter_on_a_menu_answers_it_and_is_no_message() {
		let menu = "#!/bin/sh\nprintf ' Select a model\\r\\n\\r\\n \\342\\235\\257 1. Default (recommended)\\r\\n   2. Opus\\r\\n'\nsleep 30\n";
		let dir = folder("menu", menu);
		let heard = Arc::new(Heard::default());
		let terminals = Terminals::new(heard.clone());
		let id = start(&terminals, &dir);
		terminals.attach(&id).unwrap();
		until("the menu", || terminals.find(&id).unwrap().state().screen.seen().prompt == Some(Prompt::Menu));
		terminals.write(&id, "\r", true).unwrap();
		terminals.paste(&id, "2\n", true).unwrap();
		assert!(lock(&heard.typed).is_empty());
		terminals.stop(&id).unwrap();
		until("the stop", || ended_of(&terminals, &id).is_some());
		std::fs::remove_dir_all(dir).unwrap();
	}
}
