//! The screenshot lab's control channel (Mac only: `snap` and `shot` need WKWebView and
//! `screencapture`). The lab appends one command per line to the file named by
//! `LH_SCREENS_CTL`, and the shell answers each with one line appended to `LH_SCREENS_OUT`, in
//! order:
//!
//! | command | answer |
//! |---|---|
//! | `nav <url>` | `ok` once the window is told to go there |
//! | `eval <js>` | the script's value as JSON (`null` for undefined; a promise is not awaited) |
//! | `size <w> <h>` | `ok`, the window's inner size in points |
//! | `snap <file>` | `ok` once the page is written as a PNG (two pixels a point, no title bar) |
//! | `shot <file>` | `ok` once the whole window is written as the screen shows it |
//! | `quit` | `ok`, then the app exits |
//!
//! A command that fails answers `error: <why>`, a script that throws included. `LH_SCREENS_INIT`
//! names a script that runs in the page before any of its own, for what the lab must set up
//! before the app starts.

use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc::{self, RecvTimeoutError};
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

#[cfg_attr(test, derive(Debug, PartialEq))]
enum Request<'a> {
	Nav(&'a str),
	Eval(&'a str),
	Size(f64, f64),
	Snap(&'a str),
	Shot(&'a str),
	Quit,
}

fn parse(line: &str) -> Result<Request<'_>, String> {
	let (name, arg) = line.split_once(' ').unwrap_or((line, ""));
	match name {
		"nav" => Ok(Request::Nav(arg)),
		"eval" => Ok(Request::Eval(arg)),
		"size" => {
			let size = arg.split_once(' ').and_then(|(w, h)| Some((w.parse::<f64>().ok()?, h.parse::<f64>().ok()?)));
			size.map(|(width, height)| Request::Size(width, height)).ok_or_else(|| "size takes a width and a height".to_owned())
		}
		"snap" => Ok(Request::Snap(arg)),
		"shot" => Ok(Request::Shot(arg)),
		"quit" => Ok(Request::Quit),
		other => Err(format!("unknown command {other}")),
	}
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
			let request = parse(line.trim_end());
			let quit = matches!(request, Ok(Request::Quit));
			let answer = request.and_then(|request| answer(app, request)).unwrap_or_else(|err| format!("error: {err}"));
			if let Err(err) = OpenOptions::new().create(true).append(true).open(out).and_then(|mut out| writeln!(out, "{answer}")) {
				log::line(&format!("cannot answer the lab: {err}"));
			}
			if quit {
				app.exit(0);
				return;
			}
		}
	}
}

fn answer(app: &AppHandle, request: Request) -> Result<String, String> {
	let main = app.get_webview_window("main").ok_or("no window")?;
	match request {
		Request::Nav(url) => main.navigate(Url::parse(url).map_err(|err| err.to_string())?).map_err(|err| err.to_string()).map(|()| ok()),
		Request::Eval(js) => eval(&main, js),
		Request::Size(width, height) => main.set_size(LogicalSize::new(width, height)).map_err(|err| err.to_string()).map(|()| ok()),
		Request::Snap(file) => crate::mac::screens::snapshot(&main, PathBuf::from(file)).map(|()| ok()),
		Request::Shot(file) => shot(&main, file).map(|()| ok()),
		Request::Quit => Ok(ok()),
	}
}

fn ok() -> String {
	"ok".to_owned()
}

fn eval(main: &WebviewWindow, js: &str) -> Result<String, String> {
	let (tx, rx) = mpsc::channel();
	main.eval_with_callback(guarded(js), move |value| {
		let _ = tx.send(value);
	})
	.map_err(|err| err.to_string())?;
	// Before the first page commits, wry queues the script and drops the callback unanswered.
	let raw = rx.recv_timeout(EVAL_LIMIT).map_err(|err| match err {
		RecvTimeoutError::Timeout => "the script did not answer".to_owned(),
		RecvTimeoutError::Disconnected => "the page was not ready; the script runs once it loads, unanswered".to_owned(),
	})?;
	unwrap_answer(&raw)
}

/// `js` run as a global script that answers `[true, its value as JSON]` or `[false, the error]`:
/// wry answers an empty string for a throw, and cannot turn every value into JSON.
fn guarded(js: &str) -> String {
	let source = serde_json::Value::String(js.to_owned());
	format!("(() => {{ try {{ return [true, JSON.stringify((0, eval)({source})) ?? \"null\"]; }} catch (err) {{ return [false, String(err)]; }} }})()")
}

fn unwrap_answer(raw: &str) -> Result<String, String> {
	match serde_json::from_str::<(bool, String)>(raw) {
		Ok((true, json)) => Ok(json),
		Ok((false, err)) => Err(err),
		Err(_) => Err(format!("unexpected answer {raw:?}")),
	}
}

fn shot(main: &WebviewWindow, file: &str) -> Result<(), String> {
	let id = crate::mac::screens::window_number(main)?;
	let status = Command::new("screencapture").args(["-x", "-o", "-l", &id.to_string(), file]).status().map_err(|err| err.to_string())?;
	if status.success() { Ok(()) } else { Err(format!("screencapture failed ({status})")) }
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_line_splits_at_its_first_space() {
		assert_eq!(parse("nav http://127.0.0.1:48060/x?a=b"), Ok(Request::Nav("http://127.0.0.1:48060/x?a=b")));
		assert_eq!(parse("eval document.title + ' x'"), Ok(Request::Eval("document.title + ' x'")));
		assert_eq!(parse("snap /lab/a b.png"), Ok(Request::Snap("/lab/a b.png")));
		assert_eq!(parse("shot /lab/a.png"), Ok(Request::Shot("/lab/a.png")));
		assert_eq!(parse("quit"), Ok(Request::Quit));
		assert_eq!(parse("jump"), Err("unknown command jump".to_owned()));
	}

	#[test]
	fn size_takes_two_numbers() {
		assert_eq!(parse("size 1440 900"), Ok(Request::Size(1440.0, 900.0)));
		assert_eq!(parse("size 1440.5 900"), Ok(Request::Size(1440.5, 900.0)));
		for line in ["size", "size 1440", "size wide 900", "size 1440 900 2"] {
			assert_eq!(parse(line), Err("size takes a width and a height".to_owned()), "{line}");
		}
	}

	#[test]
	fn the_guarded_answer_keeps_the_value_or_the_error() {
		assert_eq!(unwrap_answer(r#"[true,"{\"a\":1}"]"#), Ok(r#"{"a":1}"#.to_owned()));
		assert_eq!(unwrap_answer(r#"[true,"null"]"#), Ok("null".to_owned()));
		assert_eq!(unwrap_answer(r#"[false,"ReferenceError: Can't find variable: x"]"#), Err("ReferenceError: Can't find variable: x".to_owned()));
		assert_eq!(unwrap_answer(""), Err("unexpected answer \"\"".to_owned()));
	}

	#[test]
	fn the_guard_passes_the_script_as_a_string() {
		let script = guarded("a\n\"b\"");
		assert!(script.contains(r#"(0, eval)("a\n\"b\"")"#), "{script}");
	}
}
