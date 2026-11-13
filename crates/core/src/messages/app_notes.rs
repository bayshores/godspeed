//! The hidden lines an input carries to the agent about what happened in the app: he came back to
//! a stopped session ([Resumed]), and what he did with the next topic's opener ([Opener]). An
//! opener answer carries its lines in its own marker; any other input gets one app-note marker.

use gs_json::Json;
use gs_json::js_text::js_string;

use super::input_events::{ChatInput, messages_of};
use super::lesson_markers::new_app_note_marker;
use crate::session::question_core::confidence_level;
use crate::study::topic_end::{resume_due, shown_openers};

const RESUMED_LINE: &str = "[Resumed] He came back to this session after a stop.";

/// The opener-answer marker's content: [Resumed] first when due, then what he picked, or that he
/// skipped it (a null `answer`).
pub fn opener_answer_text(record: &Json, topic_done_call_id: &str, answer: &Json) -> String {
	let topic = opener_topic(record, topic_done_call_id);
	let line = if answer.is_null() { format!("[Opener] {topic}: he skipped it.") } else { format!("[Opener] {topic}: {}", picked_words(answer)) };
	let resumed = resume_due(messages_of(record)).then_some(RESUMED_LINE.to_owned());
	resumed.into_iter().chain(std::iter::once(line)).collect::<Vec<_>>().join("\n")
}

/// The app-note marker an input carries, or none. An opener answer carries its lines itself, and a
/// continue is not his input.
pub fn app_note_for(record: &Json, input: &ChatInput) -> Option<Json> {
	if matches!(input, ChatInput::Continue | ChatInput::OpenerAnswer { .. }) {
		return None;
	}
	let mut lines = Vec::new();
	if resume_due(messages_of(record)) {
		lines.push(RESUMED_LINE.to_owned());
	}
	if let ChatInput::Text { about: Some(opener), .. } = input {
		lines.push(format!("[Opener] {}: he asked about it before answering; it stays open. Answer his question and end your turn.", opener_topic(record, opener)));
	}
	(!lines.is_empty()).then(|| new_app_note_marker(&lines))
}

/// The opener question's topic: its plan step's title, else its node id.
fn opener_topic(record: &Json, topic_done_call_id: &str) -> String {
	let openers = shown_openers(messages_of(record));
	let id = openers.get(topic_done_call_id).and_then(|o| o["quiz"]["nodeId"].as_str()).unwrap_or_default();
	let title = record["tree"]["nodes"].as_arr().into_iter().flatten().find(|n| n["id"].as_str() == Some(id)).map(|n| &n["title"]).filter(|t| !t.is_null());
	title.map_or_else(|| id.to_owned(), |t| js_string(Some(t)))
}

/// "he picked A, It can move a lot, sure 3." with his thinking after it when he wrote some. "did
/// not know" and "his thinking" are the words a quiz answer reads with in a past lesson
/// (session_markdown).
fn picked_words(answer: &Json) -> String {
	let thinking = if answer["thinking"].truthy() { format!(" His thinking: {}", js_string(Some(&answer["thinking"]))) } else { String::new() };
	if answer["dontKnow"].truthy() {
		return format!("he did not know.{thinking}");
	}
	let picks: Vec<String> = answer["answers"]
		.as_arr()
		.into_iter()
		.flatten()
		.map(|a| {
			let letter = a["index"].as_f64().and_then(|i| char::from_u32((64.0 + i) as u32)).map_or_else(String::new, String::from);
			format!("{letter}, {}", js_string(a.get("label")))
		})
		.collect();
	let sure = answer.get("confidence").map_or_else(String::new, |c| format!(", sure {}", confidence_level(c.as_f64().unwrap_or(f64::NAN))));
	format!("he picked {}{sure}.{thinking}", picks.join(" and "))
}

#[cfg(test)]
mod tests {
	use gs_base::time;
	use gs_json::json;

	use super::*;

	const T0: i64 = 1_795_035_600_000;

	fn at(minutes: i64) -> i64 {
		T0 + minutes * 60_000
	}

	fn tree() -> Json {
		json!({ "nodes": [{ "id": "reg", "title": "Regularization" }, { "id": "cv", "title": "Cross-validation" }], "edges": [{ "from": "reg", "to": "cv" }] })
	}

	/// Regularization ends on a conclude at minute 48 and topic_done stores the opener at 49.
	fn ended() -> Vec<Json> {
		vec![
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "c1", "name": "conclude", "arguments": { "outcome": "solved" } }], "timestamp": at(48) }),
			json!({ "role": "toolResult", "toolCallId": "c1", "toolName": "conclude", "details": { "stop": { "kind": "topic", "nodeId": "reg", "activeMinutes": 48, "at": time::iso(at(48)) } }, "isError": false, "timestamp": at(48) }),
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "t1", "name": "topic_done", "arguments": { "nodeId": "reg", "opener": { "lead": "Now split.", "quiz": { "question": "?", "type": "predict", "nodeId": "cv" } } } }], "timestamp": at(49) }),
			json!({ "role": "toolResult", "toolCallId": "t1", "toolName": "topic_done", "details": { "part": "topic_done", "v": 1, "lead": "Now split." }, "isError": false, "timestamp": at(49) }),
		]
	}

	fn kept_at(minutes: i64) -> Json {
		let mut messages = ended();
		messages.push(json!({ "role": "custom", "customType": "keep-going", "content": "", "details": { "stopOf": "c1", "at": time::iso(at(minutes)) }, "timestamp": at(minutes) }));
		json!({ "messages": messages, "tree": tree() })
	}

	fn pick(index: i64, label: &str) -> Json {
		json!({ "index": index, "label": label, "value": label })
	}

	#[test]
	fn the_opener_lines_word_for_word() {
		let record = kept_at(50);
		let answer = json!({ "kind": "quiz", "dontKnow": false, "answers": [pick(1, "It can move a lot")], "confidence": 60 });
		assert_eq!(opener_answer_text(&record, "t1", &answer), "[Opener] Cross-validation: he picked A, It can move a lot, sure 3.");
		assert_eq!(opener_answer_text(&record, "t1", &Json::Null), "[Opener] Cross-validation: he skipped it.");
		let two = json!({ "kind": "quiz", "dontKnow": false, "answers": [pick(1, "One"), pick(3, "Three")], "thinking": "Folds are small." });
		assert_eq!(opener_answer_text(&record, "t1", &two), "[Opener] Cross-validation: he picked A, One and C, Three. His thinking: Folds are small.");
		let unsure = json!({ "kind": "quiz", "dontKnow": true, "answers": [], "thinking": "No idea." });
		assert_eq!(opener_answer_text(&record, "t1", &unsure), "[Opener] Cross-validation: he did not know. His thinking: No idea.");
	}

	#[test]
	fn the_topic_falls_back_to_the_node_id() {
		let mut record = kept_at(50);
		record.as_obj_mut().unwrap().remove("tree");
		assert_eq!(opener_answer_text(&record, "t1", &Json::Null), "[Opener] cv: he skipped it.");
	}

	#[test]
	fn resumed_comes_first_in_a_later_sitting() {
		let record = kept_at(24 * 60);
		assert_eq!(opener_answer_text(&record, "t1", &Json::Null), "[Resumed] He came back to this session after a stop.\n[Opener] Cross-validation: he skipped it.");
		let text = ChatInput::Text { text: "why?".into(), attachments: None, about: None };
		let note = app_note_for(&record, &text).unwrap();
		assert_eq!(note["content"], json!("[Resumed] He came back to this session after a stop."));
		assert!(app_note_for(&kept_at(50), &text).is_none(), "same sitting");
	}

	#[test]
	fn ask_teacher_on_an_opener_says_it_stays_open() {
		let ask = ChatInput::Text { text: "why?".into(), attachments: None, about: Some("t1".into()) };
		let note = app_note_for(&kept_at(50), &ask).unwrap();
		assert_eq!(note["content"], json!("[Opener] Cross-validation: he asked about it before answering; it stays open. Answer his question and end your turn."));
		let both = app_note_for(&kept_at(24 * 60), &ask).unwrap();
		assert_eq!(both["content"].as_str().unwrap().lines().count(), 2, "[Resumed] and [Opener]");
	}

	#[test]
	fn a_continue_and_an_opener_answer_carry_no_note() {
		let record = kept_at(24 * 60);
		assert!(app_note_for(&record, &ChatInput::Continue).is_none());
		assert!(app_note_for(&record, &ChatInput::OpenerAnswer { topic_done_call_id: "t1".into(), answer: None }).is_none());
		assert!(app_note_for(&record, &ChatInput::Next).is_some());
	}
}
