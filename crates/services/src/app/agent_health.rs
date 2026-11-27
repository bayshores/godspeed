//! The setup card's checks of the picked agent: installed, new enough, signed in and on which
//! plan (gs-runtime runs them). One check runs at a time; one asked for while it runs follows it.
//! They run at server start, when the agent or its start command changes, after a sign-in or an
//! update, and when a lesson's or job's session could not start or the agent refused its sign-in.
//! Each start and end is told with `agent-health`.

use std::sync::Arc;

use gs_base::events::EventKind;
use gs_base::tasks;
use gs_core::spaces::agent_folder::FolderAgent;
use gs_json::{Json, Obj, json};
use gs_runtime::{AgentHealth, Check, Outcome, Problem};
use parking_lot::Mutex;

use super::agent_folder::start_command;
use super::agent_login::{login_view, passed_login};
use super::agent_update::{passed_update, update_view};
use super::agents::runtime;
use crate::App;

#[derive(Default)]
pub struct HealthState(Mutex<Checks>);

#[derive(Default)]
struct Checks {
	last: Option<AgentHealth>,
	running: bool,
	/// Another check was asked for while one ran.
	again: bool,
}

/// Tells the window a check started, ended or changed what the card shows.
pub(super) fn told(app: &App) {
	app.events.emit(EventKind::AgentHealth, json!({}));
}

/// Checks the picked agent, now or right after the check that runs.
pub fn check_health(app: &Arc<App>) {
	{
		let mut checks = app.agents.health.0.lock();
		if checks.running {
			checks.again = true;
			return;
		}
		checks.running = true;
	}
	told(app);
	let app = Arc::downgrade(app);
	tasks::detach("agent health", async move {
		loop {
			let Some(app) = app.upgrade() else { return };
			let health = runtime(&app).health().await;
			let passed = |check: Check| health.rows.iter().any(|row| row.check == check && row.outcome == Outcome::Passed);
			let (logged_in, up_to_date) = (passed(Check::LoggedIn), passed(Check::UpToDate));
			let again = {
				let mut checks = app.agents.health.0.lock();
				checks.last = Some(health);
				checks.running = std::mem::take(&mut checks.again);
				checks.running
			};
			if logged_in {
				passed_login(&app);
			}
			if up_to_date {
				passed_update(&app);
			}
			told(&app);
			if !again {
				return;
			}
		}
	});
}

/// A check and, when it failed, why: the problem, the reason a check that could not run gives, the
/// version it needs and the link to the page that fixes it.
fn failure(check: Check, problem: Option<&Problem>, agent: FolderAgent) -> Obj {
	let mut view = Obj::new();
	view.insert("check", check.name());
	view.insert("problem", problem.map(Problem::name));
	view.insert("reason", problem.and_then(Problem::reason).map(str::to_owned));
	view.insert("needs", problem.and_then(|problem| problem.needs(agent)));
	view.insert("link", problem.and_then(|problem| problem.link(agent)));
	view
}

/// GET /api/agent/health: the picked agent's checks, the first that failed (with the version it
/// needs and the link to the page that fixes it, where there is one), its sign-in and its update.
/// Before a check of this agent has ended its rows are unchecked; one starts if none runs.
pub fn health_view(app: &Arc<App>) -> Json {
	let agent = runtime(app).agent();
	let own_command = start_command(app, agent).is_some();
	let (last, checking) = {
		let checks = app.agents.health.0.lock();
		(checks.last.clone().filter(|health| health.agent == agent && health.own_command == own_command), checks.running)
	};
	if last.is_none() && !checking {
		check_health(app);
	}
	let checking = checking || last.is_none();
	let health = last.unwrap_or_else(|| AgentHealth::unchecked(agent, own_command));
	let checks: Json = health
		.rows
		.iter()
		.map(|row| {
			let (state, problem) = match &row.outcome {
				Outcome::Passed => ("passed", None),
				Outcome::Failed(problem) => ("failed", Some(problem)),
				Outcome::Unchecked => ("unchecked", None),
			};
			let mut view = failure(row.check, problem, agent);
			view.insert("state", state);
			view.insert("fact", row.fact.clone());
			Json::Obj(view)
		})
		.collect();
	let failing = health.failing().map(|(check, problem)| Json::Obj(failure(check, Some(&problem), agent)));
	json!({
		"agent": agent.name(),
		"checking": checking,
		"ownCommand": own_command,
		"checks": checks,
		"failing": failing,
		"login": login_view(app, agent),
		"update": update_view(app, agent),
	})
}

#[cfg(test)]
mod tests {
	use gs_base::clock;
	use gs_json::stringify;

	use super::*;
	use crate::app::agent_folder::set_folder_agent;
	use crate::app::test_support::{scratch_dir, test_app};

	/// The view once the check running now has ended.
	async fn checked(app: &Arc<App>) -> Json {
		for _ in 0..500 {
			let view = health_view(app);
			if view["checking"] == Json::Bool(false) {
				return view;
			}
			clock::sleep(10).await;
		}
		panic!("the check never ended");
	}

	#[tokio::test]
	async fn the_first_read_starts_a_check_and_shows_unchecked_rows_until_it_ends() {
		let root = scratch_dir("health-first");
		let app = test_app(&root);
		let mut events = app.events.subscribe();
		let first = health_view(&app);
		assert_eq!(
			stringify(&first),
			r#"{"agent":"claude","checking":true,"ownCommand":false,"checks":[{"check":"installed","problem":null,"reason":null,"needs":null,"link":null,"state":"unchecked","fact":null},{"check":"node","problem":null,"reason":null,"needs":null,"link":null,"state":"unchecked","fact":null},{"check":"upToDate","problem":null,"reason":null,"needs":null,"link":null,"state":"unchecked","fact":null},{"check":"loggedIn","problem":null,"reason":null,"needs":null,"link":null,"state":"unchecked","fact":null}],"failing":null,"login":null,"update":null}"#
		);
		let view = checked(&app).await;
		assert!(view["checks"].items().iter().all(|check| check["state"].as_str() == Some("passed")), "the stand-in agent is ready");
		let mut told = 0;
		while let Ok(event) = events.try_recv() {
			told += usize::from(event.kind == EventKind::AgentHealth);
		}
		assert_eq!(told, 2, "the check's start and end");
	}

	#[tokio::test]
	async fn picking_the_other_agent_checks_it() {
		let root = scratch_dir("health-pick");
		let app = test_app(&root);
		checked(&app).await;
		set_folder_agent(&app, FolderAgent::Codex).unwrap();
		let view = checked(&app).await;
		assert_eq!(view["agent"].as_str(), Some("codex"));
		let checks: Vec<&str> = view["checks"].items().iter().map(|check| check["check"].str_or_empty()).collect();
		assert_eq!(checks, ["installed", "upToDate", "loggedIn"]);
	}
}
