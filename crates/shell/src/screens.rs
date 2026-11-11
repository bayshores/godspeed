//! The screenshot lab's control channel. The lab appends one command per line to the file named
//! by `LH_SCREENS_CTL`, and the shell answers each with one line appended to `LH_SCREENS_OUT`,
//! in order:
//!
//! | command | answer |
//! |---|---|
//! | `nav <url>` | `ok` once the window is told to go there |
//! | `eval <js>` | the script's value as JSON |
//! | `size <w> <h>` | `ok`, the window's inner size in points |
//! | `snap <file>` | `ok` once the page is written as a PNG (two pixels a point, no title bar) |
//! | `shot <file>` | `ok` once the whole window is written as the screen shows it |
//! | `quit` | `ok`, then the app exits |
//!
//! A command that fails answers `error: <why>`. `LH_SCREENS_INIT` names a script that runs in the
//! page before any of its own, for what the lab must set up before the app starts.

use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::time::Duration;

use tauri::{AppHandle, LogicalSize, Manager, Url, WebviewWindow};

use crate::log;

#[cfg(not(debug_assertions))]
compile_error!("the `screens` feature is for debug builds only");

const POLL: Duration = Duration::from_millis(10);
const EVAL_LIMIT: Duration = Duration::from_secs(30);

/// The script `LH_SCREENS_INIT` names, to run in the main window before the page's own.
pub fn init_script() -> Option<String> {
	let path = std::env::var_os("LH_SCREENS_INIT")?;
	std::fs::read_to_string(&path).inspect_err(|err| log::line(&format!("cannot read {}: {err}", Path::new(&path).display()))).ok()
}

/// Starts answering the lab, when it set both files.
pub fn start(app: &AppHandle) {
	let (Some(ctl), Some(out)) = (std::env::var_os("LH_SCREENS_CTL"), std::env::var_os("LH_SCREENS_OUT")) else { return };
	let app = app.clone();
	std::thread::spawn(move || run(&app, &PathBuf::from(ctl), &PathBuf::from(out)));
}

fn run(app: &AppHandle, ctl: &Path, out: &Path) {
	let (mut offset, mut pending) = (0, String::new());
	loop {
		std::thread::sleep(POLL);
		let Ok(mut file) = std::fs::File::open(ctl) else { continue };
		let mut text = String::new();
		if file.seek(SeekFrom::Start(offset)).and_then(|_| file.read_to_string(&mut text)).is_err() {
			continue;
		}
		offset += text.len() as u64;
		pending.push_str(&text);
		while let Some(end) = pending.find('\n') {
			let line: String = pending.drain(..=end).collect();
			let answer = command(app, line.trim_end()).unwrap_or_else(|err| format!("error: {err}"));
			if let Err(err) = OpenOptions::new().create(true).append(true).open(out).and_then(|mut out| writeln!(out, "{answer}")) {
				log::line(&format!("cannot answer the lab: {err}"));
			}
			if line.trim_end() == "quit" {
				app.exit(0);
				return;
			}
		}
	}
}

fn command(app: &AppHandle, line: &str) -> Result<String, String> {
	let main = app.get_webview_window("main").ok_or("no window")?;
	let (name, arg) = line.split_once(' ').unwrap_or((line, ""));
	match name {
		"nav" => main.navigate(Url::parse(arg).map_err(|err| err.to_string())?).map_err(|err| err.to_string()).map(|()| ok()),
		"eval" => eval(&main, arg),
		"size" => {
			let (width, height) = arg.split_once(' ').and_then(|(w, h)| Some((w.parse::<f64>().ok()?, h.parse::<f64>().ok()?))).ok_or("size takes a width and a height")?;
			main.set_size(LogicalSize::new(width, height)).map_err(|err| err.to_string()).map(|()| ok())
		}
		"snap" => snap(&main, arg).map(|()| ok()),
		"shot" => shot(&main, arg).map(|()| ok()),
		"quit" => Ok(ok()),
		other => Err(format!("unknown command {other}")),
	}
}

fn ok() -> String {
	"ok".to_owned()
}

fn eval(main: &WebviewWindow, js: &str) -> Result<String, String> {
	let (tx, rx) = mpsc::channel();
	main.eval_with_callback(js, move |value| {
		let _ = tx.send(value);
	})
	.map_err(|err| err.to_string())?;
	rx.recv_timeout(EVAL_LIMIT).map_err(|_| "the script did not answer".to_owned())
}

#[cfg(target_os = "macos")]
fn snap(main: &WebviewWindow, file: &str) -> Result<(), String> {
	crate::mac::screens::snapshot(main, PathBuf::from(file))
}

#[cfg(not(target_os = "macos"))]
fn snap(_: &WebviewWindow, _: &str) -> Result<(), String> {
	Err("snap needs WKWebView".to_owned())
}

#[cfg(target_os = "macos")]
fn shot(main: &WebviewWindow, file: &str) -> Result<(), String> {
	let id = crate::mac::screens::window_number(main)?;
	let status = Command::new("screencapture").args(["-x", "-o", "-l", &id.to_string(), file]).status().map_err(|err| err.to_string())?;
	if status.success() { Ok(()) } else { Err(format!("screencapture failed ({status})")) }
}

#[cfg(not(target_os = "macos"))]
fn shot(_: &WebviewWindow, _: &str) -> Result<(), String> {
	Err("shot needs screencapture".to_owned())
}
