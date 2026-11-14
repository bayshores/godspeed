//! The space tools of the Talk chat: the learner's spaces, files
//! and deadlines, running the same actions the outside agent's MCP tools run. Nothing here deletes
//! a space or a file. Each result's details carry the changes it made, shown as rows in Talk.

use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_core::spaces::space_tools::{SPACE_ARG_TEXT, SPACE_TOOL_TEXT, SpaceArgText, DEADLINE_KINDS, FILE_KINDS, ToolOutcome};
use gs_core::contracts::space::{SPACE_ICONS, SIGNATURE_MAX};
use gs_json::{Json, json, stringify};

use super::fn_tool::FnTool;
use gs_core::session::schema::{boolean, no_arguments, object, one_of_literals, string, string_min, string_or_null, strings};

/// Runs one space tool by name over its validated arguments (server/space-actions.ts).
pub type SpaceActions = Arc<dyn Fn(&str, Json) -> BoxFuture<'static, ToolOutcome> + Send + Sync>;

/// What a lesson adds to its own space tools: the deadline changes a learner asks for
/// mid-lesson. Each definition costs the agent tokens, so the rest stays in Talk.
const LESSON_CHANGES: [&str; 4] = ["list_spaces", "add_space_deadline", "update_space_deadline", "remove_space_deadline"];

fn space_id() -> Json {
	json!({ "type": "string" })
}

fn optional_text(description: &str) -> Json {
	string(description)
}

fn signature(text: &SpaceArgText) -> Json {
	json!({
		"type": "object",
		"required": ["kind", "value"],
		"properties": {
			"kind": { "anyOf": [{ "type": "string", "const": "math" }, { "type": "string", "const": "code" }, { "type": "string", "const": "text" }] },
			"value": { "type": "string", "minLength": 1, "maxLength": SIGNATURE_MAX },
		},
		"description": text.signature,
	})
}

fn icon(text: &SpaceArgText) -> Json {
	let names: Vec<&str> = SPACE_ICONS.iter().map(|(name, _)| *name).collect();
	one_of_literals(&names, &text.icon)
}

fn file_kind(text: &SpaceArgText) -> Json {
	one_of_literals(&FILE_KINDS, text.file_kind)
}

fn deadline_kind(text: &SpaceArgText) -> Json {
	one_of_literals(&DEADLINE_KINDS, text.deadline_kind)
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
		"create_space" => object(&["name", "icon"], vec![("name", string_min(1, t.name)), ("description", optional_text(t.description)), ("signature", signature(t)), ("icon", icon(t))]),
		"update_space" => object(
			&["space_id"],
			vec![
				id(),
				("name", json!({ "type": "string", "minLength": 1 })),
				("description", json!({ "type": "string" })),
				("signature", signature(t)),
				("icon", icon(t)),
				("archived", json!({ "type": "boolean" })),
			],
		),
		"add_space_file" => object(&["space_id", "kind"], vec![id(), ("path", string(t.file_path)), ("name", string(t.file_name)), ("text", string(t.file_text)), ("kind", file_kind(t))]),
		"set_space_file_kind" => object(
			&["space_id", "file_ids", "kind"],
			vec![id(), ("file_ids", json!({ "type": "array", "items": { "type": "string" }, "minItems": 1, "description": t.file_ids })), ("kind", file_kind(t))],
		),
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
		"link_space_folder" => object(&["space_id", "path"], vec![id(), ("path", string(t.folder_path))]),
		"start_lesson" => object(&["topic"], vec![("topic", string_min(1, t.topic)), ("space_id", string(t.lesson_space))]),
		_ => unreachable!("every space tool name has a schema"),
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

/// Every space tool, the Talk chat's whole set.
pub fn talk_tools(actions: &SpaceActions) -> Vec<FnTool> {
	SPACE_TOOL_TEXT.iter().map(|(name, _)| space_tool(actions, name)).collect()
}
