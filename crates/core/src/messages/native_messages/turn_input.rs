//! What a lesson's agent session is sent when a turn starts: only the record past the message it
//! last saw. The session keeps its own history, so its own replies and tool results are never
//! sent again.

use std::collections::HashSet;

use gs_json::js_text::js_string;
use gs_json::{Json, json, stringify};

use super::flat::render_message;
use super::side_questions::{SIDE_PENDING_TEXT, side_answer_lead, side_held_questions};
use super::to_llm::INTERRUPTED_TEXT;
use crate::messages::compaction_marks::{active_compaction_of, kept_index_for};
use crate::messages::lesson_markers::is_ui_only;
use crate::messages::role::Role;
use crate::messages::tool_calls;

fn text_part(text: impl Into<Json>) -> Json {
	json!({ "type": "text", "text": text.into() })
}

/// A message's content as parts: a plain string is one text part; text and image blocks stay.
fn content_parts(content: &Json) -> Vec<Json> {
	match content {
		Json::Str(text) if !text.is_empty() => vec![text_part(text.as_str())],
		Json::Arr(blocks) => blocks.iter().filter(|b| matches!(b["type"].as_str(), Some("text" | "image"))).filter(|b| b["type"].as_str() != Some("text") || !b["text"].str_or_empty().is_empty()).cloned().collect(),
		_ => Vec::new(),
	}
}

/// The turn's input as content parts (`{type: "text", text}` and `{type: "image", data,
/// mimeType}`), from the record past `seen`, the id of the last message the session saw.
///
/// - With no `seen` (a new session) it starts at the active summary, then the kept tail; with no
///   summary, at the start of the record.
/// - The learner's messages go as they are, markers as their text with their files, an answer
///   to a call the session made as text after `side_answer_lead`.
/// - Any other reply or result (the history a new session needs, a call godspeed wrote itself)
///   goes as one line of its flattened JSON. A question in it with no answer yet gets the result
///   the old model view gave it: still open behind a side question, or interrupted.
pub fn turn_input(messages: &[Json], seen: Option<&str>) -> Vec<Json> {
	let seen_at = seen.and_then(|id| messages.iter().position(|m| m["id"].as_str() == Some(id)));
	let mut out = Vec::new();
	let mut summary_id: Option<&Json> = None;
	let from = match seen_at {
		Some(at) => at + 1,
		None => match active_compaction_of(messages).and_then(|marker| kept_index_for(messages, marker).filter(|&kept| kept > 0).map(|kept| (marker, kept))) {
			Some((marker, kept)) => {
				out.push(text_part(js_string(marker.get("content"))));
				summary_id = marker.get("id");
				kept
			}
			None => 0,
		},
	};
	// The calls the session made itself: their results past `seen` are the learner's answers.
	let made: HashSet<&str> = seen_at.map_or_else(HashSet::new, |at| messages[..=at].iter().filter(|m| Role::Assistant.is(m)).flat_map(tool_calls).filter_map(|c| c["id"].as_str()).collect());
	let answered: HashSet<&str> = messages.iter().filter(|m| Role::ToolResult.is(m)).filter_map(|m| m["toolCallId"].as_str()).collect();
	let held = side_held_questions(messages);
	let flat = |m: &Json| render_message(m).map(|flat| text_part(stringify(&flat)));
	for m in &messages[from..] {
		match Role::of(m) {
			Some(Role::System) => {}
			Some(Role::User) => out.extend(content_parts(&m["content"])),
			Some(Role::Custom) => {
				if is_ui_only(m["customType"].as_str()) || (summary_id.is_some() && m.get("id") == summary_id) {
					continue;
				}
				out.push(text_part(m["content"].clone()));
				out.extend(m["attachments"].items().iter().cloned());
			}
			Some(Role::ToolResult) if m["toolCallId"].as_str().is_some_and(|id| made.contains(id)) => {
				let call_id = m["toolCallId"].str_or_empty();
				let asker = messages.iter().rev().find(|a| Role::Assistant.is(a) && tool_calls(a).any(|c| c["id"].as_str() == Some(call_id)));
				let lead = asker.map_or_else(|| side_answer_lead(&Json::Null, call_id), |asker| side_answer_lead(asker, call_id));
				let parts = m["content"].items();
				let answer = parts.first().filter(|a| a["type"].as_str() == Some("text")).map_or_else(String::new, |a| js_string(a.get("text")));
				out.push(text_part(format!("{lead}{answer}")));
				out.extend(parts.iter().skip(1).filter(|p| p["type"].as_str() == Some("image")).cloned());
			}
			_ => {
				out.extend(flat(m));
				for call in tool_calls(m).filter(|_| Role::Assistant.is(m)) {
					let id = call["id"].str_or_empty();
					let open = held.contains_key(id);
					if !open && answered.contains(id) {
						continue;
					}
					let text = if open { SIDE_PENDING_TEXT } else { INTERRUPTED_TEXT };
					out.extend(flat(&json!({ "role": Role::ToolResult.as_str(), "toolCallId": id, "toolName": call["name"], "content": [text_part(text)], "isError": false })));
				}
			}
		}
	}
	out
}

#[cfg(test)]
mod tests {
	use super::*;

	fn quiz(id: &str) -> Json {
		json!({ "id": format!("a_{id}"), "role": "assistant", "content": [{ "type": "toolCall", "id": id, "name": "quiz", "arguments": { "question": "2 + 2?" } }] })
	}

	#[test]
	fn only_the_record_past_seen_is_sent() {
		let messages = vec![json!({ "id": "u1", "role": "user", "content": "Teach me sums" }), quiz("q1"), json!({ "id": "r1", "role": "toolResult", "toolCallId": "q1", "toolName": "quiz", "content": [{ "type": "text", "text": "{\"pick\":\"4\"}" }] })];
		assert_eq!(turn_input(&messages, Some("a_q1")), vec![text_part("The learner answered your open question: {\"pick\":\"4\"}")]);
		assert_eq!(turn_input(&messages, Some("r1")), Vec::<Json>::new());
	}

	#[test]
	fn a_seen_id_not_in_the_record_starts_over() {
		let messages = vec![json!({ "id": "u1", "role": "user", "content": "hi" })];
		assert_eq!(turn_input(&messages, Some("gone")), vec![text_part("hi")]);
	}
}
