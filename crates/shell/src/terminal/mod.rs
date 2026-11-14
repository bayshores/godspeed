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
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use portable_pty::{Child, MasterPty};
use serde_json::{Value, json};

pub use screen::Prompt;
use screen::{Screen, Settle};
pub use spawn::{Agent, Role};

/// How long a stopped agent gets to close before it is killed.
const STOP_GRACE: Duration = Duration::from_secs(2);
/// How often a terminal sends the page its output and looks whether a question has stayed on
/// its screen: a program that prints without pause costs the window one push a frame.
const FRAME: Duration = Duration::from_millis(16);
/// More output than this in one frame is sent as the screen it drew instead.
const FRAME_BYTES: usize = 64 * 1024;
/// On the screen when the shell could not draw a terminal's output.
const BROKEN: &str = "godspeed couldn't read this terminal's screen, so it stopped it. Start it again to go on.";

pub const NOT_SET_UP: &str = "The godspeed folder isn't set up yet.";
const NOT_THERE: &str = "That terminal isn't running.";
const NOT_SHOWN: &str = "Show the terminal and click in it first.";

/// Where a terminal's news goes: the page, the server and the log.
pub trait Outlet: Send + Sync + 'static {
	fn push(&self, channel: &str, payload: Value);
	/// The live terminal ids changed.
	fn live(&self, ids: Vec<String>);
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
}

/// The terminal's input, queued in order, and its page end, kept open until the script ends.
struct Io {
	input: Sender<Vec<u8>>,
	_master: Box<dyn MasterPty + Send>,
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
	stopping: bool,
	broken: bool,
	ended: Option<Ended>,
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
			// The clock has stopped: what the script printed last goes out now.
			if state.ended.is_some() {
				self.flush(&mut state, outlet);
			}
		}
		let seen = state.screen.seen();
		let now = Instant::now();
		state.settle.update(seen, now);
		self.push_state(&mut state, outlet, now);
		true
	}

	/// Sends the page the frame's output, or the screen when there was too much of it.
	fn flush(&self, state: &mut State, outlet: &dyn Outlet) {
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
		if let Some(pid) = self.pid {
			spawn::signal_group(pid, rustix::process::Signal::HUP);
		}
		#[cfg(windows)]
		self.job.kill();
	}

	#[cfg(unix)]
	fn kill(&self) {
		if let Some(pid) = self.pid {
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

fn state_ended(state: &State) -> bool {
	state.ended.is_some() || state.stopping
}

type List = Mutex<Vec<Arc<Terminal>>>;

/// The ids of the terminals that run and were not stopped.
fn live_ids(list: &[Arc<Terminal>]) -> Vec<String> {
	list.iter().filter(|t| !state_ended(&t.state())).map(|t| t.id.clone()).collect()
}

/// Tells the server the live ids. Sent under the list's lock, so two changes at once reach it
/// in the order they happened.
fn tell_live(list: &List, outlet: &dyn Outlet) {
	let list = lock(list);
	outlet.live(live_ids(&list));
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

	pub fn live(&self) -> Vec<String> {
		live_ids(&lock(&self.list))
	}

	/// Tells a server that just started which terminals are live.
	pub fn tell_live(&self) {
		tell_live(&self.list, &*self.outlet);
	}

	/// Runs the folder's start script for `role` and `agent`: the new terminal's id. `env` is the
	/// app's environment; `data` is this app's data folder.
	pub fn start(&self, role: Role, agent: Agent, folder: &str, env: Vec<(OsString, OsString)>, data: &Path) -> Result<String, String> {
		let mut list = lock(&self.list);
		if list.iter().any(|t| t.role == role && !state_ended(&t.state())) {
			return Err(format!("The {} is already running.", role.name()));
		}
		let os = std::env::consts::OS;
		let script = spawn::script(folder, role, agent, os).ok_or(NOT_SET_UP)?;
		let id = crate::server::random_hex::<16>();
		let shell = spawn::shell(&env, os);
		#[cfg_attr(not(windows), allow(unused_mut))]
		let mut env = spawn::environment(env, &id, data, os);
		#[cfg(windows)]
		crate::win::path::refresh(&mut env);
		let spawned = spawn::spawn(spawn::argv(&script, &shell, os), env, Path::new(folder)).map_err(|err| {
			self.outlet.log(&format!("terminal could not start: {} {}: {err}", role.name(), agent.name()));
			"godspeed couldn't start the terminal.".to_owned()
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
				io: Some(Io { input, _master: spawned.master }),
				screen: Screen::default(),
				settle: Settle::default(),
				shown: (None, false),
				attached: false,
				pending: Vec::new(),
				overflow: false,
				stopping: false,
				broken: false,
				ended: None,
			}),
		});
		// An ended record stays until the next start for its role.
		list.retain(|t| t.role != role);
		list.push(terminal.clone());
		self.outlet.live(live_ids(&list));
		drop(list);
		self.outlet.log(&format!("terminal started: {} {} pid {}", role.name(), agent.name(), terminal.pid.unwrap_or_default()));
		self.run(terminal, spawned.reader, spawned.child);
		Ok(id)
	}

	/// The terminal's other three threads: its output, its exit and its clock.
	fn run(&self, terminal: Arc<Terminal>, mut reader: Box<dyn Read + Send>, mut child: Box<dyn Child + Send + Sync>) {
		let (outlet, list, reading) = (self.outlet.clone(), self.list.clone(), terminal.clone());
		std::thread::spawn(move || {
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
			ended(terminal, code, &*outlet, &list);
		});
		let outlet = self.outlet.clone();
		std::thread::spawn(move || {
			loop {
				std::thread::sleep(FRAME);
				let mut state = ticking.state();
				if state.ended.is_some() {
					return;
				}
				ticking.flush(&mut state, &*outlet);
				ticking.push_state(&mut state, &*outlet, Instant::now());
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
		let snapshot = gs_base::base64::encode(state.screen.snapshot().as_bytes());
		self.outlet.push("terminal-output", json!({ "id": id, "snapshot": snapshot }));
		Ok(())
	}

	pub fn detach(&self, id: &str) -> Result<(), String> {
		let terminal = self.find(id)?;
		let mut state = terminal.state();
		state.attached = false;
		state.pending.clear();
		state.overflow = false;
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
		terminal.write(data.as_bytes())
	}

	/// The trust or Enter button: Enter, only while the shell itself still sees that question.
	pub fn answer(&self, id: &str, kind: Prompt) -> Result<(), String> {
		let terminal = self.find(id)?;
		if terminal.state().screen.seen().prompt != Some(kind) || kind == Prompt::Menu {
			return Err("That question isn't on the screen anymore.".to_owned());
		}
		terminal.write(b"\r")
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
	/// every group is killed, also what an ended script left behind: their own kill threads end
	/// with the app.
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

/// The script exited: the record keeps its screen, and whatever it left running is stopped.
fn ended(terminal: Arc<Terminal>, code: u32, outlet: &dyn Outlet, list: &List) {
	let (ended, stopped) = {
		let mut state = terminal.state();
		let stopped = state.stopping;
		let ended = match (state.broken, stopped) {
			(true, _) => Ended::Broken,
			(false, true) => Ended::Stopped,
			(false, false) => Ended::Exited(code),
		};
		state.ended = Some(ended);
		state.io = None;
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

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
	mutex.lock().unwrap_or_else(PoisonError::into_inner)
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
		log: Mutex<Vec<String>>,
		/// The next live message takes a while to send, and `sending` says when it began.
		slow: AtomicBool,
		sending: AtomicBool,
	}

	impl Outlet for Arc<Heard> {
		fn push(&self, channel: &str, payload: Value) {
			lock(&self.pushes).push((channel.to_owned(), payload));
		}

		fn live(&self, ids: Vec<String>) {
			if self.slow.swap(false, Ordering::SeqCst) {
				self.sending.store(true, Ordering::SeqCst);
				std::thread::sleep(Duration::from_millis(300));
			}
			lock(&self.live).push(ids);
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
		terminals.start(Role::Teacher, Agent::Claude, dir.to_str().unwrap(), env(dir), Path::new("/data")).unwrap()
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
		terminals.write(&id, &format!("{SECRET}\r"), true).unwrap();
		until("the echo", || text(&terminals, &id).contains(&format!("got {SECRET}")));
		until("the end", || ended_of(&terminals, &id) == Some(Ended::Exited(0)));

		let pushes = lock(&heard.pushes);
		let (channel, snapshot) = pushes.iter().find(|(channel, _)| channel == "terminal-output").unwrap();
		assert_eq!((channel.as_str(), snapshot["id"].as_str()), ("terminal-output", Some(id.as_str())));
		let drawn = String::from_utf8(gs_base::base64::decode(snapshot["snapshot"].as_str().unwrap())).unwrap();
		assert!(drawn.contains("ready"), "the snapshot redraws the screen");
		let output: Vec<u8> = pushes.iter().filter_map(|(_, p)| p["data"].as_str()).flat_map(gs_base::base64::decode).collect();
		assert!(String::from_utf8_lossy(&output).contains(&format!("got {SECRET}")), "output after the attach");
		let last = &pushes.iter().rfind(|(channel, _)| channel == "terminal-state").unwrap().1;
		assert_eq!(last["ended"], json!({ "stopped": false, "code": 0 }));
		assert_eq!(lock(&heard.live).last(), Some(&Vec::new()), "the server hears it ended");
		assert_eq!(terminals.write(&id, "x", true), Err(NOT_THERE.to_owned()));
		std::fs::remove_dir_all(dir).unwrap();
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
		assert_eq!(terminals.start(Role::Teacher, Agent::Codex, dir.to_str().unwrap(), env(&dir), Path::new("/data")), Err("The teacher is already running.".to_owned()));
		assert_eq!(terminals.start(Role::Helper, Agent::Claude, dir.to_str().unwrap(), env(&dir), Path::new("/data")), Err(NOT_SET_UP.to_owned()), "the helper has no script here");
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
		let start_helper = || terminals.start(Role::Helper, Agent::Claude, dir.to_str().unwrap(), env(&dir), Path::new("/data")).unwrap();

		let teacher = start(&terminals, &dir);
		let helper = start_helper();
		until("ready", || text(&terminals, &teacher).contains("ready") && text(&terminals, &helper).contains("ready"));
		terminals.attach(&teacher).unwrap();
		terminals.write(&teacher, "bye\r", true).unwrap();
		until("the teacher's own end", || ended_of(&terminals, &teacher) == Some(Ended::Exited(0)));
		until("the helper's stop", || ended_of(&terminals, &helper) == Some(Ended::Stopped));
		assert_eq!(lock(&heard.live).last(), Some(&Vec::new()), "the server hears both ended");

		let teacher = start(&terminals, &dir);
		let helper = start_helper();
		until("ready", || text(&terminals, &helper).contains("ready"));
		terminals.stop(&teacher).unwrap();
		until("the helper's stop", || ended_of(&terminals, &helper) == Some(Ended::Stopped));
		assert_eq!(lock(&heard.live).last(), Some(&Vec::new()));
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn the_server_hears_the_live_terminals_in_the_order_they_changed() {
		let dir = folder("order", WAITS);
		write_script(&dir, Role::Helper, WAITS);
		let heard = Arc::new(Heard::default());
		let terminals = Arc::new(Terminals::new(heard.clone()));
		let helper = terminals.start(Role::Helper, Agent::Claude, dir.to_str().unwrap(), env(&dir), Path::new("/data")).unwrap();
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
	fn what_an_ended_script_left_running_is_killed_after_the_grace() {
		// The child ignores the hang-up, as an agent may.
		let dir = folder("leftover", "#!/bin/sh\n(trap '' HUP; exec sleep 300) &\necho $! > \"$0.pid\"\nprintf 'ready\\n'\n");
		let terminals = Terminals::new(Arc::new(Heard::default()));
		let id = start(&terminals, &dir);
		until("the end", || ended_of(&terminals, &id) == Some(Ended::Exited(0)));
		let pid_file = dir.join(".godspeed/start-claude").with_extension(if cfg!(target_os = "macos") { "command.pid" } else { "sh.pid" });
		let child = std::fs::read_to_string(pid_file).unwrap().trim().to_owned();
		std::thread::sleep(STOP_GRACE / 2);
		assert!(running(&child), "the hang-up alone left it");
		until("the kill", || !running(&child));
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
	fn the_trust_button_sends_enter_only_while_the_shell_sees_the_question() {
		let question = "#!/bin/sh\nprintf ' Do you trust the files in this folder?\\n > 1. Yes, proceed\\n   2. No, exit\\n'\nread line\nprintf '\\033[2J\\033[Htrusted\\n'\nread line\n";
		let dir = folder("trust", question);
		let terminals = Terminals::new(Arc::new(Heard::default()));
		let id = start(&terminals, &dir);
		until("the question", || text(&terminals, &id).contains("2. No, exit"));
		assert!(terminals.answer(&id, Prompt::Enter).is_err(), "no Press Enter line");
		assert!(terminals.answer(&id, Prompt::Menu).is_err(), "a plain menu has no button");
		terminals.answer(&id, Prompt::Trust).unwrap();
		until("the answer", || text(&terminals, &id).contains("trusted"));
		assert!(terminals.answer(&id, Prompt::Trust).is_err(), "the question is gone");
		terminals.stop(&id).unwrap();
		until("the stop", || ended_of(&terminals, &id).is_some());
		std::fs::remove_dir_all(dir).unwrap();
	}
}
