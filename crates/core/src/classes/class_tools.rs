//! The class tools both the outside agent's MCP server and the Talk chat offer: their names,
//! descriptions (`class_tool_text`), argument shapes and outcome.

use gs_json::Json;

pub use super::class_tool_text::{CLASS_ARG_TEXT, CLASS_TOOL_TEXT, ClassArgText};
pub use crate::contracts::class::DEADLINE_KINDS;

pub const FILE_KINDS: [&str; 2] = ["study", "info"];

/// A page the learner can open to see what a class tool changed.
#[derive(Clone, Debug, PartialEq)]
pub struct ClassChange {
	pub label: String,
	pub page: String,
}

/// What a class tool gives back.
#[derive(Clone, Debug, PartialEq)]
pub enum ToolOutcome {
	Ok { value: Json, changes: Vec<ClassChange> },
	Err(String),
}

/// The lesson the last turn started with start_lesson (in Talk), so the agent is sent on to
/// teach it. None when the turn started none.
pub fn lesson_started_last_turn(messages: &[Json]) -> Option<String> {
	for m in messages.iter().rev() {
		let role = m["role"].as_str();
		if role != Some("assistant") && role != Some("toolResult") {
			return None;
		}
		if role != Some("toolResult") || m["toolName"].as_str() != Some("start_lesson") || m["isError"].truthy() {
			continue;
		}
		if let Some(id) = m["details"]["changes"][0]["page"].as_str().and_then(|page| page.strip_prefix("/chat/")).filter(|id| !id.is_empty()) {
			return Some(id.to_owned());
		}
	}
	None
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn started(page: &str) -> Json {
		json!({ "role": "toolResult", "toolName": "start_lesson", "isError": false, "details": { "changes": [{ "label": "Lesson", "page": page }] } })
	}

	#[test]
	fn finds_the_lesson_started_in_the_last_turn() {
		let user = json!({ "role": "user" });
		assert_eq!(lesson_started_last_turn(&[user.clone(), started("/chat/abc"), json!({ "role": "assistant" })]).as_deref(), Some("abc"));
		assert_eq!(lesson_started_last_turn(&[started("/chat/abc"), user]), None);
		assert_eq!(lesson_started_last_turn(&[started("/chat/")]), None);
	}

	#[test]
	fn tool_texts_cover_every_tool() {
		assert_eq!(CLASS_TOOL_TEXT.len(), 13);
		assert!(CLASS_ARG_TEXT.icon.starts_with("The class's subject icon in the class switcher: \"cpu\" Computer science, "));
		assert!(CLASS_ARG_TEXT.signature.contains("At most 60 characters."));
	}
}
