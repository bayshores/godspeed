//! The one model-facing seam: the record becomes what the provider is sent.

use std::collections::HashMap;

use gs_json::{Json, Obj, json};

use super::scans::tool_calls;
use super::side_questions::{SIDE_PENDING_TEXT, side_answer_lead, side_held_questions};
use crate::messages::compaction_marks::{active_compaction_of, kept_index_for};
use crate::messages::lesson_markers::is_ui_only;
use gs_json::js_text::js_string;

/// The wording for an aborted turn's unanswered calls. Kept verbatim so the model's view never
/// drifts.
const INTERRUPTED_TEXT: &str = "The question was interrupted — the learner never answered; continue without holding a result for it.";

/// A one-text-part content array.
fn text_content(text: impl Into<Json>) -> Json {
	Json::Arr(vec![json!({ "type": "text", "text": text.into() })])
}

/// A user message for the wire; the timestamp is copied only when the source has one.
fn user_message(content: Json, source: &Json) -> Json {
	let mut out: Obj = [("role", Json::from("user")), ("content", content)].into_iter().collect();
	set_present(&mut out, "timestamp", source.get("timestamp"));
	Json::Obj(out)
}

/// Sets `key` when the source property exists, as JavaScript leaves an undefined one out.
fn set_present(out: &mut Obj, key: &str, value: Option<&Json>) {
	if let Some(v) = value {
		out.insert(key, v.clone());
	}
}

/// The record's messages as the provider protocol needs them.
///
/// - User, assistant and tool result messages pass through as they are, minus our `id` and `side`.
/// - Markers become user messages carrying their text; plan blocks and problem dismissals are
///   view-only and dropped.
/// - A compaction marker that names its first kept message replaces everything before it.
/// - A question a side question was asked around gets a pending result at its call, and the
///   learner's later answer arrives where it happened, as their message.
/// - A tool call with no result after it (an aborted turn) gets the interrupted result the
///   protocol demands.
pub fn to_llm_messages(messages: &[Json]) -> Vec<Json> {
	let active = active_compaction_of(messages);
	let mut start = 0;
	let mut head: Option<Json> = None;
	if let Some(marker) = active
		&& let Some(kept) = kept_index_for(messages, marker).filter(|&k| k > 0)
	{
		start = kept;
		head = Some(user_message(text_content(marker["content"].clone()), marker));
	}
	// The system message the agent seeds first carries the prompt and tools; the cut never drops
	// it, and it goes ahead of the compaction head.
	let leading = messages.first().filter(|m| m["role"].as_str() == Some("system"));
	let mut out: Vec<Json> = leading.into_iter().cloned().collect();
	let has_head = head.is_some();
	out.extend(head);
	// A call is answered when its id has a result after it; some providers reuse ids.
	let mut last_result_at: HashMap<&str, usize> = HashMap::new();
	for (j, m) in messages.iter().enumerate() {
		if let Some(id) = m["toolCallId"].as_str().filter(|_| m["role"].as_str() == Some("toolResult")) {
			last_result_at.insert(id, j);
		}
	}
	let side_held = side_held_questions(messages);
	for (i, m) in messages.iter().enumerate().skip(if leading.is_some() { start.max(1) } else { start }) {
		match m["role"].as_str() {
			Some("custom") => {
				let custom_type = m["customType"].as_str();
				if is_ui_only(custom_type) {
					continue;
				}
				// The active compaction marker already rendered as the head.
				if custom_type == Some("compaction") && has_head && active.is_some_and(|a| a["id"] == m["id"]) {
					continue;
				}
				let files = m["attachments"].as_arr().into_iter().flatten().cloned();
				let content = std::iter::once(json!({ "type": "text", "text": m["content"].clone() })).chain(files).collect();
				out.push(user_message(content, m));
				continue;
			}
			Some("toolResult") => {
				let held = m["toolCallId"].as_str().and_then(|id| side_held.get(id)).filter(|h| i > h.side_at);
				if let Some(held) = held {
					// The answer record first, then its files.
					let parts = m["content"].as_arr().map_or(&[][..], Vec::as_slice);
					let lead = side_answer_lead(&messages[held.call_at], m["toolCallId"].as_str().unwrap_or_default());
					let answer = parts.first().filter(|a| a["type"].as_str() == Some("text")).map_or_else(String::new, |a| js_string(a.get("text")));
					let content = std::iter::once(json!({ "type": "text", "text": format!("{lead}{answer}") })).chain(parts.iter().skip(1).cloned()).collect();
					out.push(user_message(content, m));
					continue;
				}
			}
			_ => {}
		}
		let mut native = m.clone();
		if let Some(o) = native.as_obj_mut() {
			o.remove("id");
			o.remove("side");
		}
		out.push(native);
		if m["role"].as_str() == Some("assistant") {
			for call in tool_calls(m) {
				let id = call["id"].as_str();
				let held = id.is_some_and(|id| side_held.contains_key(id));
				if !held && id.and_then(|id| last_result_at.get(id)).is_some_and(|&j| j > i) {
					continue;
				}
				let mut result: Obj = [("role", Json::from("toolResult"))].into_iter().collect();
				set_present(&mut result, "toolCallId", call.get("id"));
				set_present(&mut result, "toolName", call.get("name"));
				result.insert("content", text_content(if held { SIDE_PENDING_TEXT } else { INTERRUPTED_TEXT }));
				result.insert("isError", false);
				set_present(&mut result, "timestamp", m.get("timestamp"));
				out.push(Json::Obj(result));
			}
		}
	}
	out
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::messages::app_notes::app_note_for;
	use crate::messages::input_events::ChatInput;

	fn quiz_call(id: &str) -> Json {
		json!({ "id": "m1", "role": "assistant", "content": [{ "type": "toolCall", "id": id, "name": "quiz", "arguments": { "question": "?" } }], "timestamp": 5 })
	}

	#[test]
	fn records_lose_their_ids_and_markers_become_user_messages() {
		let messages = vec![
			json!({ "id": "u1", "role": "user", "content": "hi", "timestamp": 1, "side": true }),
			json!({ "id": "k1", "role": "custom", "customType": "plan-block", "content": "", "timestamp": 2 }),
			json!({ "id": "k2", "role": "custom", "customType": "practice-thinking", "content": "t", "attachments": [{ "type": "image" }], "timestamp": 3 }),
		];
		assert_eq!(
			to_llm_messages(&messages),
			vec![
				json!({ "role": "user", "content": "hi", "timestamp": 1 }),
				json!({ "role": "user", "content": [{ "type": "text", "text": "t" }, { "type": "image" }], "timestamp": 3 }),
			]
		);
	}

	#[test]
	fn ui_only_markers_never_reach_the_agent_and_app_notes_do() {
		let marker = |custom_type: &str, content: &str, at: i64| json!({ "id": custom_type, "role": "custom", "customType": custom_type, "content": content, "timestamp": at });
		let messages = vec![
			marker("keep-going", "", 1),
			marker("problem-dismissed", "", 2),
			marker("plan-block", "", 3),
			marker("app-note", "[Resumed] He came back to this session after a stop.", 4),
			marker("opener-answer", "[Opener] Cross-validation: he skipped it.", 5),
		];
		assert_eq!(
			to_llm_messages(&messages),
			vec![
				json!({ "role": "user", "content": [{ "type": "text", "text": "[Resumed] He came back to this session after a stop." }], "timestamp": 4 }),
				json!({ "role": "user", "content": [{ "type": "text", "text": "[Opener] Cross-validation: he skipped it." }], "timestamp": 5 }),
			]
		);
	}

	#[test]
	fn questions_from_earlier_reach_the_agent_as_one_line_only() {
		let review = |topic: &str, at: i64| {
			let details = json!({ "of": { "chatId": "c0", "toolCallId": "t0" }, "nodeId": "n", "topic": topic, "quiz": { "question": "?" }, "answer": { "kind": "quiz", "correct": true, "answers": [{ "label": "A" }], "confidence": 80 } });
			json!({ "id": topic, "role": "custom", "customType": "review", "content": "", "display": true, "details": details, "timestamp": at })
		};
		let mut messages = vec![review("Eigenvalues", 1), review("Gradient descent", 2)];
		let note = app_note_for(&json!({ "messages": messages }), &ChatInput::Next, None).unwrap();
		messages.push(note);
		messages.push(json!({ "id": "n", "role": "custom", "customType": "practice-next", "content": "[NEXT PROBLEM]", "timestamp": 3 }));
		let seen = to_llm_messages(&messages);
		let texts: Vec<&str> = seen.iter().filter_map(|m| m["content"][0]["text"].as_str()).collect();
		assert_eq!(texts, ["[From earlier] Eigenvalues right, sure 4. Gradient descent right, sure 4.", "[NEXT PROBLEM]"]);
	}

	#[test]
	fn a_keep_verdict_and_a_dropped_analogy_reach_the_agent_as_lines_only() {
		let keep = json!({ "text": "Lambda prices large weights.", "fits": "The leash fits one part.", "stops": "It stops at new data." });
		let mut messages = vec![
			json!({ "id": "m5", "role": "assistant", "content": [{ "type": "toolCall", "id": "q5", "name": "quiz", "arguments": { "nodeId": "reg", "keep": keep } }], "timestamp": 1 }),
			json!({ "id": "k", "role": "custom", "customType": "keep-check", "content": "", "details": { "quizCallId": "q5", "keep": "shown", "fits": true, "phrase": true }, "timestamp": 2 }),
			json!({ "id": "a", "role": "toolResult", "toolCallId": "q5", "toolName": "quiz", "content": [{ "type": "text", "text": "{}" }], "details": { "kind": "quiz", "correct": true }, "timestamp": 3 }),
			json!({ "id": "d", "role": "custom", "customType": "analogy-drop", "content": "", "details": { "of": "q5" }, "timestamp": 4 }),
			json!({ "id": "p", "role": "custom", "customType": "phrase-drop", "content": "", "details": { "of": "q5" }, "timestamp": 5 }),
		];
		let note = app_note_for(&json!({ "messages": messages }), &ChatInput::Next, None).unwrap();
		messages.push(note);
		let seen = to_llm_messages(&messages);
		assert_eq!(seen.len(), 3, "the call, its answer and the note");
		assert_eq!(seen[2]["content"][0]["text"], json!("[Analogy dropped] reg: \"The leash fits one part\""));
	}

	#[test]
	fn an_unanswered_call_gets_the_interrupted_result() {
		let out = to_llm_messages(&[quiz_call("q1")]);
		assert_eq!(out.len(), 2);
		assert_eq!(out[1], json!({ "role": "toolResult", "toolCallId": "q1", "toolName": "quiz", "content": [{ "type": "text", "text": INTERRUPTED_TEXT }], "isError": false, "timestamp": 5 }));
		let answered = to_llm_messages(&[quiz_call("q1"), json!({ "role": "toolResult", "toolCallId": "q1", "content": [] })]);
		assert_eq!(answered.len(), 2);
	}

	#[test]
	fn a_side_question_holds_the_answer_back_to_its_own_place() {
		let messages = vec![
			quiz_call("q1"),
			json!({ "id": "s", "role": "user", "content": "why?", "side": true, "timestamp": 6 }),
			json!({ "role": "toolResult", "toolCallId": "q1", "content": [{ "type": "text", "text": "{\"a\":1}" }, { "type": "image" }], "timestamp": 7 }),
		];
		let out = to_llm_messages(&messages);
		assert_eq!(out[1]["content"][0]["text"], json!(SIDE_PENDING_TEXT));
		assert_eq!(out[2], json!({ "role": "user", "content": "why?", "timestamp": 6 }));
		assert_eq!(out[3], json!({ "role": "user", "content": [{ "type": "text", "text": "The learner answered your open question: {\"a\":1}" }, { "type": "image" }], "timestamp": 7 }));
	}

	#[test]
	fn the_compaction_head_replaces_everything_before_the_cut() {
		let messages = vec![
			json!({ "id": "sys", "role": "system", "content": "prompt" }),
			json!({ "id": "a", "role": "user", "content": "old" }),
			json!({ "id": "b", "role": "user", "content": "kept", "timestamp": 2 }),
			json!({ "id": "c", "role": "custom", "customType": "compaction", "content": "summary", "details": { "firstKeptMessageId": "b" }, "timestamp": 9 }),
		];
		assert_eq!(
			to_llm_messages(&messages),
			vec![
				messages[0].clone(),
				json!({ "role": "user", "content": [{ "type": "text", "text": "summary" }], "timestamp": 9 }),
				json!({ "role": "user", "content": "kept", "timestamp": 2 }),
			]
		);
		// A cut naming a missing message renders everything, the marker as text.
		let lost = vec![messages[1].clone(), json!({ "id": "c", "role": "custom", "customType": "compaction", "content": "s", "details": { "firstKeptMessageId": "gone" }, "timestamp": 9 })];
		assert_eq!(to_llm_messages(&lost).len(), 2);
	}
}
