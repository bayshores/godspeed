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

use super::agent_folder::agent_with_command;
#[cfg(any(test, feature = "stand-in"))]
use super::agent_folder::start_command;
use super::agent_health::{HealthState, check_health};
use super::agent_login::LoginState;
use super::agent_update::UpdateState;
use crate::App;

/// The runtime in use, with the agent and the start command it was made for.
type Made = (FolderAgent, Option<String>, Arc<Runtime>);

#[derive(Default)]
pub struct AgentsState {
	#[cfg(not(any(test, feature = "stand-in")))]
	env: Arc<AgentEnv>,
	runtime: Mutex<Option<Made>>,
	pub(super) health: HealthState,
	pub(super) login: LoginState,
	pub(super) update: UpdateState,
}

/// The runtime of the agent picked now. A new pick or start command makes a new one; a session
/// opened on the old one keeps it until the session closes.
pub fn runtime(app: &Arc<App>) -> Arc<Runtime> {
	let (agent, own) = agent_with_command(app);
	let mut held = app.agents.runtime.lock();
	if let Some((made_for, command, runtime)) = held.as_ref()
		&& *made_for == agent
		&& *command == own
	{
		return runtime.clone();
	}
	let runtime = watched(app, start(app, agent, own.clone()));
	*held = Some((agent, own, runtime.clone()));
	runtime
}

/// A session that could not start, or a sign-in the agent refused, checks the agent again.
fn watched(app: &Arc<App>, runtime: Runtime) -> Arc<Runtime> {
	let app = Arc::downgrade(app);
	runtime.on_trouble(move || {
		if let Some(app) = app.upgrade() {
			check_health(&app);
		}
	});
	Arc::new(runtime)
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
fn start(_app: &App, agent: FolderAgent, _own: Option<String>) -> Runtime {
	let fake = gs_runtime::fake::FakeAgent::default();
	match agent {
		FolderAgent::Claude => fake.runtime(),
		FolderAgent::Codex => fake.codex_runtime(),
	}
}

/// Lessons and jobs run on `runtime` (a stand-in agent) while the agent and start command stay as
/// they are.
#[cfg(any(test, feature = "stand-in"))]
pub fn use_runtime(app: &Arc<App>, runtime: Runtime) {
	let agent = runtime.agent();
	*app.agents.runtime.lock() = Some((agent, start_command(app, agent), watched(app, runtime)));
}
