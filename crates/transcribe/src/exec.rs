//! Running one program like `execFile` with a 16 MB buffer per stream (`run` in transcribe.ts).

use std::ffi::OsString;
use std::path::Path;
use std::process::Stdio;

use gs_base::{fsx, text};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::sync::Notify;

const MAX_BUFFER: usize = 16 * 1024 * 1024;

/// Runs `program` to its end. A failure reads `<name> failed: <last 3 lines of stderr>`, or Node's
/// own wording when stderr is empty. Dropping the future kills the program.
pub(crate) async fn run_program(program: &Path, args: &[OsString]) -> Result<(), String> {
	let name = program.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
	let failed = |detail: String| format!("{name} failed: {detail}");
	let mut child = Command::new(program)
		.args(args)
		.stdin(Stdio::piped())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.kill_on_drop(true)
		.spawn()
		.map_err(|err| failed(spawn_message(program, &err)))?;
	let (stdout, stderr) = (child.stdout.take(), child.stderr.take());
	let overflow = Notify::new();
	let drained = async { tokio::join!(capture(stdout, "stdout", &overflow), capture(stderr, "stderr", &overflow)) };
	tokio::pin!(drained);
	let (out, err) = loop {
		tokio::select! {
			done = &mut drained => break done,
			() = overflow.notified() => { let _ = child.start_kill(); }
		}
	};
	let status = child.wait().await.map_err(|err| failed(err.to_string()))?;
	let stderr_text = text::from_utf8_lossy(&err.bytes);
	let problem = match (out.overflowed.or(err.overflowed), status.success()) {
		(Some(stream), _) => format!("{stream} maxBuffer length exceeded"),
		(None, true) => return Ok(()),
		(None, false) => command_failed(program, args, &stderr_text),
	};
	let lines: Vec<&str> = text::trim(&stderr_text).split('\n').collect();
	let tail = lines[lines.len().saturating_sub(3)..].join(" ");
	Err(failed(if tail.is_empty() { problem } else { tail }))
}

/// Node's `err.message` for a program that did not start.
fn spawn_message(program: &Path, err: &std::io::Error) -> String {
	match fsx::error_code(err) {
		Some(code) => format!("spawn {} {code}", program.display()),
		None => err.to_string(),
	}
}

/// Node's `err.message` for a program that exited badly.
fn command_failed(program: &Path, args: &[OsString], stderr: &str) -> String {
	let mut command = program.display().to_string();
	if !args.is_empty() {
		command.push(' ');
		command.push_str(&args.iter().map(|a| a.to_string_lossy()).collect::<Vec<_>>().join(" "));
	}
	format!("Command failed: {command}\n{stderr}")
}

struct Captured {
	bytes: Vec<u8>,
	/// The stream's name once more than MAX_BUFFER bytes came out of it.
	overflowed: Option<&'static str>,
}

/// Reads a stream to its end, keeping the first MAX_BUFFER bytes; going over wakes `overflow`.
async fn capture(stream: Option<impl AsyncRead + Unpin>, name: &'static str, overflow: &Notify) -> Captured {
	let mut captured = Captured { bytes: Vec::new(), overflowed: None };
	let Some(mut stream) = stream else { return captured };
	let mut chunk = vec![0; 64 * 1024];
	while let Ok(n @ 1..) = stream.read(&mut chunk).await {
		let room = MAX_BUFFER - captured.bytes.len();
		captured.bytes.extend_from_slice(&chunk[..n.min(room)]);
		if n > room && captured.overflowed.is_none() {
			captured.overflowed = Some(name);
			overflow.notify_one();
		}
	}
	captured
}

#[cfg(all(test, unix))]
mod tests {
	use std::path::PathBuf;

	use super::*;
	use crate::test_support::{Scratch, install};

	fn script(scratch: &Scratch, body: &str) -> PathBuf {
		let file = scratch.0.join("tool");
		install(&file, &format!("#!/bin/sh\n{body}\n"));
		file
	}

	async fn run(body: &str, args: &[&str]) -> Result<(), String> {
		let scratch = Scratch::new("exec");
		let args: Vec<OsString> = args.iter().map(OsString::from).collect();
		run_program(&script(&scratch, body), &args).await
	}

	#[tokio::test]
	async fn a_clean_exit_is_ok_whatever_it_prints() {
		assert_eq!(run("echo out; echo err >&2", &[]).await, Ok(()));
	}

	#[tokio::test]
	async fn a_failure_shows_the_last_three_stderr_lines_on_one_line() {
		let err = run("printf 'one\\ntwo\\n three \\nfour\\n\\n' >&2; exit 1", &[]).await.unwrap_err();
		assert_eq!(err, "tool failed: two  three  four");
	}

	#[tokio::test]
	async fn a_failure_without_stderr_uses_the_command_line() {
		let scratch = Scratch::new("exec");
		let program = script(&scratch, "exit 3");
		let err = run_program(&program, &[OsString::from("a b"), OsString::from("c")]).await.unwrap_err();
		assert_eq!(err, format!("tool failed: Command failed: {} a b c\n", program.display()));
		let blank = run("printf '  \\n\\n' >&2; exit 3", &["x"]).await.unwrap_err();
		assert!(blank.ends_with(" x\n  \n\n"), "{blank:?}");
	}

	#[tokio::test]
	async fn a_program_killed_by_a_signal_fails_like_any_other() {
		let err = run("kill -9 $$", &[]).await.unwrap_err();
		assert!(err.starts_with("tool failed: Command failed: "), "{err}");
	}

	#[tokio::test]
	async fn a_program_that_cannot_start_reads_like_nodes_spawn_error() {
		let scratch = Scratch::new("exec");
		let file = scratch.0.join("broken");
		install(&file, "#!/nonexistent/interpreter\n");
		assert_eq!(run_program(&file, &[]).await.unwrap_err(), format!("broken failed: spawn {} ENOENT", file.display()));
	}

	#[tokio::test]
	async fn more_than_16_mb_on_stdout_stops_the_program() {
		let err = run("echo warn >&2; head -c 17000000 /dev/zero", &[]).await.unwrap_err();
		assert_eq!(err, "tool failed: warn");
		let silent = run("head -c 17000000 /dev/zero", &[]).await.unwrap_err();
		assert_eq!(silent, "tool failed: stdout maxBuffer length exceeded");
	}

	#[tokio::test]
	async fn more_than_16_mb_on_stderr_keeps_the_first_16_mb() {
		let err = run("yes abcdefghij | head -c 17000000 >&2", &[]).await.unwrap_err();
		assert_eq!(err, "tool failed: abcdefghij abcdefghij abcde");
	}
}
