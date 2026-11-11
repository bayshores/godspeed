//! remember, forget and save_rule: short notes about the learner (they follow the work loop in
//! the instructions every agent gets), and the learner's teaching rules.

use gs_json::{Json, json};

use super::reply::{failure, result};
use super::tools::{ToolCall, class_arg};

pub fn remember(call: &ToolCall<'_>, args: &Json) -> Json {
	let scope = match class_arg(call.app, args["class_id"].as_str()) {
		Ok(scope) => scope,
		Err(error) => return failure(&error),
	};
	match call.app.stores.agent_notes.add_agent_note(args["text"].as_str().unwrap_or_default(), scope.as_deref()) {
		Ok(note) => result(&json!({ "note": note })),
		Err(error) => failure(&error),
	}
}

pub fn forget(call: &ToolCall<'_>, args: &Json) -> Json {
	let id = args["note_id"].as_str().unwrap_or_default();
	match call.app.stores.agent_notes.remove_agent_note(id) {
		Ok(true) => result(&json!({ "removed": id })),
		Ok(false) => failure(&format!("No note \"{id}\".")),
		Err(error) => failure(&error),
	}
}

pub fn save_rule(call: &ToolCall<'_>, args: &Json) -> Json {
	let scope = match class_arg(call.app, args["class_id"].as_str()) {
		Ok(scope) => scope,
		Err(error) => return failure(&error),
	};
	let place = match scope {
		Some(class_id) => json!({ "classId": class_id }),
		None => json!({ "area": args["area"].as_str().unwrap_or("teaching") }),
	};
	let rule = args["rule"].as_str().unwrap_or_default();
	match gs_services::app::agent_rules::save_rule_by_agent(call.app, rule, &place, Some(call.caller.unwrap_or("Your agent"))) {
		Ok(saved) => result(&json!({ "saved": saved["rule"], "for": saved["for"], "note": "The learner sees it in the godspeed window and can undo or edit it." })),
		Err(error) => failure(&error),
	}
}
