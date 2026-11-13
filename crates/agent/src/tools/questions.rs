//! The question tools: client-answered, so each call only checks the
//! authoring rules and returns the "question posed" placeholder that ends the turn.

use std::sync::Arc;

use gs_core::session::code_question::{write_code_input_problems, write_code_input_schema};
use gs_core::session::question_core::{
	ask_input_schema, ask_option_problems, explain_input_base, explain_input_object, explain_input_problems, parse_options_if_string, probe_quiz_input_schema, quiz_input_object, quiz_input_problems,
};
use gs_engine::turn::tool_execute::{invalid_input_result, question_result};
use gs_json::{Json, json, stringify_pretty};

use super::fn_tool::FnTool;
use super::plan::PlanContext;

/// Models sometimes send `options` as a JSON-encoded string; this runs before validation so a
/// double-encoded call lands instead of costing a retry. Anything unparseable passes through.
fn prepare_question_arguments(mut args: Json) -> Json {
	let parsed = args["options"].as_str().and_then(|_| parse_options_if_string(Some(&args["options"]))).filter(|p| p.as_arr().is_some());
	if let (Some(parsed), Some(obj)) = (parsed, args.as_obj_mut()) {
		obj.insert("options", parsed);
	}
	args
}

/// The tool's answer for the authoring problems found: an error result to retry on, or the
/// placeholder that ends the turn.
fn verdict(name: &str, problems: &[String]) -> Json {
	if problems.is_empty() { question_result() } else { invalid_input_result(name, problems) }
}

pub fn ask_user_question_tool() -> FnTool {
	let description = "Ask the learner a single question and pause until they answer. NOT graded \u{2014} there is no correct answer. \
		Use when requirements are ambiguous, preferences are needed, a decision would materially affect the lesson, \
		or you need an open-ended response. ONE question per turn: call a single ask_user_question, then end your \
		turn \u{2014} his answer determines the next.";
	FnTool::immediate("ask_user_question", description, ask_input_schema(), |args| {
		let options = args["options"].as_arr().cloned().unwrap_or_default();
		verdict("ask_user_question", &ask_option_problems(&options))
	})
	.sequential()
	.prepared(prepare_question_arguments)
	// The schema check rejects such a call before it runs; called bare, the TypeScript throws.
	.with_run(|run| {
		Arc::new(move |args, ctx| {
			let run = run.clone();
			Box::pin(async move {
				if !matches!(args["options"], Json::Null | Json::Arr(_)) {
					return Err("options.forEach is not a function".to_owned());
				}
				run(args, ctx).await
			})
		})
	})
}

/// The example call every quiz description ends with: its escaping is the exemplar the models
/// copy, and the same body serves every variant.
fn quiz_example_body() -> Vec<(&'static str, Json)> {
	vec![
		("question", json!("A signal is $y=\\sin(2x)$ and $\\frac{dx}{dt}=3$. What is $\\frac{dy}{dt}$?")),
		(
			"options",
			json!([
				{ "label": "$6\\cos(2x)$", "value": "a" },
				{ "label": "$2\\cos(2x)$", "value": "b" },
				{ "label": "$3\\cos(2x)$", "value": "c" },
			]),
		),
		("explanation", json!("The phase changes twice as fast as $x$; multiply by the sine's slope:\n$$\n\\frac{dy}{dt}=\\cos(2x)\\cdot2\\cdot3=6\\cos(2x)\n$$")),
		("correctAnswer", json!("a")),
	]
}

/// The quiz mechanics every variant shares; `with_node` is the teach variant, which also names
/// the question's role and the plan node.
fn quiz_description(name: &str, with_node: bool) -> String {
	let mut text = format!(
		"Ask the learner a GRADED question with a known correct answer, then instantly grade and give feedback. \
		Unlike ask_user_question (which collects preferences/decisions with no right answer), {name} always has a \
		correct answer supplied by you, marks the learner's selection right/wrong, reveals the correct answer, and \
		can show an explanation. Options-only: single-select or multi-select, plus an automatic 'I don't know' \
		choice so the learner can signal a genuine gap instead of guessing. An always-present optional thinking \
		field lets the learner attach his reasoning to ANY answer; it reaches you only when non-empty. \
		No free-text answers \u{2014} for non-graded questions use ask_user_question instead. "
	);
	if with_node {
		text.push_str("Every call declares `type` \u{2014} the question's role in the teaching cycle; the field's own description says when each kind fires. ");
		text.push_str("Set `nodeId` (required) to the plan node this question is about \u{2014} validated at call time against the session's plan map. For off-map checks use ask_user_question. ");
	}
	text.push_str(&format!("ONE question per turn: call a single {name}, then end your turn \u{2014} his answer determines the next."));
	// The teach example leads with the required pair models drop most; the probe one carries none.
	let mut example = gs_json::Obj::new();
	if with_node {
		example.insert("type", "check");
		example.insert("nodeId", "chain-rule");
	}
	for (key, value) in quiz_example_body() {
		example.insert(key, value);
	}
	text.push_str("\nExample arguments \u{2014} copy the escaping exactly: inside JSON strings a LaTeX backslash is \\\\ and a newline is \\n.\n```json\n");
	text.push_str(&stringify_pretty(&Json::Obj(example), "  "));
	text.push_str("\n```");
	if with_node {
		text.push_str(" The example's nodeId is illustrative \u{2014} copy an exact id from this session's plan_init.");
	}
	text
}

/// The explain mechanics (free-recall quizzing): the commitment rule is the grading contract.
fn explain_description(name: &str, with_node: bool) -> String {
	let node = if with_node {
		"Set `nodeId` (required) to the plan node this question is about \u{2014} validated at call time against the session's plan map. "
	} else {
		""
	};
	format!(
		"Ask the learner to EXPLAIN something in his own words \u{2014} a graded check with NO options: he types a free-text \
		answer. Unlike ask_user_question (no right answer), {name} always has one. THE COMMITMENT RULE: \
		correctAnswer is the FULL correct answer in your own words, reasoning included, COMMITTED before he ever \
		sees the question. When his answer returns, grade it strictly against the commitment \u{2014} never revise it \
		after seeing his words. He sees the committed answer on submit. {node}\
		ONE question per turn: call a single {name}, then end your turn \u{2014} his answer determines the next."
	)
}

/// The prober's multiple-choice tool, named `probe` so a probe-phase call shape never carries
/// into teaching.
pub fn probe_quiz_tool() -> FnTool {
	FnTool::immediate("probe", quiz_description("probe", false), probe_quiz_input_schema(), |args| verdict("probe", &quiz_input_problems(&args))).sequential().prepared(prepare_question_arguments)
}

/// The prober's free-recall tool, named `recall` for the same reason.
pub fn probe_explain_tool() -> FnTool {
	FnTool::immediate("recall", explain_description("recall", false), explain_input_base(), |args| verdict("recall", &explain_input_problems(&args))).sequential().prepared(prepare_question_arguments)
}

pub fn write_code_tool() -> FnTool {
	let description = "Ask the learner to WRITE CODE. He gets a code editor (line numbers, syntax highlighting) that starts with \
		`starter`, an 'I don't know' choice, and an optional thinking field. The app never runs or grades the code: \
		his answer returns to you as {\"kind\":\"code\",\"code\":...,\"language\":...} (plus dontKnow: true instead of code \
		when he doesn't know, and thinking when he wrote some), and your next reply grades it. \
		ONE question per turn: call a single write_code, then end your turn. His answer determines the next.";
	FnTool::immediate("write_code", description, write_code_input_schema(), |args| verdict("write_code", &write_code_input_problems(&args))).sequential()
}

/// The plan's node-id check, read from the live chat record so mid-turn rewrites count.
pub fn node_id_problem(ctx: &PlanContext, node_id: &str) -> Option<String> {
	let record = ctx.chat_store.get_chat(&ctx.chat_id);
	let known: Vec<String> = record.iter().flat_map(|r| r["tree"]["nodes"].as_arr().into_iter().flatten()).filter_map(|n| n["id"].as_str().map(str::to_owned)).collect();
	if known.iter().any(|id| id == node_id) {
		return None;
	}
	let hint = if known.is_empty() {
		"No plan map exists yet \u{2014} call plan_init before posing quizzes.".to_owned()
	} else {
		let more = if known.len() > 5 { ", \u{2026}" } else { "" };
		format!("Copy one of the plan's node ids exactly ({}{more}).", known.iter().take(5).cloned().collect::<Vec<_>>().join(", "))
	};
	Some(format!("nodeId \"{node_id}\" matches no node in this session's plan map. {hint}"))
}

/// The teach quiz: the shared authoring rules plus the plan-node check.
pub fn teach_quiz_tool(ctx: &PlanContext) -> FnTool {
	let ctx = ctx.clone();
	FnTool::immediate("quiz", quiz_description("quiz", true), quiz_input_object(), move |args| {
		let mut problems = quiz_input_problems(&args);
		problems.extend(node_id_problem(&ctx, args["nodeId"].as_str().unwrap_or_default()));
		verdict("quiz", &problems)
	})
	.sequential()
	.prepared(prepare_question_arguments)
}

/// The teach free-recall tool, with the same plan-node check.
pub fn teach_explain_tool(ctx: &PlanContext) -> FnTool {
	let ctx = ctx.clone();
	FnTool::immediate("explain", explain_description("explain", true), explain_input_object(), move |args| {
		let mut problems = explain_input_problems(&args);
		problems.extend(node_id_problem(&ctx, args["nodeId"].as_str().unwrap_or_default()));
		verdict("explain", &problems)
	})
	.sequential()
	.prepared(prepare_question_arguments)
}

/// The teach questions without a record to read: quiz with no node check, plus ask.
pub fn bare_question_tools() -> Vec<FnTool> {
	let quiz = FnTool::immediate("quiz", "Ask the learner a graded question.", quiz_input_object(), |args| verdict("quiz", &quiz_input_problems(&args))).sequential();
	vec![quiz.healed(), ask_user_question_tool().healed()]
}
