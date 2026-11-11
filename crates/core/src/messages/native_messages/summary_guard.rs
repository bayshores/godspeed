//! The lesson list's summary runs three folds over a record. In TypeScript they throw on a broken
//! message (null, or an assistant reply whose content or a block in it is missing where the fold
//! reads it), and Node then leaves the lesson out of the list. The Rust folds read such a message
//! as nothing, so this walks the same paths and says when Node would have thrown.

use gs_json::Json;

use super::scans::{clean_tool_call_ids, is_clean, is_plain_learner_message, replies_to_side_question, result_ids_from};
use super::{PRACTICE_CONCLUDE_TOOL, PRACTICE_PROBLEM_TOOL};
use crate::messages::pending::is_question_tool;
use crate::messages::phases::{Phase3, refused_probe, tagged_node_id};

/// Would `phaseAt3Lh(messages, start)`, `danglingQuestionOf` or `activeProblemOf` throw?
pub fn summary_folds_throw(messages: &[Json], start: Phase3) -> bool {
	messages.iter().any(Json::is_null) || phase_fold_throws(messages, start) || dangling_fold_throws(messages) || active_fold_throws(messages)
}

fn role(m: &Json) -> &str {
	m["role"].as_str().unwrap_or("")
}

/// `for (const block of content)`: only arrays and strings iterate, and a string's characters
/// have no blocks to read.
fn blocks(content: &Json) -> Option<&[Json]> {
	match content {
		Json::Arr(items) => Some(items),
		Json::Str(_) => Some(&[]),
		_ => None,
	}
}

/// phaseAt3Lh reads blocks only while in plan, and stops at the first tagged quiz or explain call.
fn phase_fold_throws(messages: &[Json], start: Phase3) -> bool {
	let mut phase = start;
	for m in messages {
		match role(m) {
			"toolResult" if phase == Phase3::Probe && m["toolName"].as_str() == Some("probe_done") && !m["isError"].truthy() && !refused_probe(&m["details"]) => phase = Phase3::Plan,
			"assistant" if phase == Phase3::Plan && !m["content"].is_null() => {
				let Some(blocks) = blocks(&m["content"]) else { return true };
				for b in blocks {
					if b.is_null() {
						return true;
					}
					if b["type"].as_str() == Some("toolCall") && matches!(b["name"].as_str(), Some("quiz" | "explain")) && tagged_node_id(&b["arguments"]) {
						phase = Phase3::Teach;
						break;
					}
				}
			}
			_ => {}
		}
	}
	false
}

/// danglingQuestionOf walks back to the first plain learner message and stops at the first open
/// question call.
fn dangling_fold_throws(messages: &[Json]) -> bool {
	for mi in (0..messages.len()).rev() {
		let m = &messages[mi];
		if is_plain_learner_message(m) {
			return false;
		}
		if role(m) != "assistant" {
			continue;
		}
		let Some(blocks) = blocks(&m["content"]) else { return true };
		let answered = result_ids_from(&messages[mi + 1..]);
		for b in blocks {
			if b.is_null() {
				return true;
			}
			let open = b["type"].as_str() == Some("toolCall") && b["name"].as_str().is_some_and(is_question_tool) && !b["id"].as_str().is_some_and(|id| answered.contains(id));
			if open {
				return false;
			}
		}
		if !replies_to_side_question(messages, mi) {
			return false;
		}
	}
	false
}

/// activeProblemOf reads `content.length` of every assistant reply it passes (a non-array has no
/// blocks to read) and stops at a dismissal, a clean conclude or a clean pose.
fn active_fold_throws(messages: &[Json]) -> bool {
	let clean = clean_tool_call_ids(messages);
	for m in messages.iter().rev() {
		match role(m) {
			"custom" if m["customType"].as_str() == Some("problem-dismissed") => return false,
			"assistant" => match &m["content"] {
				Json::Null => return true,
				Json::Arr(blocks) => {
					for b in blocks.iter().rev() {
						if b.is_null() {
							return true;
						}
						let ends = b["type"].as_str() == Some("toolCall") && matches!(b["name"].as_str(), Some(PRACTICE_CONCLUDE_TOOL | PRACTICE_PROBLEM_TOOL)) && is_clean(&clean, b);
						if ends {
							return false;
						}
					}
				}
				_ => {}
			},
			_ => {}
		}
	}
	false
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn throws(messages: Json) -> bool {
		summary_folds_throw(messages.as_arr().unwrap(), Phase3::Probe)
	}

	#[test]
	fn broken_messages_throw_where_node_reads_them() {
		assert!(throws(json!([null])));
		assert!(throws(json!([{ "role": "assistant" }])));
		assert!(throws(json!([{ "role": "assistant", "content": null }])));
		assert!(throws(json!([{ "role": "assistant", "content": [null] }])));
		assert!(throws(json!([{ "role": "assistant", "content": {} }])));
		assert!(!throws(json!(["text", 5, { "role": "assistant", "content": "plain" }])));
		assert!(!throws(json!([{ "role": "assistant", "content": [] }])));
	}

	#[test]
	fn a_learner_message_or_a_clean_pose_ends_the_walk_before_the_damage() {
		// danglingQuestionOf stops at the learner's message, and activeProblemOf at the clean pose.
		let messages = json!([
			{ "role": "assistant", "content": 7 },
			{ "role": "assistant", "content": [{ "type": "toolCall", "id": "p1", "name": "problem" }] },
			{ "role": "toolResult", "toolCallId": "p1" },
			{ "role": "user", "content": "hi" },
		]);
		assert!(!throws(messages));
		// An open question stops danglingQuestionOf before a broken block after it.
		let open = json!([{ "role": "assistant", "content": [{ "type": "toolCall", "id": "q1", "name": "quiz" }, null] }]);
		assert!(throws(open.clone()), "activeProblemOf still reads every block backwards");
		assert!(!dangling_fold_throws(open.as_arr().unwrap()));
	}
}
