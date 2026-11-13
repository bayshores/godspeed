//! The UI-only markers are listed twice, here (lesson_markers.rs) and in the window
//! (native-messages.ts). Both replay tests/golden/ui_only_markers.json: one case per marker type
//! between a question and a side question, plus the notes that ride ahead of a side question and
//! one marker that is neither, so the two lists cannot drift.

use gs_core::messages::lesson_markers::{UI_ONLY_MARKERS, is_ui_only};
use gs_core::messages::native_messages::{dangling_question_of, side_held_questions, to_llm_messages};
use gs_json::{Json, json, parse};

#[test]
fn ui_only_markers_match_the_window() {
	let cases = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/ui_only_markers.json")).unwrap()).unwrap();
	let cases = cases.as_arr().unwrap();
	for case in cases {
		let name = case["name"].as_str().unwrap();
		let messages = case["aroundSideQuestion"].as_arr().unwrap();
		assert_eq!(is_ui_only(Some(name)), case["uiOnly"].as_bool().unwrap(), "{name}");
		let mut held: Vec<Json> = side_held_questions(messages).into_iter().map(|(id, h)| json!([id, { "callAt": h.call_at, "sideAt": h.side_at }])).collect();
		held.sort_by_key(|h| h[0].as_str().unwrap_or_default().to_owned());
		assert_eq!(Json::Arr(held), case["held"], "{name}: held");
		assert_eq!(dangling_question_of(messages).map(|d| Json::from(d.tool_call_id)).unwrap_or(Json::Null), case["dangling"], "{name}: dangling");
		// A UI-only marker never reaches the model.
		let without: Vec<Json> = messages.iter().filter(|m| m["customType"].as_str() != Some(name)).cloned().collect();
		assert_eq!(to_llm_messages(messages) == to_llm_messages(&without), is_ui_only(Some(name)), "{name}: the model view");
	}
	let covered: Vec<&str> = cases.iter().filter(|c| c["uiOnly"].as_bool() == Some(true)).filter_map(|c| c["name"].as_str()).collect();
	assert_eq!(covered, UI_ONLY_MARKERS, "one case per UI-only marker type");
}
