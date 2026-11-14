//! The turn's agent, built from the record (the agent-construction branch of chat-handler.ts):
//! Talk, practice, homework, study, or a lesson's prober until its probe is done and its teacher
//! after. Every kind shares the turn composition; only the agent differs.

use std::sync::Arc;

use gs_agent::extraction::ledgers;
use gs_agent::teacher::teacher_agent::{AgentBuildOptions, create_homework_agent, create_practice_agent, create_prober_agent, create_study_agent, create_talk_agent, create_teacher_agent};
use gs_agent::tools::space::SpaceToolContext;
use gs_agent::tools::graph::{GraphToolContext, ScopedGraph};
use gs_agent::tools::homework::HomeworkToolContext;
use gs_agent::tools::jobs::JobToolContext;
use gs_agent::tools::lesson::{ProberToolContext, StudyToolContext, TeacherToolContext};
use gs_agent::tools::plan::PlanContext;
use gs_agent::tools::ports::{ChatPort, Spawn};
use gs_agent::tools::practice::{GraphNodes, PracticeToolContext};
use gs_agent::tools::probe::ProbeDoneContext;
use gs_agent::tools::rules::SaveRule;
use gs_agent::tools::side::LessonSide;
use gs_agent::tools::talk::SpaceActions;
use gs_base::{clock, text, time};
use gs_core::spaces::space_tools::ToolOutcome;
use gs_core::graph::ports::GraphStore;
use gs_core::records::settings_resolution::graph_tools_enabled;
use gs_core::records::teaching_areas::learner_rules_section;
use gs_engine::turn::agent::Agent;
use gs_engine::turn::faux::Engine;
use gs_json::{Json, json};

use super::chat_handler::send_first_message;
use super::homework::homework_deadline;
use super::job_host::run_job;
use crate::App;
use crate::app::agent_rules::save_rule_by_agent;
use crate::app::today_note::current_today_note;
use crate::spaces::space_actions::space_actions;
use crate::spaces::citations::check_cites;
use crate::spaces::space_card::space_card_for;
use crate::spaces::space_search::space_search;
use crate::jobs::deliver_job_result;

/// What one turn's agent is built from.
pub(super) struct TurnAgent {
	pub chat_id: String,
	/// The transcript the turn runs on (the record is the agent's state).
	pub messages: Vec<Json>,
	/// A successful probe_done is in the transcript: the teacher, not the prober.
	pub teaching: bool,
	pub side_turn: bool,
	pub engine: Engine,
}

/// The lesson's space name and rules, for the learner's-rules section.
fn lesson_space_rules(app: &App, space_id: Option<&str>) -> Option<(String, Vec<String>)> {
	let cls = app.stores.spaces.get_space(space_id?)?;
	let rules = cls["rules"].as_arr().into_iter().flatten().filter_map(|r| r.as_str().map(str::to_owned)).collect();
	Some((cls["name"].as_str().unwrap_or_default().to_owned(), rules))
}

fn graph_of(app: &Arc<App>, scope: Option<&str>) -> Arc<dyn GraphStore> {
	Arc::new(ledgers::ScopedGraph::new(&app.stores.graphs, scope))
}

/// Every space graph plus "No space", `own` marking the lesson's (reads may cross spaces, writes
/// never do).
fn scoped_graphs(app: &Arc<App>, lesson_scope: Option<&str>) -> Arc<dyn Fn() -> Vec<ScopedGraph> + Send + Sync> {
	let (app, lesson_scope) = (app.clone(), lesson_scope.map(str::to_owned));
	Arc::new(move || {
		let spaces = app.stores.spaces.list_spaces();
		let scopes = std::iter::once((None, "No space")).chain(spaces.iter().map(|c| (c["id"].as_str(), c["name"].as_str().unwrap_or_default())));
		scopes.map(|(scope, name)| ScopedGraph { space_name: name.to_owned(), graph_store: graph_of(&app, scope), own: scope == lesson_scope.as_deref() }).collect()
	})
}

/// The map readers, when the settings open them to the agent.
fn graph_tools(app: &Arc<App>, effective: &Json, lesson_scope: Option<&str>) -> Option<GraphToolContext> {
	graph_tools_enabled(effective).then(|| GraphToolContext { chat_store: app.stores.chats.clone(), graph_store: graph_of(app, lesson_scope), graphs: Some(scoped_graphs(app, lesson_scope)) })
}

/// The whole graph's nodes, read fresh per pose.
fn graph_nodes(app: &Arc<App>, scope: Option<&str>) -> GraphNodes {
	let graph = graph_of(app, scope);
	Arc::new(move || graph.read_nodes().unwrap_or_default())
}

/// read_space, set_space_note and the space-file search: lessons in a space only.
fn space_tools(app: &Arc<App>, space_id: &str) -> SpaceToolContext {
	let (card_app, card_id) = (app.clone(), space_id.to_owned());
	let (today_app, today_id) = (app.clone(), space_id.to_owned());
	let (note_app, note_id) = (app.clone(), space_id.to_owned());
	SpaceToolContext {
		space_card: Arc::new(move || card_app.stores.spaces.get_space(&card_id).map(|cls| space_card_for(&card_app, &cls)).transpose()),
		today_note: Some(Arc::new(move || current_today_note(&today_app, Some(&today_id)))),
		search: Some(Arc::new(space_search(app, space_id, true))),
		set_note: Some(Arc::new(move |note: &str| {
			if note_app.stores.spaces.get_space(&note_id).is_none() {
				return "This lesson's space no longer exists.".to_owned();
			}
			match note_app.stores.spaces.update_space(&note_id, &json!({ "note": { "text": text::trim(note), "at": time::iso_now() } })) {
				Ok(_) => "Saved. It shows on the space's cover.".to_owned(),
				Err(err) => err,
			}
		})),
	}
}

/// save_rule: the rule joins the learner's rules; the chat shows it with Undo and Edit.
fn save_rule(app: &Arc<App>, lesson_scope: Option<&str>) -> SaveRule {
	let (app, lesson_scope) = (app.clone(), lesson_scope.map(str::to_owned));
	Arc::new(move |rule, scope, area| {
		let this_space = scope == "this_space";
		let place = match (this_space, &lesson_scope) {
			(true, None) => return Json::from("This lesson isn't in a space. Save the rule for every lesson instead."),
			(true, Some(space_id)) => json!({ "spaceId": space_id }),
			(false, _) => json!({ "area": area.unwrap_or("teaching") }),
		};
		match save_rule_by_agent(&app, rule, &place, None) {
			Ok(saved) => json!({ "saved": true, "rule": saved["rule"], "for": saved["for"], "where": place, "note": "Saved. The learner sees it in the chat and can undo or edit it." }),
			Err(error) => Json::from(error),
		}
	})
}

/// Talk's space actions, named for the agent; lessons take the deadline changes too.
fn agent_space_actions(app: &Arc<App>) -> SpaceActions {
	let agent = app.bridge.agent_name(clock::now_ms());
	let actions = Arc::new(space_actions(app, agent.as_deref(), send_first_message(app), true));
	Arc::new(move |name: &str, args: Json| {
		let (actions, name) = (actions.clone(), name.to_owned());
		Box::pin(async move { actions.run(&name, &args).await.unwrap_or_else(|| ToolOutcome::Err(format!("{name} is not a space tool."))) })
	})
}

/// Builds this turn's agent from the record.
pub(super) fn build_lesson_agent(app: &Arc<App>, record: &Json, effective: &Json, turn: TurnAgent) -> Arc<Agent> {
	let TurnAgent { chat_id, messages, teaching, side_turn, engine } = turn;
	let lesson_scope = record["spaceId"].as_str();
	let space_rules = lesson_space_rules(app, lesson_scope);
	let toggles = Some(&effective["agent"]["tools"]).filter(|t| !t.is_null()).cloned();
	let opts = AgentBuildOptions {
		messages,
		on_usage: None,
		tools: None,
		tool_toggles: toggles,
		learner_rules: Some(learner_rules_section(&effective["agent"]["rules"], space_rules.as_ref().map(|(name, rules)| (name.as_str(), rules.as_slice())))),
		chat_id: Some(chat_id.clone()),
		side_turn,
		..AgentBuildOptions::new(engine, &app.stores.prompt_overrides)
	};

	let chats: Arc<dyn ChatPort> = app.stores.chats.clone();
	let spawn: Spawn = {
		let app = app.clone();
		Arc::new(move |job: &Json, input: &Json| run_job(&app, job["id"].as_str().unwrap_or_default(), Some(input.clone())))
	};
	let jobs = JobToolContext { chat_id: chat_id.clone(), job_store: app.stores.jobs.clone(), spawn };
	let space_actions = agent_space_actions(app);
	let side = LessonSide { space: lesson_scope.map(|id| space_tools(app, id)), save_rule: Some(save_rule(app, lesson_scope)), space_actions: Some(space_actions.clone()) };
	let teacher = || TeacherToolContext { plan: PlanContext { chat_id: chat_id.clone(), chat_store: chats.clone() }, jobs: jobs.clone(), side: side.clone() };

	let kind = record["kind"].as_str();
	match (kind, lesson_scope, record["deadlineId"].as_str()) {
		(Some("talk"), ..) => create_talk_agent(&space_actions, AgentBuildOptions { learner_rules: None, ..opts }),
		(Some("practice"), ..) => {
			let ctx = PracticeToolContext { chat_id, chat_store: chats, graph_nodes: Some(graph_nodes(app, lesson_scope)), graph: graph_tools(app, effective, lesson_scope), jobs: Some(jobs), side };
			create_practice_agent(&ctx, opts)
		}
		(Some("homework"), Some(space_id), Some(deadline_id)) if !space_id.is_empty() && !deadline_id.is_empty() => {
			let ctx = HomeworkToolContext { chat_id, chat_store: chats, homework: homework_deadline(app, space_id, deadline_id), graph: graph_tools(app, effective, lesson_scope), jobs: Some(jobs), side };
			create_homework_agent(&ctx, opts)
		}
		(Some("study"), ..) => {
			let marks_app = app.clone();
			let check_marks = Arc::new(move |text: &str| check_cites(&marks_app, text));
			// Study sends deadline changes to Talk, so it has no deadline tools.
			let teacher = TeacherToolContext { side: LessonSide { space_actions: None, ..side.clone() }, ..teacher() };
			create_study_agent(&StudyToolContext { teacher, graph_nodes: Some(graph_nodes(app, lesson_scope)), check_marks }, opts)
		}
		_ if teaching => create_teacher_agent(Some(&teacher()), opts),
		_ => {
			let deliver_app = app.clone();
			let probe = ProbeDoneContext { chat_id: chat_id.clone(), chat_store: chats.clone(), deliver: Arc::new(move |steer| deliver_job_result(&deliver_app, steer)) };
			create_prober_agent(&ProberToolContext { probe, jobs, graph: graph_tools(app, effective, lesson_scope), side }, opts)
		}
	}
}

#[cfg(test)]
mod tests {
	use gs_engine::turn::models::agent_engine;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	fn tool_names(app: &Arc<App>, kind: &str) -> Vec<String> {
		let record = json!({ "id": "chat_a", "kind": kind, "messages": [] });
		let effective = app.stores.settings.effective_settings().unwrap();
		let turn = TurnAgent { chat_id: "chat_a".to_owned(), messages: Vec::new(), teaching: false, side_turn: false, engine: agent_engine(&app.bridge) };
		let agent = build_lesson_agent(app, &record, &effective, turn);
		agent.messages()[0]["toolsAdded"].as_arr().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_owned()).collect()
	}

	#[test]
	fn study_sends_deadline_changes_to_talk_and_other_lessons_keep_the_tools() {
		let root = scratch_dir("lesson-agent");
		let app = test_app(&root);
		let study = tool_names(&app, "study");
		assert!(study.contains(&"topic_done".to_owned()));
		assert!(!study.iter().any(|t| t.contains("deadline") || t == "list_spaces"), "{study:?}");
		for kind in ["practice", "lesson"] {
			assert!(tool_names(&app, kind).contains(&"add_space_deadline".to_owned()), "{kind}");
		}
	}
}
