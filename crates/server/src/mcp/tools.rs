//! The tool list and the call router. tools.json is tools/list exactly as the Node SDK emitted
//! it from the zod schemas (order, titles, descriptions, annotations, JSON Schemas); calls are
//! checked against those schemas before a handler runs.

use std::sync::{Arc, LazyLock};

use gs_core::contracts::space::parse_space_scope;
use gs_json::Json;
use gs_services::App;

use super::reply::failure;
use super::schema::check_arguments;
use super::{spaces, graph, lessons, memory, work};

static TOOLS: LazyLock<Json> = LazyLock::new(|| gs_json::parse(include_str!("tools.json")).unwrap_or_default());

/// tools/list's `tools`.
pub fn tool_list() -> &'static Json {
	&TOOLS
}

fn input_schema(name: &str) -> Option<&'static Json> {
	TOOLS.as_arr()?.iter().find(|t| t["name"].as_str() == Some(name)).map(|t| &t["inputSchema"])
}

pub fn has_tool(name: &str) -> bool {
	input_schema(name).is_some()
}

/// One tool call: the app, the calling agent's name and the request's `_meta`.
pub struct ToolCall<'a> {
	pub app: &'a Arc<App>,
	pub caller: Option<&'a str>,
	pub meta: &'a Json,
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

/// Runs a listed tool (`has_tool`) on its raw arguments.
pub async fn call_tool(call: &ToolCall<'_>, name: &str, args: &Json) -> Json {
	let Some(schema) = input_schema(name) else { return failure(&format!("Tool {name} not found")) };
	let args = match check_arguments(name, schema, args) {
		Ok(args) => args,
		Err(error) => return failure(&error),
	};
	match name {
		"wait_for_work" => work::wait_for_work(call, &args).await,
		"respond" => work::respond(call, &args).await,
		"read_work" => work::read_work(call, &args),
		"list_lessons" => lessons::list_lessons(call, &args),
		"read_lesson" => lessons::read_lesson(call, &args),
		"search_graph" => graph::search_graph(call, &args).await,
		"import_notes" => graph::import_notes(call, &args),
		"remember" => memory::remember(call, &args),
		"forget" => memory::forget(call, &args),
		"save_rule" => memory::save_rule(call, &args),
		other => spaces::space_tool(call, other, &args).await.unwrap_or_else(|| failure(&format!("Tool {other} not found"))),
	}
}

#[cfg(test)]
mod tests {
	use gs_core::spaces::space_tools::{SPACE_ARG_TEXT, SPACE_TOOL_TEXT};
	use gs_core::records::agent_notes::NOTE_MAX_CHARS;

	use super::*;

	#[test]
	fn lists_every_tool_in_order() {
		let names: Vec<&str> = tool_list().as_arr().unwrap().iter().filter_map(|t| t["name"].as_str()).collect();
		assert_eq!(names.len(), 25);
		assert_eq!(names[..3], ["wait_for_work", "respond", "read_work"]);
		assert_eq!(names[24], "unlink_space_folder");
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
		assert_eq!(input_schema("remember").unwrap()["properties"]["text"]["maxLength"].as_f64(), Some(NOTE_MAX_CHARS as f64));
	}
}
