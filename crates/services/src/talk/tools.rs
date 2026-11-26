//! godspeed's data tools, which the agent calls in free talk: lessons and graphs (`lessons`, `graph`), spaces (`spaces`), memory (`memory`) and the notes
//! vault (`vault`). Deleting a space is app-only on purpose. tools.json is the list (order,
//! titles, descriptions, annotations, JSON Schemas); a call's arguments are checked against its
//! schema (`schema`) before its handler runs.

mod graph;
mod lessons;
mod memory;
pub mod reply;
mod schema;
mod spaces;
mod vault;

use std::sync::{Arc, LazyLock};

use gs_core::contracts::space::parse_space_scope;
use gs_json::Json;

use crate::App;
use crate::app::open_page::open_page;
use reply::{failure, outcome};
use schema::check_arguments;

static TOOLS: LazyLock<Json> = LazyLock::new(|| gs_json::parse(include_str!("tools.json")).unwrap_or_default());

/// The tools: each one's name, title, description, annotations and JSON Schema.
pub fn tool_list() -> &'static Json {
	&TOOLS
}

fn input_schema(name: &str) -> Option<&'static Json> {
	TOOLS.as_arr()?.iter().find(|t| t["name"].as_str() == Some(name)).map(|t| &t["inputSchema"])
}

/// One tool call: the app and the calling agent's name.
pub struct ToolCall<'a> {
	pub app: &'a Arc<App>,
	pub caller: Option<&'a str>,
}

/// A tool's space_id argument, checked: absent or "none" is No space; otherwise the space must
/// exist. The scope, or the refusal text.
pub fn space_arg(app: &App, space_id: Option<&str>) -> Result<Option<String>, String> {
	let Some(scope) = parse_space_scope(space_id) else {
		return Err(format!("\"{}\" is not a space id. Use list_spaces.", space_id.unwrap_or_default()));
	};
	if let Some(id) = &scope
		&& app.stores.spaces.get_space(id).is_none()
	{
		return Err(format!("No space \"{id}\". Use list_spaces."));
	}
	Ok(scope)
}

/// A listed tool's raw arguments, checked against its schema; Err is the failed result.
pub fn checked_arguments(name: &str, args: &Json) -> Result<Json, Json> {
	let Some(schema) = input_schema(name) else { return Err(failure(&format!("Tool {name} not found"))) };
	check_arguments(name, schema, args).map_err(|error| failure(&error))
}

/// Runs a listed tool on arguments `checked_arguments` passed.
pub async fn run_tool(call: &ToolCall<'_>, name: &str, args: &Json) -> Json {
	match name {
		"list_lessons" => lessons::list_lessons(call, args),
		"read_lesson" => lessons::read_lesson(call, args),
		"search_graph" => graph::search_graph(call, args).await,
		"import_notes" => graph::import_notes(call, args),
		"remember" => memory::remember(call, args),
		"forget" => memory::forget(call, args),
		"save_rule" => memory::save_rule(call, args),
		"open_page" => outcome(open_page(call.app, call.caller, args)),
		"search_vault" => vault::search_vault(call, args),
		"write_vault_note" => vault::write_vault_note(call, args),
		other => spaces::space_tool(call, other, args).await.unwrap_or_else(|| failure(&format!("Tool {other} not found"))),
	}
}

#[cfg(test)]
mod tests {
	use gs_core::contracts::space::{MAX_PATH_TOPICS, PATH_GOAL_MAX};
	use gs_core::session::teacher_steps::{StepNames, round_call};
	use gs_core::spaces::space_path::PATH_COVERS_MAX;
	use gs_core::spaces::space_tools::{SPACE_ARG_TEXT, SPACE_TOOL_TEXT};
	use gs_core::records::agent_notes::NOTE_MAX_CHARS;
	use crate::turns::files_lesson::MAX_LESSON_FILES;

	use super::*;

	#[test]
	fn lists_every_tool_in_order() {
		let names: Vec<&str> = tool_list().as_arr().unwrap().iter().filter_map(|t| t["name"].as_str()).collect();
		assert_eq!(names.len(), 24);
		assert_eq!(names[..3], ["list_lessons", "read_lesson", "search_graph"]);
		assert_eq!(names[19..], ["start_lesson", "open_page", "unlink_space_folder", "search_vault", "write_vault_note"]);
	}

	struct NoNames;

	impl StepNames for NoNames {
		fn space(&self, _: &str) -> Option<String> {
			None
		}
		fn file(&self, _: &str, _: &str) -> Option<String> {
			None
		}
		fn lesson(&self, _: &str) -> Option<String> {
			None
		}
		fn obsidian(&self) -> bool {
			false
		}
	}

	/// A new tool fails here until teacher_steps.rs says what it is for Follow: a change the
	/// activity log names, or a step in words.
	#[test]
	fn every_tool_is_decided_for_the_teacher_s_round() {
		for tool in tool_list().as_arr().unwrap() {
			let name = tool["name"].as_str().unwrap();
			assert!(round_call(name, &gs_json::json!({}), &NoNames).is_some(), "{name}");
		}
	}

	/// Clients and listings read a missing hint as the risky default, so every tool states all four.
	#[test]
	fn every_tool_states_all_four_hints() {
		for tool in tool_list().as_arr().unwrap() {
			for hint in ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] {
				assert!(tool["annotations"][hint].as_bool().is_some(), "{} {hint}", tool["name"].as_str().unwrap());
			}
		}
	}

	/// The listed texts are the shared space-tool texts, so the two never drift apart.
	#[test]
	fn space_tool_texts_match_the_shared_ones() {
		for (name, description) in SPACE_TOOL_TEXT {
			let tool = tool_list().as_arr().unwrap().iter().find(|t| t["name"].as_str() == Some(name)).unwrap();
			assert_eq!(tool["description"].as_str(), Some(description), "{name}");
		}
		let create = &input_schema("create_space").unwrap()["properties"];
		assert_eq!(create["signature"]["description"].as_str(), Some(SPACE_ARG_TEXT.signature.as_str()));
		assert_eq!(create["icon"]["description"].as_str(), Some(SPACE_ARG_TEXT.icon.as_str()));
		for tool in ["create_space", "update_space"] {
			let path = &input_schema(tool).unwrap()["properties"]["path"];
			assert_eq!(path["description"].as_str(), Some(SPACE_ARG_TEXT.path), "{tool}");
			assert_eq!(path["properties"]["goal"]["description"].as_str(), Some(SPACE_ARG_TEXT.path_goal), "{tool}");
			assert_eq!(path["properties"]["goal"]["maxLength"].as_f64(), Some(PATH_GOAL_MAX as f64), "{tool}");
			assert_eq!(path["properties"]["topics"]["maxItems"].as_f64(), Some(MAX_PATH_TOPICS as f64), "{tool}");
			let covers = &path["properties"]["topics"]["items"]["properties"]["covers"];
			assert_eq!(covers["description"].as_str(), Some(SPACE_ARG_TEXT.path_covers), "{tool}");
			assert_eq!(covers["maxLength"].as_f64(), Some(PATH_COVERS_MAX as f64), "{tool}");
		}
		assert_eq!(input_schema("remember").unwrap()["properties"]["text"]["maxLength"].as_f64(), Some(NOTE_MAX_CHARS as f64));
		let files = &input_schema("start_lesson").unwrap()["properties"]["file_ids"];
		assert_eq!((files["description"].as_str(), files["maxItems"].as_f64()), (Some(SPACE_ARG_TEXT.lesson_files), Some(MAX_LESSON_FILES as f64)));
	}
}
