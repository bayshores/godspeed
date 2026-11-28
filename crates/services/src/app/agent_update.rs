//! Updating the picked agent from the setup card, one update at a time, the way it was installed
//! (gs-runtime finds the way and runs it). Each line it prints is told with `agent-update`; a
//! finished update checks the agent again. A failed one stays on the card, with the command the
//! learner can run themselves, until the next starts or a check finds the agent new enough.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use gs_base::events::EventKind;
use gs_base::tasks;
use gs_core::spaces::agent_folder::FolderAgent;
use gs_json::{Json, json};
use gs_runtime::Update;
use parking_lot::Mutex;

use super::agent_health::check_health;
use super::agents::runtime;
use crate::App;

#[derive(Default)]
pub(crate) struct UpdateState {
	run: Mutex<Option<Run>>,
	/// Held while an update starts, so two starts never make two.
	starting: tokio::sync::Mutex<()>,
	next: AtomicU64,
}

struct Run {
	agent: FolderAgent,
	id: u64,
	stage: Stage,
	/// The last line it printed, or why it stopped.
	line: Option<String>,
	command: &'static str,
}

/// Where an update is. `Done` is only told, never kept: the card shows the new version from the
/// check that follows.
#[derive(Clone, Copy, PartialEq)]
enum Stage {
	Running,
	Done,
	Failed,
}

impl Stage {
	fn name(self) -> &'static str {
		match self {
			Stage::Running => "running",
			Stage::Done => "done",
			Stage::Failed => "failed",
		}
	}
}

fn view(stage: Stage, line: Option<&str>, command: &str) -> Json {
	json!({ "state": stage.name(), "line": line, "command": command })
}

impl Run {
	fn view(&self) -> Json {
		view(self.stage, self.line.as_deref(), self.command)
	}
}

/// Tells the window where the update is.
fn tell(app: &App, update: Json) {
	app.events.emit(EventKind::AgentUpdate, update);
}

/// The health view's `update`: the picked agent's update running or failed, else null.
pub(super) fn update_view(app: &App, agent: FolderAgent) -> Json {
	app.agents.update.run.lock().as_ref().filter(|run| run.agent == agent).map_or(Json::Null, Run::view)
}

/// A check found the agent new enough: a failed update no longer shows.
pub(super) fn passed_update(app: &App) {
	let mut run = app.agents.update.run.lock();
	if run.as_ref().is_some_and(|run| run.stage == Stage::Failed) {
		*run = None;
	}
}

/// POST /api/agent/update: updates the picked agent and gives `{state, line, command}`. While one
/// runs for this agent, that one. When godspeed can't tell how the agent was installed, the
/// update has failed at once with the command to run. An error says why none could start (the
/// learner's own command, or no agent found).
pub async fn start_update(app: &Arc<App>) -> Result<Json, String> {
	let _starting = app.agents.update.starting.lock().await;
	let runtime = runtime(app);
	let agent = runtime.agent();
	if let Some(running) = app.agents.update.run.lock().as_ref().filter(|run| run.agent == agent && run.stage == Stage::Running) {
		return Ok(running.view());
	}
	let (stage, command, running) = match runtime.update().await {
		Ok(Update::Running { command, lines, ended }) => (Stage::Running, command, Some((lines, ended))),
		Ok(Update::Unknown { command }) => (Stage::Failed, command, None),
		Err(reason) => {
			eprintln!("[agent update] {reason}");
			return Err(reason);
		}
	};
	let id = app.agents.update.next.fetch_add(1, Ordering::SeqCst);
	let run = Run { agent, id, stage, line: None, command };
	let started = run.view();
	*app.agents.update.run.lock() = Some(run);
	tell(app, started.clone());
	if let Some((mut lines, ended)) = running {
		let weak = Arc::downgrade(app);
		tasks::detach("agent update", async move {
			while let Some(line) = lines.recv().await {
				let Some(app) = weak.upgrade() else { return };
				let told = {
					let mut run = app.agents.update.run.lock();
					// A newer update took its place.
					let Some(run) = run.as_mut().filter(|run| run.id == id) else { return };
					run.line = Some(line);
					run.view()
				};
				tell(&app, told);
			}
			let result = ended.await.unwrap_or_else(|_| Err("the update stopped".to_owned()));
			let Some(app) = weak.upgrade() else { return };
			let (told, done) = {
				let mut held = app.agents.update.run.lock();
				// A newer update took its place.
				let Some(run) = held.as_mut().filter(|run| run.id == id) else { return };
				match result {
					Ok(()) => {
						let done = view(Stage::Done, run.line.as_deref(), command);
						*held = None;
						(done, true)
					}
					Err(reason) => {
						eprintln!("[agent update] {command}: {reason}");
						run.stage = Stage::Failed;
						run.line = Some(reason);
						(run.view(), false)
					}
				}
			};
			tell(&app, told);
			if done {
				check_health(&app);
			}
		});
	}
	Ok(started)
}
