//! Folds that read the record for what is open right now: the question waiting for an answer,
//! the problem on screen, a dismissal waiting for its conclude, and where a turn can retry from.

use std::collections::HashSet;

use gs_json::Json;

use super::{PRACTICE_CONCLUDE_TOOL, PRACTICE_PROBLEM_TOOL};
use crate::messages::lesson_markers::is_ui_only;
use crate::messages::pending::is_question_tool;
use crate::messages::phases::refused_probe;

/// The question the learner is being asked: the call's id, tool and arguments.
#[derive(Clone, Debug, PartialEq)]
pub struct DanglingQuestion {
	pub tool_call_id: String,
	pub tool: String,
	pub input: Json,
}

/// The problem on screen: the pose call's id and arguments.
#[derive(Clone, Debug, PartialEq)]
pub struct ActiveProblem {
	pub tool_call_id: String,
	pub input: Json,
}

fn role(m: &Json) -> &str {
	m["role"].as_str().unwrap_or("")
}

/// The tool calls in an assistant message, in order.
pub(super) fn tool_calls(m: &Json) -> impl DoubleEndedIterator<Item = &Json> {
	m["content"].as_arr().into_iter().flatten().filter(|b| b["type"].as_str() == Some("toolCall"))
}

/// A user message asked while a question or problem waits.
pub(super) fn is_side_question(m: &Json) -> bool {
	role(m) == "user" && m["side"] == Json::Bool(true)
}

pub(super) fn is_plain_learner_message(m: &Json) -> bool {
	role(m) == "user" && m["side"] != Json::Bool(true)
}

/// A compaction marker or a UI-only marker (a plan block, a problem dismissal, Keep going):
/// bookkeeping that lands between a question and the next learner message without being part of
/// either.
pub(super) fn is_bookkeeping(m: &Json) -> bool {
	let custom_type = m["customType"].as_str();
	role(m) == "custom" && (custom_type == Some("compaction") || is_ui_only(custom_type))
}

/// The ids of every tool result in `messages`.
pub(super) fn result_ids_from(messages: &[Json]) -> HashSet<&str> {
	messages.iter().filter(|m| role(m) == "toolResult").filter_map(|m| m["toolCallId"].as_str()).collect()
}

/// The ids of tool calls whose results are clean: the only calls that ever happened. A pose or a
/// conclude counts through its result, so errored and unanswered calls are skipped.
pub(super) fn clean_tool_call_ids(messages: &[Json]) -> HashSet<&str> {
	messages.iter().filter(|m| role(m) == "toolResult" && !m["isError"].truthy()).filter_map(|m| m["toolCallId"].as_str()).collect()
}

pub(super) fn is_clean(clean: &HashSet<&str>, call: &Json) -> bool {
	call["id"].as_str().is_some_and(|id| clean.contains(id))
}

/// What the agent filled into the problem call before the conclude call `conclude_call_id`: the
/// arguments of the newest pose that went through (a refused pose revealed nothing).
pub fn problem_input_for_conclude(messages: &[Json], conclude_call_id: &str) -> Option<Json> {
	let owner = messages.iter().position(|m| role(m) == "assistant" && tool_calls(m).any(|b| b["id"].as_str() == Some(conclude_call_id)))?;
	let clean = clean_tool_call_ids(messages);
	let pose = messages[..=owner].iter().rev().filter(|m| role(m) == "assistant").find_map(|m| tool_calls(m).rev().find(|b| b["name"].as_str() == Some(PRACTICE_PROBLEM_TOOL) && is_clean(&clean, b)))?;
	Some(pose["arguments"].clone()).filter(|a| !a.is_null())
}

/// The newest problem call with nothing concluding after it. A clean conclude call or a
/// dismissal marker frees the slot; the pose's own ack does not.
pub fn active_problem_of(messages: &[Json]) -> Option<ActiveProblem> {
	let clean = clean_tool_call_ids(messages);
	for m in messages.iter().rev() {
		match role(m) {
			"custom" if m["customType"].as_str() == Some("problem-dismissed") => return None,
			"assistant" => {
				for call in tool_calls(m).rev() {
					match call["name"].as_str() {
						Some(PRACTICE_CONCLUDE_TOOL) if is_clean(&clean, call) => return None,
						Some(PRACTICE_PROBLEM_TOOL) if is_clean(&clean, call) => {
							return Some(ActiveProblem { tool_call_id: call["id"].as_str().unwrap_or_default().to_owned(), input: call["arguments"].clone() });
						}
						_ => {}
					}
				}
			}
			_ => {}
		}
	}
	None
}

/// The problem call id of a dismissal marker still waiting for its conclude; the next learner
/// input carries the synthesized pair. The newest dismissal marker, clean conclude or clean pose
/// from the end decides.
pub fn pending_problem_dismissal_of(messages: &[Json]) -> Option<String> {
	let clean = clean_tool_call_ids(messages);
	for m in messages.iter().rev() {
		match role(m) {
			"custom" if m["customType"].as_str() == Some("problem-dismissed") => return m["details"]["problemCallId"].as_str().map(str::to_owned),
			"assistant" => {
				for call in tool_calls(m).rev() {
					if matches!(call["name"].as_str(), Some(PRACTICE_CONCLUDE_TOOL | PRACTICE_PROBLEM_TOOL)) && is_clean(&clean, call) {
						return None;
					}
				}
			}
			_ => {}
		}
	}
	None
}

/// Is the assistant message at `i` part of a reply to a side question (only reply steps and
/// bookkeeping lie between it and that question)?
pub(super) fn replies_to_side_question(messages: &[Json], i: usize) -> bool {
	messages[..i].iter().rev().find(|m| !matches!(role(m), "assistant" | "toolResult") && !is_bookkeeping(m)).is_some_and(is_side_question)
}

/// The question the learner is being asked: the newest assistant message's first question call
/// with no result after it. A reply to a side question looks past that question, so the one it
/// was asked around stays open. A plain learner message closes it.
pub fn dangling_question_of(messages: &[Json]) -> Option<DanglingQuestion> {
	for mi in (0..messages.len()).rev() {
		let m = &messages[mi];
		if is_plain_learner_message(m) {
			return None;
		}
		if role(m) != "assistant" {
			continue;
		}
		let answered = result_ids_from(&messages[mi + 1..]);
		let open = tool_calls(m).find(|b| b["name"].as_str().is_some_and(is_question_tool) && !b["id"].as_str().is_some_and(|id| answered.contains(id)));
		if let Some(call) = open {
			return Some(DanglingQuestion { tool_call_id: call["id"].as_str().unwrap_or_default().to_owned(), tool: call["name"].as_str().unwrap_or_default().to_owned(), input: call["arguments"].clone() });
		}
		if !replies_to_side_question(messages, mi) {
			return None;
		}
	}
	None
}

/// The probe-to-teach seam: a probe_done result that is neither an error nor a refusal means the
/// probe is over.
pub fn has_probe_done(messages: &[Json]) -> bool {
	messages.iter().any(|m| role(m) == "toolResult" && m["toolName"].as_str() == Some("probe_done") && !m["isError"].truthy() && !refused_probe(&m["details"]))
}

/// The record ends in a dismissed question: the session waits for the learner.
pub fn ends_in_dismissal(messages: &[Json]) -> bool {
	messages.last().is_some_and(|m| role(m) == "toolResult" && m["details"]["dismissed"] == Json::Bool(true))
}

/// The record a continue runs from: everything before a trailing failed or stopped reply.
pub fn retry_context(messages: &[Json]) -> &[Json] {
	let failed = |m: &Json| role(m) == "assistant" && matches!(m["stopReason"].as_str(), Some("error" | "aborted"));
	let end = messages.iter().rposition(|m| !failed(m)).map_or(0, |i| i + 1);
	&messages[..end]
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn call(id: &str, name: &str, arguments: Json) -> Json {
		json!({ "type": "toolCall", "id": id, "name": name, "arguments": arguments })
	}

	fn assistant(calls: Vec<Json>) -> Json {
		json!({ "role": "assistant", "content": calls })
	}

	fn result(id: &str, is_error: bool) -> Json {
		json!({ "role": "toolResult", "toolCallId": id, "toolName": "x", "isError": is_error })
	}

	fn user(side: bool) -> Json {
		if side { json!({ "role": "user", "content": "q", "side": true }) } else { json!({ "role": "user", "content": "q" }) }
	}

	#[test]
	fn a_problem_is_active_from_its_clean_ack_until_a_conclude_or_dismissal() {
		let pose = assistant(vec![call("p1", "problem", json!({ "statement": "s" }))]);
		let conclude = assistant(vec![call("c1", "conclude", json!({}))]);
		assert_eq!(active_problem_of(std::slice::from_ref(&pose)), None);
		let posed = [pose.clone(), result("p1", false)];
		assert_eq!(active_problem_of(&posed), Some(ActiveProblem { tool_call_id: "p1".into(), input: json!({ "statement": "s" }) }));
		assert_eq!(active_problem_of(&[pose.clone(), result("p1", true)]), None);
		let concluded = [pose.clone(), result("p1", false), conclude.clone(), result("c1", false)];
		assert_eq!(active_problem_of(&concluded), None);
		let dangling_conclude = [pose.clone(), result("p1", false), conclude.clone()];
		assert!(active_problem_of(&dangling_conclude).is_some());
		let dismissed = [pose, result("p1", false), json!({ "role": "custom", "customType": "problem-dismissed", "details": { "problemCallId": "p1" } })];
		assert_eq!(active_problem_of(&dismissed), None);
		assert_eq!(pending_problem_dismissal_of(&dismissed).as_deref(), Some("p1"));
		assert_eq!(pending_problem_dismissal_of(&concluded), None);
		assert_eq!(pending_problem_dismissal_of(&posed), None);
	}

	#[test]
	fn the_conclude_reads_the_pose_it_closes() {
		let messages = [
			assistant(vec![call("p1", "problem", json!({ "statement": "old" }))]),
			result("p1", false),
			assistant(vec![call("p2", "problem", json!({ "statement": "refused" }))]),
			result("p2", true),
			assistant(vec![call("c1", "conclude", json!({}))]),
		];
		assert_eq!(problem_input_for_conclude(&messages, "c1"), Some(json!({ "statement": "old" })));
		assert_eq!(problem_input_for_conclude(&messages, "nope"), None);
		assert_eq!(problem_input_for_conclude(&messages[2..], "c1"), None);
	}

	#[test]
	fn the_question_stays_open_around_a_side_question() {
		let quiz = assistant(vec![call("q1", "quiz", json!({ "question": "?" }))]);
		let open = DanglingQuestion { tool_call_id: "q1".into(), tool: "quiz".into(), input: json!({ "question": "?" }) };
		assert_eq!(dangling_question_of(std::slice::from_ref(&quiz)), Some(open.clone()));
		assert_eq!(dangling_question_of(&[quiz.clone(), result("q1", false)]), None);
		assert_eq!(dangling_question_of(&[quiz.clone(), user(false)]), None);
		let reply = assistant(vec![]);
		let around = [quiz.clone(), user(true), reply.clone()];
		assert_eq!(dangling_question_of(&around), Some(open));
		assert_eq!(dangling_question_of(&[quiz, user(false), reply]), None);
	}

	#[test]
	fn probe_dismissal_and_retry_folds() {
		let probe = json!({ "role": "toolResult", "toolName": "probe_done", "details": { "ok": false } });
		assert!(!has_probe_done(&[probe]));
		assert!(has_probe_done(&[json!({ "role": "toolResult", "toolName": "probe_done" })]));
		assert!(ends_in_dismissal(&[json!({ "role": "toolResult", "details": { "dismissed": true } })]));
		assert!(!ends_in_dismissal(&[]));
		let stopped = json!({ "role": "assistant", "content": [], "stopReason": "aborted" });
		let messages = [user(false), stopped.clone(), stopped];
		assert_eq!(retry_context(&messages), &messages[..1]);
		assert!(retry_context(&messages[1..]).is_empty());
	}
}
