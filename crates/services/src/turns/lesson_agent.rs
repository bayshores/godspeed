//! The turn's agent, built from the record (the agent-construction branch of chat-handler.ts):
//! practice, homework, study, or a lesson's prober until its probe is done and its teacher
//! after. Every kind shares the turn composition; only the agent differs.

use std::sync::Arc;

use gs_agent::extraction::ledgers;
use gs_agent::teacher::teacher_agent::{AgentBuildOptions, create_homework_agent, create_practice_agent, create_prober_agent, create_study_agent, create_teacher_agent};
use gs_agent::tools::space::SpaceToolContext;
use gs_agent::tools::graph::SearchGraph;
use gs_agent::tools::homework::HomeworkToolContext;
use gs_agent::tools::jobs::JobToolContext;
use gs_agent::tools::lesson::{ProberToolContext, StudyToolContext, TeacherToolContext};
use gs_agent::tools::plan::PlanContext;
use gs_agent::tools::ports::{ChatPort, Spawn};
use gs_agent::tools::practice::{GraphNodes, PracticeToolContext};
use gs_agent::tools::probe::ProbeDoneContext;
use gs_agent::tools::rules::SaveRule;
use gs_agent::tools::side::LessonSide;
use gs_agent::tools::space_actions::SpaceActions;
use gs_base::{clock, text, time};
use gs_core::session::plan::agent_writes_plan;
use gs_core::spaces::space_tools::ToolOutcome;
use gs_core::graph::ports::GraphStore;
use gs_core::records::settings_resolution::graph_tools_enabled;
use gs_core::records::teaching_areas::learner_rules_section;
use gs_core::session::tool_switches::switched_off;
use gs_engine::turn::agent::Agent;
use gs_engine::turn::faux::Engine;
use gs_json::{Json, json};

use super::chat_handler::send_first_message;
use super::homework::deadline_problem_list;
use super::job_host::run_job;
use super::problem_pages::problem_pages;
use crate::App;
use crate::graph::graph::search_graph;
use crate::app::agent_rules::save_rule_by_agent;
use crate::app::open_page::agent_open_page;
use crate::app::today_note::current_today_note;
use crate::spaces::space_actions::{Mark, space_actions};
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
	let rules = cls["rules"].items().iter().filter_map(|r| r.as_str().map(str::to_owned)).collect();
	Some((cls["name"].str_or_empty().to_owned(), rules))
}

/// search_graph over the lesson's own graph only, a few facts and chains at a time.
fn lesson_graph_search(app: &Arc<App>, lesson_scope: Option<&str>) -> SearchGraph {
	let (app, lesson_scope) = (app.clone(), lesson_scope.map(str::to_owned));
	Arc::new(move |query| {
		let (app, lesson_scope) = (app.clone(), lesson_scope.clone());
		Box::pin(async move { search_graph(&app, lesson_scope.as_deref(), query.as_deref(), 8).await })
	})
}

/// The whole graph's nodes, read fresh per pose.
fn graph_nodes(app: &Arc<App>, scope: Option<&str>) -> GraphNodes {
	let graph: Arc<dyn GraphStore> = Arc::new(ledgers::ScopedGraph::new(&app.stores.graphs, scope));
	Arc::new(move || graph.read_nodes().unwrap_or_default())
}

/// read_space, set_space_note and the space-file search: lessons in a space only. The search's
/// broken-formula line names the pdf tool, so it comes only while that tool is on.
fn space_tools(app: &Arc<App>, space_id: &str, pdf_on: bool) -> SpaceToolContext {
	let (card_app, card_id) = (app.clone(), space_id.to_owned());
	let (today_app, today_id) = (app.clone(), space_id.to_owned());
	let (note_app, note_id) = (app.clone(), space_id.to_owned());
	SpaceToolContext {
		space_card: Arc::new(move || card_app.stores.spaces.get_space(&card_id).map(|cls| space_card_for(&card_app, &cls)).transpose()),
		today_note: Some(Arc::new(move || current_today_note(&today_app, Some(&today_id)))),
		search: Some(Arc::new(space_search(app, space_id, pdf_on))),
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

/// The space actions a lesson's deadline changes run, named for the agent.
fn agent_space_actions(app: &Arc<App>) -> SpaceActions {
	let agent = app.bridge.agent_name(clock::now_ms());
	let actions = Arc::new(space_actions(app, agent.as_deref(), send_first_message(app), Mark::Started));
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
	let pdf_on = !switched_off(toggles.as_ref(), "pdf");
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
		Arc::new(move |job: &Json, input: &Json| run_job(&app, job["id"].str_or_empty(), Some(input.clone())))
	};
	let jobs = JobToolContext { chat_id: chat_id.clone(), job_store: app.stores.jobs.clone(), spawn };
	let side = LessonSide {
		space: lesson_scope.map(|id| space_tools(app, id, pdf_on)),
		search_graph: graph_tools_enabled(effective).then(|| lesson_graph_search(app, lesson_scope)),
		save_rule: Some(save_rule(app, lesson_scope)),
		space_actions: Some(agent_space_actions(app)),
		open_page: Some(agent_open_page(app)),
	};
	let teacher = || TeacherToolContext { plan: PlanContext { chat_id: chat_id.clone(), chat_store: chats.clone() }, jobs: jobs.clone(), side: side.clone() };

	let pages = problem_pages(app, lesson_scope, None);
	let kind = record["kind"].as_str();
	match (kind, lesson_scope, record["deadlineId"].as_str()) {
		(Some("practice"), ..) => {
			let ctx = PracticeToolContext { chat_id, chat_store: chats, graph_nodes: Some(graph_nodes(app, lesson_scope)), jobs: Some(jobs), side, pages };
			create_practice_agent(&ctx, opts)
		}
		(Some("homework"), Some(space_id), Some(deadline_id)) if !space_id.is_empty() && !deadline_id.is_empty() => {
			let ctx = HomeworkToolContext { chat_id, chat_store: chats, homework: deadline_problem_list(app, space_id, deadline_id), jobs: Some(jobs), side, pages: problem_pages(app, Some(space_id), Some(deadline_id)) };
			create_homework_agent(&ctx, opts)
		}
		(Some("study"), ..) => {
			let marks_app = app.clone();
			let check_marks = Arc::new(move |text: &str| check_cites(&marks_app, text));
			// Study sends deadline changes outside lessons, so it has no deadline tools.
			let teacher = TeacherToolContext { side: LessonSide { space_actions: None, ..side.clone() }, ..teacher() };
			create_study_agent(&StudyToolContext { teacher, graph_nodes: Some(graph_nodes(app, lesson_scope)), check_marks, pages, writes_plan: agent_writes_plan(record) }, opts)
		}
		_ if teaching => create_teacher_agent(Some(&teacher()), opts),
		_ => {
			let deliver_app = app.clone();
			let probe = ProbeDoneContext { chat_id: chat_id.clone(), chat_store: chats.clone(), deliver: Arc::new(move |steer| deliver_job_result(&deliver_app, steer)) };
			create_prober_agent(&ProberToolContext { probe, jobs, side }, opts)
		}
	}
}

#[cfg(test)]
mod tests {
	use gs_engine::turn::models::agent_engine;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	fn names_for(app: &Arc<App>, record: &Json, effective: &Json) -> Vec<String> {
		let turn = TurnAgent { chat_id: "chat_a".to_owned(), messages: Vec::new(), teaching: false, side_turn: false, engine: agent_engine(&app.bridge) };
		let agent = build_lesson_agent(app, record, effective, turn);
		agent.messages()[0]["toolsAdded"].as_arr().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_owned()).collect()
	}

	fn tool_names(app: &Arc<App>, kind: &str) -> Vec<String> {
		names_for(app, &json!({ "id": "chat_a", "kind": kind, "messages": [] }), &app.stores.settings.effective_settings().unwrap())
	}

	#[test]
	fn study_sends_deadline_changes_outside_lessons_and_other_lessons_keep_the_tools() {
		let root = scratch_dir("lesson-agent");
		let app = test_app(&root);
		let study = tool_names(&app, "study");
		assert!(study.contains(&"topic_done".to_owned()));
		assert!(!study.iter().any(|t| t.contains("deadline") || t == "list_spaces"), "{study:?}");
		for kind in ["practice", "lesson"] {
			assert!(tool_names(&app, kind).contains(&"add_space_deadline".to_owned()), "{kind}");
		}
	}

	#[test]
	fn every_lesson_opens_pages_study_too() {
		let root = scratch_dir("lesson-agent-open-page");
		let app = test_app(&root);
		for kind in ["study", "practice", "lesson"] {
			assert!(tool_names(&app, kind).contains(&"open_page".to_owned()), "{kind}");
		}
	}

	#[test]
	fn every_lesson_searches_its_own_graph_while_the_graph_switch_is_on() {
		let root = scratch_dir("lesson-agent-graph");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Botany" })).unwrap()["id"].as_str().unwrap().to_owned();
		let effective = app.stores.settings.effective_settings().unwrap();
		let in_space = names_for(&app, &json!({ "id": "chat_a", "kind": "study", "spaceId": space_id, "messages": [] }), &effective);
		assert!(in_space.contains(&"search_graph".to_owned()) && in_space.contains(&"read_space".to_owned()), "{in_space:?}");
		let no_space = tool_names(&app, "study");
		assert!(no_space.contains(&"search_graph".to_owned()) && !no_space.contains(&"read_space".to_owned()), "{no_space:?}");
		for kind in ["practice", "lesson"] {
			assert!(tool_names(&app, kind).contains(&"search_graph".to_owned()), "{kind}");
		}

		let mut off = effective.clone();
		off.get_mut("graph").and_then(Json::as_obj_mut).unwrap().insert("enabled", false);
		let study = names_for(&app, &json!({ "id": "chat_a", "kind": "study", "messages": [] }), &off);
		assert!(!study.contains(&"search_graph".to_owned()), "{study:?}");
	}

	#[test]
	fn a_study_lesson_has_plan_init_only_when_the_agent_writes_its_plan() {
		let root = scratch_dir("lesson-agent-plan");
		let app = test_app(&root);
		let effective = app.stores.settings.effective_settings().unwrap();
		let tree = json!({ "nodes": [{ "id": "t1", "title": "Sums" }], "edges": [] });
		let has_plan_init = |record: Json| names_for(&app, &record, &effective).contains(&"plan_init".to_owned());
		assert!(has_plan_init(json!({ "id": "chat_a", "kind": "study", "messages": [] })), "no plan from the app");
		assert!(!has_plan_init(json!({ "id": "chat_a", "kind": "study", "tree": tree, "messages": [] })), "the app's plan");
		let written = json!({ "role": "toolResult", "toolCallId": "p1", "toolName": "plan_init", "details": { "ok": true }, "timestamp": 1 });
		assert!(has_plan_init(json!({ "id": "chat_a", "kind": "study", "tree": tree, "messages": [written] })), "the agent's own plan");
	}
}
