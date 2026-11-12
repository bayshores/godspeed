//! The homework tools (src/backend/agent/tools/homework.ts): post_problems saves the assignment's
//! problems on its deadline, problem opens one in the learner's Your turn panel (it ends the turn,
//! but carries no solution: homework is hints only), conclude closes it and marks it done when the
//! learner's own work was right. The side tools are practice's.

use std::sync::Arc;

use gs_core::contracts::space::MAX_HOMEWORK_PROBLEMS;
use gs_core::messages::native_messages::active_problem_of;
use gs_core::study::homework::conclude_marks_done;
use gs_engine::turn::tool_execute::{conclude_result, invalid_input_result, problem_result};
use gs_json::{Json, js_number, json, quote};
use parking_lot::Mutex;

use super::fn_tool::FnTool;
use super::graph::GraphToolContext;
use super::heal::heal_tool_record;
use super::jobs::JobToolContext;
use super::ports::ChatPort;
use super::practice::practice_side_tools;
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
	pub graph: Option<GraphToolContext>,
	pub jobs: Option<JobToolContext>,
	pub side: LessonSide,
}

/// The number of the problem open in the stored record, as the pose wrote it.
fn open_problem_of(ctx: &HomeworkToolContext) -> Option<String> {
	let record = ctx.chat_store.get_chat(&ctx.chat_id)?;
	let active = active_problem_of(record["messages"].as_arr().map_or(&[][..], Vec::as_slice))?;
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
		let problems = args["problems"].as_arr().map(Vec::as_slice).unwrap_or_default();
		if let Some(refused) = homework.post(problems) {
			return invalid_input_result("post_problems", &[refused]);
		}
		json!({ "content": [{ "type": "text", "text": format!("Saved {} problems.", problems.len()) }], "details": null })
	})
	.sequential()
}

fn problem_tool(homework: Arc<dyn HomeworkDeadline>, open: &Arc<Mutex<Option<String>>>) -> FnTool {
	let open = open.clone();
	let parameters = object(
		&["number", "statement"],
		vec![
			("number", string("REQUIRED \u{2014} the problem's number as posted with post_problems.")),
			("statement", string("REQUIRED \u{2014} the problem as the learner sees it while working (markdown + LaTeX): the assignment's wording. Never any part of its answer.")),
		],
	);
	let description = "Open one problem in the learner's work area. Ends the turn: the learner's work arrives as *Your thinking* messages (text and photos). Only one problem is open at a time; conclude it before opening the next.";
	FnTool::immediate("problem", description, parameters, move |args| {
		let mut open = open.lock();
		if let Some(number) = open.as_ref() {
			return invalid_input_result("problem", &[format!("problem {number} is still open \u{2014} conclude it first")]);
		}
		let numbers: Vec<String> = homework.problems().iter().map(|p| p["number"].as_str().unwrap_or_default().to_owned()).collect();
		if numbers.is_empty() {
			return invalid_input_result("problem", &["no problems are posted yet \u{2014} post them with post_problems first".to_owned()]);
		}
		let number = args["number"].as_str().unwrap_or_default();
		if !numbers.iter().any(|n| n == number) {
			return invalid_input_result("problem", &[format!("no problem numbered {}; the numbers are {}", quote(number), numbers.join(", "))]);
		}
		*open = Some(number.to_owned());
		problem_result()
	})
	.sequential()
}

fn conclude_tool(homework: Arc<dyn HomeworkDeadline>, open: &Arc<Mutex<Option<String>>>) -> FnTool {
	let open = open.clone();
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
	let description = "Close the open problem with the outcome and verdict; solved and solvedWithHints mark it done. Then say your closing words and END YOUR TURN: the next problem waits for the learner's go-ahead.";
	FnTool::immediate("conclude", description, parameters, move |args| {
		let mut open = open.lock();
		let Some(number) = open.take() else {
			return invalid_input_result("conclude", &["no problem is open".to_owned()]);
		};
		if conclude_marks_done(&args["outcome"]) {
			homework.mark_done(&number);
		}
		conclude_result()
	})
	.sequential()
}

/// The homework agent's whole registry; `enabled` filters the side tools as in practice.
pub fn homework_tools(ctx: &HomeworkToolContext, enabled: Option<&Json>) -> Vec<FnTool> {
	let open = Arc::new(Mutex::new(open_problem_of(ctx)));
	let mut tools = vec![post_problems_tool(ctx.homework.clone()), problem_tool(ctx.homework.clone(), &open), conclude_tool(ctx.homework.clone(), &open)];
	tools.extend(practice_side_tools(ctx.jobs.as_ref(), ctx.graph.as_ref(), &ctx.side, enabled));
	heal_tool_record(tools)
}
