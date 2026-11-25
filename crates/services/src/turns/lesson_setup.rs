//! The turn's instructions and tools, built from the record: practice, homework, study, or a
//! lesson's prober until its probe is done and its teacher after. Every kind shares the turn
//! composition; only the setup differs.

use std::sync::Arc;

use gs_agent::extraction::ledgers;
use gs_agent::subagents::headless::get_headless;
use gs_agent::teacher::teacher_agent::{AgentBuildOptions, LessonSetup, homework_setup, practice_setup, prober_setup, study_setup, teacher_setup};
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
use gs_base::{text, time};
use gs_core::session::plan::agent_writes_plan;
use gs_core::spaces::space_tools::ToolOutcome;
use gs_core::graph::ports::GraphStore;
use gs_core::records::settings_resolution::graph_tools_enabled;
use gs_core::records::teaching_areas::{every_turn_rules, learner_rules_section};
use gs_core::messages::native_messages::has_probe_done;
use gs_core::session::tool_switches::{VISUAL_TOOL, switched_off};
use gs_engine::turn::agent::BeforeToolCallFn;
use gs_json::{Json, json};

use super::chat_handler::send_first_message;
use super::lesson_problems::lesson_problem_list;
use super::job_host::run_job;
use super::problem_pages::problem_pages;
use crate::App;
use crate::app::agent_folder::folder_agent;
use crate::graph::graph::search_graph;
use crate::app::agent_rules::save_rule_by_agent;
use crate::app::open_page::agent_open_page;
use crate::app::today_note::current_today_note;
use crate::spaces::space_actions::{Mark, space_actions};
use crate::spaces::citations::check_cites;
use crate::spaces::space_card::space_card_for;
use crate::spaces::space_search::space_search;
use crate::jobs::deliver_job_result;
use crate::vault::lesson_vault_tool;

/// What one turn's setup is built from, besides the record.
pub(super) struct LessonTurn {
	pub chat_id: String,
	/// A successful probe_done is in the transcript: the teacher, not the prober.
	pub teaching: bool,
	pub side_turn: bool,
	/// The turn's own check of each call, after the agent's.
	pub call_check: Option<BeforeToolCallFn>,
}

/// The lesson's space name and rules, for the learner's-rules section.
fn lesson_space_rules(app: &App, space_id: Option<&str>) -> Option<(String, Vec<String>)> {
	let cls = app.stores.spaces.get_space(space_id?)?;
	let rules = cls["rules"].items().iter().filter_map(|r| r.as_str().map(str::to_owned)).collect();
	Some((cls["name"].str_or_empty().to_owned(), rules))
}

/// The learner's rules and his lesson's space rules, as both rule texts take them.
fn with_lesson_rules<T>(app: &App, effective: &Json, space_id: Option<&str>, text: impl FnOnce(&Json, Option<(&str, &[String])>) -> T) -> T {
	let space_rules = lesson_space_rules(app, space_id);
	text(&effective["agent"]["rules"], space_rules.as_ref().map(|(name, rules)| (name.as_str(), rules.as_slice())))
}

/// The rules block a lesson's later turns end with (`every_turn_rules`). It names the
/// figure tool while the lesson's teacher has it: the switch is on and its prober is done.
pub fn every_turn_rules_for(app: &App, lesson: &Json) -> String {
	let effective = app.stores.settings.effective_settings().unwrap_or_else(|err| {
		eprintln!("[work item] reading the settings for the learner's rules failed: {err}");
		Json::Null
	});
	let probing = !matches!(lesson["kind"].as_str(), Some("practice" | "homework" | "study")) && !has_probe_done(lesson["messages"].items());
	let figures = !probing && !switched_off(Some(&effective["agent"]["tools"]), VISUAL_TOOL);
	with_lesson_rules(app, &effective, lesson["spaceId"].as_str(), |rules, space| every_turn_rules(rules, space, figures))
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
	let actions = Arc::new(space_actions(app, Some(folder_agent(app).label()), send_first_message(app), Mark::Started));
	Arc::new(move |name: &str, args: Json| {
		let (actions, name) = (actions.clone(), name.to_owned());
		Box::pin(async move { actions.run(&name, &args).await.unwrap_or_else(|| ToolOutcome::Err(format!("{name} is not a space tool."))) })
	})
}

/// This turn's instructions and tools, from the record.
pub(super) fn lesson_setup(app: &Arc<App>, record: &Json, effective: &Json, turn: LessonTurn) -> LessonSetup {
	let LessonTurn { chat_id, teaching, side_turn, call_check } = turn;
	let lesson_scope = record["spaceId"].as_str();
	let toggles = Some(&effective["agent"]["tools"]).filter(|t| !t.is_null()).cloned();
	let pdf_on = !switched_off(toggles.as_ref(), "pdf");
	let opts = AgentBuildOptions {
		tool_toggles: toggles,
		learner_rules: Some(with_lesson_rules(app, effective, lesson_scope, learner_rules_section)),
		side_turn,
		call_check,
		..AgentBuildOptions::new(&app.stores.prompt_overrides)
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
		write_vault_note: lesson_vault_tool(app, &chat_id, record),
		visual: Some(get_headless(&app.pdf, app.shell.as_ref())),
	};
	let teacher = || TeacherToolContext { plan: PlanContext { chat_id: chat_id.clone(), chat_store: chats.clone() }, jobs: jobs.clone(), side: side.clone() };

	let pages = problem_pages(app, lesson_scope, None);
	let kind = record["kind"].as_str();
	match (kind, lesson_problem_list(app, record)) {
		(Some("practice"), _) => {
			let ctx = PracticeToolContext { chat_id, chat_store: chats, graph_nodes: Some(graph_nodes(app, lesson_scope)), jobs: Some(jobs), side, pages };
			practice_setup(&ctx, opts)
		}
		(Some("homework"), Some(homework)) => {
			let ctx = HomeworkToolContext { chat_id, chat_store: chats, homework, jobs: Some(jobs), side, pages: problem_pages(app, lesson_scope, record["deadlineId"].as_str()) };
			homework_setup(&ctx, opts)
		}
		(Some("study"), problems) => {
			let marks_app = app.clone();
			let check_marks = Arc::new(move |text: &str| check_cites(&marks_app, text));
			// Study sends deadline changes outside lessons, so it has no deadline tools.
			let teacher = TeacherToolContext { side: LessonSide { space_actions: None, ..side.clone() }, ..teacher() };
			study_setup(&StudyToolContext { teacher, graph_nodes: Some(graph_nodes(app, lesson_scope)), check_marks, pages, writes_plan: agent_writes_plan(record), problems }, opts)
		}
		_ if teaching => teacher_setup(Some(&teacher()), opts),
		_ => {
			let deliver_app = app.clone();
			let probe = ProbeDoneContext { chat_id: chat_id.clone(), chat_store: chats.clone(), deliver: Arc::new(move |steer| deliver_job_result(&deliver_app, steer)) };
			prober_setup(&ProberToolContext { probe, jobs, side: LessonSide { visual: None, ..side } }, opts)
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	fn names_for(app: &Arc<App>, record: &Json, effective: &Json) -> Vec<String> {
		names_of(app, record, effective, false)
	}

	fn names_of(app: &Arc<App>, record: &Json, effective: &Json, teaching: bool) -> Vec<String> {
		let turn = LessonTurn { chat_id: "chat_a".to_owned(), teaching, side_turn: false, call_check: None };
		lesson_setup(app, record, effective, turn).host.tool_names().map(str::to_owned).collect()
	}

	/// A new lesson tool fails here until lesson_steps.rs says what it is on the lesson's desk: a
	/// step, the plan, or nothing.
	#[test]
	fn every_lesson_tool_is_decided_for_the_desk() {
		use gs_core::session::lesson_steps::lesson_call;

		use crate::turns::step_names::AppStepNames;

		let root = scratch_dir("lesson-agent-desk");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "CSE 29" })).unwrap()["id"].as_str().unwrap().to_owned();
		let deadline_id = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "PA4", "kind": "homework", "date": "2099-01-15" })).unwrap()["id"].as_str().unwrap().to_owned();
		let homework = app.stores.chats.create_chat("PA4", Some("homework"), Some(&space_id), Some(&deadline_id), &[]).unwrap();
		let effective = app.stores.settings.effective_settings().unwrap();
		let lesson = |kind: &str| json!({ "id": "chat_a", "kind": kind, "spaceId": space_id, "messages": [] });
		let mut names: Vec<String> = ["study", "practice", "lesson"].iter().flat_map(|kind| names_for(&app, &lesson(kind), &effective)).collect();
		names.extend(names_of(&app, &lesson("lesson"), &effective, true));
		names.extend(names_for(&app, &homework, &effective));
		for tool in ["post_problems", "part", "read", "pdf", "work_plan", "read_passage", "demo", "visual"] {
			assert!(names.iter().any(|n| n == tool), "{tool} is among the lesson tools: {names:?}");
		}
		for name in &names {
			assert!(lesson_call(name, &json!({}), Some(&space_id), &AppStepNames(&app)).is_some(), "{name}");
		}
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
