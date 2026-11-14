//! Run examples on this computer (mock-runner.ts): the learner's code for a mock's code question
//! is saved to a folder of its own in the system's temp folder and run with the computer's Node or
//! Python, with a time limit. What it printed is read by core `mock_run`.
//!
//! This runs the learner's own code: the run gets no input, none of godspeed's settings in its
//! environment, its own process group (all of it is ended with the run), a time limit and a cap
//! on what it prints.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use gs_base::{clock, fsx, ids, text};
use gs_core::mocks::mock::MockLanguage;
use gs_core::mocks::mock_run::{RUN_SECONDS, read_run, run_file, runner_source};
use gs_engine::turn::abort::Abort;
use gs_json::{Json, json};
use gs_transcribe::programs::{HOMEBREW_BIN_DIRS, find_in};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};

const MAX_OUTPUT: usize = 1024 * 1024;

/// The server's environment (`vars`) without godspeed's own settings: LH_DESKTOP_API_SECRET
/// opens the app's whole API, and the learner's program has no use for any of them.
fn run_env(vars: impl Iterator<Item = (OsString, OsString)>) -> Vec<(OsString, OsString)> {
	let mut env: Vec<(OsString, OsString)> = vars
		.filter(|(key, _)| {
			let key = key.to_string_lossy();
			// The compile cache would gain a file for every run's new temp folder.
			!key.to_uppercase().starts_with("LH_") && key != "NODE_COMPILE_CACHE" && key != "NODE_OPTIONS" && key != "PYTHONIOENCODING"
		})
		.collect();
	// Python on Windows prints to a pipe in the old code page, so "→" would crash.
	env.push(("PYTHONIOENCODING".into(), "utf-8".into()));
	env
}

/// Node's name for this platform (`process.platform`).
fn platform() -> &'static str {
	match std::env::consts::OS {
		"macos" => "darwin",
		"windows" => "win32",
		other => other,
	}
}

/// A Python that only stands in for one: without Apple's developer tools the Mac's
/// /usr/bin/python3 opens their install dialog, and without Python Windows' WindowsApps
/// python.exe opens the Store.
pub fn is_stand_in_python(file: &str, platform: &str, has_dev_tools: &dyn Fn() -> bool) -> bool {
	match platform {
		"darwin" => file == "/usr/bin/python3" && !has_dev_tools(),
		"win32" => file.to_lowercase().contains("\\windowsapps\\"),
		_ => false,
	}
}

fn has_dev_tools() -> bool {
	std::process::Command::new("/usr/bin/xcode-select").arg("-p").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success())
}

fn path_env() -> Option<String> {
	std::env::var_os("PATH").map(|p| p.to_string_lossy().into_owned())
}

/// The command that runs Python files: Windows' py launcher first, then python3 or python. An
/// app opened from the Dock has only the system folders on its PATH, so on a Mac Homebrew's
/// Python comes first.
fn python_command() -> Option<Vec<PathBuf>> {
	let any = |_: &Path| true;
	if platform() == "win32"
		&& let Some(py) = find_in("py", path_env().as_deref(), &HOMEBREW_BIN_DIRS, &any)
	{
		return Some(vec![py, PathBuf::from("-3")]);
	}
	let path = if platform() == "darwin" { Some([HOMEBREW_BIN_DIRS.join(":"), path_env().unwrap_or_default()].join(":")) } else { path_env() };
	let real = |file: &Path| !is_stand_in_python(&file.to_string_lossy(), platform(), &has_dev_tools);
	let found = find_in("python3", path.as_deref(), &HOMEBREW_BIN_DIRS, &real).or_else(|| find_in("python", path.as_deref(), &HOMEBREW_BIN_DIRS, &real));
	found.map(|python| vec![python])
}

/// The command that runs a language, or why this computer has none. JavaScript runs on the
/// computer's own Node, found like the other programs.
fn command_for(language: MockLanguage) -> Result<Vec<PathBuf>, &'static str> {
	match language {
		MockLanguage::Javascript => find_in("node", path_env().as_deref(), &HOMEBREW_BIN_DIRS, &|_| true).map(|node| vec![node]).ok_or("godspeed couldn't find Node.js on this computer. Install Node.js, or answer in Python."),
		MockLanguage::Python => python_command().ok_or("godspeed couldn't find Python on this computer. Install Python 3, or answer in JavaScript."),
	}
}

/// How to end a run and every process in it, or None when nothing may be ended: on macOS and
/// Linux the run leads its own process group, so the whole group; on Windows its process tree,
/// only while the program runs, since once it has ended its pid may already be another program's.
#[derive(Debug, PartialEq)]
pub enum Stop {
	Group(u32),
	Command(Vec<String>),
}

pub fn stop_command(pid: u32, platform: &str, running: bool) -> Option<Stop> {
	if platform != "win32" {
		return Some(Stop::Group(pid));
	}
	running.then(|| Stop::Command(["taskkill", "/T", "/F", "/PID", &pid.to_string()].map(str::to_owned).to_vec()))
}

/// Ends the run's processes.
async fn stop_all(pid: u32, running: bool) {
	let (program, args) = match stop_command(pid, platform(), running) {
		None => return,
		Some(Stop::Group(group)) => {
			// Without unsafe code there is no kill(2): the system's kill program, /bin/kill where
			// there is one (NixOS has none).
			let any = |_: &Path| true;
			let Some(kill) = find_in("kill", Some("/bin"), &[], &any).or_else(|| find_in("kill", path_env().as_deref(), &[], &any)) else { return };
			(kill.to_string_lossy().into_owned(), vec!["-KILL".to_owned(), "--".to_owned(), format!("-{group}")])
		}
		Some(Stop::Command(command)) => (command[0].clone(), command[1..].to_vec()),
	};
	let mut stop = Command::new(program);
	stop.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
	hide_window(&mut stop);
	// Every process of it may have ended already.
	let _ = stop.status().await;
}

#[cfg(windows)]
fn hide_window(command: &mut Command) {
	const CREATE_NO_WINDOW: u32 = 0x0800_0000;
	command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_window(_command: &mut Command) {}

/// `fs.mkdtempSync(path.join(tmp, "godspeed-run-"))`, by its real path: it is the one the error
/// text names.
fn make_run_dir(tmp: &Path) -> Result<PathBuf, String> {
	let dir = fsx::make_temp_dir(tmp, "godspeed-run-")?;
	std::fs::canonicalize(&dir).map(fsx::without_long_prefix).map_err(|err| fsx::node_error_message(&err, "realpath", &dir))
}

/// `pathToFileURL(dir).href`: what Node names a module file by.
fn file_url(dir: &str) -> String {
	let path = if cfg!(windows) { format!("/{}", dir.replace('\\', "/")) } else { dir.to_owned() };
	let mut url = String::from("file://");
	for byte in path.bytes() {
		match byte {
			b'%' | b'\\' | b'\n' | b'\r' | b'\t' | b' ' | b'"' | b'#' | b'<' | b'>' | b'?' | b'`' | b'{' | b'}' | 0..=0x1f | 0x7f..=0xff => url.push_str(&format!("%{byte:02X}")),
			_ => url.push(byte as char),
		}
	}
	url
}

/// Python on Windows prints each line ending as CRLF; what it printed reads the same everywhere.
fn unix_newlines(text: &str) -> String {
	if cfg!(windows) { text.replace("\r\n", "\n") } else { text.to_owned() }
}

/// `fs.rm(dir, { recursive: true, force: true, maxRetries: 5 })`: Windows lets go of an ended
/// program's files a moment later.
async fn remove_run_dir(dir: &Path) {
	for attempt in 1..=6 {
		match tokio::fs::remove_dir_all(dir).await {
			Err(err) if err.kind() != std::io::ErrorKind::NotFound && attempt < 6 => clock::sleep(100 * attempt).await,
			_ => return,
		}
	}
}

/// Ends what is left of a run however it ends (also when the request that asked for it goes
/// away): its processes, then its folder, which Windows keeps while a program in it runs. One
/// left behind never holds up the answer.
struct Cleanup {
	/// Taken only on drop.
	child: Option<Child>,
	dir: PathBuf,
}

impl Drop for Cleanup {
	fn drop(&mut self) {
		// Without a runtime the program is killed as it drops (kill_on_drop).
		let (Some(mut child), Ok(runtime)) = (self.child.take(), tokio::runtime::Handle::try_current()) else { return };
		let dir = self.dir.clone();
		runtime.spawn(async move {
			// The program is ended last: Windows walks the process tree from it, and its open handle
			// keeps its pid from going to another program until then.
			let pid = child.id();
			let running = matches!(child.try_wait(), Ok(None));
			if let Some(pid) = pid {
				stop_all(pid, running).await;
			}
			drop(child);
			remove_run_dir(&dir).await;
		});
	}
}

/// One pipe went past the cap.
struct TooMuch;

/// What one pipe gave until it closed.
async fn read_capped(mut pipe: impl AsyncRead + Unpin) -> Result<Vec<u8>, TooMuch> {
	let mut kept = Vec::new();
	let mut chunk = vec![0u8; 64 * 1024];
	loop {
		match pipe.read(&mut chunk).await {
			Ok(0) | Err(_) => return Ok(kept),
			Ok(n) if kept.len() + n > MAX_OUTPUT => return Err(TooMuch),
			Ok(n) => kept.extend_from_slice(&chunk[..n]),
		}
	}
}

fn stopped(error: &str) -> Json {
	json!({ "examples": [], "error": error })
}

async fn aborted(signal: Option<&Abort>) {
	match signal {
		Some(signal) => signal.aborted().await,
		None => std::future::pending().await,
	}
}

/// Runs the learner's code on a code question's examples: a run outcome (core `read_run`).
/// `signal` stops it, as does dropping the future.
pub async fn run_examples(tmp: &Path, question: &Json, code: &str, language: MockLanguage, signal: Option<&Abort>) -> Result<Json, String> {
	let command = match command_for(language) {
		Ok(command) => command,
		Err(missing) => return Ok(stopped(missing)),
	};
	let examples = question["examples"].as_arr().map_or(&[][..], Vec::as_slice);
	let mark = format!("__godspeed_{}__", ids::uuid());
	let dir = make_run_dir(tmp)?;
	let file = dir.join(run_file(language));
	if let Err(err) = fsx::write_text_atomic(&file, &runner_source(code, &question["fn"], examples, language, &mark)) {
		let _ = std::fs::remove_dir_all(&dir);
		return Err(fsx::node_error_message(&err, "open", &file));
	}
	let mut spawn = Command::new(&command[0]);
	spawn.args(&command[1..]).arg(&file).current_dir(&dir).env_clear().envs(run_env(std::env::vars_os())).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
	#[cfg(unix)]
	spawn.process_group(0);
	hide_window(&mut spawn);
	let mut child = match spawn.spawn() {
		Ok(child) => child,
		Err(_) => {
			let _ = std::fs::remove_dir_all(&dir);
			return Ok(read_run("", "", &mark, examples));
		}
	};
	let shown_dir = format!("{}{}", dir.to_string_lossy(), std::path::MAIN_SEPARATOR);
	let (out, err, pid) = (child.stdout.take(), child.stderr.take(), child.id());
	let mut run = Cleanup { child: Some(child), dir };
	let (Some(out), Some(err), Some(child)) = (out, err, run.child.as_mut()) else { return Err("the run had no output".to_owned()) };
	let finished = async {
		// What the program started may still hold its output open: end it all once the program
		// itself is done, so its output closes too.
		let ended = async {
			let _ = child.wait().await;
			if let Some(pid) = pid {
				stop_all(pid, false).await;
			}
			Ok(())
		};
		// Too much output stops the run at once.
		tokio::try_join!(ended, read_capped(out), read_capped(err)).map(|((), out, err)| (out, err))
	};
	let outcome = tokio::select! {
		printed = finished => match printed {
			Ok((out, err)) => {
				// The temp folder's path, also as a file:// URL when Node read the code as a module,
				// says nothing to the learner.
				let err = unix_newlines(&text::from_utf8_lossy(&err)).replace(&file_url(&shown_dir), "").replace(&shown_dir, "");
				read_run(&unix_newlines(&text::from_utf8_lossy(&out)), &err, &mark, examples)
			}
			Err(TooMuch) => stopped("Your code printed too much and was stopped."),
		},
		() = clock::sleep(i64::from(RUN_SECONDS) * 1000) => stopped(&format!("Your code ran for more than {RUN_SECONDS} seconds and was stopped.")),
		() = aborted(signal) => stopped("The run was stopped."),
	};
	drop(run);
	Ok(outcome)
}

#[cfg(test)]
#[path = "mock_runner_tests.rs"]
mod tests;
