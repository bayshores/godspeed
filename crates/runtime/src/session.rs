//! A runtime per agent: it starts the agent's program on first use, again after it stopped, and
//! opens sessions on it. A session takes the learner's input and gives back events.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use gs_core::spaces::agent_folder::FolderAgent;
use gs_json::Json;
use tokio::sync::{Mutex, mpsc};

use crate::claude::agent::{Connection as ClaudeConnection, SessionLink};
use crate::claude::protocol::ClaudeProgram;
use crate::codex::agent::{CodexLogin, Connection as CodexConnection, ThreadLink};
use crate::event::{Part, SessionEvent};
use crate::pipes::Started;
use crate::process::{AgentEnv, AgentProcess, Launch};

/// A godspeed tool as the agent sees it: its input is described by a JSON Schema.
#[derive(Clone, Debug, PartialEq)]
pub struct ToolSpec {
	pub name: String,
	pub description: String,
	pub input_schema: Json,
}

/// What a session opens with.
#[derive(Clone, Debug, PartialEq)]
pub struct SessionSpec {
	/// The folder the agent works in.
	pub cwd: PathBuf,
	/// None is the agent's own default.
	pub model: Option<String>,
	/// godspeed's instructions, added to the agent's own.
	pub instructions: String,
	pub tools: Vec<ToolSpec>,
	/// The agent's own id of a session to go on with (`Session::native_id`).
	pub resume: Option<String>,
	/// Whether the agent keeps the session, so it can be resumed later.
	pub persist: bool,
}

/// `own_command` is the learner's own start command for the agent, if they set one.
enum Start {
	Codex { env: Arc<AgentEnv>, home: PathBuf, own_command: Option<String> },
	Claude { env: Arc<AgentEnv>, helper: PathBuf, own_command: Option<String> },
	/// Pipes made by the caller: tests and the fake agent.
	#[cfg(any(test, feature = "fake"))]
	Pipes(Box<dyn Fn() -> Started + Send + Sync>),
}

#[derive(Clone)]
enum Connection {
	Codex(Arc<CodexConnection>),
	Claude(Arc<ClaudeConnection>),
}

impl Connection {
	fn alive(&self) -> bool {
		match self {
			Connection::Codex(codex) => codex.alive(),
			Connection::Claude(claude) => claude.alive(),
		}
	}
}

pub struct Runtime {
	agent: FolderAgent,
	start: Start,
	/// Held while the agent starts, which waits on its handshake, so two opens never start two.
	connection: Mutex<Option<Connection>>,
}

impl Runtime {
	/// `home` is godspeed's own Codex settings folder, which holds its sign-in and threads; the
	/// learner's own (`~/.codex`) is never read. `own_command` is the learner's own command for
	/// Codex, if they set one; `app-server` follows it.
	pub fn codex(env: Arc<AgentEnv>, home: PathBuf, own_command: Option<String>) -> Runtime {
		Runtime { agent: FolderAgent::Codex, start: Start::Codex { env, home, own_command }, connection: Mutex::new(None) }
	}

	/// `helper` is the bundled `claude-helper.mjs`; `own_command` is the learner's own command
	/// for Claude Code, if they set one.
	pub fn claude(env: Arc<AgentEnv>, helper: PathBuf, own_command: Option<String>) -> Runtime {
		Runtime { agent: FolderAgent::Claude, start: Start::Claude { env, helper, own_command }, connection: Mutex::new(None) }
	}

	#[cfg(any(test, feature = "fake"))]
	pub(crate) fn from_pipes(agent: FolderAgent, start: impl Fn() -> Started + Send + Sync + 'static) -> Runtime {
		Runtime { agent, start: Start::Pipes(Box::new(start)), connection: Mutex::new(None) }
	}

	pub fn agent(&self) -> FolderAgent {
		self.agent
	}

	pub(crate) fn env(&self) -> Option<&AgentEnv> {
		match &self.start {
			Start::Codex { env, .. } | Start::Claude { env, .. } => Some(env),
			#[cfg(any(test, feature = "fake"))]
			Start::Pipes(_) => None,
		}
	}

	pub(crate) fn own_command(&self) -> Option<&str> {
		match &self.start {
			Start::Codex { own_command, .. } | Start::Claude { own_command, .. } => own_command.as_deref(),
			#[cfg(any(test, feature = "fake"))]
			Start::Pipes(_) => None,
		}
	}

	pub(crate) fn codex_home(&self) -> Option<&Path> {
		match &self.start {
			Start::Codex { home, .. } => Some(home),
			_ => None,
		}
	}

	pub(crate) fn claude_helper(&self) -> Option<&PathBuf> {
		match &self.start {
			Start::Claude { helper, .. } => Some(helper),
			_ => None,
		}
	}

	pub async fn open(&self, spec: SessionSpec) -> Result<Session, String> {
		match self.connection().await? {
			Connection::Codex(codex) => codex.open(spec).await,
			Connection::Claude(claude) => claude.open(spec).await,
		}
	}

	async fn codex_connection(&self) -> Result<Arc<CodexConnection>, String> {
		match self.connection().await? {
			Connection::Codex(codex) => Ok(codex),
			Connection::Claude(_) => Err("not Codex".to_owned()),
		}
	}

	/// Codex's `account/read`, for the health check.
	pub(crate) async fn codex_account(&self) -> Result<Json, String> {
		self.codex_connection().await?.account().await
	}

	/// Starts the learner's ChatGPT sign-in to godspeed's Codex; the caller opens its page.
	pub async fn codex_login_start(&self) -> Result<CodexLogin, String> {
		self.codex_connection().await?.login_start().await
	}

	pub async fn codex_login_cancel(&self, login: &str) -> Result<(), String> {
		self.codex_connection().await?.login_cancel(login).await
	}

	/// The running connection, or a new one when there is none or the last one stopped.
	async fn connection(&self) -> Result<Connection, String> {
		let mut held = self.connection.lock().await;
		if let Some(connection) = held.as_ref().filter(|connection| connection.alive()) {
			return Ok(connection.clone());
		}
		let connection = self.connect().await?;
		*held = Some(connection.clone());
		Ok(connection)
	}

	async fn connect(&self) -> Result<Connection, String> {
		match &self.start {
			Start::Codex { env, home, own_command } => {
				let launch = match own_command {
					Some(command) => Launch::own_command(command, "app-server"),
					None => {
						let mut launch = env.launch(env.find("codex").await.ok_or(NO_CODEX)?).await?;
						launch.args.push("app-server".into());
						launch
					}
				};
				std::fs::create_dir_all(home).map_err(|err| format!("cannot make godspeed's Codex folder {}: {err}", home.display()))?;
				let started = spawn("codex app-server", &launch, &codex_vars(env.vars().await, home))?;
				Ok(Connection::Codex(CodexConnection::start(started).await?))
			}
			Start::Claude { env, helper, own_command } => {
				let program = match own_command {
					Some(command) => ClaudeProgram::Command(command.clone()),
					None => ClaudeProgram::Path(env.find("claude").await.ok_or(NO_CLAUDE)?.to_string_lossy().into_owned()),
				};
				if !helper.is_file() {
					return Err(format!("godspeed's Claude helper is missing: {}", helper.display()));
				}
				let node = env.find("node").await.ok_or(NO_NODE)?;
				let started = spawn("claude helper", &Launch { program: node, args: vec![helper.into()] }, env.vars().await)?;
				Ok(Connection::Claude(ClaudeConnection::start(started, program)))
			}
			#[cfg(any(test, feature = "fake"))]
			Start::Pipes(start) => Ok(match self.agent {
				FolderAgent::Codex => Connection::Codex(CodexConnection::start(start()).await?),
				FolderAgent::Claude => Connection::Claude(ClaudeConnection::start(start(), ClaudeProgram::Path("claude".to_owned()))),
			}),
		}
	}
}

const NO_CODEX: &str = "godspeed couldn't find Codex on this computer.";
const NO_CLAUDE: &str = "godspeed couldn't find Claude Code on this computer.";
const NO_NODE: &str = "godspeed couldn't find Node.js on this computer.";

/// Codex's environment: the agent's, with godspeed's own settings folder in place of the learner's.
pub(crate) fn codex_vars(vars: &[(OsString, OsString)], home: &Path) -> Vec<(OsString, OsString)> {
	let mut vars: Vec<_> = vars.iter().filter(|(key, _)| !key.eq_ignore_ascii_case("CODEX_HOME")).cloned().collect();
	vars.push(("CODEX_HOME".into(), home.into()));
	vars
}

fn spawn(label: &'static str, launch: &Launch, vars: &[(OsString, OsString)]) -> Result<Started, String> {
	let (process, stdin, stdout) = AgentProcess::start(label, launch, vars)?;
	Ok(Started { reader: Box::new(stdout), writer: Box::new(stdin), process: Some(process) })
}

pub(crate) enum Link {
	Codex(ThreadLink),
	Claude(SessionLink),
}

/// An open session. Every method takes `&self`, so one task can wait on events while another
/// sends, steers or stops. Dropping it closes it.
pub struct Session {
	native_id: String,
	events: Mutex<mpsc::UnboundedReceiver<SessionEvent>>,
	link: Link,
}

impl Session {
	pub(crate) fn new(native_id: String, events: mpsc::UnboundedReceiver<SessionEvent>, link: Link) -> Session {
		Session { native_id, events: Mutex::new(events), link }
	}

	/// The agent's own id for the session (Claude Code's session id, Codex's thread id).
	pub fn native_id(&self) -> &str {
		&self.native_id
	}

	/// The next event; None once the session is closed or its agent stopped.
	pub async fn next(&self) -> Option<SessionEvent> {
		self.events.lock().await.recv().await
	}

	/// Starts a turn with the learner's input.
	pub async fn send(&self, input: &[Part]) -> Result<(), String> {
		match &self.link {
			Link::Codex(thread) => thread.send(input).await,
			Link::Claude(session) => session.send(input),
		}
	}

	/// Adds input to the running turn. Codex folds it into that turn (`turn/steer`). Claude Code
	/// folds it in after the turn's current step; one that comes after the last step runs as the
	/// next turn, with its own `TurnStarted` and `Ended`.
	pub async fn steer(&self, input: &[Part]) -> Result<(), String> {
		match &self.link {
			Link::Codex(thread) => thread.steer(input).await,
			Link::Claude(session) => session.steer(input),
		}
	}

	/// Stops the running turn; it ends with `End::Interrupted`.
	pub async fn interrupt(&self) -> Result<(), String> {
		match &self.link {
			Link::Codex(thread) => thread.interrupt().await,
			Link::Claude(session) => session.interrupt(),
		}
	}

	/// The model for the next turns.
	pub fn set_model(&self, model: &str) -> Result<(), String> {
		match &self.link {
			Link::Codex(thread) => thread.set_model(model),
			Link::Claude(session) => session.set_model(model),
		}
	}

	/// Ends the session and its query or thread, as dropping it does.
	pub fn close(self) {}
}

impl Drop for Session {
	fn drop(&mut self) {
		match &self.link {
			Link::Codex(thread) => thread.close(),
			Link::Claude(session) => session.close(),
		}
	}
}
