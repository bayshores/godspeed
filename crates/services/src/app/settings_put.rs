//! PUT /api/settings/{section}: one section of the settings record replaced whole.

use std::sync::Arc;

use gs_json::{Json, json};

use super::settings_body::{SETTINGS_SECTIONS, parse_section};
use super::settings_record::record_or_new;
use crate::App;
use crate::classes::queue_waiting_files;

/// What the section name does when it is also a name every JavaScript object has. The old server
/// looked sections up on a plain object, so these names reached a function that is not a
/// parser: Err is the empty 500, Ok a 400 with an empty body. None for a name that is just
/// unknown.
fn inherited(section: &str, body: &Json) -> Option<Result<(u16, Json), String>> {
	let refused: Result<(u16, Json), String> = Ok((400, json!({})));
	let broke: Result<(u16, Json), String> = Err(format!("settings section \"{section}\" is not a parser"));
	match section {
		"constructor" | "toString" => Some(refused),
		// Only a value that is not an object gets past `this` being undefined.
		"isPrototypeOf" => Some(if matches!(body, Json::Obj(_) | Json::Arr(_)) { broke } else { refused }),
		"valueOf" | "hasOwnProperty" | "propertyIsEnumerable" | "toLocaleString" | "__defineGetter__" | "__defineSetter__" | "__lookupGetter__" | "__lookupSetter__" | "__proto__" => Some(broke),
		_ => None,
	}
}

/// The status and JSON answer; Err is a failure the route does not catch. `body` is the request's
/// JSON, null when it was not JSON.
pub fn put_settings_section(app: &Arc<App>, section: &str, body: &Json) -> Result<(u16, Json), String> {
	if let Some(answer) = inherited(section, body) {
		return answer;
	}
	let parsed = match parse_section(section, body) {
		None => return Ok((404, json!({ "error": format!("unknown settings section \"{section}\""), "supported": SETTINGS_SECTIONS }))),
		Some(Err(error)) => return Ok((400, json!({ "error": error }))),
		Some(Ok(parsed)) => parsed,
	};
	let graph_was_on = graph_is_on(app)?;
	let mut next = record_or_new(app.stores.settings.read_settings()?);
	if let Some(fields) = next.as_obj_mut() {
		fields.insert(section, parsed);
	}
	app.stores.settings.write_settings(&next)?;
	// Class files saved while the graph was off wait for it to come back on.
	if section == "graph" && !graph_was_on && graph_is_on(app)? {
		queue_waiting_files(app);
	}
	Ok((200, json!({ "settings": next })))
}

fn graph_is_on(app: &App) -> Result<bool, String> {
	Ok(app.stores.settings.effective_settings()?["graph"]["enabled"].truthy())
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn a_section_replaces_only_itself_and_the_record_starts_bare() {
		let root = scratch_dir("put-section");
		let app = test_app(&root);
		let (status, answer) = put_settings_section(&app, "general", &json!({ "teacherName": "Zed" })).unwrap();
		assert_eq!((status, stringify(&answer).as_str()), (200, r#"{"settings":{"version":2,"general":{"teacherName":"Zed"}}}"#));
		let (_, answer) = put_settings_section(&app, "compaction", &json!({})).unwrap();
		assert_eq!(answer["settings"]["general"]["teacherName"].as_str(), Some("Zed"));
		assert!(answer["settings"]["compaction"].as_obj().is_some());
		let (_, answer) = put_settings_section(&app, "general", &json!({})).unwrap();
		assert_eq!(stringify(&answer["settings"]["general"]), "{}");
	}

	#[test]
	fn unknown_sections_and_bad_bodies_are_refused_with_their_words() {
		let root = scratch_dir("put-refused");
		let app = test_app(&root);
		let (status, answer) = put_settings_section(&app, "nope", &json!({})).unwrap();
		assert_eq!(status, 404);
		assert_eq!(stringify(&answer), r#"{"error":"unknown settings section \"nope\"","supported":["general","agent","appearance","graph","compaction"]}"#);
		let (status, answer) = put_settings_section(&app, "general", &Json::Null).unwrap();
		assert_eq!(status, 400);
		assert!(answer["error"].as_str().is_some());
		assert!(app.stores.settings.read_settings().unwrap().is_none());
	}

	#[test]
	fn names_every_object_has_answer_as_the_old_server_did() {
		let root = scratch_dir("put-inherited");
		let app = test_app(&root);
		for name in ["constructor", "toString"] {
			assert_eq!(put_settings_section(&app, name, &json!({})), Ok((400, json!({}))));
		}
		assert_eq!(put_settings_section(&app, "isPrototypeOf", &Json::Null), Ok((400, json!({}))));
		assert!(put_settings_section(&app, "isPrototypeOf", &json!({})).is_err());
		for name in ["valueOf", "hasOwnProperty", "__proto__"] {
			assert!(put_settings_section(&app, name, &json!({})).is_err(), "{name}");
		}
	}
}
