//! The class tools: agents set up the learner's classes (create, edit, archive, add files, link
//! folders, deadlines) and start lessons in them. Deleting a class is app-only on purpose.

use gs_core::classes::class_tools::ToolOutcome;
use gs_json::{Json, json};
use gs_services::app::agent_actions::note_agent_action;
use gs_services::classes::class_actions::{class_actions, folder_name};
use gs_services::classes::{AGENT_FILE_READING_REFUSAL, unlink_folder};
use gs_services::turns::send_first_message;

use super::caller::in_claude_code;
use super::reply::{failure, outcome, result};
use super::tools::ToolCall;

/// Runs one class tool; None for a name that is not one.
pub async fn class_tool(call: &ToolCall<'_>, name: &str, args: &Json) -> Option<Json> {
	let actions = class_actions(call.app, call.caller, send_first_message(call.app), false);
	match name {
		"start_lesson" => Some(started(call, actions.start_lesson(args).await)),
		"unlink_class_folder" => Some(unlink_class_folder(call, args)),
		_ => actions.run(name, args).await.map(outcome),
	}
}

/// start_lesson's answer also says how to begin teaching.
fn started(call: &ToolCall<'_>, done: ToolOutcome) -> Json {
	let value = match done {
		ToolOutcome::Ok { value, .. } => value,
		ToolOutcome::Err(error) => return failure(&error),
	};
	let lesson_id = value["lessonId"].as_str().unwrap_or_default();
	let next = if in_claude_code(call.caller) {
		super::work::waiter_hint(Some(lesson_id))
	} else {
		format!("Call wait_for_work with lesson_id \"{lesson_id}\" to begin teaching.")
	};
	let mut answer = value.clone();
	if let Some(fields) = answer.as_obj_mut() {
		fields.insert("note", format!("Open the lesson in the godspeed window. {next}"));
	}
	result(&answer)
}

fn unlink_class_folder(call: &ToolCall<'_>, args: &Json) -> Json {
	let app = call.app;
	let class_id = args["class_id"].as_str().unwrap_or_default();
	let Some(before) = app.stores.classes.get_class(class_id) else {
		return failure(&format!("No class \"{class_id}\". Use list_classes."));
	};
	if let Err(refused) = unlink_folder(app, class_id) {
		return failure(if refused.code == "extraction_running" { AGENT_FILE_READING_REFUSAL } else { &refused.error });
	}
	let folder = before["linkedFolder"].as_str();
	let action = json!({
		"label": format!("Unlinking {}", folder_name(folder)),
		"classId": class_id,
		"target": { "kind": "class", "id": class_id },
		"page": "/class/files",
	});
	note_agent_action(app, call.caller, &action);
	let removed = before["files"].as_arr().into_iter().flatten().filter(|f| f["origin"].as_str() == Some("linked")).count();
	let mut answer = json!({ "classId": class_id });
	if let (Some(fields), Some(folder)) = (answer.as_obj_mut(), before.get("linkedFolder")) {
		fields.insert("unlinked", folder.clone());
	}
	if let Some(fields) = answer.as_obj_mut() {
		fields.insert("filesRemoved", removed);
	}
	result(&answer)
}
