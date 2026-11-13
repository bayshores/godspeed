//! The lesson markers of a stop and its opener: Keep going (UI-only), the answer to an opener and
//! the hidden app note (both model-visible), a question from earlier answered, a kept sentence's
//! verdict and his drops of its analogy or phrase (all UI-only), plus the one set of UI-only
//! markers every path to the agent skips.

use gs_base::{clock, time};
use gs_json::{Json, json};

use super::message_id::new_message_id;
use super::native_messages::marker;

/// Markers the agent never sees: the model view, both compaction paths and every other view of
/// the lesson for the agent skip them. A plan block is a snapshot for the window; a problem
/// dismissal reaches the agent as the synthesized conclude pair; Keep going reaches it as the
/// opener's answer or the go-ahead; a question from earlier reaches it as one [From earlier] line;
/// a keep's verdict as its note after his answer; a dropped analogy as one [Analogy dropped] line.
pub const UI_ONLY_MARKERS: [&str; 7] = ["plan-block", "problem-dismissed", "keep-going", "review", KEEP_CHECK, ANALOGY_DROP, PHRASE_DROP];

/// A Study quiz's kept sentence as checked when the turn was saved.
pub const KEEP_CHECK: &str = "keep-check";
/// He dropped a kept sentence's analogy lines, or brought them back.
pub const ANALOGY_DROP: &str = "analogy-drop";
/// He dropped a kept sentence's memory phrase, or brought it back.
pub const PHRASE_DROP: &str = "phrase-drop";

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

/// The verdict on a Study quiz's keep: `{quizCallId, keep: "shown" | "dropped", fits, phrase,
/// source?: "ok" | "dropped", sourceMark?, note?}`.
pub fn new_keep_check_marker(details: Json) -> Json {
	Json::Obj(marker(new_message_id(), KEEP_CHECK, "", false, details))
}

/// He dropped (or with `back`, brought back) the analogy lines or the phrase of the kept sentence
/// the quiz call `of` earned. `custom_type` is ANALOGY_DROP or PHRASE_DROP; the last one for a quiz
/// wins.
pub fn new_kept_drop_marker(custom_type: &str, of: &str, back: bool) -> Json {
	let now = clock::now_ms();
	let details = if back { json!({ "of": of, "back": true, "at": time::iso(now) }) } else { json!({ "of": of, "at": time::iso(now) }) };
	let mut m = marker(new_message_id(), custom_type, "", false, details);
	m.insert("timestamp", now);
	Json::Obj(m)
}

/// The learner's answer to an opener (or its skip). `content` is the model-facing lines
/// (app_notes::opener_answer_text); `details` is `{topicDoneCallId, answer}`.
pub fn new_opener_answer_marker(content: String, details: Json) -> Json {
	Json::Obj(marker(new_message_id(), "opener-answer", content, true, details))
}

/// Hidden lines for the agent about what happened in the app, joined by a newline. `details` is
/// `{}`, or `{reviewOf}` naming the question from earlier he asked the teacher about.
pub fn new_app_note_marker(lines: &[String], details: Json) -> Json {
	Json::Obj(marker(new_message_id(), "app-note", lines.join("\n"), false, details))
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
	fn a_keep_verdict_and_a_drop_are_ui_only() {
		let check = new_keep_check_marker(json!({ "quizCallId": "q5", "keep": "shown", "fits": true, "phrase": false }));
		assert_eq!((check["customType"].as_str(), check["display"].as_bool()), (Some("keep-check"), Some(false)));
		assert!(is_ui_only(check["customType"].as_str()));
		let drop = new_kept_drop_marker(ANALOGY_DROP, "q5", false);
		assert_eq!(keys(&drop["details"]), ["of", "at"]);
		assert_eq!(drop["details"]["at"].as_str(), Some(time::iso(drop["timestamp"].as_i64().unwrap()).as_str()));
		let back = new_kept_drop_marker(PHRASE_DROP, "q5", true);
		assert_eq!((back["customType"].as_str(), keys(&back["details"])), (Some("phrase-drop"), vec!["of", "back", "at"]));
		assert!(is_ui_only(Some(ANALOGY_DROP)) && is_ui_only(Some(PHRASE_DROP)));
	}

	#[test]
	fn the_opener_answer_and_the_app_note_reach_the_agent() {
		let answer = new_opener_answer_marker("[Opener] Cross-validation: he skipped it.".into(), json!({ "topicDoneCallId": "t1", "answer": null }));
		assert_eq!((answer["customType"].as_str(), answer["display"].as_bool()), (Some("opener-answer"), Some(true)));
		assert_eq!(answer["content"], json!("[Opener] Cross-validation: he skipped it."));
		assert_eq!(answer["details"], json!({ "topicDoneCallId": "t1", "answer": null }));
		let note = new_app_note_marker(&["[Resumed] a".into(), "[Opener] b".into()], json!({}));
		assert_eq!((note["customType"].as_str(), note["display"].as_bool()), (Some("app-note"), Some(false)));
		assert_eq!(note["content"], json!("[Resumed] a\n[Opener] b"));
	}
}
