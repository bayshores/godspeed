//! The question tools: client-answered, so each call only checks the
//! authoring rules and returns the "question posed" placeholder that ends the turn.

use std::sync::Arc;

use gs_core::session::argument_heal::heal_encoded_arguments;
use gs_core::session::code_question::{write_code_input_problems, write_code_input_schema};
use gs_core::session::question_core::{
	ask_input_schema, ask_option_problems, explain_input_base, explain_input_object, explain_input_problems, parse_options_if_string, probe_quiz_input_schema, quiz_input_object, quiz_input_problems,
	study_quiz_input_object, without_broken_keep,
};
use gs_engine::turn::tool_execute::{invalid_input_result, question_result};
use gs_engine::turn::validate::validate_tool_arguments;
use gs_json::{Json, json, stringify_pretty};

use super::fn_tool::FnTool;
use super::plan::PlanContext;

/// Models sometimes send `options` as a JSON-encoded string; this runs before validation so a
/// double-encoded call lands instead of costing a retry. Anything unparseable passes through.
fn prepare_question_arguments(mut args: Json) -> Result<Json, String> {
	let parsed = args["options"].as_str().and_then(|_| parse_options_if_string(Some(&args["options"]))).filter(|p| p.as_arr().is_some());
	if let (Some(parsed), Some(obj)) = (parsed, args.as_obj_mut()) {
		obj.insert("options", parsed);
	}
	Ok(args)
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
	// The schema check rejects such a call before it runs; called bare, it fails with this message.
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
		text.push_str(NODE_ID_RULE);
		text.push_str("For off-map checks use ask_user_question. ");
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

const NODE_ID_RULE: &str = "Set `nodeId` (required) to the plan node this question is about \u{2014} validated at call time against the session's plan map. ";

/// The explain mechanics (free-recall quizzing): the commitment rule is the grading contract.
fn explain_description(name: &str, with_node: bool) -> String {
	let node = if with_node { NODE_ID_RULE } else { "" };
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

/// The plan's node ids in a chat record.
pub fn node_ids_in(record: Option<&Json>) -> Vec<String> {
	record.iter().flat_map(|r| r["tree"]["nodes"].items().iter()).filter_map(|n| n["id"].as_str().map(str::to_owned)).collect()
}

/// The plan's node ids, read from the live chat record so mid-turn rewrites count.
pub fn plan_node_ids(ctx: &PlanContext) -> Vec<String> {
	node_ids_in(ctx.chat_store.get_chat(&ctx.chat_id).as_ref())
}

/// The refusal for a nodeId that is in none of the plan's `known` ids.
pub fn node_id_problem(known: &[String], node_id: &str) -> Option<String> {
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
	node_quiz_tool(ctx, quiz_input_object())
}

/// The Study quiz: the teach quiz whose schema adds `standalone`, which marks a quiz godspeed may
/// ask again weeks later, `onPlot` and `keep`.
pub fn study_quiz_tool(ctx: &PlanContext) -> FnTool {
	node_quiz_tool(ctx, study_quiz_input_object()).prepared(prepare_study_quiz)
}

/// The Study quiz's preparation: a keep that breaks its own rules leaves the prepared copy, so the
/// quiz is never refused for it; then `options` sent as a string, then any field sent JSON-encoded.
fn prepare_study_quiz(args: Json) -> Result<Json, String> {
	Ok(heal_encoded_arguments(&prepare_question_arguments(without_broken_keep(args))?, &study_quiz_input_object()))
}

/// A Study quiz call as its tool takes it: the arguments after its preparation (and validation,
/// when they pass it), and whether they pass every check. The lesson-parts hook reads a plot's
/// guess this way.
pub fn study_quiz_call(known: &[String], sent: &Json) -> (Json, bool) {
	let Ok(prepared) = prepare_study_quiz(sent.clone()) else { return (sent.clone(), false) };
	match validate_tool_arguments("quiz", &study_quiz_input_object(), &prepared) {
		Ok(args) => {
			let passes = with_node_check(quiz_input_problems(&args), known, &args).is_empty();
			(args, passes)
		}
		Err(_) => (prepared, false),
	}
}

/// A question's authoring problems with its plan-node check added.
fn with_node_check(mut problems: Vec<String>, known: &[String], args: &Json) -> Vec<String> {
	problems.extend(node_id_problem(known, args["nodeId"].str_or_empty()));
	problems
}

fn node_quiz_tool(ctx: &PlanContext, schema: Json) -> FnTool {
	let ctx = ctx.clone();
	FnTool::immediate("quiz", quiz_description("quiz", true), schema, move |args| verdict("quiz", &with_node_check(quiz_input_problems(&args), &plan_node_ids(&ctx), &args))).sequential().prepared(prepare_question_arguments)
}

/// The teach free-recall tool, with the same plan-node check.
pub fn teach_explain_tool(ctx: &PlanContext) -> FnTool {
	let ctx = ctx.clone();
	FnTool::immediate("explain", explain_description("explain", true), explain_input_object(), move |args| {
		verdict("explain", &with_node_check(explain_input_problems(&args), &plan_node_ids(&ctx), &args))
	})
	.sequential()
	.prepared(prepare_question_arguments)
}

/// The teach questions without a record to read: quiz with no node check, plus ask.
pub fn bare_question_tools() -> Vec<FnTool> {
	let quiz = FnTool::immediate("quiz", "Ask the learner a graded question.", quiz_input_object(), |args| verdict("quiz", &quiz_input_problems(&args))).sequential();
	vec![quiz.healed(), ask_user_question_tool().healed()]
}
