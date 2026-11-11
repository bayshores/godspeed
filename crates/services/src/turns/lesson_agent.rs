//! The turn's agent, built from the record (the agent-construction branch of chat-handler.ts):
//! Talk, practice, homework, study, or a lesson's prober until its probe is done and its teacher
//! after. Every kind shares the turn composition; only the agent differs.

use std::sync::Arc;

use gs_agent::extraction::ledgers;
use gs_agent::teacher::teacher_agent::{AgentBuildOptions, create_homework_agent, create_practice_agent, create_prober_agent, create_study_agent, create_talk_agent, create_teacher_agent};
use gs_agent::tools::class::ClassToolContext;
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
use gs_agent::tools::talk::ClassActions;
use gs_base::{clock, text, time};
use gs_core::classes::class_tools::ToolOutcome;
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
use crate::classes::class_actions::class_actions;
use crate::classes::class_card::class_card_for;
use crate::classes::class_search::class_search;
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

/// The lesson's class name and rules, for the learner's-rules section.
fn lesson_class_rules(app: &App, class_id: Option<&str>) -> Option<(String, Vec<String>)> {
	let cls = app.stores.classes.get_class(class_id?)?;
	let rules = cls["rules"].as_arr().into_iter().flatten().filter_map(|r| r.as_str().map(str::to_owned)).collect();
	Some((cls["name"].as_str().unwrap_or_default().to_owned(), rules))
}

fn graph_of(app: &Arc<App>, scope: Option<&str>) -> Arc<dyn GraphStore> {
	Arc::new(ledgers::ScopedGraph::new(&app.stores.graphs, scope))
}

/// Every class graph plus "No class", `own` marking the lesson's (reads may cross classes, writes
/// never do).
fn scoped_graphs(app: &Arc<App>, lesson_scope: Option<&str>) -> Arc<dyn Fn() -> Vec<ScopedGraph> + Send + Sync> {
	let (app, lesson_scope) = (app.clone(), lesson_scope.map(str::to_owned));
	Arc::new(move || {
		let classes = app.stores.classes.list_classes();
		let scopes = std::iter::once((None, "No class")).chain(classes.iter().map(|c| (c["id"].as_str(), c["name"].as_str().unwrap_or_default())));
		scopes.map(|(scope, name)| ScopedGraph { class_name: name.to_owned(), graph_store: graph_of(&app, scope), own: scope == lesson_scope.as_deref() }).collect()
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

/// read_class, set_class_note and the class-file search: lessons in a class only.
fn class_tools(app: &Arc<App>, class_id: &str) -> ClassToolContext {
	let (card_app, card_id) = (app.clone(), class_id.to_owned());
	let (today_app, today_id) = (app.clone(), class_id.to_owned());
	let (note_app, note_id) = (app.clone(), class_id.to_owned());
	ClassToolContext {
		class_card: Arc::new(move || card_app.stores.classes.get_class(&card_id).map(|cls| class_card_for(&card_app, &cls)).transpose()),
		today_note: Some(Arc::new(move || current_today_note(&today_app, Some(&today_id)))),
		search: Some(Arc::new(class_search(app, class_id))),
		set_note: Some(Arc::new(move |note: &str| {
			if note_app.stores.classes.get_class(&note_id).is_none() {
				return "This lesson's class no longer exists.".to_owned();
			}
			match note_app.stores.classes.update_class(&note_id, &json!({ "note": { "text": text::trim(note), "at": time::iso_now() } })) {
				Ok(_) => "Saved. It shows on the class's cover.".to_owned(),
				Err(err) => err,
			}
		})),
	}
}

/// save_rule: the rule joins the learner's rules; the chat shows it with Undo and Edit.
fn save_rule(app: &Arc<App>, lesson_scope: Option<&str>) -> SaveRule {
	let (app, lesson_scope) = (app.clone(), lesson_scope.map(str::to_owned));
	Arc::new(move |rule, scope, area| {
		let this_class = scope == "this_class";
		let place = match (this_class, &lesson_scope) {
			(true, None) => return Json::from("This lesson isn't in a class. Save the rule for every lesson instead."),
			(true, Some(class_id)) => json!({ "classId": class_id }),
			(false, _) => json!({ "area": area.unwrap_or("teaching") }),
		};
		match save_rule_by_agent(&app, rule, &place, None) {
			Ok(saved) => json!({ "saved": true, "rule": saved["rule"], "for": saved["for"], "where": place, "note": "Saved. The learner sees it in the chat and can undo or edit it." }),
			Err(error) => Json::from(error),
		}
	})
}

/// Talk's class actions, named for the agent; lessons take the deadline changes too.
fn agent_class_actions(app: &Arc<App>) -> ClassActions {
	let agent = app.bridge.agent_name(clock::now_ms());
	let actions = Arc::new(class_actions(app, agent.as_deref(), send_first_message(app), true));
	Arc::new(move |name: &str, args: Json| {
		let (actions, name) = (actions.clone(), name.to_owned());
		Box::pin(async move { actions.run(&name, &args).await.unwrap_or_else(|| ToolOutcome::Err(format!("{name} is not a class tool."))) })
	})
}

/// Builds this turn's agent from the record.
pub(super) fn build_lesson_agent(app: &Arc<App>, record: &Json, effective: &Json, turn: TurnAgent) -> Arc<Agent> {
	let TurnAgent { chat_id, messages, teaching, side_turn, engine } = turn;
	let lesson_scope = record["classId"].as_str();
	let class_rules = lesson_class_rules(app, lesson_scope);
	let toggles = Some(&effective["agent"]["tools"]).filter(|t| !t.is_null()).cloned();
	let opts = AgentBuildOptions {
		messages,
		on_usage: None,
		tools: None,
		tool_toggles: toggles,
		learner_rules: Some(learner_rules_section(&effective["agent"]["rules"], class_rules.as_ref().map(|(name, rules)| (name.as_str(), rules.as_slice())))),
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
	let class_actions = agent_class_actions(app);
	let side = LessonSide { class: lesson_scope.map(|id| class_tools(app, id)), save_rule: Some(save_rule(app, lesson_scope)), class_actions: Some(class_actions.clone()) };
	let teacher = || TeacherToolContext { plan: PlanContext { chat_id: chat_id.clone(), chat_store: chats.clone() }, jobs: jobs.clone(), side: side.clone() };

	let kind = record["kind"].as_str();
	match (kind, lesson_scope, record["deadlineId"].as_str()) {
		(Some("talk"), ..) => create_talk_agent(&class_actions, AgentBuildOptions { learner_rules: None, ..opts }),
		(Some("practice"), ..) => {
			let ctx = PracticeToolContext { chat_id, chat_store: chats, graph_nodes: Some(graph_nodes(app, lesson_scope)), graph: graph_tools(app, effective, lesson_scope), jobs: Some(jobs), side };
			create_practice_agent(&ctx, opts)
		}
		(Some("homework"), Some(class_id), Some(deadline_id)) if !class_id.is_empty() && !deadline_id.is_empty() => {
			let ctx = HomeworkToolContext { chat_id, chat_store: chats, homework: homework_deadline(app, class_id, deadline_id), graph: graph_tools(app, effective, lesson_scope), jobs: Some(jobs), side };
			create_homework_agent(&ctx, opts)
		}
		(Some("study"), ..) => create_study_agent(&StudyToolContext { teacher: teacher(), graph_nodes: Some(graph_nodes(app, lesson_scope)) }, opts),
		_ if teaching => create_teacher_agent(Some(&teacher()), opts),
		_ => {
			let deliver_app = app.clone();
			let probe = ProbeDoneContext { chat_id: chat_id.clone(), chat_store: chats.clone(), deliver: Arc::new(move |steer| deliver_job_result(&deliver_app, steer)) };
			create_prober_agent(&ProberToolContext { probe, jobs, graph: graph_tools(app, effective, lesson_scope), side }, opts)
		}
	}
}
