//! Space tools that run the same space actions as the outside agent's MCP tools: a lesson's
//! deadline changes, and what a deadline request or a space check reads and writes. Nothing here
//! deletes a space or a file. Each result's details carry the changes it made.

use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_core::spaces::space_tools::{SPACE_ARG_TEXT, SPACE_TOOL_TEXT, SpaceArgText, DEADLINE_KINDS, FILE_KINDS, ToolOutcome};
use gs_json::{Json, json, stringify};

use super::fn_tool::FnTool;
use gs_core::contracts::space::{MAX_PATH_TOPICS, PATH_GOAL_MAX};
use gs_core::session::schema::{boolean, described, no_arguments, object, one_of_literals, string, string_min, string_or_null, strings};
use gs_core::spaces::space_path::PATH_COVERS_MAX;

/// Runs one space tool by name over its validated arguments (server/space-actions.ts).
pub type SpaceActions = Arc<dyn Fn(&str, Json) -> BoxFuture<'static, ToolOutcome> + Send + Sync>;

/// What a lesson adds to its own space tools: the deadline changes a learner asks for
/// mid-lesson. Each definition costs the agent tokens, so the other space changes happen
/// outside lessons.
const LESSON_CHANGES: [&str; 4] = ["list_spaces", "add_space_deadline", "update_space_deadline", "remove_space_deadline"];

fn space_id() -> Json {
	json!({ "type": "string" })
}

fn optional_text(description: &str) -> Json {
	string(description)
}

fn file_kind(text: &SpaceArgText) -> Json {
	one_of_literals(&FILE_KINDS, text.file_kind)
}

fn deadline_kind(text: &SpaceArgText) -> Json {
	one_of_literals(&DEADLINE_KINDS, text.deadline_kind)
}

/// A path as `update_space` takes it: a goal and its topics in order.
fn path_schema(t: &SpaceArgText) -> Json {
	let goal = json!({ "type": "string", "minLength": 1, "maxLength": PATH_GOAL_MAX, "description": t.path_goal });
	let covers = json!({ "type": "string", "minLength": 1, "maxLength": PATH_COVERS_MAX, "description": t.path_covers });
	let topic = object(&["name", "covers"], vec![("name", json!({ "type": "string", "minLength": 1 })), ("covers", covers)]);
	let topics = json!({ "type": "array", "items": topic, "minItems": 1, "maxItems": MAX_PATH_TOPICS });
	described(object(&["goal", "topics"], vec![("goal", goal), ("topics", topics)]), t.path)
}

/// The input schema of one space tool.
fn schema_of(name: &str) -> Json {
	let t: &SpaceArgText = &SPACE_ARG_TEXT;
	let id = || ("space_id", space_id());
	match name {
		"list_spaces" => no_arguments(),
		"read_space" => object(&["space_id"], vec![id(), ("files", boolean(t.files))]),
		"search_space_files" => object(
			&["space_id", "query"],
			vec![id(), ("query", string_min(1, t.query)), ("limit", json!({ "type": "integer", "minimum": 1, "maximum": 20, "description": t.limit }))],
		),
		"read_passage" => object(&["space_id"], vec![id(), ("passage_id", optional_text(t.passage_id)), ("file_id", optional_text(t.file_id)), ("range", optional_text(t.range))]),
		"add_space_file" => object(&["space_id", "kind"], vec![id(), ("path", string(t.file_path)), ("name", string(t.file_name)), ("text", string(t.file_text)), ("kind", file_kind(t)), ("lesson_id", string(t.file_lesson))]),
		"add_space_deadline" => {
			let deadline = object(
				&["kind", "name", "date"],
				vec![
					("kind", deadline_kind(t)),
					("name", string_min(1, t.deadline_name)),
					("date", string(t.date)),
					("time", string(t.time)),
					("file_ids", strings(t.covered_files)),
					("left_out_ids", strings(t.left_out_files)),
					("source", string(t.source)),
					("assignment_file_id", string(t.assignment_file)),
					("about_file_id", string(t.about_file)),
				],
			);
			object(&["space_id", "deadlines"], vec![id(), ("deadlines", json!({ "type": "array", "items": deadline, "minItems": 1 }))])
		}
		"update_space_deadline" => object(
			&["space_id", "deadline_id"],
			vec![
				id(),
				("deadline_id", space_id()),
				("kind", deadline_kind(t)),
				("name", json!({ "type": "string", "minLength": 1 })),
				("date", string("YYYY-MM-DD.")),
				("time", string_or_null(t.new_time)),
				("file_ids", strings(t.covered_files)),
				("left_out_ids", strings(t.left_out_files)),
				("source", string_or_null(t.source)),
				("assignment_file_id", string_or_null(t.assignment_file)),
				("about_file_id", string_or_null(t.about_file_change)),
				("done", json!({ "type": "boolean" })),
			],
		),
		"remove_space_deadline" => object(&["space_id", "deadline_id"], vec![id(), ("deadline_id", space_id())]),
		// A space check's own: only the path and the description.
		"update_space" => object(&["space_id"], vec![id(), ("description", string(t.description)), ("path", path_schema(t))]),
		_ => unreachable!("only the space tools named here are built"),
	}
}

/// An action's outcome as a tool result: the value for the model, the changes for the thread. A
/// refusal throws, so the model sees an error.
fn to_result(outcome: ToolOutcome) -> Result<Json, String> {
	match outcome {
		ToolOutcome::Err(error) => Err(error),
		ToolOutcome::Ok { value, changes } => {
			let text = value.as_str().map_or_else(|| stringify(&value), str::to_owned);
			let changes: Vec<Json> = changes.into_iter().map(|c| json!({ "label": c.label, "page": c.page })).collect();
			Ok(json!({ "text": text, "details": { "changes": changes } }))
		}
	}
}

fn space_tool(actions: &SpaceActions, name: &'static str) -> FnTool {
	let actions = actions.clone();
	let description = SPACE_TOOL_TEXT.iter().find(|(tool, _)| *tool == name).map_or("", |(_, text)| *text);
	FnTool::server(name, description, schema_of(name), move |args, _ctx| {
		let outcome = actions(name, args);
		async move { to_result(outcome.await) }
	})
}

/// The deadline changes a lesson may make.
pub fn lesson_space_change_tools(actions: &SpaceActions) -> Vec<FnTool> {
	LESSON_CHANGES.iter().map(|name| space_tool(actions, name)).collect()
}

const READS: [&str; 3] = ["read_space", "search_space_files", "read_passage"];

/// What a deadline request reads and changes: the deadline, and with `files` the files it writes.
pub fn deadline_request_tools(actions: &SpaceActions, files: bool) -> Vec<FnTool> {
	let writes: &[&'static str] = if files { &["update_space_deadline", "add_space_file"] } else { &["update_space_deadline"] };
	READS.iter().chain(writes).copied().map(|name| space_tool(actions, name)).collect()
}

/// What a space check reads and changes: the space's deadlines, and with `path` its path and
/// description.
pub fn space_check_tool_names(path: bool) -> Vec<&'static str> {
	let writes: &[&'static str] = if path { &["add_space_deadline", "update_space_deadline", "update_space"] } else { &["add_space_deadline", "update_space_deadline"] };
	READS.iter().chain(writes).copied().collect()
}

/// The space check's tools (`space_check_tool_names`); `actions` limits the arguments.
pub fn space_check_tools(actions: &SpaceActions, path: bool) -> Vec<FnTool> {
	space_check_tool_names(path).into_iter().map(|name| space_tool(actions, name)).collect()
}
