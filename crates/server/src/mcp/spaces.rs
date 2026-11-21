//! The space tools: agents set up the learner's spaces (create, edit, close, add files, link
//! folders, deadlines) and start lessons in them. Deleting a space is app-only on purpose.

use gs_core::spaces::space_tools::ToolOutcome;
use gs_json::{Json, json};
use gs_services::app::agent_actions::note_agent_action;
use gs_services::spaces::space_actions::{Mark, space_actions, folder_name};
use gs_services::spaces::space_checks::as_check_call;
use gs_services::spaces::{AGENT_FILE_READING_REFUSAL, unlink_folder};
use gs_services::turns::send_first_message;

use super::reply::{failure, outcome, result};
use super::tools::ToolCall;

/// Runs one space tool; None for a name that is not one.
pub async fn space_tool(call: &ToolCall<'_>, name: &str, args: &Json) -> Option<Json> {
	// From godspeed's own teacher terminal the learner asked for it there, so the window opens
	// what it starts even with Follow off.
	let agent = call.agent();
	let asked_here = call.app.bridge.is_teacher_terminal(call.terminal);
	let mark = if asked_here { Mark::Started } else { Mark::Asked };
	if let Some(done) = as_check_call(call.app, agent.as_deref(), name, args).await {
		return Some(outcome(done));
	}
	let actions = space_actions(call.app, call.caller, send_first_message(call.app), mark);
	match name {
		"start_lesson" => Some(started(call, actions.start_lesson(args).await)),
		"unlink_space_folder" => Some(unlink_space_folder(call, args)),
		_ => actions.run(name, args).await.map(outcome),
	}
}

/// Where the new lesson is: the window opens it itself, or Follow does, or the learner does.
const IN_WINDOW: &str = "The lesson is in the godspeed window.";

/// start_lesson's answer also says how its turns come: they wake a session the folder's waiter
/// wakes, any other agent waits for them. A continued lesson is where the learner left it.
fn started(call: &ToolCall<'_>, done: ToolOutcome) -> Json {
	let value = match done {
		ToolOutcome::Ok { value, .. } => value,
		ToolOutcome::Err(error) => return failure(&error),
	};
	let lesson_id = value["lessonId"].str_or_empty();
	let continued = value["status"].as_str() == Some("continued");
	let turns = if call.woken() {
		"Tell the user so in one short line, then end your turn; godspeed wakes you when work arrives.".to_owned()
	} else if continued {
		format!("Its next turns come through wait_for_work with lesson_id \"{lesson_id}\".")
	} else {
		format!("Call wait_for_work with lesson_id \"{lesson_id}\" to begin teaching.")
	};
	let note = if continued { format!("{IN_WINDOW} The learner continues where they left off. {turns}") } else { format!("{IN_WINDOW} {turns}") };
	let mut answer = value.clone();
	if let Some(fields) = answer.as_obj_mut() {
		fields.insert("note", note);
	}
	result(&answer)
}

fn unlink_space_folder(call: &ToolCall<'_>, args: &Json) -> Json {
	let app = call.app;
	let space_id = args["space_id"].str_or_empty();
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
	let removed = before["files"].items().iter().filter(|f| f["origin"].as_str() == Some("linked")).count();
	let mut answer = json!({ "spaceId": space_id });
	if let (Some(fields), Some(folder)) = (answer.as_obj_mut(), before.get("linkedFolder")) {
		fields.insert("unlinked", folder.clone());
	}
	if let Some(fields) = answer.as_obj_mut() {
		fields.insert("filesRemoved", removed);
	}
	result(&answer)
}
