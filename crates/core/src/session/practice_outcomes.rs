//! Each practice problem that was concluded,
//! paired with how it ended. A problem counts once its `problem` call went through, and ends at
//! the next `conclude` that went through.

use std::collections::HashMap;

use gs_base::time;
use gs_json::{Json, Obj};

use gs_json::js_text::js_string;

const OUTCOMES: [&str; 5] = ["solved", "solvedWithHints", "movedOn", "surrendered", "dismissed"];

struct Call<'a> {
	message_id: Option<&'a Json>,
	name: &'a str,
	args: &'a Json,
}

struct OpenProblem<'a> {
	message_id: Option<&'a Json>,
	call_id: &'a str,
	args: &'a Json,
}

/// `new Date(timestamp).toISOString()`: null and booleans read as numbers, text and objects
/// through `Date.parse`. A missing or unreadable timestamp is an invalid date, which JavaScript
/// refuses with a RangeError; stored records always carry a millisecond number.
fn iso_of(timestamp: Option<&Json>) -> String {
	let ms = match timestamp {
		None => None,
		Some(Json::Null | Json::Bool(false)) => Some(0),
		Some(Json::Bool(true)) => Some(1),
		Some(Json::Num(n)) => Some(*n).filter(|n| n.is_finite() && n.abs() <= 8.64e15).map(|n| n.trunc() as i64),
		Some(other) => time::parse_date(&js_string(Some(other))),
	};
	time::iso(ms.expect("Invalid time value"))
}

/// Strings of the `target` list, each once, in first-seen order.
fn targets_of(args: &Json) -> Json {
	let mut seen: Vec<&str> = Vec::new();
	for target in args["target"].as_arr().into_iter().flatten().filter_map(Json::as_str) {
		if !seen.contains(&target) {
			seen.push(target);
		}
	}
	seen.into_iter().map(|t| Json::Str(t.to_owned())).collect()
}

/// Each concluded practice problem, oldest first: `{ messageId, problemCallId, statement,
/// targets[, nodeId], outcome, at }` (a study problem names its plan node).
pub fn practice_outcomes(messages: &[Json]) -> Vec<Json> {
	let mut calls: HashMap<&str, Call> = HashMap::new();
	let mut out = Vec::new();
	let mut open: Option<OpenProblem> = None;
	for m in messages {
		if m["role"].as_str() == Some("assistant") {
			for block in m["content"].as_arr().into_iter().flatten() {
				let (Some(name @ ("problem" | "conclude")), Some(id)) = (block["name"].as_str(), block["id"].as_str()) else { continue };
				if block["type"].as_str() == Some("toolCall") {
					calls.insert(id, Call { message_id: m.get("id"), name, args: &block["arguments"] });
				}
			}
			continue;
		}
		if m["role"].as_str() != Some("toolResult") || m["isError"].truthy() {
			continue;
		}
		let Some(call_id) = m["toolCallId"].as_str() else { continue };
		let Some(call) = calls.get(call_id) else { continue };
		if call.name == "problem" {
			open = Some(OpenProblem { message_id: call.message_id, call_id, args: call.args });
			continue;
		}
		let Some(outcome) = call.args["outcome"].as_str().filter(|o| OUTCOMES.contains(o)) else { continue };
		let Some(problem) = open.take() else { continue };
		let mut entry = Obj::new();
		if let Some(id) = problem.message_id {
			entry.insert("messageId", id.clone());
		}
		entry.insert("problemCallId", problem.call_id);
		entry.insert("statement", problem.args["statement"].as_str().unwrap_or_default());
		entry.insert("targets", targets_of(problem.args));
		if let Some(node_id) = problem.args["nodeId"].as_str().filter(|n| !n.is_empty()) {
			entry.insert("nodeId", node_id);
		}
		entry.insert("outcome", outcome);
		entry.insert("at", iso_of(m.get("timestamp")));
		out.push(Json::Obj(entry));
	}
	out
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;

	fn assistant(id: &str, blocks: Json) -> Json {
		json!({ "role": "assistant", "id": id, "content": blocks })
	}

	fn result(call: &str, at: i64, is_error: bool) -> Json {
		json!({ "role": "toolResult", "toolCallId": call, "timestamp": at, "isError": is_error })
	}

	#[test]
	fn a_problem_ends_at_the_next_concluding_call_that_went_through() {
		let messages = [
			assistant("m1", json!([{ "type": "toolCall", "id": "p1", "name": "problem", "arguments": { "statement": "S", "target": ["f1", "f1", 3, "f2"] } }])),
			result("p1", 1, false),
			assistant("m2", json!([{ "type": "toolCall", "id": "c1", "name": "conclude", "arguments": { "outcome": "bogus" } }, { "type": "toolCall", "id": "c2", "name": "conclude", "arguments": { "outcome": "solved" } }])),
			result("c1", 2, false),
			result("c2", 1_700_000_000_123, true),
			result("c2", 1_700_000_000_123, false),
			result("c2", 1_700_000_000_999, false),
		];
		let out = practice_outcomes(&messages);
		assert_eq!(out.len(), 1);
		assert_eq!(stringify(&out[0]), r#"{"messageId":"m1","problemCallId":"p1","statement":"S","targets":["f1","f2"],"outcome":"solved","at":"2023-11-14T22:13:20.123Z"}"#);
	}

	#[test]
	fn a_study_problem_carries_its_plan_node() {
		let messages = [
			assistant("m1", json!([{ "type": "toolCall", "id": "p1", "name": "problem", "arguments": { "statement": "S", "nodeId": "tpc_1" } }, { "type": "toolCall", "id": "p2", "name": "problem", "arguments": { "statement": "T", "nodeId": "" } }])),
			result("p1", 1, false),
			assistant("m2", json!([{ "type": "toolCall", "id": "c1", "name": "conclude", "arguments": { "outcome": "movedOn" } }, { "type": "toolCall", "id": "c2", "name": "conclude", "arguments": { "outcome": "solved" } }])),
			result("c1", 2, false),
			result("p2", 3, false),
			result("c2", 4, false),
		];
		let out = practice_outcomes(&messages);
		assert_eq!(stringify(&out[0]), r#"{"messageId":"m1","problemCallId":"p1","statement":"S","targets":[],"nodeId":"tpc_1","outcome":"movedOn","at":"1970-01-01T00:00:00.002Z"}"#);
		assert!(out[1].get("nodeId").is_none());
	}

	#[test]
	fn timestamps_read_like_new_date() {
		assert_eq!(iso_of(Some(&Json::Null)), "1970-01-01T00:00:00.000Z");
		assert_eq!(iso_of(Some(&Json::Bool(true))), "1970-01-01T00:00:00.001Z");
		assert_eq!(iso_of(Some(&json!(-1.9))), "1969-12-31T23:59:59.999Z");
		assert_eq!(iso_of(Some(&json!(["2024-01-01"]))), "2024-01-01T00:00:00.000Z");
	}

	#[test]
	#[should_panic(expected = "Invalid time value")]
	fn a_missing_timestamp_is_an_invalid_date() {
		let messages = [
			assistant("m1", json!([{ "type": "toolCall", "id": "p1", "name": "problem", "arguments": {} }, { "type": "toolCall", "id": "c1", "name": "conclude", "arguments": { "outcome": "movedOn" } }])),
			result("p1", 1, false),
			json!({ "role": "toolResult", "toolCallId": "c1" }),
		];
		practice_outcomes(&messages);
	}
}
