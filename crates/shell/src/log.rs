//! `<userData>/logs/main.log`: the shell's lines and the server's stderr, each also written to
//! the shell's stderr. A launch that finds the file over 5 MiB starts a new one.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

const ROTATE_BYTES: u64 = 5 * 1024 * 1024;

static FILE: OnceLock<Mutex<File>> = OnceLock::new();

/// Opens the log in `dir`. Lines before this go to stderr only.
pub fn open(dir: &Path) {
	let file = dir.join("main.log");
	let opened = std::fs::create_dir_all(dir).and_then(|()| {
		if std::fs::metadata(&file).is_ok_and(|m| m.len() > ROTATE_BYTES) {
			std::fs::rename(&file, dir.join("main.old.log"))?;
		}
		OpenOptions::new().create(true).append(true).open(&file)
	});
	match opened {
		Ok(f) => {
			let _ = FILE.set(Mutex::new(f));
		}
		Err(err) => line(&format!("cannot open {}: {err}", file.display())),
	}
}

/// `[<ISO time>] <text>`. Logging never fails the caller.
pub fn line(text: &str) {
	let entry = format!("[{}] {text}\n", gs_base::time::iso_now());
	let _ = std::io::stderr().write_all(entry.as_bytes());
	if let Some(file) = FILE.get() {
		let mut file = file.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
		let _ = file.write_all(entry.as_bytes());
	}
}

/// A panic is logged with its backtrace before the default hook runs, so it can be found after
/// the window is gone.
pub fn catch_panics() {
	let default = std::panic::take_hook();
	std::panic::set_hook(Box::new(move |info| {
		line(&format!("uncaught: {info}\n{}", std::backtrace::Backtrace::force_capture()));
		default(info);
	}));
}
