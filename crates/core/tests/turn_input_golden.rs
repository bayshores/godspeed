//! What a lesson's agent session is sent each turn (`turn_input`), against tests/golden/turn_input.json.
//! The cases are written here; `GS_RECORD_GOLDEN=1 cargo test -p gs-core --test turn_input_golden`
//! records their outputs again, which is right only when the input is meant to change.

use gs_core::messages::native_messages::turn_input;
use gs_json::{Json, json, parse, stringify_pretty};

const GOLDEN: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/turn_input.json");

fn user(id: &str, content: Json) -> Json {
	json!({ "id": id, "role": "user", "content": content, "timestamp": 1 })
}

fn marker(id: &str, custom_type: &str, content: &str) -> Json {
	json!({ "id": id, "role": "custom", "customType": custom_type, "content": content, "display": true, "details": {}, "timestamp": 1 })
}

fn reply(id: &str, content: Json) -> Json {
	json!({ "id": id, "role": "assistant", "content": content, "api": "godspeed-agent", "provider": "agent", "model": "outside-agent", "usage": {}, "stopReason": "toolUse", "timestamp": 1 })
}

fn call(id: &str, name: &str, arguments: Json) -> Json {
	json!({ "type": "toolCall", "id": id, "name": name, "arguments": arguments })
}

fn result(id: &str, call_id: &str, name: &str, content: Json) -> Json {
	json!({ "id": id, "role": "toolResult", "toolCallId": call_id, "toolName": name, "content": content, "details": {}, "isError": false, "timestamp": 1 })
}

fn text(text: &str) -> Json {
	json!({ "type": "text", "text": text })
}

fn image() -> Json {
	json!({ "type": "image", "data": "iVBORw0KGgo=", "mimeType": "image/png" })
}

/// Each case: its name, the record and the id of the last message the session saw.
fn cases() -> Vec<(&'static str, Vec<Json>, Option<&'static str>)> {
	let card = marker("m_card", "study-context", "[Study context] Sets and functions.");
	let first = user("m_goal", json!("Teach me injective functions"));
	let quiz = reply("m_quiz", json!([text("One check first."), call("q1", "quiz", json!({ "question": "Is x² injective on ℝ?" }))]));
	let answer = result("m_answer", "q1", "quiz", json!([text("{\"pick\":\"no\",\"correct\":true}")]));
	let two = reply("m_two", json!([call("q2", "quiz", json!({ "question": "What is f(2)?" })), call("q3", "quiz", json!({ "question": "What is f(3)?" }))]));
	let side = json!({ "id": "m_side", "role": "user", "content": "why 3?", "side": true, "timestamp": 1 });
	let summary = json!({ "id": "m_cut", "role": "custom", "customType": "compaction", "content": "[Summary] He knows injective maps.", "details": { "firstKeptMessageId": "m_quiz" }, "timestamp": 1 });
	vec![
		("a new lesson's first turn", vec![card.clone(), first.clone()], None),
		("an answer to the session's own question", vec![card.clone(), first.clone(), quiz.clone(), marker("m_today", "today-context", "[Today] Monday."), answer.clone()], Some("m_quiz")),
		("an answer among several names its question", vec![first.clone(), two.clone(), side.clone(), result("m_r3", "q3", "quiz", json!([text("{\"value\":9}"), image()]))], Some("m_side")),
		("a typed message with a picture and a steer", vec![first.clone(), quiz.clone(), answer.clone(), user("m_typed", json!([text("Here is my work"), image()])), json!({ "id": "steer_1", "role": "user", "content": "also this", "timestamp": 1 })], Some("m_answer")),
		("markers go as text, view-only ones not at all", vec![first.clone(), marker("m_keep", "keep-going", ""), marker("m_next", "practice-next", "[NEXT PROBLEM]"), json!({ "id": "m_job", "role": "custom", "customType": "subagent-steer", "content": "The figure is drawn.", "attachments": [image()], "timestamp": 1 })], Some("m_goal")),
		("a new session after a cut opens with the summary and the kept tail", vec![card.clone(), first.clone(), quiz.clone(), answer.clone(), summary.clone(), user("m_more", json!("Next?"))], None),
		("a new session with no cut gets the whole record", vec![card, first.clone(), quiz.clone(), answer.clone(), user("m_more", json!("Next?"))], None),
		("a new session sees an unanswered question as interrupted and one behind a side question as open", vec![first.clone(), reply("m_old", json!([call("q0", "quiz", json!({ "question": "Is ∅ a set?" }))])), user("m_more", json!("Next?")), quiz.clone(), side.clone()], None),
		("a call godspeed wrote itself goes flat", vec![first, reply("m_conc", json!([call("call_conc_p1", "conclude", json!({ "outcome": "dismissed" }))])), result("m_ack", "call_conc_p1", "conclude", json!([text("Problem concluded.")])), marker("m_next", "practice-next", "[NEXT PROBLEM]")], Some("m_goal")),
	]
}

#[test]
fn a_turn_sends_only_what_the_session_has_not_seen() {
	let got: Vec<Json> = cases().into_iter().map(|(name, messages, seen)| json!({ "name": name, "messages": messages.clone(), "seen": seen, "output": turn_input(&messages, seen) })).collect();
	let got = Json::Arr(got);
	if std::env::var_os("GS_RECORD_GOLDEN").is_some() {
		gs_base::fsx::write_text_atomic(std::path::Path::new(GOLDEN), &format!("{}\n", stringify_pretty(&got, "\t"))).unwrap();
		return;
	}
	let want = parse(&std::fs::read_to_string(GOLDEN).unwrap()).unwrap();
	for (got, want) in got.items().iter().zip(want.items()) {
		assert_eq!(stringify_pretty(got, " "), stringify_pretty(want, " "), "{}", want["name"].str_or_empty());
	}
	assert_eq!(got.items().len(), want.items().len());
}
