//! The lesson markers of a stop and its opener: Keep going (UI-only), the answer to an opener and
//! the hidden app note (both model-visible), a question from earlier answered (UI-only), plus the
//! one set of UI-only markers every path to the agent skips.

use gs_base::{clock, time};
use gs_json::{Json, json};

use super::message_id::new_message_id;
use super::native_messages::marker;

/// Markers the agent never sees: the model view, both compaction paths and every other view of
/// the lesson for the agent skip them. A plan block is a snapshot for the window; a problem
/// dismissal reaches the agent as the synthesized conclude pair; Keep going reaches it as the
/// opener's answer or the go-ahead; a question from earlier reaches it as one [From earlier] line.
pub const UI_ONLY_MARKERS: [&str; 4] = ["plan-block", "problem-dismissed", "keep-going", "review"];

/// Whether a marker's `customType` is one of UI_ONLY_MARKERS.
pub fn is_ui_only(custom_type: Option<&str>) -> bool {
	custom_type.is_some_and(|t| UI_ONLY_MARKERS.contains(&t))
}

/// The learner pressed Keep going at the stop carried by the call `stop_of`.
pub fn new_keep_going_marker(stop_of: &str) -> Json {
	let now = clock::now_ms();
	let mut m = marker(new_message_id(), "keep-going", "", true, json!({ "stopOf": stop_of, "at": time::iso(now) }));
	m.insert("timestamp", now);
	Json::Obj(m)
}

/// The learner answered a question from earlier. `details` is `{of: {chatId, messageId,
/// toolCallId}, nodeId, topic, quiz, answer, sitting}`: the quiz is copied so the card survives the
/// source lesson being deleted.
pub fn new_review_marker(details: Json) -> Json {
	let mut m = marker(new_message_id(), "review", "", true, details);
	m.insert("timestamp", clock::now_ms());
	Json::Obj(m)
}

/// The learner's answer to an opener (or its skip). `content` is the model-facing lines
/// (app_notes::opener_answer_text); `details` is `{topicDoneCallId, answer}`.
pub fn new_opener_answer_marker(content: String, details: Json) -> Json {
	Json::Obj(marker(new_message_id(), "opener-answer", content, true, details))
}

/// Hidden lines for the agent about what happened in the app, joined by a newline.
pub fn new_app_note_marker(lines: &[String]) -> Json {
	Json::Obj(marker(new_message_id(), "app-note", lines.join("\n"), false, json!({})))
}

#[cfg(test)]
mod tests {
	use super::*;

	fn keys(v: &Json) -> Vec<&str> {
		v.as_obj().unwrap().keys().map(String::as_str).collect()
	}

	#[test]
	fn keep_going_names_its_stop_and_is_ui_only() {
		let m = new_keep_going_marker("c1");
		assert_eq!(keys(&m), ["id", "role", "customType", "content", "display", "details", "timestamp"]);
		assert_eq!((m["customType"].as_str(), m["content"].as_str(), m["display"].as_bool()), (Some("keep-going"), Some(""), Some(true)));
		assert_eq!(m["details"]["stopOf"], json!("c1"));
		assert_eq!(m["details"]["at"].as_str(), Some(time::iso(m["timestamp"].as_i64().unwrap()).as_str()));
		assert!(is_ui_only(m["customType"].as_str()));
		assert!(!is_ui_only(Some("opener-answer")) && !is_ui_only(Some("app-note")) && !is_ui_only(None));
	}

	#[test]
	fn a_question_from_earlier_is_ui_only() {
		let m = new_review_marker(json!({ "nodeId": "reg" }));
		assert_eq!(keys(&m), ["id", "role", "customType", "content", "display", "details", "timestamp"]);
		assert_eq!((m["customType"].as_str(), m["content"].as_str(), m["display"].as_bool()), (Some("review"), Some(""), Some(true)));
		assert_eq!(m["details"], json!({ "nodeId": "reg" }));
		assert!(is_ui_only(m["customType"].as_str()));
	}

	#[test]
	fn the_opener_answer_and_the_app_note_reach_the_agent() {
		let answer = new_opener_answer_marker("[Opener] Cross-validation: he skipped it.".into(), json!({ "topicDoneCallId": "t1", "answer": null }));
		assert_eq!((answer["customType"].as_str(), answer["display"].as_bool()), (Some("opener-answer"), Some(true)));
		assert_eq!(answer["content"], json!("[Opener] Cross-validation: he skipped it."));
		assert_eq!(answer["details"], json!({ "topicDoneCallId": "t1", "answer": null }));
		let note = new_app_note_marker(&["[Resumed] a".into(), "[Opener] b".into()]);
		assert_eq!((note["customType"].as_str(), note["display"].as_bool()), (Some("app-note"), Some(false)));
		assert_eq!(note["content"], json!("[Resumed] a\n[Opener] b"));
	}
}
