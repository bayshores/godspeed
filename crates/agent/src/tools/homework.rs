//! The homework tools: post_problems saves the assignment's
//! problems on its deadline, problem opens one in the learner's Your turn panel (it ends the turn,
//! but carries no solution: homework is hints only), part marks the part the learner is on there,
//! conclude closes it and marks it done when the learner's own work was right. The side tools are
//! practice's.

use std::sync::Arc;

use gs_core::contracts::space::MAX_HOMEWORK_PROBLEMS;
use gs_core::messages::native_messages::active_problem_of;
use gs_core::session::question_core::{problem_choice_fields, problem_choice_problems};
use gs_base::clock;
use gs_core::study::homework::{conclude_marks_done, picked_problem};
use gs_core::study::topic_end::long_problem_stop;
use gs_engine::turn::messages::text_block;
use gs_engine::turn::tool_execute::{conclude_result, invalid_input_result, problem_result};
use gs_json::{Json, js_number, json, quote};
use parking_lot::Mutex;

use super::fn_tool::FnTool;
use super::heal::heal_tool_record;
use super::jobs::JobToolContext;
use super::ports::ChatPort;
use super::practice::{practice_side_tools, record_messages};
use gs_core::session::schema::{object, one_of_literals, string};
use super::side::LessonSide;

/// The session's deadline, read and written through the space store.
pub trait HomeworkDeadline: Send + Sync {
	fn problems(&self) -> Vec<Json>;
	/// Saves the list (done marks kept by number); the refusal text when refused.
	fn post(&self, problems: &[Json]) -> Option<String>;
	fn mark_done(&self, number: &str);
}

#[derive(Clone)]
pub struct HomeworkToolContext {
	pub chat_id: String,
	pub chat_store: Arc<dyn ChatPort>,
	pub homework: Arc<dyn HomeworkDeadline>,
	pub jobs: Option<JobToolContext>,
	pub side: LessonSide,
}

/// The number of the problem open in the stored record, as the pose wrote it.
fn open_problem_of(ctx: &HomeworkToolContext) -> Option<String> {
	let record = ctx.chat_store.get_chat(&ctx.chat_id)?;
	let active = active_problem_of(record["messages"].items())?;
	Some(match &active.input["number"] {
		Json::Str(number) => number.clone(),
		Json::Num(number) => js_number(*number),
		Json::Bool(flag) => flag.to_string(),
		_ => String::new(),
	})
}

fn post_problems_tool(homework: Arc<dyn HomeworkDeadline>) -> FnTool {
	let problem = object(
		&["number", "title", "text"],
		vec![
			("number", string("As the assignment numbers it, e.g. \"1\", \"2b\", \"Q3\". Unique.")),
			("title", string("A few words on what it asks.")),
			("text", string("The problem as the assignment states it (markdown + LaTeX), with any parts.")),
			("page", json!({ "type": "integer", "minimum": 1, "description": "The assignment page it is on." })),
		],
	);
	let parameters = object(&["problems"], vec![("problems", json!({ "type": "array", "items": problem, "minItems": 1, "maxItems": MAX_HOMEWORK_PROBLEMS }))]);
	let description = "Save the assignment's problems, all of them in order, in one call. The learner sees them as the session's list with how many are done. Calling it again replaces the list; a problem keeps its done mark by number.";
	FnTool::immediate("post_problems", description, parameters, move |args| {
		let problems = args["problems"].items();
		if let Some(refused) = homework.post(problems) {
			return invalid_input_result("post_problems", &[refused]);
		}
		json!({ "content": [text_block(&format!("Saved {} problems.", problems.len()))], "details": null })
	})
	.sequential()
}

fn problem_tool(homework: Arc<dyn HomeworkDeadline>, open: &Arc<Mutex<Option<String>>>) -> FnTool {
	let open = open.clone();
	let mut fields = vec![
		("number", string("REQUIRED \u{2014} the problem's number as posted with post_problems.")),
		(
			"statement",
			string("REQUIRED \u{2014} the problem as the learner sees it while working (markdown + LaTeX): the assignment's wording, starting with the problem itself, never a title or heading line. When you pass options, the statement never lists them again and never says how many to pick: the rows say \"Select all that apply\" themselves. Never any part of its answer."),
		),
	];
	fields.extend(problem_choice_fields());
	let parameters = object(&["number", "statement"], fields);
	let description = "Open one problem in the learner's Your turn panel, where it stays in view. Ends the turn: the learner's work and questions arrive as their messages (text and photos). Only one problem is open at a time; conclude it before opening the next.";
	FnTool::immediate("problem", description, parameters, move |args| {
		let choice_problems = problem_choice_problems(&args);
		if !choice_problems.is_empty() {
			return invalid_input_result("problem", &choice_problems);
		}
		let mut open = open.lock();
		if let Some(number) = open.as_ref() {
			return invalid_input_result("problem", &[format!("problem {number} is still open \u{2014} conclude it first")]);
		}
		let numbers: Vec<String> = homework.problems().iter().map(|p| p["number"].str_or_empty().to_owned()).collect();
		if numbers.is_empty() {
			return invalid_input_result("problem", &["no problems are posted yet \u{2014} post them with post_problems first".to_owned()]);
		}
		let number = args["number"].str_or_empty();
		if !numbers.iter().any(|n| n == number) {
			return invalid_input_result("problem", &[format!("no problem numbered {}; the numbers are {}", quote(number), numbers.join(", "))]);
		}
		*open = Some(number.to_owned());
		problem_result("the learner's work and questions arrive as their messages.")
	})
	.sequential()
}

fn part_tool(open: &Arc<Mutex<Option<String>>>) -> FnTool {
	let open = open.clone();
	let parameters = object(&["part"], vec![("part", string("REQUIRED \u{2014} the part as the problem labels it, e.g. \"a\", \"b\", \"2\"."))]);
	let description = "For a problem with parts: mark the part the learner works on now, when they start it. Their panel opens that part and folds the others. Doesn't end the turn.";
	FnTool::immediate("part", description, parameters, move |_args| {
		if open.lock().is_none() {
			return invalid_input_result("part", &["no problem is open".to_owned()]);
		}
		json!({ "content": [text_block("Marked.")], "details": null })
	})
	.sequential()
}

fn conclude_tool(ctx: &HomeworkToolContext, open: &Arc<Mutex<Option<String>>>) -> FnTool {
	let (open, homework, chat_id, chat_store) = (open.clone(), ctx.homework.clone(), ctx.chat_id.clone(), ctx.chat_store.clone());
	let parameters = object(
		&["outcome", "verdict"],
		vec![
			(
				"outcome",
				one_of_literals(
					&["solved", "solvedWithHints", "movedOn", "dismissed"],
					"REQUIRED \u{2014} solved or solvedWithHints once the learner's own work is right (marks the problem done), movedOn when the learner leaves it for now. Bare words, no quotes (dismissed is synthesized, never yours).",
				),
			),
			("verdict", string("REQUIRED \u{2014} what was right in the learner's work, or where it still breaks. Never the answer.")),
		],
	);
	let description = "Close the open problem with the outcome and verdict; solved and solvedWithHints mark it done. Then say your closing words and END YOUR TURN: the next problem waits for the learner's go-ahead. When they asked for a different problem, that ask is the go-ahead: open it right after this result.";
	FnTool::immediate("conclude", description, parameters, move |args| {
		let mut open = open.lock();
		let Some(number) = open.take() else {
			return invalid_input_result("conclude", &["no problem is open".to_owned()]);
		};
		if conclude_marks_done(&args["outcome"]) {
			homework.mark_done(&number);
		}
		// With every problem done, the done bar shows instead of a stop; a problem left for a picked
		// one makes none either.
		let left = homework.problems().iter().any(|p| !p["done"].truthy());
		let messages = record_messages(&chat_store, &chat_id);
		let picked = args["outcome"].as_str() == Some("movedOn") && picked_problem(&messages).is_some();
		conclude_result((left && !picked).then(|| long_problem_stop(&messages, clock::now_ms())).flatten())
	})
	.sequential()
}

/// The homework agent's whole registry; `enabled` filters the side tools as in practice.
pub fn homework_tools(ctx: &HomeworkToolContext, enabled: Option<&Json>) -> Vec<FnTool> {
	let open = Arc::new(Mutex::new(open_problem_of(ctx)));
	let mut tools = vec![post_problems_tool(ctx.homework.clone()), problem_tool(ctx.homework.clone(), &open), part_tool(&open), conclude_tool(ctx, &open)];
	tools.extend(practice_side_tools(ctx.jobs.as_ref(), &ctx.side, enabled));
	heal_tool_record(tools)
}

#[cfg(test)]
mod tests {
	use gs_engine::turn::abort::Abort;
	use gs_engine::turn::tool::{Tool, ToolContext};

	use super::*;
	use crate::tools::plan::PlanContext;
	use crate::tools::test_record::{learner_at, record};

	struct Deadline(Mutex<Vec<Json>>);

	impl HomeworkDeadline for Deadline {
		fn problems(&self) -> Vec<Json> {
			self.0.lock().clone()
		}
		fn post(&self, _problems: &[Json]) -> Option<String> {
			None
		}
		fn mark_done(&self, number: &str) {
			for p in self.0.lock().iter_mut().filter(|p| p["number"].as_str() == Some(number)) {
				p.as_obj_mut().unwrap().insert("done", true);
			}
		}
	}

	/// Problem 1 open for 26 active minutes, with problem 2 after it; `then` is the learner's
	/// newest input.
	async fn conclude_one(outcome: &str, problems: Json, then: Option<Json>) -> Json {
		let posed = json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "h1", "name": "problem", "arguments": { "number": "1", "statement": "s" } }], "timestamp": clock::now_ms() - 26 * 60_000 });
		let result = json!({ "role": "toolResult", "toolCallId": "h1", "toolName": "problem", "details": null, "isError": false, "timestamp": clock::now_ms() - 26 * 60_000 });
		let worked: Vec<Json> = (0..6).map(|i| learner_at(22 - 4 * i)).collect();
		let PlanContext { chat_id, chat_store } = record([vec![posed, result], worked, then.into_iter().collect()].concat());
		let homework = Arc::new(Deadline(Mutex::new(problems.as_arr().unwrap().clone())));
		let ctx = HomeworkToolContext { chat_id, chat_store, homework, jobs: None, side: LessonSide::default() };
		let tool = homework_tools(&ctx, None).into_iter().find(|t| t.name() == "conclude").unwrap();
		tool.execute(json!({ "outcome": outcome, "verdict": "v" }), ToolContext { tool_call_id: "c1".to_owned(), abort: Abort::new() }).await.unwrap()
	}

	#[tokio::test]
	async fn a_long_problem_stops_unless_none_is_left() {
		let two = json!([{ "number": "1" }, { "number": "2" }]);
		let stop = &conclude_one("solved", two.clone(), None).await["details"]["stop"];
		assert_eq!((stop["kind"].as_str(), stop["activeMinutes"].as_f64()), (Some("problem"), Some(26.0)));
		assert_eq!(conclude_one("solved", json!([{ "number": "1" }, { "number": "2", "done": true }]), None).await["details"], Json::Null, "the done bar shows instead");
		assert_eq!(conclude_one("movedOn", json!([{ "number": "1" }]), None).await["details"]["stop"]["kind"].as_str(), Some("problem"), "problem 1 is still undone");
		let pick = json!({ "role": "custom", "customType": "practice-next", "details": { "number": "2" }, "timestamp": clock::now_ms() });
		assert_eq!(conclude_one("movedOn", two.clone(), Some(pick.clone())).await["details"], Json::Null, "he picked problem 2: no break before it");
		assert_eq!(conclude_one("solved", two, Some(pick)).await["details"]["stop"]["kind"].as_str(), Some("problem"), "solved on the way still stops");
	}

	#[tokio::test]
	async fn a_choice_problem_needs_two_to_eight_options() {
		let ctx = HomeworkToolContext { chat_id: "c".to_owned(), chat_store: record(vec![]).chat_store, homework: Arc::new(Deadline(Mutex::new(vec![json!({ "number": "1" })]))), jobs: None, side: LessonSide::default() };
		let tool = homework_tools(&ctx, None).into_iter().find(|t| t.name() == "problem").unwrap();
		let pose = |extra: Json| {
			let mut input = json!({ "number": "1", "statement": "s" });
			for (key, value) in extra.as_obj().unwrap().iter() {
				input.as_obj_mut().unwrap().insert(key, value.clone());
			}
			tool.execute(input, ToolContext { tool_call_id: "p1".to_owned(), abort: Abort::new() })
		};
		let out = pose(json!({ "options": [{ "label": "only" }] })).await.unwrap();
		assert_eq!(out["isError"].as_bool(), Some(true));
		assert!(out["details"]["problems"][0].as_str().unwrap().contains("1 items"));
		assert_eq!(pose(json!({ "multiSelect": true })).await.unwrap()["isError"].as_bool(), Some(true));
		assert_ne!(pose(json!({ "options": [{ "label": "a" }, { "label": "b" }] })).await.unwrap()["isError"].as_bool(), Some(true));
	}
}
