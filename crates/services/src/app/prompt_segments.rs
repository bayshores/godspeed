//! The teacher's prompt, as Settings lists, saves and resets it: the segments the app ships, each
//! with the learner's saved version. A saved version is used in place of the source; deleting it
//! brings the source back.

use gs_agent::teacher::prompt_segments::{AgentKind, all_segment_paths, effective_prompt_segments};
use gs_core::records::prompt_segments::is_valid_segment_path;
use gs_json::{Json, json};

use crate::App;

/// Each segment of one agent's prompt with its source and the learner's saved version.
fn effective_segments(app: &App, kind: AgentKind) -> Vec<Json> {
	effective_prompt_segments(kind, &app.stores.prompt_overrides)
		.into_iter()
		.map(|s| json!({ "path": s.path, "sourceText": s.source_text, "overrideText": s.override_text, "shared": s.shared }))
		.collect()
}

/// Every segment the teacher and the level check compose; one both share is listed once.
pub fn prompt_segments(app: &App) -> Json {
	let mut listed: Vec<Json> = Vec::new();
	for segment in effective_segments(app, AgentKind::Teacher).into_iter().chain(effective_segments(app, AgentKind::Prober)) {
		match listed.iter_mut().find(|seen| seen["path"] == segment["path"]) {
			Some(seen) => *seen = segment,
			None => listed.push(segment),
		}
	}
	json!({ "segments": listed })
}

/// Save the learner's version of one segment: the status and JSON answer; Err is a failure the
/// route does not catch. `body` is the request's JSON, null when it was not JSON.
pub fn save_prompt_segment(app: &App, path: &str, body: &Json) -> Result<(u16, Json), String> {
	if !is_valid_segment_path(path) {
		return Ok((400, json!({ "error": "invalid segment path" })));
	}
	let Some(text) = body["text"].as_str() else { return Ok((400, json!({ "error": "body must be {text: string}" }))) };
	let supported = all_segment_paths();
	if !supported.contains(&path) {
		return Ok((400, json!({ "error": format!("\"{path}\" is not a current source segment"), "supported": supported })));
	}
	app.stores.prompt_overrides.write_override(path, text)?;
	Ok((200, json!({ "path": path, "text": text })))
}

/// Reset one segment to the shipped text (already reset counts as done).
pub fn reset_prompt_segment(app: &App, path: &str) -> (u16, Json) {
	if !is_valid_segment_path(path) {
		return (400, json!({ "error": "invalid segment path" }));
	}
	app.stores.prompt_overrides.delete_override(path);
	(200, json!({ "path": path, "deleted": true }))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn the_list_shows_source_and_saved_text_with_shared_parts_once() {
		let root = scratch_dir("segments-list");
		let app = test_app(&root);
		assert_eq!(save_prompt_segment(&app, "teacher/20-teaching.md", &json!({ "text": "Mine" })).unwrap().0, 200);
		let list = prompt_segments(&app);
		let segments = list["segments"].as_arr().unwrap();
		let paths: Vec<&str> = segments.iter().filter_map(|s| s["path"].as_str()).collect();
		assert_eq!(paths.iter().filter(|p| **p == "shared/10-voice.md").count(), 1);
		assert_eq!(paths[0], "system-prompt.md");
		let teaching = segments.iter().find(|s| s["path"].as_str() == Some("teacher/20-teaching.md")).unwrap();
		assert_eq!((teaching["overrideText"].as_str(), teaching["shared"].as_bool()), (Some("Mine"), Some(false)));
		assert!(teaching["sourceText"].as_str().unwrap().len() > 100);
		assert_eq!(segments[0]["overrideText"], Json::Null);
		assert_eq!(segments[0].as_obj().unwrap().keys().map(String::as_str).collect::<Vec<_>>(), ["path", "sourceText", "overrideText", "shared"]);
	}

	#[test]
	fn saving_and_resetting_refuse_what_is_not_a_current_segment() {
		let root = scratch_dir("segments-save");
		let app = test_app(&root);
		assert_eq!(save_prompt_segment(&app, "teacher/notes.md", &json!({ "text": "x" })).unwrap(), (400, json!({ "error": "invalid segment path" })));
		assert_eq!(save_prompt_segment(&app, "teacher/05-method.md", &json!({ "text": 5 })).unwrap(), (400, json!({ "error": "body must be {text: string}" })));
		assert_eq!(save_prompt_segment(&app, "teacher/99-new.md", &Json::Null).unwrap().0, 400);
		let (status, answer) = save_prompt_segment(&app, "talk/00-base.md", &json!({ "text": "x" })).unwrap();
		assert_eq!((status, answer["error"].as_str()), (400, Some("\"talk/00-base.md\" is not a current source segment")));
		assert_eq!(answer["supported"].as_arr().map(Vec::len), Some(26));
		assert_eq!(save_prompt_segment(&app, "system-prompt.md", &json!({ "text": "" })).unwrap(), (200, json!({ "path": "system-prompt.md", "text": "" })));
		assert_eq!(reset_prompt_segment(&app, "system-prompt.md"), (200, json!({ "path": "system-prompt.md", "deleted": true })));
		assert_eq!(reset_prompt_segment(&app, "system-prompt.md").0, 200);
		assert_eq!(reset_prompt_segment(&app, "teacher/notes.md").0, 400);
		assert_eq!(app.stores.prompt_overrides.list_overrides(), Vec::<String>::new());
	}
}
