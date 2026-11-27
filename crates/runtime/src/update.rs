//! Updating the learner's agent from the setup card, the way it was installed: Claude Code updates
//! itself; Codex through npm or Homebrew, whichever folder it sits in. The update runs as a
//! terminal would run its command, each line it prints is told as it comes, and it has done its
//! job only once the agent says it is new enough.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use gs_base::{clock, tasks};
use gs_core::spaces::agent_folder::FolderAgent;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::{mpsc, oneshot};

use crate::health::{at_least, floor, found_version};
use crate::process::{AgentEnv, AgentProcess, Launch, printed};
use crate::session::Runtime;

const CLAUDE_UPDATE: &str = "claude update";
const CODEX_NPM: &str = "npm install -g @openai/codex@latest";
const CODEX_BREW: &str = "brew upgrade codex";
/// How long the update may take; Homebrew first updates itself, which can be slow.
const UPDATE_MS: i64 = 10 * 60_000;
/// How long npm or Homebrew may take to say where its folder is, and the agent its version.
const ASK_MS: i64 = 15_000;

/// What an update refused answers while the learner starts the agent with their own command,
/// which godspeed asks nothing of.
const OWN_COMMAND: &str = "godspeed starts this agent with your own command, so it doesn't update it.";

pub enum Update {
	/// `command` runs and `lines` gives each line it prints, closing when it stops printing;
	/// `ended` is Ok once the agent is new enough, else the last line it printed or why it stopped.
	Running { command: &'static str, lines: mpsc::UnboundedReceiver<String>, ended: oneshot::Receiver<Result<(), String>> },
	/// godspeed can't tell how the agent was installed, so the learner runs `command` themselves.
	Unknown { command: &'static str },
}

impl Runtime {
	pub async fn update(&self) -> Result<Update, String> {
		if self.own_command().is_some() {
			return Err(OWN_COMMAND.to_owned());
		}
		let env = self.env().ok_or("the stand-in agent has no update")?;
		let agent = self.agent();
		let program = env.find_agent(agent).await?;
		let command = match agent {
			FolderAgent::Claude => CLAUDE_UPDATE,
			FolderAgent::Codex => match codex_way(env, &program).await {
				Some(command) => command,
				None => return Ok(Update::Unknown { command: CODEX_NPM }),
			},
		};
		let agent_launch = env.launch(program).await?;
		// A Codex app-server kept for the next session runs the old program, and on Windows
		// keeps its file from being replaced.
		self.forget_connection().await;
		let vars = env.vars().await.to_vec();
		let (process, stdout, stderr) = AgentProcess::start_reading(&Launch::shell(command), &vars)?;
		let (done, ended) = oneshot::channel();
		let (told, lines) = mpsc::unbounded_channel();
		let ran = async move { tokio::join!(read_lines(stdout, &told), read_lines(stderr, &told)) };
		let checked = async move { new_enough(agent.name(), &agent_launch, &vars, floor(agent)).await };
		tasks::detach("agent update", watch(process, ran, checked, done));
		Ok(Update::Running { command, lines, ended })
	}
}

/// The command that updates Codex the way it was installed: npm's when it sits in npm's global
/// folder, Homebrew's when in Homebrew's; None when godspeed can't tell.
async fn codex_way(env: &AgentEnv, codex: &Path) -> Option<&'static str> {
	let codex = std::fs::canonicalize(codex).ok()?;
	let vars = env.vars().await;
	if folder("npm root -g", vars).await.is_some_and(|root| codex.starts_with(root)) {
		return Some(CODEX_NPM);
	}
	if !cfg!(windows)
		&& let Some(prefix) = folder("brew --prefix", vars).await
		&& ["Cellar", "Caskroom"].iter().any(|dir| codex.starts_with(prefix.join(dir)))
	{
		return Some(CODEX_BREW);
	}
	None
}

/// The folder a command prints, as a real path; None when it can't run or prints none.
async fn folder(line: &str, vars: &[(OsString, OsString)]) -> Option<PathBuf> {
	let out = printed(&Launch::shell(line), &[], vars, ASK_MS).await.ok()?;
	let out = out.trim();
	(!out.is_empty()).then(|| std::fs::canonicalize(out).ok()).flatten()
}

/// Ok when the agent now says a version at least `floor`; else what it says.
async fn new_enough(name: &str, launch: &Launch, vars: &[(OsString, OsString)], floor: &str) -> Result<(), String> {
	let found = found_version(launch, vars, ASK_MS, name).await?;
	if at_least(&found, floor) { Ok(()) } else { Err(format!("{name} is still {found}")) }
}

/// Waits for the update to end, or the 10 minutes to pass, then ends it if it still runs (by its
/// own process group or job) and says how it ended. `ran` gives the last line of its output and
/// of its error output; a failure shows the error's, which names what went wrong.
async fn watch(mut process: AgentProcess, ran: impl Future<Output = (Option<String>, Option<String>)>, checked: impl Future<Output = Result<(), String>>, done: oneshot::Sender<Result<(), String>>) {
	let finished = clock::within(UPDATE_MS, async { tokio::join!(ran, process.status()) }).await;
	drop(process);
	let result = match finished {
		None => Err(format!("the update didn't finish within {} minutes", UPDATE_MS / 60_000)),
		Some(((out, err), status)) => {
			let last = err.or(out);
			match status {
				Ok(status) if status.success() => checked.await.map_err(|why| last.unwrap_or(why)),
				Ok(status) => Err(last.unwrap_or_else(|| format!("the update ended with {status}"))),
				Err(err) => Err(err),
			}
		}
	};
	// Whoever started it may have stopped waiting.
	let _ = done.send(result);
}

/// Tells each line a program prints, and gives the last. A progress line redrawn with carriage
/// returns counts as what it last shows.
async fn read_lines(out: impl AsyncRead + Unpin, told: &mpsc::UnboundedSender<String>) -> Option<String> {
	let mut lines = BufReader::new(out).lines();
	let mut last = None;
	while let Ok(Some(line)) = lines.next_line().await {
		let Some(line) = line.split('\r').map(str::trim).rfind(|part| !part.is_empty()) else { continue };
		// Whoever started it may have stopped listening.
		let _ = told.send(line.to_owned());
		last = Some(line.to_owned());
	}
	last
}

#[cfg(all(test, unix))]
mod tests;
