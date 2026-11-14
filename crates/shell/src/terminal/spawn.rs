//! Starting one of the godspeed folder's start scripts in a pseudo-terminal: which script, the
//! command line and environment for each OS, and stopping everything it started. The page names
//! only a role and an agent; the program and its arguments are built here.

use std::ffi::{OsStr, OsString};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize};

/// Every view shows the same fixed size, so the agent never redraws for a resize.
pub const ROWS: u16 = 30;
pub const COLS: u16 = 100;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
	Teacher,
	Helper,
}

impl Role {
	pub fn parse(text: &str) -> Option<Role> {
		match text {
			"teacher" => Some(Role::Teacher),
			"helper" => Some(Role::Helper),
			_ => None,
		}
	}

	pub fn name(self) -> &'static str {
		match self {
			Role::Teacher => "teacher",
			Role::Helper => "helper",
		}
	}
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Agent {
	Claude,
	Codex,
}

impl Agent {
	pub fn parse(text: &str) -> Option<Agent> {
		match text {
			"claude" => Some(Agent::Claude),
			"codex" => Some(Agent::Codex),
			_ => None,
		}
	}

	pub fn name(self) -> &'static str {
		match self {
			Agent::Claude => "claude",
			Agent::Codex => "codex",
		}
	}
}

/// The start script for this role and agent in an absolute folder, when it is there.
pub fn script(folder: &str, role: Role, agent: Agent, os: &str) -> Option<PathBuf> {
	let folder = Path::new(folder);
	if !folder.is_absolute() {
		return None;
	}
	let extension = match os {
		"macos" => "command",
		"windows" => "cmd",
		_ => "sh",
	};
	let helper = if role == Role::Helper { "-helper" } else { "" };
	let script = folder.join(".godspeed").join(format!("start-{}{helper}.{extension}", agent.name()));
	script.metadata().is_ok_and(|meta| meta.is_file()).then_some(script)
}

/// The shells that read the learner's profile the way `-l -i -c` expects; any other `$SHELL`
/// (fish, nu) runs the script through the system's own.
const KNOWN_SHELLS: [&str; 5] = ["zsh", "bash", "sh", "dash", "ksh"];

fn login_shell(shell: &str, os: &str) -> String {
	let known = Path::new(shell).file_name().and_then(OsStr::to_str).is_some_and(|name| KNOWN_SHELLS.contains(&name));
	if known {
		shell.to_owned()
	} else if os == "macos" {
		"/bin/zsh".to_owned()
	} else {
		"/bin/bash".to_owned()
	}
}

/// The learner's shell as the environment names it (`ComSpec` on Windows), else the account's.
pub fn shell(env: &[(OsString, OsString)], os: &str) -> String {
	let key = if os == "windows" { "ComSpec" } else { "SHELL" };
	let named = env.iter().find(|(k, _)| k.to_str().is_some_and(|k| k.eq_ignore_ascii_case(key))).and_then(|(_, value)| value.to_str()).filter(|value| !value.is_empty());
	named.map_or_else(|| CommandBuilder::new_default_prog().get_shell(), str::to_owned)
}

/// The command line: the learner's login shell runs the script, as Terminal does with a
/// `.command` file, so PATH from `.zprofile` and `.zshrc` both count. `shell` is `$SHELL`, or
/// `ComSpec` on Windows.
pub fn argv(script: &Path, shell: &str, os: &str) -> Vec<OsString> {
	if os == "windows" {
		// Relative to the folder, the working directory: portable-pty quotes only a space, a tab
		// or `"`, and cmd splits a full path at `&`, `(`, `)` or `^`.
		let name = script.file_name().unwrap_or_default().to_string_lossy();
		return vec![shell.into(), "/d".into(), "/c".into(), format!(r".godspeed\{name}").into()];
	}
	vec![login_shell(shell, os).into(), "-l".into(), "-i".into(), "-c".into(), "exec \"$0\"".into(), script.into()]
}

/// What an AppImage sets for itself; a program started from it must not inherit them.
const APPIMAGE_VARIABLES: [&str; 12] = ["APPDIR", "APPIMAGE", "ARGV0", "OWD", "LD_LIBRARY_PATH", "LD_PRELOAD", "GDK_PIXBUF_MODULE_FILE", "GIO_EXTRA_MODULES", "GSETTINGS_SCHEMA_DIR", "GTK_PATH", "GTK_EXE_PREFIX", "GTK_DATA_PREFIX"];

/// The agent's environment: the app's own, less what belongs to the app, plus the terminal's id
/// and this app's data folder (the folder's connector finds the app through it).
pub fn environment(base: impl IntoIterator<Item = (OsString, OsString)>, id: &str, data: &Path, os: &str) -> Vec<(OsString, OsString)> {
	let dropped = |key: &str| {
		let upper = key.to_ascii_uppercase();
		upper.starts_with("LH_") || upper.starts_with("TAURI_") || upper == "GODSPEED_TERMINAL" || upper == "GODSPEED_DATA_DIR" || (os == "linux" && APPIMAGE_VARIABLES.contains(&key))
	};
	let mut env: Vec<(OsString, OsString)> = base.into_iter().filter(|(key, _)| !key.to_str().is_some_and(dropped)).collect();
	let has = |env: &[(OsString, OsString)], key: &str| env.iter().any(|(k, _)| k == key);
	for (key, value) in [("TERM", "xterm-256color"), ("COLORTERM", "truecolor"), ("LANG", "en_US.UTF-8")] {
		if !has(&env, key) {
			env.push((key.into(), value.into()));
		}
	}
	env.push(("GODSPEED_TERMINAL".into(), id.into()));
	env.push(("GODSPEED_DATA_DIR".into(), data.into()));
	env
}

/// A started script: its process, the terminal's two ends and, on Windows, the job that holds
/// every process it starts.
pub struct Spawned {
	pub child: Box<dyn Child + Send + Sync>,
	pub master: Box<dyn MasterPty + Send>,
	pub reader: Box<dyn Read + Send>,
	pub writer: Box<dyn Write + Send>,
	#[cfg(windows)]
	pub job: crate::win::job::Job,
}

pub fn spawn(argv: Vec<OsString>, env: Vec<(OsString, OsString)>, cwd: &Path) -> Result<Spawned, String> {
	let failed = |err: &dyn std::fmt::Display| format!("cannot start the terminal: {err}");
	let pair = portable_pty::native_pty_system().openpty(PtySize { rows: ROWS, cols: COLS, pixel_width: 0, pixel_height: 0 }).map_err(|err| failed(&err))?;
	let mut command = CommandBuilder::from_argv(argv);
	command.env_clear();
	for (key, value) in env {
		command.env(key, value);
	}
	command.cwd(cwd);
	#[cfg_attr(not(windows), allow(unused_mut))]
	let mut child = pair.slave.spawn_command(command).map_err(|err| failed(&err))?;
	// The script holds the only other end now, so reading ends once it and its children close it.
	drop(pair.slave);
	#[cfg(windows)]
	let job = crate::win::job::Job::holding(&mut *child)?;
	let reader = pair.master.try_clone_reader().map_err(|err| failed(&err))?;
	let writer = pair.master.take_writer().map_err(|err| failed(&err))?;
	Ok(Spawned {
		child,
		master: pair.master,
		reader,
		writer,
		#[cfg(windows)]
		job,
	})
}

/// Sends `signal` to the process group the script leads (`portable-pty` made it a session
/// leader), so its children get it too. A group that already ended is no error.
#[cfg(unix)]
pub fn signal_group(pid: u32, signal: rustix::process::Signal) {
	// Never 1: kill(-1) reaches every process of the account.
	if let Some(pid) = i32::try_from(pid).ok().filter(|pid| *pid > 1).and_then(rustix::process::Pid::from_raw) {
		let _ = rustix::process::kill_process_group(pid, signal);
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn temp(name: &str) -> PathBuf {
		let dir = std::env::temp_dir().join(format!("gs-shell-terminal-{name}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(dir.join(".godspeed")).unwrap();
		dir
	}

	#[test]
	fn the_page_names_a_role_and_an_agent_never_a_program() {
		assert_eq!((Role::parse("teacher"), Role::parse("helper")), (Some(Role::Teacher), Some(Role::Helper)));
		assert_eq!((Agent::parse("claude"), Agent::parse("codex")), (Some(Agent::Claude), Some(Agent::Codex)));
		for refused in ["", "Teacher", "claude-helper", "rm -rf ~", "/bin/sh", "codex "] {
			assert_eq!(Role::parse(refused), None, "{refused}");
			assert_eq!(Agent::parse(refused), None, "{refused}");
		}
	}

	#[test]
	fn only_the_folders_own_start_scripts_run() {
		let dir = temp("scripts");
		let folder = dir.to_str().unwrap();
		assert_eq!(script(folder, Role::Teacher, Agent::Claude, "linux"), None);
		gs_base::fsx::write_text_atomic(&dir.join(".godspeed/start-claude.sh"), "#!/bin/sh\n").unwrap();
		assert_eq!(script(folder, Role::Teacher, Agent::Claude, "linux"), Some(dir.join(".godspeed/start-claude.sh")));
		assert_eq!(script(folder, Role::Helper, Agent::Claude, "linux"), None);
		gs_base::fsx::write_text_atomic(&dir.join(".godspeed/start-codex-helper.command"), "").unwrap();
		gs_base::fsx::write_text_atomic(&dir.join(".godspeed/start-codex-helper.cmd"), "").unwrap();
		assert_eq!(script(folder, Role::Helper, Agent::Codex, "macos"), Some(dir.join(".godspeed/start-codex-helper.command")));
		assert_eq!(script(folder, Role::Helper, Agent::Codex, "windows"), Some(dir.join(".godspeed/start-codex-helper.cmd")));
		assert_eq!(script("relative", Role::Teacher, Agent::Claude, "linux"), None);
		std::fs::create_dir_all(dir.join(".godspeed/start-codex.sh")).unwrap();
		assert_eq!(script(folder, Role::Teacher, Agent::Codex, "linux"), None, "a folder is not a script");
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn the_login_shell_runs_the_script_and_an_unknown_shell_falls_back() {
		let script = Path::new("/g/.godspeed/start-claude.command");
		let line = |shell: &str, os: &str| argv(script, shell, os).into_iter().map(|a| a.into_string().unwrap()).collect::<Vec<_>>();
		assert_eq!(line("/opt/homebrew/bin/bash", "macos"), ["/opt/homebrew/bin/bash", "-l", "-i", "-c", "exec \"$0\"", "/g/.godspeed/start-claude.command"]);
		assert_eq!(line("/usr/local/bin/fish", "macos")[0], "/bin/zsh", "fish ends in sh but is not one");
		assert_eq!(line("/usr/bin/nu", "linux")[0], "/bin/bash");
		assert_eq!(line("/bin/dash", "linux")[0], "/bin/dash");
		assert_eq!(line("", "linux")[0], "/bin/bash");
		let windows = Path::new(r"C:\Users\R&D (x)\godspeed").join(".godspeed").join("start-codex.cmd");
		assert_eq!(argv(&windows, r"C:\Windows\system32\cmd.exe", "windows"), [r"C:\Windows\system32\cmd.exe", "/d", "/c", r".godspeed\start-codex.cmd"].map(OsString::from), "the folder, with its & and ( ), is the working directory");
	}

	#[test]
	fn the_agent_gets_the_apps_environment_without_the_apps_own_variables() {
		let base = [("PATH", "/usr/bin"), ("LH_DATA_DIR", "/secret"), ("TAURI_ENV_DEBUG", "1"), ("GODSPEED_TERMINAL", "old"), ("APPIMAGE", "/x.AppImage"), ("LANG", "de_DE.UTF-8"), ("HOME", "/h")];
		let base = || base.iter().map(|(k, v)| (OsString::from(k), OsString::from(v)));
		let env = |os: &str| environment(base(), "ab".repeat(16).as_str(), Path::new("/data"), os).into_iter().map(|(k, v)| (k.into_string().unwrap(), v.into_string().unwrap())).collect::<Vec<_>>();
		let linux = env("linux");
		let get = |key: &str| linux.iter().filter(|(k, _)| k == key).map(|(_, v)| v.as_str()).collect::<Vec<_>>();
		assert_eq!(get("PATH"), ["/usr/bin"]);
		assert_eq!(get("LANG"), ["de_DE.UTF-8"], "the learner's language stays");
		assert_eq!((get("TERM"), get("COLORTERM")), (vec!["xterm-256color"], vec!["truecolor"]));
		assert_eq!(get("GODSPEED_TERMINAL"), ["ab".repeat(16)]);
		assert_eq!(get("GODSPEED_DATA_DIR"), ["/data"]);
		for gone in ["LH_DATA_DIR", "TAURI_ENV_DEBUG", "APPIMAGE"] {
			assert!(get(gone).is_empty(), "{gone}");
		}
		assert!(env("macos").iter().any(|(k, _)| k == "APPIMAGE"), "only Linux runs from an AppImage");
	}
}
