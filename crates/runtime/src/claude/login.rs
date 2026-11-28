//! Claude Code's own sign-in, `claude auth login --claudeai`, as a child with no terminal. It
//! opens the browser itself and prints the sign-in link, then waits: for the browser to hand the
//! sign-in back, or for the code the sign-in page shows, which the learner pastes into godspeed
//! and godspeed writes to its input. It ends with 0 once signed in.

use std::ffi::OsString;

use gs_base::{clock, tasks};
use gs_core::spaces::agent_folder::FolderAgent;
use parking_lot::Mutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::{Mutex as AsyncMutex, oneshot};

use crate::process::{AgentEnv, AgentProcess};

const LABEL: &str = "claude auth login";
/// How long the link may take to be printed.
const LINK_MS: i64 = 15_000;
/// How long the learner has to finish signing in.
const LOGIN_MS: i64 = 5 * 60_000;

/// A running `claude auth login`.
pub(crate) struct ClaudeLogin {
	stdin: AsyncMutex<ChildStdin>,
	/// Sending, or dropping it with the login, ends the child.
	cancel: Mutex<Option<oneshot::Sender<()>>>,
}

type Ended = oneshot::Receiver<Result<(), String>>;

impl ClaudeLogin {
	/// Starts the learner's own `claude`, found as lessons find it, and waits for its link.
	pub async fn start(env: &AgentEnv) -> Result<(ClaudeLogin, String, Ended), String> {
		let claude = env.find_agent(FolderAgent::Claude).await?;
		let mut launch = env.launch(claude).await?;
		launch.args.extend(["auth", "login", "--claudeai"].map(OsString::from));
		let (process, stdin, stdout) = AgentProcess::start(LABEL, &launch, env.vars().await)?;
		let (link, linked) = oneshot::channel();
		let (cancel, cancelled) = oneshot::channel();
		let (done, mut ended) = oneshot::channel();
		tasks::detach(LABEL, watch(process, stdout, link, cancelled, done));
		let login = ClaudeLogin { stdin: AsyncMutex::new(stdin), cancel: Mutex::new(Some(cancel)) };
		match clock::within(LINK_MS, linked).await {
			Some(Ok(url)) => Ok((login, url, ended)),
			// It ended without one.
			Some(Err(_)) => Err(match (&mut ended).await {
				Ok(Err(why)) => why,
				_ => format!("{LABEL} printed no sign-in link"),
			}),
			// Dropping `login` ends the child.
			None => Err(format!("{LABEL} printed no sign-in link within {} seconds", LINK_MS / 1000)),
		}
	}

	/// Writes the code the sign-in page showed to the child's input.
	pub async fn send_code(&self, code: &str) -> Result<(), String> {
		let code = code.trim();
		if code.is_empty() || code.contains(['\n', '\r']) {
			return Err("The code is one line of text.".to_owned());
		}
		let mut input = self.stdin.lock().await;
		let wrote = async {
			input.write_all(format!("{code}\n").as_bytes()).await?;
			input.flush().await
		};
		wrote.await.map_err(|err| format!("the sign-in has ended: {err}"))
	}

	pub fn cancel(&self) {
		if let Some(cancel) = self.cancel.lock().take() {
			let _ = cancel.send(());
		}
	}
}

/// Waits for the child to end, a cancel, or the 5 minutes to pass, then ends it if it still runs
/// (by its own process group or job) and says how the sign-in ended.
async fn watch(mut process: AgentProcess, stdout: ChildStdout, link: oneshot::Sender<String>, cancelled: oneshot::Receiver<()>, done: oneshot::Sender<Result<(), String>>) {
	let result = {
		let finishing = async { tokio::join!(read_link(stdout, link), process.status()).1 };
		tokio::select! {
			_ = cancelled => Err("the sign-in was cancelled".to_owned()),
			status = clock::within(LOGIN_MS, finishing) => match status {
				None => Err(format!("the sign-in didn't finish within {} minutes", LOGIN_MS / 60_000)),
				Some(Ok(status)) if status.success() => Ok(()),
				Some(Ok(status)) => Err(format!("{LABEL} ended with {status}")),
				Some(Err(err)) => Err(err),
			},
		}
	};
	drop(process);
	// Whoever started it may have stopped waiting.
	let _ = done.send(result);
}

/// Reads what the child prints until it closes its output, and sends the sign-in link once its
/// line is whole. The prompt for a code that follows has no line end.
async fn read_link(mut stdout: ChildStdout, link: oneshot::Sender<String>) {
	let mut link = Some(link);
	let mut printed = Vec::new();
	let mut chunk = [0u8; 4096];
	while let Ok(read @ 1..) = stdout.read(&mut chunk).await {
		if link.is_none() {
			continue;
		}
		printed.extend_from_slice(&chunk[..read]);
		if let Some(url) = sign_in_link(&String::from_utf8_lossy(&printed)) {
			let _ = link.take().map(|link| link.send(url.to_owned()));
		}
	}
}

/// The sign-in link in what `claude auth login` printed, once its line is whole. A terminal
/// hyperlink around it ends at its control character.
fn sign_in_link(printed: &str) -> Option<&str> {
	let start = printed.find("https://")?;
	let rest = &printed[start..];
	let end = rest.find(|c: char| c.is_whitespace() || c.is_control())?;
	Some(&rest[..end])
}

#[cfg(test)]
mod tests;
