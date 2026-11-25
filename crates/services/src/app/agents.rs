//! The learner's agent program that runs the lessons (Claude Code or Codex, picked in
//! agent-folder.json): one runtime for it, started on first use, with the learner's own start
//! command when they set one. Codex keeps godspeed's sign-in and threads in `<data>/codex-home`.
//! A test build never starts a real agent: with no stand-in given, lessons play empty turns.

use std::sync::Arc;

use gs_core::spaces::agent_folder::FolderAgent;
use gs_runtime::Runtime;
#[cfg(not(any(test, feature = "stand-in")))]
use gs_runtime::process::AgentEnv;
use parking_lot::Mutex;

use super::agent_folder::{folder_agent, start_command};
use crate::App;

/// The runtime in use, with the agent and the start command it was made for.
type Made = (FolderAgent, Option<String>, Arc<Runtime>);

#[derive(Default)]
pub struct AgentsState {
	#[cfg(not(any(test, feature = "stand-in")))]
	env: Arc<AgentEnv>,
	runtime: Mutex<Option<Made>>,
	/// Told when the learner picks an agent: jobs wait for one.
	pub(crate) picked: tokio::sync::Notify,
}

/// The runtime of the agent picked now. A new pick or start command makes a new one; a session
/// opened on the old one keeps it until the session closes.
pub fn runtime(app: &App) -> Arc<Runtime> {
	let agent = folder_agent(app);
	let own = start_command(app, agent);
	let mut held = app.agents.runtime.lock();
	if let Some((made_for, command, runtime)) = held.as_ref()
		&& *made_for == agent
		&& *command == own
	{
		return runtime.clone();
	}
	let runtime = Arc::new(start(app, agent, own.clone()));
	*held = Some((agent, own, runtime.clone()));
	runtime
}

#[cfg(not(any(test, feature = "stand-in")))]
fn start(app: &App, agent: FolderAgent, own: Option<String>) -> Runtime {
	let env = app.agents.env.clone();
	match agent {
		FolderAgent::Claude => Runtime::claude(env, app.paths.resources.join("agent").join("claude-helper.mjs"), own),
		FolderAgent::Codex => Runtime::codex(env, app.paths.data.join("codex-home"), own),
	}
}

#[cfg(any(test, feature = "stand-in"))]
fn start(_app: &App, _agent: FolderAgent, _own: Option<String>) -> Runtime {
	gs_runtime::fake::FakeAgent::default().runtime()
}

/// Lessons run on `runtime` (a stand-in agent) while the agent and start command stay as they are.
#[cfg(any(test, feature = "stand-in"))]
pub fn use_runtime(app: &App, runtime: Runtime) {
	let agent = runtime.agent();
	*app.agents.runtime.lock() = Some((agent, start_command(app, agent), Arc::new(runtime)));
}

/// The learner picked the stand-in's agent, so jobs run too, and lessons and jobs run on it.
#[cfg(any(test, feature = "stand-in"))]
pub fn pick_stand_in(app: &Arc<App>, runtime: Runtime) {
	let agent = runtime.agent();
	use_runtime(app, runtime);
	super::agent_folder::set_folder_agent(app, agent).expect("the agent folder state is writable");
}
