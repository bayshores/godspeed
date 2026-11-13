//! save_rule: the teacher saves a lasting teaching rule when the
//! learner states a preference. The learner sees it in the chat and can undo or edit it.

use std::sync::Arc;

use gs_core::records::teaching_areas::{RULE_MAX_CHARS, TEACHING_AREAS};
use gs_json::{Json, json};

use super::fn_tool::FnTool;
use gs_core::session::schema::{object, one_of_literals};

/// Saves the rule (text, `every_lesson` or `this_space`, area) and gives back the saved rule
/// or the refusal as text.
pub type SaveRule = Arc<dyn Fn(&str, &str, Option<&str>) -> Json + Send + Sync>;

pub fn save_rule_tool(save_rule: SaveRule) -> FnTool {
	let area_ids: Vec<&str> = TEACHING_AREAS.iter().map(|a| a.id).collect();
	let parameters = object(
		&["rule", "for"],
		vec![
			(
				"rule",
				json!({
					"type": "string",
					"minLength": 1,
					"maxLength": RULE_MAX_CHARS,
					"description": "One line, an instruction to yourself in plain words, e.g. \"Use Python for code examples.\"",
				}),
			),
			("for", one_of_literals(&["every_lesson", "this_space"], "\"every_lesson\", or \"this_space\" when it only matters in this lesson's space.")),
			(
				"area",
				one_of_literals(
					&area_ids,
					"With every_lesson, the part of teaching it is about: \"voice\" (how you talk), \"teaching\" (planning and steps, the default), \"questions\" (checks and quizzes), \"facts\" (accuracy and research), \"demos\" (demos and figures), \"files\" (the learner's files, formatting and code).",
				),
			),
		],
	);
	let description = "Save a rule about how to teach this learner, when they tell you a preference that should hold in later lessons too (\"use Python from now on\", \"shorter answers please\"). \
		It joins the learner's rules and applies from your next turn. Don't use it for a one-off request, for facts about the learner, or for a rule they already have. \
		Don't ask first: the learner sees it in the chat and can undo or edit it, so just mention it in a few words.";
	FnTool::server("save_rule", description, parameters, move |args, _ctx| {
		let save_rule = save_rule.clone();
		async move { Ok(save_rule(args["rule"].as_str().unwrap_or_default(), args["for"].as_str().unwrap_or_default(), args["area"].as_str())) }
	})
}
