//! The space tools: agents set up the learner's spaces (create, edit, close, add files, link
//! folders, deadlines) and start lessons in them. Deleting a space is app-only on purpose.

use gs_core::spaces::space_tools::ToolOutcome;
use gs_json::{Json, json};
use gs_services::app::agent_actions::note_agent_action;
use gs_services::spaces::space_actions::{space_actions, folder_name};
use gs_services::spaces::{AGENT_FILE_READING_REFUSAL, unlink_folder};
use gs_services::turns::send_first_message;

use super::caller::{agent_id_of, in_claude_code};
use super::reply::{failure, outcome, result};
use super::tools::ToolCall;

/// Runs one space tool; None for a name that is not one.
pub async fn space_tool(call: &ToolCall<'_>, name: &str, args: &Json) -> Option<Json> {
	// From godspeed's own teacher terminal the learner asked for it there, so the window opens
	// what it starts even with Follow off.
	let agent = agent_id_of(call.meta);
	let asked_here = call.terminal.is_some() && !call.app.bridge.is_helper_agent(agent.as_deref());
	let actions = space_actions(call.app, call.caller, send_first_message(call.app), asked_here);
	match name {
		"start_lesson" => {
			// Asked first: the waiter may take the new lesson's first turn before the call returns.
			let waiting = call.app.bridge.agent_waiting(agent.as_deref());
			Some(started(call, actions.start_lesson(args).await, waiting))
		}
		"unlink_space_folder" => Some(unlink_space_folder(call, args)),
		_ => actions.run(name, args).await.map(outcome),
	}
}

/// start_lesson's answer also says how to begin teaching, unless the agent's waiter already runs.
fn started(call: &ToolCall<'_>, done: ToolOutcome, waiting: bool) -> Json {
	let value = match done {
		ToolOutcome::Ok { value, .. } => value,
		ToolOutcome::Err(error) => return failure(&error),
	};
	let lesson_id = value["lessonId"].as_str().unwrap_or_default();
	let note = if waiting {
		"Open in the godspeed window. Your waiter already running brings its turns.".to_owned()
	} else if in_claude_code(call.caller) {
		format!("Open the lesson in the godspeed window. {}", super::work::waiter_hint(Some(lesson_id), false))
	} else {
		format!("Open the lesson in the godspeed window. Call wait_for_work with lesson_id \"{lesson_id}\" to begin teaching.")
	};
	let mut answer = value.clone();
	if let Some(fields) = answer.as_obj_mut() {
		fields.insert("note", note);
	}
	result(&answer)
}

fn unlink_space_folder(call: &ToolCall<'_>, args: &Json) -> Json {
	let app = call.app;
	let space_id = args["space_id"].as_str().unwrap_or_default();
	let Some(before) = app.stores.spaces.get_space(space_id) else {
		return failure(&format!("No space \"{space_id}\". Use list_spaces."));
	};
	if let Err(refused) = unlink_folder(app, space_id) {
		return failure(if refused.code == "extraction_running" { AGENT_FILE_READING_REFUSAL } else { &refused.error });
	}
	let folder = before["linkedFolder"].as_str();
	let action = json!({
		"label": format!("Unlinking {}", folder_name(folder)),
		"spaceId": space_id,
		"target": { "kind": "space", "id": space_id },
		"page": "/space/files",
	});
	note_agent_action(app, call.caller, &action);
	let removed = before["files"].as_arr().into_iter().flatten().filter(|f| f["origin"].as_str() == Some("linked")).count();
	let mut answer = json!({ "spaceId": space_id });
	if let (Some(fields), Some(folder)) = (answer.as_obj_mut(), before.get("linkedFolder")) {
		fields.insert("unlinked", folder.clone());
	}
	if let Some(fields) = answer.as_obj_mut() {
		fields.insert("filesRemoved", removed);
	}
	result(&answer)
}
