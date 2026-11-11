//! Side questions: the learner asks the teacher something while a question or problem waits, and
//! it stays open around the answer. These rules decide what the model reads in their place.

use std::collections::{HashMap, HashSet};

use gs_base::text;
use gs_json::{Json, quote};

use super::scans::{active_problem_of, dangling_question_of, is_bookkeeping, is_side_question, tool_calls};
use crate::messages::js_text::js_string;
use crate::messages::pending::is_question_tool;

/// The model's result for a question the learner asked a side question around: providers need a
/// result right after the call, and the real answer comes later.
pub const SIDE_PENDING_TEXT: &str = "Not answered yet. The learner asked a side question first. Answer it. The question stays open in their window, so don't repeat it or ask another.";

/// How that later answer (or skip) reaches the model, at its own place.
pub const SIDE_ANSWER_LEAD: &str = "The learner answered your open question: ";

/// A side question asked while a problem is active starts with this: the problem already has its
/// result, so the question itself says the problem stays open.
pub const SIDE_PROBLEM_LEAD: &str = "Side question. Your problem stays open in their window: answer this in text, don't conclude it or pose another, and their thinking on it comes later. ";

/// Where a question was asked and where the side question that holds it sits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HeldQuestion {
	pub call_at: usize,
	pub side_at: usize,
}

/// The side question right after the assistant message at `i`, past its tool results and
/// bookkeeping.
fn side_question_after(messages: &[Json], i: usize) -> Option<usize> {
	let j = (i + 1..messages.len()).find(|&j| messages[j]["role"].as_str() != Some("toolResult") && !is_bookkeeping(&messages[j]))?;
	is_side_question(&messages[j]).then_some(j)
}

/// The question calls a side question was asked around: call id to the message that asked it and
/// that side question. Their result, if any, comes after the side question.
pub fn side_held_questions(messages: &[Json]) -> HashMap<String, HeldQuestion> {
	let mut answered_at: HashMap<&str, usize> = HashMap::new();
	for (j, m) in messages.iter().enumerate() {
		if let Some(id) = m["toolCallId"].as_str().filter(|_| m["role"].as_str() == Some("toolResult")) {
			answered_at.insert(id, j);
		}
	}
	let mut held = HashMap::new();
	for (j, m) in messages.iter().enumerate() {
		if m["role"].as_str() != Some("assistant") {
			continue;
		}
		let Some(side_at) = side_question_after(messages, j) else { continue };
		for call in tool_calls(m).filter(|b| b["name"].as_str().is_some_and(is_question_tool)) {
			let Some(id) = call["id"].as_str() else { continue };
			if answered_at.get(id).copied().unwrap_or(side_at) >= side_at {
				held.insert(id.to_owned(), HeldQuestion { call_at: j, side_at });
			}
		}
	}
	held
}

/// Does this turn answer a side question: the newest input (a learner message, their thinking, a
/// job result) is one, and the question or problem it was asked around is still open?
pub fn is_side_turn(messages: &[Json]) -> bool {
	let input = messages.iter().rev().find(|m| m["role"].as_str() == Some("user") || (m["role"].as_str() == Some("custom") && !is_bookkeeping(m)));
	input.is_some_and(is_side_question) && (dangling_question_of(messages).is_some() || active_problem_of(messages).is_some())
}

/// The indexes of side questions asked around an active problem with no question waiting: the
/// model reads SIDE_PROBLEM_LEAD before each. Each is judged from the messages before it, so
/// earlier model views never change.
pub(super) fn problem_side_questions(messages: &[Json]) -> HashSet<usize> {
	(0..messages.len())
		.filter(|&i| is_side_question(&messages[i]))
		.filter(|&i| dangling_question_of(&messages[..i]).is_none() && active_problem_of(&messages[..i]).is_some())
		.collect()
}

/// A side question's content with SIDE_PROBLEM_LEAD in front.
pub(super) fn with_problem_lead(content: &Json) -> Json {
	match content {
		Json::Str(s) => Json::from(format!("{SIDE_PROBLEM_LEAD}{s}")),
		Json::Arr(parts) => {
			let mut out: Vec<Json> = Vec::with_capacity(parts.len() + 1);
			match parts.first().filter(|first| first["type"].as_str() == Some("text")) {
				Some(first) => {
					let mut led = first.clone();
					if let Some(o) = led.as_obj_mut() {
						o.insert("text", format!("{SIDE_PROBLEM_LEAD}{}", js_string(first.get("text"))));
					}
					out.push(led);
					out.extend(parts[1..].iter().cloned());
				}
				None => {
					out.push(gs_json::json!({ "type": "text", "text": text::trim_end(SIDE_PROBLEM_LEAD) }));
					out.extend(parts.iter().cloned());
				}
			}
			Json::Arr(out)
		}
		other => other.clone(),
	}
}

/// SIDE_ANSWER_LEAD, naming the question when its message asked several: out of place, the answer
/// no longer sits next to its own call.
pub(super) fn side_answer_lead(asker: &Json, call_id: &str) -> String {
	if asker["role"].as_str() != Some("assistant") {
		return SIDE_ANSWER_LEAD.to_owned();
	}
	let questions: Vec<&Json> = tool_calls(asker).filter(|b| b["name"].as_str().is_some_and(is_question_tool)).collect();
	if questions.len() < 2 {
		return SIDE_ANSWER_LEAD.to_owned();
	}
	let question = questions.iter().find(|b| b["id"].as_str() == Some(call_id)).and_then(|b| b["arguments"]["question"].as_str()).unwrap_or(call_id);
	format!("The learner answered your open question ({}): ", quote(question))
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn quiz(id: &str) -> Json {
		json!({ "type": "toolCall", "id": id, "name": "quiz", "arguments": { "question": format!("what {id}?") } })
	}

	fn side() -> Json {
		json!({ "role": "user", "content": "why?", "side": true })
	}

	#[test]
	fn a_side_question_holds_the_calls_around_it() {
		let ask = json!({ "role": "assistant", "content": [quiz("a"), quiz("b")] });
		let messages = vec![ask, side(), json!({ "role": "assistant", "content": [] }), json!({ "role": "toolResult", "toolCallId": "a" })];
		let held = side_held_questions(&messages);
		assert_eq!(held.len(), 2);
		assert_eq!(held["a"], HeldQuestion { call_at: 0, side_at: 1 });
		assert!(is_side_turn(&messages[..2]));
		assert!(!is_side_turn(&messages[..1]));
		// A result before the side question means the call was answered first.
		let answered = vec![messages[0].clone(), json!({ "role": "toolResult", "toolCallId": "a" }), side()];
		assert!(!side_held_questions(&answered).contains_key("a"));
		assert!(side_held_questions(&answered).contains_key("b"));
	}

	#[test]
	fn an_active_problem_gives_its_side_questions_a_lead() {
		let pose = json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "p", "name": "problem", "arguments": {} }] });
		let messages = vec![pose, json!({ "role": "toolResult", "toolCallId": "p", "isError": false }), side()];
		assert_eq!(problem_side_questions(&messages), HashSet::from([2]));
		assert!(is_side_turn(&messages));
		assert_eq!(with_problem_lead(&json!("hi")), json!(format!("{SIDE_PROBLEM_LEAD}hi")));
		assert_eq!(with_problem_lead(&json!([{ "type": "text", "text": "hi", "x": 1 }, { "type": "image" }])), json!([{ "type": "text", "text": format!("{SIDE_PROBLEM_LEAD}hi"), "x": 1 }, { "type": "image" }]));
		assert_eq!(with_problem_lead(&json!([{ "type": "image" }])), json!([{ "type": "text", "text": SIDE_PROBLEM_LEAD.trim_end() }, { "type": "image" }]));
	}

	#[test]
	fn the_answer_lead_names_the_question_only_among_several() {
		let several = json!({ "role": "assistant", "content": [quiz("a"), quiz("b")] });
		assert_eq!(side_answer_lead(&several, "b"), "The learner answered your open question (\"what b?\"): ");
		assert_eq!(side_answer_lead(&several, "zz"), "The learner answered your open question (\"zz\"): ");
		assert_eq!(side_answer_lead(&json!({ "role": "assistant", "content": [quiz("a")] }), "a"), SIDE_ANSWER_LEAD);
		assert_eq!(side_answer_lead(&json!({ "role": "user" }), "a"), SIDE_ANSWER_LEAD);
	}
}
