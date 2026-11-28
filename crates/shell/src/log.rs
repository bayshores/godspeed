//! `<userData>/logs/main.log`: the shell's lines and the server's stderr, each also written to
//! the shell's stderr. A launch that finds the file over 5 MiB starts a new one.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use gs_base::locks::lock;

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
		let mut file = lock(file);
		let _ = file.write_all(entry.as_bytes());
	}
}

/// A panic is logged with its backtrace before the default hook runs, so it can be found after
/// the window is gone. Release builds carry no symbols, so the backtrace keeps raw addresses and
/// the load address; `docs/desktop-release.md` says how to turn them back into names.
pub fn catch_panics() {
	let default = std::panic::take_hook();
	std::panic::set_hook(Box::new(move |info| {
		let trace = std::backtrace::Backtrace::force_capture();
		line(&format!("uncaught: {info}\nload address {:#x}\n{trace:#}", load_address()));
		default(info);
	}));
}

/// Where this program's image starts in memory, from the symbol each linker defines for it.
#[expect(unsafe_code, reason = "the address of a symbol the linker defines can only be named in an extern block")]
fn load_address() -> usize {
	unsafe extern "C" {
		#[cfg(target_os = "macos")]
		#[link_name = "_mh_execute_header"]
		static IMAGE_START: u8;
		#[cfg(target_os = "linux")]
		#[link_name = "__executable_start"]
		static IMAGE_START: u8;
		#[cfg(windows)]
		#[link_name = "__ImageBase"]
		static IMAGE_START: u8;
	}
	// Only the symbol's address is taken; it is never read.
	(&raw const IMAGE_START) as usize
}
