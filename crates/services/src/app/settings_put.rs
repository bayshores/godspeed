//! PUT /api/settings/{section}: one section of the settings record replaced whole.
//! PATCH /api/settings/general: single fields of that section changed, the rest kept.

use std::sync::Arc;

use gs_base::locks::LockKey;
use gs_json::{Json, json};

use super::settings_body::{NOT_A_RECORD, SETTINGS_SECTIONS, parse_section};
use super::settings_record::record_or_new;
use crate::App;
use crate::spaces::queue_waiting_files;

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
	let next = store_section(app, section, parsed)?;
	// Space files saved while the graph was off wait for it to come back on.
	if section == "graph" && !graph_was_on && graph_is_on(app)? {
		queue_waiting_files(app);
	}
	Ok((200, json!({ "settings": next })))
}

/// `body` holds the fields to change: a value sets its field, null removes it. The merged section
/// goes through the parser a PUT of it would, so a bad value is refused the same way.
pub fn patch_settings_section(app: &Arc<App>, section: &str, body: &Json) -> Result<(u16, Json), String> {
	if section != "general" {
		return Ok((404, json!({ "error": format!("settings section \"{section}\" cannot be patched") })));
	}
	let Some(changes) = body.as_obj() else { return Ok((400, json!({ "error": NOT_A_RECORD }))) };
	// The merge and the save share one hold, so no other save lands between them.
	let _held = app.locks.lock(LockKey::AppFile("settings.json"));
	let record = record_or_new(app.stores.settings.read_settings()?);
	let mut merged = record[section].as_obj().cloned().unwrap_or_default();
	for (key, value) in changes.iter() {
		match value {
			Json::Null => merged.remove(key),
			_ => merged.insert(key.as_str(), value.clone()),
		};
	}
	let parsed = match parse_section(section, &Json::Obj(merged)) {
		Some(Ok(parsed)) => parsed,
		Some(Err(error)) => return Ok((400, json!({ "error": error }))),
		None => return Ok((404, json!({ "error": format!("unknown settings section \"{section}\"") }))),
	};
	Ok((200, json!({ "settings": store_section(app, section, parsed)? })))
}

/// The settings record with `section` set to `parsed`, saved.
fn store_section(app: &App, section: &str, parsed: Json) -> Result<Json, String> {
	// Every other section is written back as read, so no other save may land in between.
	let _held = app.locks.lock(LockKey::AppFile("settings.json"));
	let mut next = record_or_new(app.stores.settings.read_settings()?);
	if let Some(fields) = next.as_obj_mut() {
		fields.insert(section, parsed);
	}
	app.stores.settings.write_settings(&next)?;
	app.misc.settings_saved.notify_one();
	Ok(next)
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
		assert_eq!((status, stringify(&answer).as_str()), (200, r#"{"settings":{"version":3,"general":{"teacherName":"Zed"}}}"#));
		let (_, answer) = put_settings_section(&app, "graph", &json!({})).unwrap();
		assert_eq!(answer["settings"]["general"]["teacherName"].as_str(), Some("Zed"));
		assert!(answer["settings"]["graph"].as_obj().is_some());
		let (_, answer) = put_settings_section(&app, "general", &json!({})).unwrap();
		assert_eq!(stringify(&answer["settings"]["general"]), "{}");
	}

	#[test]
	fn an_old_heading_weight_stays_until_the_appearance_section_is_saved() {
		let root = scratch_dir("put-retired-rendering");
		let app = test_app(&root);
		let old = r##"{"version":3,"appearance":{"mdRendering":{"headingWeight":800,"boldColor":"#f00"}}}"##;
		gs_base::fsx::write_text_atomic(&app.paths.settings_file, old).unwrap();
		let (_, answer) = put_settings_section(&app, "general", &json!({ "teacherName": "Zed" })).unwrap();
		assert_eq!(stringify(&answer["settings"]["appearance"]), r##"{"mdRendering":{"headingWeight":800,"boldColor":"#f00"}}"##);
		let (_, answer) = put_settings_section(&app, "appearance", &json!({ "background": "#123456" })).unwrap();
		assert_eq!(stringify(&answer["settings"]["appearance"]), r##"{"background":"#123456"}"##);
	}

	#[test]
	fn two_sections_saved_at_once_both_stay() {
		let root = scratch_dir("put-together");
		let app = test_app(&root);
		for round in 0..30 {
			let _ = std::fs::remove_file(&app.paths.settings_file);
			let start = Arc::new(std::sync::Barrier::new(2));
			let put = |section: &'static str, body: Json| {
				let (app, start) = (app.clone(), start.clone());
				std::thread::spawn(move || {
					start.wait();
					put_settings_section(&app, section, &body).unwrap();
				})
			};
			let threads = [put("general", json!({ "teacherName": "Zed" })), put("graph", json!({}))];
			threads.into_iter().for_each(|t| t.join().unwrap());
			let saved = app.stores.settings.read_settings().unwrap().unwrap();
			assert!(saved["general"].truthy() && saved["graph"].truthy(), "round {round}: {}", stringify(&saved));
		}
	}

	#[test]
	fn unknown_sections_and_bad_bodies_are_refused_with_their_words() {
		let root = scratch_dir("put-refused");
		let app = test_app(&root);
		let (status, answer) = put_settings_section(&app, "nope", &json!({})).unwrap();
		assert_eq!(status, 404);
		assert_eq!(stringify(&answer), r#"{"error":"unknown settings section \"nope\"","supported":["general","agent","appearance","graph"]}"#);
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

	#[test]
	fn a_patch_changes_one_general_field_and_keeps_every_other() {
		let root = scratch_dir("patch-field");
		let app = test_app(&root);
		put_settings_section(&app, "general", &json!({ "teacherName": "Zed", "sounds": false })).unwrap();
		put_settings_section(&app, "graph", &json!({ "enabled": true })).unwrap();
		let (status, answer) = patch_settings_section(&app, "general", &json!({ "onboarded": true })).unwrap();
		assert_eq!(status, 200);
		assert_eq!(stringify(&answer["settings"]["general"]), r#"{"onboarded":true,"teacherName":"Zed","sounds":false}"#);
		assert_eq!(stringify(&answer["settings"]["graph"]), r#"{"enabled":true}"#);
		assert_eq!(app.stores.settings.read_settings().unwrap().unwrap(), answer["settings"]);
	}

	#[test]
	fn a_patch_with_null_removes_the_field() {
		let root = scratch_dir("patch-null");
		let app = test_app(&root);
		put_settings_section(&app, "general", &json!({ "teacherName": "Zed", "sounds": false })).unwrap();
		let (_, answer) = patch_settings_section(&app, "general", &json!({ "teacherName": Json::Null })).unwrap();
		assert_eq!(stringify(&answer["settings"]["general"]), r#"{"sounds":false}"#);
	}

	#[test]
	fn a_patch_with_a_bad_value_is_refused_as_a_put_would_and_saves_nothing() {
		let root = scratch_dir("patch-bad");
		let app = test_app(&root);
		put_settings_section(&app, "general", &json!({ "sounds": false })).unwrap();
		let before = app.stores.settings.read_settings().unwrap();
		let (status, answer) = patch_settings_section(&app, "general", &json!({ "onboarded": "yes" })).unwrap();
		assert_eq!((status, answer["error"].as_str()), (400, Some("onboarded must be a boolean")));
		assert_eq!(app.stores.settings.read_settings().unwrap(), before);
	}

	#[test]
	fn a_patch_needs_an_object_and_only_the_general_section_can_be_patched() {
		let root = scratch_dir("patch-refused");
		let app = test_app(&root);
		for body in [Json::Null, json!([]), json!("x")] {
			let (status, answer) = patch_settings_section(&app, "general", &body).unwrap();
			assert_eq!((status, answer["error"].as_str()), (400, Some("Invalid JSON body")));
		}
		let (status, answer) = patch_settings_section(&app, "graph", &json!({})).unwrap();
		assert_eq!(status, 404);
		assert_eq!(stringify(&answer), r#"{"error":"settings section \"graph\" cannot be patched"}"#);
		assert!(app.stores.settings.read_settings().unwrap().is_none());
	}
}
