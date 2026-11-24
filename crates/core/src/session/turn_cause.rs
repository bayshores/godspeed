//! Why a lesson's turn runs, which the desk's head sentence words: decided from the turn's input
//! and the record it lands on.

use gs_json::Json;

use crate::messages::input_events::{ChatInput, TurnInput};
use crate::messages::native_messages::active_problem_of;
use crate::messages::role::Role;

/// The causes by name, in `TurnCause` order (the window's `TURN_CAUSES`).
pub const TURN_CAUSES: [&str; 8] = ["first", "answer", "problem", "ask", "next", "retry", "open_problem", "job"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TurnCause {
	/// The teacher has written nothing in the lesson yet.
	First,
	/// An answer to a question.
	Answer,
	/// His message while a problem is open: his work on it.
	Problem,
	/// A message, a side question or a steer he typed.
	Ask,
	/// The go-ahead between problems.
	Next,
	/// Try again.
	Retry,
	/// A homework problem he picked.
	OpenProblem,
	/// A finished job woke the lesson.
	Job,
}

impl TurnCause {
	pub fn name(self) -> &'static str {
		TURN_CAUSES[self as usize]
	}
}

/// The cause of a turn with `input` on a record whose messages before it are `messages`.
pub fn turn_cause(input: &TurnInput, messages: &[Json]) -> TurnCause {
	let taught = messages.iter().any(|m| Role::Assistant.is(m));
	match input {
		TurnInput::Chat(ChatInput::Continue) => TurnCause::Retry,
		_ if !taught => TurnCause::First,
		TurnInput::Steers(steers) if steers.iter().any(|s| Role::User.is(s)) => TurnCause::Ask,
		TurnInput::Steers(_) => TurnCause::Job,
		TurnInput::Chat(ChatInput::Text { about: None, .. }) if active_problem_of(messages).is_some() => TurnCause::Problem,
		TurnInput::Chat(ChatInput::Text { .. } | ChatInput::Side { .. }) => TurnCause::Ask,
		TurnInput::Chat(ChatInput::Answer { .. } | ChatInput::OpenerAnswer { .. }) => TurnCause::Answer,
		TurnInput::Chat(ChatInput::Next) => TurnCause::Next,
		TurnInput::Chat(ChatInput::Open { .. }) => TurnCause::OpenProblem,
	}
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn taught() -> Vec<Json> {
		vec![json!({ "role": "user", "content": "Pointers", "timestamp": 1 }), json!({ "role": "assistant", "content": [{ "type": "text", "text": "Hi." }], "timestamp": 2 })]
	}

	fn text(text: &str) -> TurnInput {
		TurnInput::Chat(ChatInput::Text { text: text.to_owned(), attachments: None, about: None })
	}

	#[test]
	fn each_name_is_its_cause_s() {
		let all = [TurnCause::First, TurnCause::Answer, TurnCause::Problem, TurnCause::Ask, TurnCause::Next, TurnCause::Retry, TurnCause::OpenProblem, TurnCause::Job];
		assert_eq!(all.map(TurnCause::name), TURN_CAUSES);
	}

	#[test]
	fn each_input_has_its_cause() {
		let taught = taught();
		assert_eq!(turn_cause(&text("Pointers"), &[]), TurnCause::First);
		assert_eq!(turn_cause(&TurnInput::Steers(vec![json!({ "role": "custom", "customType": "probe-handoff" })]), &[]), TurnCause::First);
		assert_eq!(turn_cause(&text("Why?"), &taught), TurnCause::Ask);
		assert_eq!(turn_cause(&TurnInput::Chat(ChatInput::Side { text: "Why?".to_owned(), attachments: None }), &taught), TurnCause::Ask);
		let answer = TurnInput::Chat(ChatInput::Answer { tool_call_id: "q1".to_owned(), answer: json!({}), attachments: None });
		assert_eq!(turn_cause(&answer, &taught), TurnCause::Answer);
		assert_eq!(turn_cause(&TurnInput::Chat(ChatInput::OpenerAnswer { topic_done_call_id: "t1".to_owned(), answer: None }), &taught), TurnCause::Answer);
		assert_eq!(turn_cause(&TurnInput::Chat(ChatInput::Next), &taught), TurnCause::Next);
		assert_eq!(turn_cause(&TurnInput::Chat(ChatInput::Open { number: "2b".to_owned() }), &taught), TurnCause::OpenProblem);
		assert_eq!(turn_cause(&TurnInput::Chat(ChatInput::Continue), &[]), TurnCause::Retry, "Try again after a first reply that failed");
		assert_eq!(turn_cause(&TurnInput::Steers(vec![json!({ "id": "s1", "role": "user", "content": "Focus on malloc" })]), &taught), TurnCause::Ask);
		assert_eq!(turn_cause(&TurnInput::Steers(vec![json!({ "id": "steer_job_1", "role": "custom", "customType": "subagent-steer" })]), &taught), TurnCause::Job);
	}

	#[test]
	fn his_message_while_a_problem_is_open_is_his_work_on_it() {
		let mut posed = taught();
		posed.push(json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "p1", "name": "problem", "arguments": { "statement": "Sum 1 to n." } }], "timestamp": 3 }));
		posed.push(json!({ "role": "toolResult", "toolCallId": "p1", "toolName": "problem", "content": [], "isError": false, "timestamp": 3 }));
		assert_eq!(turn_cause(&text("n(n+1)/2"), &posed), TurnCause::Problem);
		posed.push(json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "c1", "name": "conclude", "arguments": { "outcome": "solved" } }], "timestamp": 4 }));
		posed.push(json!({ "role": "toolResult", "toolCallId": "c1", "toolName": "conclude", "content": [], "isError": false, "timestamp": 4 }));
		assert_eq!(turn_cause(&text("Next?"), &posed), TurnCause::Ask, "concluded");
	}
}
