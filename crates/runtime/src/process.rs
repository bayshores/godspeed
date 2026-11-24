//! Starting the learner's agent programs: the environment they get (the app's own variables and
//! any API key taken out, the learner's login-shell PATH put in), finding a program on
//! that PATH (through an npm `.cmd` shim on Windows), and a child process whose whole tree ends
//! when godspeed drops it.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::Stdio;

use gs_base::child_env::{app_variable, login_shell};
use gs_base::{clock, tasks};
use gs_transcribe::programs::{HOMEBREW_BIN_DIRS, find_in};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::OnceCell;

/// API keys the agents would bill instead of the learner's plan; godspeed runs on plans only.
const API_KEYS: [&str; 3] = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"];

/// The agent's environment: the app's own, less the app's variables, godspeed's own
/// (`GODSPEED_`, which belong to the terminal and the outside connector), and any API key.
fn agent_vars(base: impl IntoIterator<Item = (OsString, OsString)>, os: &str) -> Vec<(OsString, OsString)> {
	let dropped = |key: &str| {
		let upper = key.to_ascii_uppercase();
		app_variable(key, os) || upper.starts_with("GODSPEED_") || API_KEYS.contains(&upper.as_str())
	};
	base.into_iter().filter(|(key, _)| !key.to_str().is_some_and(dropped)).collect()
}

/// Marks the PATH in the login shell's output, which may also hold what the learner's profile
/// prints.
const PATH_MARK: &str = "__GODSPEED_PATH__";

/// A profile that waits for input must not hold the agent's start for long.
const PROBE_MS: i64 = 5_000;

fn marked_path(output: &str) -> Option<&str> {
	let start = output.find(PATH_MARK)? + PATH_MARK.len();
	let end = output[start..].find(PATH_MARK)? + start;
	Some(&output[start..end]).filter(|path| !path.is_empty())
}

/// The PATH the learner's login shell sets up, as a terminal would have it: an app opened from
/// the Dock gets only the system's folders.
async fn login_path(vars: &[(OsString, OsString)], os: &str) -> Result<String, String> {
	let shell = vars.iter().find(|(key, _)| key == "SHELL").and_then(|(_, value)| value.to_str()).unwrap_or_default();
	let mut command = Command::new(login_shell(shell, os));
	command.args(["-l", "-i", "-c", &format!("printf '{PATH_MARK}%s{PATH_MARK}' \"$PATH\"")]);
	command.env_clear().envs(vars.iter().map(|(key, value)| (key, value)));
	command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
	let output = clock::within(PROBE_MS, command.output()).await.ok_or("it took too long")?.map_err(|err| err.to_string())?;
	marked_path(&String::from_utf8_lossy(&output.stdout)).map(str::to_owned).ok_or_else(|| "it printed no PATH".to_owned())
}

fn path_var(vars: &[(OsString, OsString)]) -> Option<String> {
	vars.iter().find(|(key, _)| key.to_str().is_some_and(|key| key.eq_ignore_ascii_case("PATH"))).map(|(_, value)| value.to_string_lossy().into_owned())
}

/// How to start a program: itself, Node with a script, or the learner's own command.
#[derive(Clone, Debug, PartialEq)]
pub struct Launch {
	pub program: PathBuf,
	pub args: Vec<OsString>,
}

impl Launch {
	/// The learner's own start command (such as `standardcompute launch codex --`) with `word`
	/// after it, run by the system's shell as a terminal would run it. `word` is one plain word,
	/// so it needs no quoting.
	pub fn own_command(command: &str, word: &str) -> Launch {
		if cfg!(windows) {
			let cmd = std::env::var_os("ComSpec").unwrap_or_else(|| "cmd.exe".into());
			// `/s` takes the outer quotes off and runs the rest as written.
			return Launch { program: cmd.into(), args: vec!["/d".into(), "/s".into(), "/c".into(), format!("\"{command} {word}\"").into()] };
		}
		Launch { program: "/bin/sh".into(), args: vec!["-c".into(), format!("{command} \"$@\"").into(), "sh".into(), word.into()] }
	}
}

/// The environment every agent program starts with. The login shell is asked once, on first use.
#[derive(Default)]
pub struct AgentEnv {
	vars: OnceCell<Vec<(OsString, OsString)>>,
}

impl AgentEnv {
	pub async fn vars(&self) -> &[(OsString, OsString)] {
		self.vars
			.get_or_init(|| async {
				let os = std::env::consts::OS;
				let mut vars = agent_vars(std::env::vars_os(), os);
				// Windows apps get the account's PATH, and there is no login shell to ask.
				if os != "windows" {
					match login_path(&vars, os).await {
						Ok(path) => {
							vars.retain(|(key, _)| key != "PATH");
							vars.push(("PATH".into(), path.into()));
						}
						Err(err) => eprintln!("[agent-env] the login shell's PATH could not be read ({err}), so the app's own is used"),
					}
				}
				vars
			})
			.await
	}

	/// A program on the agent's PATH, then in Homebrew's folders. On Windows an npm install is a
	/// `.cmd` shim, which only cmd can run, so the program it runs is returned instead.
	pub async fn find(&self, name: &str) -> Option<PathBuf> {
		let path = path_var(self.vars().await);
		if !cfg!(windows) {
			return find_in(name, path.as_deref(), &HOMEBREW_BIN_DIRS, &|_| true);
		}
		// npm also writes an extensionless shell script beside its shims, which Windows cannot run.
		let exe = |file: &Path| file.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("exe"));
		find_in(name, path.as_deref(), &[], &exe).or_else(|| find_in(&format!("{name}.cmd"), path.as_deref(), &[], &|_| true).and_then(|shim| shim_program(&shim)))
	}

	/// How to start `program`: a Node script (what an npm shim on Windows may run) runs with Node.
	pub async fn launch(&self, program: PathBuf) -> Result<Launch, String> {
		let script = program.extension().and_then(OsStr::to_str).is_some_and(|ext| ["js", "mjs", "cjs"].contains(&ext));
		if !script {
			return Ok(Launch { program, args: Vec::new() });
		}
		let node = self.find("node").await.ok_or("godspeed couldn't find Node.js on this computer.")?;
		Ok(Launch { program: node, args: vec![program.into()] })
	}
}

/// The program an npm `.cmd` shim runs. npm's cmd-shim names it last, as `"%dp0%\<path>"`, a
/// path from the shim's own folder.
fn shim_target(text: &str, dir: &Path) -> Option<PathBuf> {
	const START: &str = "\"%dp0%\\";
	let start = text.rfind(START)? + START.len();
	let end = text[start..].find('"')? + start;
	Some(text[start..end].split('\\').filter(|part| !part.is_empty()).fold(dir.to_path_buf(), |path, part| path.join(part)))
}

fn shim_program(shim: &Path) -> Option<PathBuf> {
	let text = std::fs::read_to_string(shim).ok()?;
	shim_target(&text, shim.parent()?).filter(|target| target.is_file())
}

/// A running agent program. Dropping it ends the program and everything it started: on macOS and
/// Linux it leads its own process group, on Windows a job object holds it.
pub struct AgentProcess {
	child: Child,
	#[cfg(unix)]
	pid: Option<u32>,
	#[cfg(windows)]
	_job: win32job::Job,
}

impl AgentProcess {
	/// Starts `launch` with `vars` as its whole environment; what it writes to stderr is logged
	/// under `label`.
	pub fn start(label: &'static str, launch: &Launch, vars: &[(OsString, OsString)]) -> Result<(AgentProcess, ChildStdin, ChildStdout), String> {
		let mut command = Command::new(&launch.program);
		add_args(&mut command, launch);
		command.env_clear().envs(vars.iter().map(|(key, value)| (key, value)));
		command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
		#[cfg(unix)]
		command.process_group(0);
		hide_window(&mut command);
		let mut child = command.spawn().map_err(|err| format!("cannot start {}: {err}", launch.program.display()))?;
		#[cfg(windows)]
		let job = hold(&child)?;
		let (Some(stdin), Some(stdout), Some(stderr)) = (child.stdin.take(), child.stdout.take(), child.stderr.take()) else {
			return Err(format!("{label} started without its pipes"));
		};
		tasks::detach(label, async move {
			let mut lines = BufReader::new(stderr).lines();
			while let Ok(Some(line)) = lines.next_line().await {
				eprintln!("[{label}] {line}");
			}
		});
		let process = AgentProcess {
			#[cfg(unix)]
			pid: child.id(),
			child,
			#[cfg(windows)]
			_job: job,
		};
		Ok((process, stdin, stdout))
	}

	/// Waits for the program to end, and says how it ended.
	pub async fn ended(&mut self) -> String {
		match self.child.wait().await {
			Ok(status) => status.to_string(),
			Err(err) => format!("its end could not be read: {err}"),
		}
	}
}

impl Drop for AgentProcess {
	fn drop(&mut self) {
		// Never 1: kill(-1) reaches every process of the account.
		#[cfg(unix)]
		if let Some(pid) = self.pid.and_then(|pid| i32::try_from(pid).ok()).filter(|pid| *pid > 1).and_then(rustix::process::Pid::from_raw) {
			// A group that already ended is no error.
			let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::KILL);
		}
	}
}

/// cmd does not split its command line the way other Windows programs do, so it gets its
/// arguments as written (see `Launch::own_command`).
#[cfg(windows)]
fn add_args(command: &mut Command, launch: &Launch) {
	let cmd = launch.program.file_name().is_some_and(|name| name.eq_ignore_ascii_case("cmd.exe"));
	for arg in &launch.args {
		if cmd {
			command.raw_arg(arg);
		} else {
			command.arg(arg);
		}
	}
}

#[cfg(not(windows))]
fn add_args(command: &mut Command, launch: &Launch) {
	command.args(&launch.args);
}

/// On Windows a console program started from a window app opens a console window of its own.
#[cfg(windows)]
pub(crate) fn hide_window(command: &mut Command) {
	const CREATE_NO_WINDOW: u32 = 0x0800_0000;
	command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(crate) fn hide_window(_command: &mut Command) {}

/// A job holding the child, so everything it starts ends with the job's handle.
#[cfg(windows)]
fn hold(child: &Child) -> Result<win32job::Job, String> {
	let failed = |err: win32job::JobError| format!("cannot hold the agent's processes: {err}");
	let handle = child.raw_handle().ok_or("cannot hold the agent's processes: no process handle")?;
	let job = win32job::Job::create_with_limit_info(win32job::ExtendedLimitInfo::new().limit_kill_on_job_close()).map_err(failed)?;
	job.assign_process(handle as isize).map_err(failed)?;
	Ok(job)
}

#[cfg(test)]
impl AgentEnv {
	/// An environment that is not read from the app's.
	pub(crate) fn fixed(vars: Vec<(OsString, OsString)>) -> AgentEnv {
		AgentEnv { vars: OnceCell::new_with(Some(vars)) }
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn vars(pairs: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
		pairs.iter().map(|(key, value)| (OsString::from(key), OsString::from(value))).collect()
	}

	#[test]
	fn the_agent_gets_the_apps_environment_without_godspeeds_variables_or_an_api_key() {
		let base = vars(&[("PATH", "/usr/bin"), ("LH_DATA_DIR", "/secret"), ("TAURI_ENV_DEBUG", "1"), ("GODSPEED_MCP_URL", "http://x"), ("godspeed_terminal", "x"), ("ANTHROPIC_API_KEY", "sk"), ("OPENAI_API_KEY", "sk"), ("codex_api_key", "sk"), ("ANTHROPIC_MODEL", "m"), ("APPIMAGE", "/x.AppImage"), ("HOME", "/h")]);
		let kept = |os: &str| agent_vars(base.clone(), os).into_iter().map(|(key, _)| key.into_string().unwrap()).collect::<Vec<_>>();
		assert_eq!(kept("linux"), ["PATH", "ANTHROPIC_MODEL", "HOME"]);
		assert_eq!(kept("macos"), ["PATH", "ANTHROPIC_MODEL", "APPIMAGE", "HOME"], "only Linux runs from an AppImage");
	}

	#[test]
	fn the_path_is_read_between_its_marks_whatever_the_profile_prints() {
		assert_eq!(marked_path(&format!("Welcome back!\n{PATH_MARK}/a:/b{PATH_MARK}")), Some("/a:/b"));
		assert_eq!(marked_path(&format!("{PATH_MARK}{PATH_MARK}")), None);
		assert_eq!(marked_path("no marks"), None);
	}

	#[cfg(unix)]
	#[tokio::test]
	async fn a_login_shell_gives_its_path() {
		let path = login_path(&vars(&[("SHELL", "/bin/sh"), ("PATH", "/usr/bin:/bin"), ("HOME", "/nonexistent-gs-runtime")]), std::env::consts::OS).await.unwrap();
		assert!(path.contains("/bin"), "{path}");
	}

	#[test]
	fn an_npm_shim_is_followed_to_the_program_it_runs() {
		// What npm's cmd-shim writes for a native program and for a Node script.
		let native = "@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe\"   %*\r\n";
		let script = "@ECHO off\r\nIF EXIST \"%dp0%\\node.exe\" (\r\n  SET \"_prog=%dp0%\\node.exe\"\r\n) ELSE (\r\n  SET \"_prog=node\"\r\n)\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\"  \"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js\" %*\r\n";
		let dir = Path::new("/npm");
		assert_eq!(shim_target(native, dir), Some(dir.join("node_modules").join("@anthropic-ai").join("claude-code").join("bin").join("claude.exe")));
		assert_eq!(shim_target(script, dir), Some(dir.join("node_modules").join("@openai").join("codex").join("bin").join("codex.js")), "the program, not the Node it may run with");
		assert_eq!(shim_target("@echo off\r\nclaude %*\r\n", dir), None);
	}

	#[cfg(unix)]
	#[tokio::test]
	async fn a_node_script_starts_with_node_and_a_program_by_itself() {
		use std::os::unix::fs::PermissionsExt;
		let dir = std::env::temp_dir().join(format!("gs-runtime-launch-{}", std::process::id()));
		std::fs::create_dir_all(&dir).unwrap();
		let node = dir.join("node");
		gs_base::fsx::write_text_atomic(&node, "#!/bin/sh\n").unwrap();
		std::fs::set_permissions(&node, std::fs::Permissions::from_mode(0o755)).unwrap();
		let env = AgentEnv::fixed(vars(&[("PATH", dir.to_str().unwrap())]));
		let program = PathBuf::from("/x/codex");
		assert_eq!(env.launch(program.clone()).await.unwrap(), Launch { program, args: Vec::new() });
		assert_eq!(env.launch("/x/codex.js".into()).await.unwrap(), Launch { program: node, args: vec!["/x/codex.js".into()] });
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[cfg(unix)]
	#[tokio::test]
	async fn the_learners_own_command_runs_with_the_word_after_its_own() {
		let launch = Launch::own_command("printf '%s|' launch codex --", "app-server");
		let (_process, _stdin, stdout) = AgentProcess::start("test launcher", &launch, &vars(&[("PATH", "/usr/bin:/bin")])).unwrap();
		let printed = BufReader::new(stdout).lines().next_line().await.unwrap().unwrap();
		assert_eq!(printed, "launch|codex|--|app-server|");
	}

	#[cfg(unix)]
	#[tokio::test]
	async fn dropping_a_process_ends_everything_it_started() {
		let launch = Launch { program: "/bin/sh".into(), args: vec!["-c".into(), "sleep 30 & echo $!; wait".into()] };
		let (process, _stdin, stdout) = AgentProcess::start("test sleeper", &launch, &vars(&[("PATH", "/usr/bin:/bin")])).unwrap();
		let child = BufReader::new(stdout).lines().next_line().await.unwrap().unwrap().parse::<i32>().unwrap();
		let alive = |pid: i32| rustix::process::test_kill_process(rustix::process::Pid::from_raw(pid).unwrap()).is_ok();
		assert!(alive(child));
		drop(process);
		let gone = clock::within(5_000, async {
			while alive(child) {
				clock::sleep(20).await;
			}
		});
		assert!(gone.await.is_some(), "the shell's own child ended with it");
	}
}
