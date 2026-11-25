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
use crate::codex::agent::{Connection as CodexConnection, ThreadLink};
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
pub(crate) enum Connection {
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

/// What godspeed is told when the agent may need setting up again: a session that could not
/// start, or a sign-in the agent refused.
type Notice = Arc<dyn Fn() + Send + Sync>;

/// The notice, shared with the connections, which see the refused sign-ins.
#[derive(Clone, Default)]
pub(crate) struct Trouble(Arc<parking_lot::Mutex<Option<Notice>>>);

impl Trouble {
	pub(crate) fn tell(&self) {
		let notice = self.0.lock().clone();
		if let Some(notice) = notice {
			notice();
		}
	}
}

pub struct Runtime {
	agent: FolderAgent,
	start: Start,
	/// Held while the agent starts, which waits on its handshake, so two opens never start two.
	connection: Mutex<Option<Connection>>,
	trouble: Trouble,
}

impl Runtime {
	/// `home` is godspeed's own Codex settings folder, which holds its sign-in and threads; the
	/// learner's own (`~/.codex`) is never read. `own_command` is the learner's own command for
	/// Codex, if they set one; `app-server` follows it.
	pub fn codex(env: Arc<AgentEnv>, home: PathBuf, own_command: Option<String>) -> Runtime {
		Runtime { agent: FolderAgent::Codex, start: Start::Codex { env, home, own_command }, connection: Mutex::new(None), trouble: Trouble::default() }
	}

	/// `helper` is the bundled `claude-helper.mjs`; `own_command` is the learner's own command
	/// for Claude Code, if they set one.
	pub fn claude(env: Arc<AgentEnv>, helper: PathBuf, own_command: Option<String>) -> Runtime {
		Runtime { agent: FolderAgent::Claude, start: Start::Claude { env, helper, own_command }, connection: Mutex::new(None), trouble: Trouble::default() }
	}

	#[cfg(any(test, feature = "fake"))]
	pub(crate) fn from_pipes(agent: FolderAgent, start: impl Fn() -> Started + Send + Sync + 'static) -> Runtime {
		Runtime { agent, start: Start::Pipes(Box::new(start)), connection: Mutex::new(None), trouble: Trouble::default() }
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

	/// `notice` is called when the agent may need setting up again: a session that could not
	/// start, or a sign-in the agent refused during a turn.
	pub fn on_trouble(&self, notice: impl Fn() + Send + Sync + 'static) {
		*self.trouble.0.lock() = Some(Arc::new(notice));
	}

	pub async fn open(&self, spec: SessionSpec) -> Result<Session, String> {
		let opened = match self.connection().await {
			Ok(Connection::Codex(codex)) => codex.open(spec).await,
			Ok(Connection::Claude(claude)) => claude.open(spec).await,
			Err(err) => Err(err),
		};
		if opened.is_err() {
			self.trouble.tell();
		}
		opened
	}

	pub(crate) async fn codex_connection(&self) -> Result<Arc<CodexConnection>, String> {
		match self.connection().await? {
			Connection::Codex(codex) => Ok(codex),
			Connection::Claude(_) => Err("not Codex".to_owned()),
		}
	}

	/// Codex's `account/read`, for the health check.
	pub(crate) async fn codex_account(&self) -> Result<Json, String> {
		self.codex_connection().await?.account().await
	}

	/// The running connection, or a new one when there is none or the last one stopped.
	pub(crate) async fn connection(&self) -> Result<Connection, String> {
		let mut held = self.connection.lock().await;
		if let Some(connection) = held.as_ref().filter(|connection| connection.alive()) {
			return Ok(connection.clone());
		}
		let connection = self.connect().await?;
		*held = Some(connection.clone());
		Ok(connection)
	}

	/// The next session starts a new connection; sessions open now keep theirs.
	pub(crate) async fn forget_connection(&self) {
		self.connection.lock().await.take();
	}

	async fn connect(&self) -> Result<Connection, String> {
		match &self.start {
			Start::Codex { env, home, own_command } => {
				let launch = match own_command {
					Some(command) => Launch::shell(&format!("{command} app-server")),
					None => {
						let mut launch = env.launch(env.find("codex").await.ok_or(NO_CODEX)?).await?;
						launch.args.push("app-server".into());
						launch
					}
				};
				std::fs::create_dir_all(home).map_err(|err| format!("cannot make godspeed's Codex folder {}: {err}", home.display()))?;
				let started = spawn("codex app-server", &launch, &codex_vars(env.vars().await, home))?;
				Ok(Connection::Codex(CodexConnection::start(started, self.trouble.clone()).await?))
			}
			Start::Claude { env, helper, own_command } => {
				let program = match own_command {
					Some(command) => ClaudeProgram::Command(command.clone()),
					None => ClaudeProgram::Path(env.find("claude").await.ok_or(NO_CLAUDE)?.to_string_lossy().into_owned()),
				};
				let helper = helper_to_run(helper, debug_helper());
				if !helper.is_file() {
					return Err(format!("godspeed's Claude helper is missing: {}", helper.display()));
				}
				let node = env.find("node").await.ok_or(NO_NODE)?;
				let started = spawn("claude helper", &Launch { program: node, args: vec![helper.into_os_string()] }, env.vars().await)?;
				Ok(Connection::Claude(ClaudeConnection::start(started, program, self.trouble.clone())))
			}
			#[cfg(any(test, feature = "fake"))]
			Start::Pipes(start) => Ok(match self.agent {
				FolderAgent::Codex => Connection::Codex(CodexConnection::start(start(), self.trouble.clone()).await?),
				FolderAgent::Claude => Connection::Claude(ClaudeConnection::start(start(), ClaudeProgram::Path("claude".to_owned()), self.trouble.clone())),
			}),
		}
	}
}

/// The helper `npm run layout` names in `LH_CLAUDE_HELPER`, so lessons play on a stand-in with no
/// real agent. A release build never reads it: a variable in the learner's environment must not
/// swap the helper that runs their agent.
pub(crate) fn debug_helper() -> Option<OsString> {
	#[cfg(debug_assertions)]
	{
		std::env::var_os("LH_CLAUDE_HELPER")
	}
	#[cfg(not(debug_assertions))]
	{
		None
	}
}

pub(crate) fn helper_to_run(bundled: &Path, named: Option<OsString>) -> PathBuf {
	named.filter(|file| !file.is_empty()).map_or_else(|| bundled.to_path_buf(), PathBuf::from)
}

pub(crate) const NO_CODEX: &str = "godspeed couldn't find Codex on this computer.";
pub(crate) const NO_CLAUDE: &str = "godspeed couldn't find Claude Code on this computer.";
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

	/// Adds input to the running turn: Codex folds it into that turn (`turn/steer`). Claude Code
	/// takes new input only as its next turn, so godspeed sends it then.
	pub async fn steer(&self, input: &[Part]) -> Result<(), String> {
		match &self.link {
			Link::Codex(thread) => thread.steer(input).await,
			Link::Claude(_) => Err("Claude Code takes new input only as its next turn".to_owned()),
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

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_named_helper_replaces_the_bundled_one() {
		let bundled = Path::new("/app/agent/claude-helper.mjs");
		assert_eq!(helper_to_run(bundled, None), bundled);
		assert_eq!(helper_to_run(bundled, Some(OsString::new())), bundled);
		assert_eq!(helper_to_run(bundled, Some("/lab/layout-helper.mjs".into())), Path::new("/lab/layout-helper.mjs"));
	}
}
