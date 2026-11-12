//! Opening things for the learner: a file in the file manager, a folder or PDF in its default
//! app, and a terminal running one of the godspeed folder's start scripts. Nothing here can
//! launch a program the page names.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const NOT_SET_UP: &str = "The godspeed folder isn't set up yet.";
const NO_TERMINAL: &str = "Couldn't open a terminal. Copy the command and run it in yours.";

/// macOS treats these folders as packages: opening one launches or installs it.
const BUNDLE_EXTENSIONS: [&str; 14] = ["app", "appex", "bundle", "framework", "kext", "mdimporter", "mpkg", "pkg", "plugin", "prefpane", "qlgenerator", "saver", "workflow", "xpc"];

fn is_app_bundle(folder: &Path) -> bool {
	let Some(name) = folder.file_name().map(|name| name.to_string_lossy().to_lowercase()) else { return false };
	name.rsplit_once('.').is_some_and(|(_, extension)| BUNDLE_EXTENSIONS.contains(&extension))
}

/// Shows an absolute path selected in the file manager; a relative path, or one that is not there
/// (moved or deleted since the page listed it), does nothing.
pub fn show_in_folder(target: &str) -> Result<(), String> {
	if !Path::new(target).is_absolute() || std::fs::metadata(target).is_err() {
		return Ok(());
	}
	tauri_plugin_opener::reveal_item_in_dir(target).map_err(|err| err.to_string())
}

/// Opens a folder, or a PDF, in its default app. Links are resolved before any check, an app
/// bundle is a folder too and is only shown, and any other file does nothing.
pub fn open_path(target: &str) -> Result<(), String> {
	if !Path::new(target).is_absolute() {
		return Ok(());
	}
	let Ok(real) = std::fs::canonicalize(target) else { return Ok(()) };
	if real.is_dir() && is_app_bundle(&real) {
		tauri_plugin_opener::reveal_item_in_dir(&real).map_err(|err| err.to_string())
	} else if real.is_dir() || (real.is_file() && real.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))) {
		tauri_plugin_opener::open_path(without_verbatim_prefix(&real), None::<&str>).map_err(|err| err.to_string())
	} else {
		Ok(())
	}
}

/// Windows canonicalizes to `\\?\C:\…`, which Explorer's open call may not take; drive paths
/// lose the prefix, network paths keep it.
fn without_verbatim_prefix(path: &Path) -> PathBuf {
	let text = path.to_string_lossy();
	match text.strip_prefix(r"\\?\") {
		Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
		_ => path.to_owned(),
	}
}

/// The start script for this agent in this folder, or None when the request isn't one.
/// "claude-backup" starts the backup teacher.
fn start_script(folder: &str, agent: &str, os: &str) -> Option<PathBuf> {
	let folder = Path::new(folder);
	if !folder.is_absolute() || !matches!(agent, "claude" | "claude-backup" | "codex") {
		return None;
	}
	let extension = match os {
		"macos" => "command",
		"windows" => "cmd",
		_ => "sh",
	};
	let script = folder.join(".godspeed").join(format!("start-{agent}.{extension}"));
	script.metadata().is_ok_and(|meta| meta.is_file()).then_some(script)
}

/// The terminals to try, in order: Terminal on a Mac, a new console on Windows, the usual Linux
/// ones, including GNOME's newer Ptyxis and Console. Each is a program and its arguments.
fn terminal_candidates(script: &Path, os: &str) -> Vec<(&'static str, Vec<String>)> {
	let script = script.to_string_lossy().into_owned();
	let with = |before: &[&str], last: &str| before.iter().map(|arg| (*arg).to_owned()).chain([last.to_owned()]).collect::<Vec<_>>();
	match os {
		"macos" => vec![("open", with(&["-a", "Terminal"], &script))],
		"windows" => vec![("cmd.exe", with(&["/c", "start", "\"\"", "cmd.exe", "/k"], &format!("\"{script}\"")))],
		_ => vec![
			("x-terminal-emulator", with(&["-e"], &script)),
			("gnome-terminal", with(&["--"], &script)),
			("konsole", with(&["-e"], &script)),
			("ptyxis", with(&["--"], &script)),
			("kgx", with(&["--"], &script)),
			("xterm", with(&["-e"], &script)),
		],
	}
}

/// Starts the program apart from this app, with no input or output. True when it started.
fn spawn_detached(program: &str, args: &[String]) -> bool {
	let mut command = Command::new(program);
	command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		const DETACHED_PROCESS: u32 = 0x8;
		const CREATE_NEW_PROCESS_GROUP: u32 = 0x200;
		// cmd.exe reads its own quoting, so the arguments go through as one string.
		command.raw_arg(args.join(" ")).creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
	}
	#[cfg(not(windows))]
	{
		use std::os::unix::process::CommandExt;
		command.args(args).process_group(0);
	}
	let Ok(mut child) = command.spawn() else { return false };
	// A started terminal keeps running; this only collects the launcher's exit.
	std::thread::spawn(move || {
		let _ = child.wait();
	});
	true
}

/// Opens a terminal running the godspeed folder's start script for "claude", "claude-backup" or
/// "codex": None once one opened, else a message saying why not.
pub fn open_agent(folder: &str, agent: &str) -> Option<String> {
	let os = std::env::consts::OS;
	let Some(script) = start_script(folder, agent, os) else { return Some(NOT_SET_UP.to_owned()) };
	if terminal_candidates(&script, os).iter().any(|(program, args)| spawn_detached(program, args)) { None } else { Some(NO_TERMINAL.to_owned()) }
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn macos_bundle_folders_are_told_apart_from_plain_folders() {
		for folder in ["/Applications/Utilities/Terminal.app", "/Users/me/Downloads/Installer.APP", "/Library/PreferencePanes/X.prefPane", "/x/Y.bundle", "/Users/me/Downloads/Setup.pkg", "/x/Z.xpc"] {
			assert!(is_app_bundle(Path::new(folder)), "{folder}");
		}
		for folder in ["/Users/me/CSE 21", "/Users/me/notes.app.d", "/Users/me/app", "/Users/me/Foo.app/Contents"] {
			assert!(!is_app_bundle(Path::new(folder)), "{folder}");
		}
	}

	#[test]
	fn a_drive_path_loses_the_verbatim_prefix_and_a_network_path_keeps_it() {
		assert_eq!(without_verbatim_prefix(Path::new(r"\\?\C:\Users\me\CSE 21")), PathBuf::from(r"C:\Users\me\CSE 21"));
		assert_eq!(without_verbatim_prefix(Path::new(r"\\?\UNC\host\share")), PathBuf::from(r"\\?\UNC\host\share"));
		assert_eq!(without_verbatim_prefix(Path::new("/Users/me")), PathBuf::from("/Users/me"));
	}

	fn temp(name: &str) -> PathBuf {
		let dir = std::env::temp_dir().join(format!("gs-shell-open-{name}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(dir.join(".godspeed")).unwrap();
		dir
	}

	#[test]
	fn only_the_folders_own_start_scripts_run() {
		let dir = temp("scripts");
		gs_base::fsx::write_text_atomic(&dir.join(".godspeed/start-claude.sh"), "#!/bin/sh\n").unwrap();
		let folder = dir.to_str().unwrap();
		assert_eq!(start_script(folder, "claude", "linux"), Some(dir.join(".godspeed/start-claude.sh")));
		assert_eq!(start_script(folder, "rm -rf", "linux"), None);
		assert_eq!(start_script(folder, "codex", "linux"), None);
		assert_eq!(start_script(folder, "claude-backup", "linux"), None);
		gs_base::fsx::write_text_atomic(&dir.join(".godspeed/start-claude-backup.sh"), "#!/bin/sh\n").unwrap();
		assert_eq!(start_script(folder, "claude-backup", "linux"), Some(dir.join(".godspeed/start-claude-backup.sh")));
		assert_eq!(start_script(folder, "claude-other", "linux"), None);
		assert_eq!(start_script("relative", "claude", "linux"), None);
		assert_eq!(start_script(dir.join("nowhere").to_str().unwrap(), "claude", "linux"), None);
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn each_os_names_its_script_extension() {
		let dir = temp("extensions");
		for (os, file) in [("macos", "start-codex.command"), ("windows", "start-codex.cmd"), ("linux", "start-codex.sh")] {
			gs_base::fsx::write_text_atomic(&dir.join(".godspeed").join(file), "").unwrap();
			assert_eq!(start_script(dir.to_str().unwrap(), "codex", os), Some(dir.join(".godspeed").join(file)), "{os}");
		}
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn opens_terminal_on_a_mac_and_a_new_console_on_windows() {
		assert_eq!(terminal_candidates(Path::new("/a/b.command"), "macos"), vec![("open", ["-a", "Terminal", "/a/b.command"].map(str::to_owned).to_vec())]);
		assert_eq!(
			terminal_candidates(Path::new("C:\\a b\\s.cmd"), "windows"),
			vec![("cmd.exe", ["/c", "start", "\"\"", "cmd.exe", "/k", "\"C:\\a b\\s.cmd\""].map(str::to_owned).to_vec())]
		);
		let linux: Vec<_> = terminal_candidates(Path::new("/a/b.sh"), "linux").into_iter().map(|(program, _)| program).collect();
		assert_eq!(linux, ["x-terminal-emulator", "gnome-terminal", "konsole", "ptyxis", "kgx", "xterm"]);
	}

	#[test]
	fn an_agent_with_no_start_script_says_the_folder_is_not_set_up() {
		let dir = temp("not-set-up");
		assert_eq!(open_agent(dir.to_str().unwrap(), "claude"), Some(NOT_SET_UP.to_owned()));
		assert_eq!(open_agent("relative", "claude"), Some(NOT_SET_UP.to_owned()));
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn a_path_that_is_not_absolute_or_not_there_does_nothing() {
		assert_eq!(open_path("relative/dir"), Ok(()));
		assert_eq!(open_path("/gs-shell-open-nowhere"), Ok(()));
		assert_eq!(show_in_folder("relative/file"), Ok(()));
		assert_eq!(show_in_folder("/gs-shell-open-nowhere/gone.pdf"), Ok(()));
	}

	#[test]
	fn a_file_that_is_not_a_pdf_does_nothing() {
		let dir = temp("files");
		gs_base::fsx::write_text_atomic(&dir.join("notes.txt"), "x").unwrap();
		assert_eq!(open_path(dir.join("notes.txt").to_str().unwrap()), Ok(()));
		std::fs::remove_dir_all(dir).unwrap();
	}
}
