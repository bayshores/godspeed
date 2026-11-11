//! Ported from src/shared/core/native-messages.ts: the lesson record's message shapes and what
//! builds them. A message is the pi message plus our `id`; markers are `role: "custom"`. The
//! scans, the side-question rules, the context cards and the model-facing projection live in the
//! folder beside this file and are re-exported here under their TypeScript module's name.

use std::collections::HashSet;

use gs_base::{clock, ids, text};
use gs_json::{Json, Obj, json, stringify};

use super::message_id::new_message_id;
use crate::contracts::chat::{CONCLUDE_ACK_TEXT, HANDOFF_TEXT, NEXT_PROBLEM_TEXT, THINKING_LABEL};
use crate::session::question_core::compact_answer_for_model;

mod context_cards;
mod scans;
mod side_questions;
mod summary_guard;
mod to_llm;

pub use context_cards::{class_card_text, new_class_context_message, new_graph_context_message, new_study_context_message};
pub use scans::{ActiveProblem, DanglingQuestion, active_problem_of, dangling_question_of, ends_in_dismissal, has_probe_done, pending_problem_dismissal_of, problem_input_for_conclude, retry_context};
pub use side_questions::{HeldQuestion, SIDE_ANSWER_LEAD, SIDE_PENDING_TEXT, SIDE_PROBLEM_LEAD, is_side_turn, side_held_questions};
pub use summary_guard::summary_folds_throw;
pub use to_llm::to_llm_messages;

pub const SEND_TO_USER_TOOL: &str = "send_to_user";

/// The practice agent's two tools (the conclude-before-next-problem gate's vocabulary).
pub const PRACTICE_PROBLEM_TOOL: &str = "problem";
pub const PRACTICE_CONCLUDE_TOOL: &str = "conclude";

/// The text of a `send_to_user` call block, when it has a non-blank message.
pub fn send_to_user_text(block: &Json) -> Option<String> {
	if block["type"].as_str() != Some("toolCall") || block["name"].as_str() != Some(SEND_TO_USER_TOOL) {
		return None;
	}
	block["arguments"]["message"].as_str().filter(|m| !text::trim(m).is_empty()).map(str::to_owned)
}

/// The text a message shows the learner: plain text blocks and `send_to_user` messages, minus
/// the calls in `failed`.
pub fn user_facing_text_of(content: &Json, failed: Option<&HashSet<String>>) -> Vec<String> {
	match content {
		Json::Str(s) => {
			if text::trim(s).is_empty() {
				vec![]
			} else {
				vec![s.clone()]
			}
		}
		Json::Arr(blocks) => blocks
			.iter()
			.filter(|b| b.as_obj().is_some())
			.filter(|b| !(b["type"].as_str() == Some("toolCall") && failed.is_some_and(|f| b["id"].as_str().is_some_and(|id| f.contains(id)))))
			.filter_map(|b| if b["type"].as_str() == Some("text") { b["text"].as_str().map(str::to_owned) } else { send_to_user_text(b) })
			.filter(|t| !text::trim(t).is_empty())
			.collect(),
		_ => vec![],
	}
}

/// The `send_to_user` calls whose message never reached the learner (an error result, or a
/// reply that stopped with an error or an abort).
pub fn failed_output_call_ids(messages: &[Json]) -> HashSet<String> {
	let mut failed = HashSet::new();
	for m in messages {
		match m["role"].as_str() {
			Some("toolResult") if m["toolName"].as_str() == Some(SEND_TO_USER_TOOL) && m["isError"].truthy() => {
				if let Some(id) = m["toolCallId"].as_str() {
					failed.insert(id.to_owned());
				}
			}
			Some("assistant") if matches!(m["stopReason"].as_str(), Some("error" | "aborted")) => {
				for b in m["content"].as_arr().into_iter().flatten() {
					if b["type"].as_str() == Some("toolCall")
						&& b["name"].as_str() == Some(SEND_TO_USER_TOOL)
						&& let Some(id) = b["id"].as_str()
					{
						failed.insert(id.to_owned());
					}
				}
			}
			_ => {}
		}
	}
	failed
}

fn now() -> Json {
	Json::from(clock::now_ms())
}

/// A marker message: `content` is what the model reads, `details` what the view shows.
fn marker(id: String, custom_type: &str, content: impl Into<Json>, display: bool, details: Json) -> Obj {
	[
		("id", Json::from(id)),
		("role", "custom".into()),
		("customType", custom_type.into()),
		("content", content.into()),
		("display", display.into()),
		("details", details),
		("timestamp", now()),
	]
	.into_iter()
	.collect()
}

/// A learner-authored user message. Files ride as content parts after the text; a message with
/// files may have no text.
pub fn new_user_message(text: &str, attachments: &[Json]) -> Json {
	let content = if attachments.is_empty() {
		Json::from(text)
	} else {
		let lead = (!gs_base::text::trim(text).is_empty()).then(|| json!({ "type": "text", "text": text }));
		lead.into_iter().chain(attachments.iter().cloned()).collect()
	};
	json!({ "id": new_message_id(), "role": "user", "content": content, "timestamp": clock::now_ms() })
}

/// A side question: the learner asks the teacher something while a question or problem waits.
/// The question stays open around it.
pub fn new_side_question(text: &str, attachments: &[Json]) -> Json {
	let mut message = new_user_message(text, attachments);
	if let Some(o) = message.as_obj_mut() {
		o.insert("side", true);
	}
	message
}

/// A steered user message (mid-turn composer steering) with the client-minted steer id.
pub fn new_user_steer(text: &str, id: &str) -> Json {
	json!({ "id": id, "role": "user", "content": text, "timestamp": clock::now_ms() })
}

/// The learner's answer: the question call's tool result. The model sees the compact record,
/// `details` keeps the full graded answer for the record and the view, and the answer's files
/// follow as content parts.
pub fn new_answer_result(tool_call_id: &str, tool_name: &str, answer: &Json, attachments: &[Json]) -> Json {
	let record = json!({ "type": "text", "text": stringify(&compact_answer_for_model(answer)) });
	json!({
		"id": new_message_id(),
		"role": "toolResult",
		"toolCallId": tool_call_id,
		"toolName": tool_name,
		"content": std::iter::once(record).chain(attachments.iter().cloned()).collect::<Json>(),
		"details": answer.clone(),
		"isError": false,
		"timestamp": clock::now_ms(),
	})
}

/// The probe-to-teach handoff wake. The id is fixed per chat so redelivery does nothing.
pub fn new_handoff_message(chat_id: &str) -> Json {
	Json::Obj(marker(format!("steer_probe_{chat_id}"), "probe-handoff", HANDOFF_TEXT, true, json!({ "chatId": chat_id })))
}

/// The plan-block marker for a plan_init call.
pub fn new_plan_block_message(plan_call_id: &str, block: Json) -> Json {
	Json::Obj(marker(ids::timed("pb"), "plan-block", "", true, json!({ "planCallId": plan_call_id, "block": block })))
}

/// The hidden marker carrying today's note for the model.
pub fn new_today_context_message(note: &str, day: &str) -> Json {
	Json::Obj(marker(new_message_id(), "today-context", note, false, json!({ "day": day })))
}

/// A request from the app itself (not the learner), shown in the chat.
pub fn new_app_request_message(request: &str, deadlines: Vec<Json>) -> Json {
	Json::Obj(marker(new_message_id(), "app-request", format!("[From godspeed, not the learner] {request}"), true, json!({ "deadlines": deadlines })))
}

/// The learner's thinking on the active problem. One lane: the model reads the text to tell
/// working from a claimed answer.
pub fn new_thinking_message(problem_call_id: &str, text: &str, attachments: &[Json]) -> Json {
	let mut message = marker(new_message_id(), "practice-thinking", format!("{THINKING_LABEL}:\n{text}"), true, json!({ "problemCallId": problem_call_id, "text": text }));
	if !attachments.is_empty() {
		// The files sit between the text and the display flag.
		let mut with_files = Obj::new();
		for (key, value) in message {
			let after_content = key == "content";
			with_files.insert(key, value);
			if after_content {
				with_files.insert("attachments", attachments.iter().cloned().collect::<Json>());
			}
		}
		message = with_files;
	}
	Json::Obj(message)
}

/// The learner's explicit move-on signal between problems.
pub fn new_next_message() -> Json {
	Json::Obj(marker(new_message_id(), "practice-next", NEXT_PROBLEM_TEXT, true, json!({})))
}

/// The problem-dismissal marker: view-only, the model's face arrives with the learner's next
/// input as `concluded_by_dismissal_pair`.
pub fn new_problem_dismissed_marker(problem_call_id: &str) -> Json {
	Json::Obj(marker(new_message_id(), "problem-dismissed", "", true, json!({ "problemCallId": problem_call_id })))
}

/// The dismissal's deferred conclude: a synthetic assistant message carrying a conclude call
/// (outcome "dismissed") plus its ack result, so the record and the model both read the problem
/// as concluded and the slot free. The call id is derived from the problem call id.
pub fn concluded_by_dismissal_pair(problem_call_id: &str) -> [Json; 2] {
	let call_id = format!("call_conc_{problem_call_id}");
	let at = clock::now_ms();
	let call = json!({ "type": "toolCall", "id": call_id, "name": PRACTICE_CONCLUDE_TOOL, "arguments": { "outcome": "dismissed" } });
	// The stamps are placeholders: history serialization reads only the content blocks.
	let assistant = json!({
		"id": new_message_id(),
		"role": "assistant",
		"content": [call],
		"timestamp": at,
		"api": "faux",
		"provider": "synthetic",
		"model": "synthetic-conclude",
		"usage": {
			"input": 0,
			"output": 0,
			"cacheRead": 0,
			"cacheWrite": 0,
			"totalTokens": 0,
			"cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 },
		},
		"stopReason": "toolUse",
	});
	let result = json!({
		"id": new_message_id(),
		"role": "toolResult",
		"toolCallId": call_id,
		"toolName": PRACTICE_CONCLUDE_TOOL,
		"content": [{ "type": "text", "text": CONCLUDE_ACK_TEXT }],
		"details": { "outcome": "dismissed", "problemCallId": problem_call_id },
		"isError": false,
		"timestamp": at,
	});
	[assistant, result]
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn user_facing_text_skips_failed_calls() {
		let messages = vec![
			json!({ "role": "assistant", "stopReason": "aborted", "content": [{ "type": "toolCall", "id": "c1", "name": "send_to_user", "arguments": { "message": "lost" } }] }),
			json!({ "role": "toolResult", "toolName": "send_to_user", "toolCallId": "c2", "isError": true }),
		];
		let failed = failed_output_call_ids(&messages);
		assert_eq!(failed, HashSet::from(["c1".to_owned(), "c2".to_owned()]));
		let content = json!([{ "type": "text", "text": "hi" }, { "type": "toolCall", "id": "c1", "name": "send_to_user", "arguments": { "message": "lost" } }, { "type": "toolCall", "id": "c3", "name": "send_to_user", "arguments": { "message": "kept" } }, { "type": "text", "text": "  " }]);
		assert_eq!(user_facing_text_of(&content, Some(&failed)), ["hi", "kept"]);
		assert_eq!(new_app_request_message("x", vec![])["content"], json!("[From godspeed, not the learner] x"));
	}

	fn keys(v: &Json) -> Vec<&str> {
		v.as_obj().unwrap().keys().map(String::as_str).collect()
	}

	#[test]
	fn user_messages_carry_files_after_the_text() {
		let plain = new_user_message("hi", &[]);
		assert_eq!(keys(&plain), ["id", "role", "content", "timestamp"]);
		assert_eq!(plain["content"], json!("hi"));
		let file = json!({ "type": "image", "data": "x", "mimeType": "image/png" });
		assert_eq!(new_user_message("hi", std::slice::from_ref(&file))["content"], json!([{ "type": "text", "text": "hi" }, file.clone()]));
		assert_eq!(new_user_message(" \n", std::slice::from_ref(&file))["content"], json!([file.clone()]));
		let side = new_side_question("q", &[]);
		assert_eq!(keys(&side), ["id", "role", "content", "timestamp", "side"]);
		let steer = new_user_steer("t", "steer_1");
		assert_eq!((keys(&steer), steer["id"].clone()), (vec!["id", "role", "content", "timestamp"], json!("steer_1")));
	}

	#[test]
	fn markers_keep_the_typescript_key_order() {
		let thinking = new_thinking_message("c1", "my work", &[json!({ "type": "text", "text": "f" })]);
		assert_eq!(keys(&thinking), ["id", "role", "customType", "content", "attachments", "display", "details", "timestamp"]);
		assert_eq!(thinking["content"], json!("Your thinking:\nmy work"));
		assert_eq!(keys(&new_thinking_message("c1", "t", &[])), ["id", "role", "customType", "content", "display", "details", "timestamp"]);
		assert_eq!(new_handoff_message("chat_x")["id"], json!("steer_probe_chat_x"));
		assert_eq!(new_next_message()["details"], json!({}));
		let answer = new_answer_result("c1", "quiz", &json!({ "kind": "quiz", "correct": true }), &[]);
		assert_eq!(keys(&answer), ["id", "role", "toolCallId", "toolName", "content", "details", "isError", "timestamp"]);
		assert_eq!(answer["content"][0]["text"], json!(r#"{"kind":"quiz","correct":true}"#));
	}

	#[test]
	fn the_dismissal_pair_ties_call_and_result() {
		let [call, result] = concluded_by_dismissal_pair("p1");
		assert_eq!(call["content"][0]["id"], json!("call_conc_p1"));
		assert_eq!(result["toolCallId"], json!("call_conc_p1"));
		assert_eq!(keys(&call), ["id", "role", "content", "timestamp", "api", "provider", "model", "usage", "stopReason"]);
		assert_eq!(call["timestamp"], result["timestamp"]);
	}
}
