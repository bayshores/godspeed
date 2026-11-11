//! The Electron godspeed and this shell share userData, and neither's single-instance lock sees
//! the other. Electron's own lock files tell whether it runs; `shell.pid` tells the last
//! Electron release that this shell runs.

use std::io;
use std::path::Path;

pub const STILL_OPEN: &str = "The old godspeed is still open. Quit it, then open godspeed again.";

const PID_FILE: &str = "shell.pid";

/// Whether an Electron godspeed runs on this userData.
#[cfg(unix)]
pub fn electron_running(user_data: &Path) -> bool {
	// A symlink to the socket Chromium's ProcessSingleton listens on: connecting is how Chromium
	// finds a running copy, and closing without a message makes it do nothing.
	std::os::unix::net::UnixStream::connect(user_data.join("SingletonSocket")).is_ok()
}

/// Whether an Electron godspeed runs on this userData.
#[cfg(windows)]
pub fn electron_running(user_data: &Path) -> bool {
	const SHARING_VIOLATION: i32 = 32;
	let lockfile = user_data.join("lockfile");
	// Chromium holds it open without write sharing while it runs, and deletes it on close.
	lockfile.exists() && std::fs::OpenOptions::new().write(true).open(&lockfile).is_err_and(|err| err.raw_os_error() == Some(SHARING_VIOLATION))
}

pub fn write_pid(user_data: &Path) -> io::Result<()> {
	std::fs::create_dir_all(user_data)?;
	gs_base::fsx::write_text_atomic(&user_data.join(PID_FILE), &format!("{}\n", std::process::id()))
}

pub fn remove_pid(user_data: &Path) {
	let _ = std::fs::remove_file(user_data.join(PID_FILE));
}

#[cfg(test)]
mod tests {
	use super::*;

	fn temp(name: &str) -> std::path::PathBuf {
		let dir = std::env::temp_dir().join(format!("gs-shell-old-app-{name}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		dir
	}

	#[test]
	#[cfg(unix)]
	fn a_listening_singleton_socket_means_running() {
		let dir = temp("listening");
		let socket = dir.join("socket");
		let _listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
		std::os::unix::fs::symlink(&socket, dir.join("SingletonSocket")).unwrap();
		assert!(electron_running(&dir));
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	#[cfg(unix)]
	fn a_dangling_singleton_socket_or_none_means_not_running() {
		let dir = temp("dangling");
		assert!(!electron_running(&dir));
		std::os::unix::fs::symlink(dir.join("gone"), dir.join("SingletonSocket")).unwrap();
		assert!(!electron_running(&dir));
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	#[cfg(windows)]
	fn a_lockfile_held_without_write_sharing_means_running() {
		use std::os::windows::fs::OpenOptionsExt;
		let dir = temp("lockfile");
		assert!(!electron_running(&dir));
		let held = std::fs::OpenOptions::new().write(true).create(true).share_mode(0).open(dir.join("lockfile")).unwrap();
		assert!(electron_running(&dir));
		drop(held);
		assert!(!electron_running(&dir));
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn the_pid_file_holds_this_process() {
		let dir = temp("pid").join("userData");
		write_pid(&dir).unwrap();
		assert_eq!(std::fs::read_to_string(dir.join("shell.pid")).unwrap(), format!("{}\n", std::process::id()));
		remove_pid(&dir);
		assert!(!dir.join("shell.pid").exists());
		std::fs::remove_dir_all(dir.parent().unwrap()).unwrap();
	}
}
