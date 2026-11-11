//! The class tools of the Talk chat (src/backend/agent/tools/talk.ts): the learner's classes, files
//! and deadlines, running the same actions the outside agent's MCP tools run. Nothing here deletes
//! a class or a file. Each result's details carry the changes it made, shown as rows in Talk.

use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_core::classes::class_tools::{CLASS_ARG_TEXT, CLASS_TOOL_TEXT, ClassArgText, DEADLINE_KINDS, FILE_KINDS, ToolOutcome};
use gs_core::contracts::class::{CLASS_ICONS, SIGNATURE_MAX};
use gs_json::{Json, json, stringify};

use super::fn_tool::FnTool;
use gs_core::session::schema::{boolean, no_arguments, object, one_of_literals, string, string_min, string_or_null, strings};

/// Runs one class tool by name over its validated arguments (server/class-actions.ts).
pub type ClassActions = Arc<dyn Fn(&str, Json) -> BoxFuture<'static, ToolOutcome> + Send + Sync>;

/// What a lesson adds to its own class tools: the deadline changes a learner asks for
/// mid-lesson. Each definition costs the agent tokens, so the rest stays in Talk.
const LESSON_CHANGES: [&str; 4] = ["list_classes", "add_class_deadline", "update_class_deadline", "remove_class_deadline"];

fn class_id() -> Json {
	json!({ "type": "string" })
}

fn optional_text(description: &str) -> Json {
	string(description)
}

fn signature(text: &ClassArgText) -> Json {
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

fn icon(text: &ClassArgText) -> Json {
	let names: Vec<&str> = CLASS_ICONS.iter().map(|(name, _)| *name).collect();
	one_of_literals(&names, &text.icon)
}

fn file_kind(text: &ClassArgText) -> Json {
	one_of_literals(&FILE_KINDS, text.file_kind)
}

fn deadline_kind(text: &ClassArgText) -> Json {
	one_of_literals(&DEADLINE_KINDS, text.deadline_kind)
}

/// The input schema of one class tool.
fn schema_of(name: &str) -> Json {
	let t: &ClassArgText = &CLASS_ARG_TEXT;
	let id = || ("class_id", class_id());
	match name {
		"list_classes" => no_arguments(),
		"read_class" => object(&["class_id"], vec![id(), ("files", boolean(t.files))]),
		"search_class_files" => object(
			&["class_id", "query"],
			vec![id(), ("query", string_min(1, t.query)), ("limit", json!({ "type": "integer", "minimum": 1, "maximum": 20, "description": t.limit }))],
		),
		"read_passage" => object(&["class_id"], vec![id(), ("passage_id", optional_text(t.passage_id)), ("file_id", optional_text(t.file_id)), ("range", optional_text(t.range))]),
		"create_class" => object(&["name", "icon"], vec![("name", string_min(1, t.name)), ("description", optional_text(t.description)), ("signature", signature(t)), ("icon", icon(t))]),
		"update_class" => object(
			&["class_id"],
			vec![
				id(),
				("name", json!({ "type": "string", "minLength": 1 })),
				("description", json!({ "type": "string" })),
				("signature", signature(t)),
				("icon", icon(t)),
				("archived", json!({ "type": "boolean" })),
			],
		),
		"add_class_file" => object(&["class_id", "path", "kind"], vec![id(), ("path", string(t.file_path)), ("kind", file_kind(t))]),
		"set_class_file_kind" => object(
			&["class_id", "file_ids", "kind"],
			vec![id(), ("file_ids", json!({ "type": "array", "items": { "type": "string" }, "minItems": 1, "description": t.file_ids })), ("kind", file_kind(t))],
		),
		"add_class_deadline" => {
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
				],
			);
			object(&["class_id", "deadlines"], vec![id(), ("deadlines", json!({ "type": "array", "items": deadline, "minItems": 1 }))])
		}
		"update_class_deadline" => object(
			&["class_id", "deadline_id"],
			vec![
				id(),
				("deadline_id", class_id()),
				("kind", deadline_kind(t)),
				("name", json!({ "type": "string", "minLength": 1 })),
				("date", string("YYYY-MM-DD.")),
				("time", string_or_null(t.new_time)),
				("file_ids", strings(t.covered_files)),
				("left_out_ids", strings(t.left_out_files)),
				("source", string_or_null(t.source)),
				("assignment_file_id", string_or_null(t.assignment_file)),
				("done", json!({ "type": "boolean" })),
			],
		),
		"remove_class_deadline" => object(&["class_id", "deadline_id"], vec![id(), ("deadline_id", class_id())]),
		"link_class_folder" => object(&["class_id", "path"], vec![id(), ("path", string(t.folder_path))]),
		"start_lesson" => object(&["topic"], vec![("topic", string_min(1, t.topic)), ("class_id", string(t.lesson_class))]),
		_ => unreachable!("every class tool name has a schema"),
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

fn class_tool(actions: &ClassActions, name: &'static str) -> FnTool {
	let actions = actions.clone();
	let description = CLASS_TOOL_TEXT.iter().find(|(tool, _)| *tool == name).map_or("", |(_, text)| *text);
	FnTool::server(name, description, schema_of(name), move |args, _ctx| {
		let outcome = actions(name, args);
		async move { to_result(outcome.await) }
	})
}

/// The deadline changes a lesson may make.
pub fn lesson_class_change_tools(actions: &ClassActions) -> Vec<FnTool> {
	LESSON_CHANGES.iter().map(|name| class_tool(actions, name)).collect()
}

/// All thirteen class tools, the Talk chat's whole set.
pub fn talk_tools(actions: &ClassActions) -> Vec<FnTool> {
	CLASS_TOOL_TEXT.iter().map(|(name, _)| class_tool(actions, name)).collect()
}
