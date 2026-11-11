//! The events POST /api/chat carries and the record
//! appends each one makes. A send tells the server what happened, never what the client's list
//! looks like, and a refused event appends nothing.

use std::fmt;

use gs_base::text;
use gs_json::Json;

use super::attachments::{ChatAttachment, MAX_ATTACHMENTS, TOO_MANY_REFUSAL, attachment_refusal, base64_bytes};
use gs_json::js_text::js_string;
use super::native_messages::{
	concluded_by_dismissal_pair, dangling_question_of, active_problem_of, new_answer_result, new_next_message, new_problem_dismissed_marker, new_side_question, new_thinking_message, new_user_message,
	pending_problem_dismissal_of,
};
use super::pending::{answer_takes_files, tool_question_kind};

/// A malformed input event: the honest 400.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatInputError(pub String);

impl fmt::Display for ChatInputError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str(&self.0)
	}
}

impl std::error::Error for ChatInputError {}

fn refuse<T>(message: impl Into<String>) -> Result<T, ChatInputError> {
	Err(ChatInputError(message.into()))
}

/// One client input event (the POST body's `input`).
#[derive(Clone, Debug, PartialEq)]
pub enum ChatInput {
	/// A learner-authored message.
	Text { text: String, attachments: Option<Vec<ChatAttachment>> },
	/// The pending question's graded result.
	Answer { tool_call_id: String, answer: Json, attachments: Option<Vec<ChatAttachment>> },
	/// Run the next turn on the current record.
	Continue,
	/// A side question asked while a question or problem waits.
	Side { text: String, attachments: Option<Vec<ChatAttachment>> },
	/// The learner's thinking on the active practice problem.
	Thinking { problem_call_id: String, text: String, attachments: Option<Vec<ChatAttachment>> },
	/// The learner's go-ahead between problems.
	Next,
}

/// Every input a turn accepts: a client event, or the wake pipeline's queued steers.
#[derive(Clone, Debug, PartialEq)]
pub enum TurnInput {
	Chat(ChatInput),
	Steers(Vec<Json>),
}

/// The dismissal event. It never composes a turn: the silent route appends and persists and
/// wakes nothing.
#[derive(Clone, Debug, PartialEq)]
pub enum DismissInput {
	/// A question's dismissal; the answer must be one.
	Dismiss { tool_call_id: String, answer: Json },
	/// The problem discard; the conclude pair rides the learner's next input.
	DismissProblem { problem_call_id: String },
}

/// A mid-turn steer from the composer, with the client-minted id.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UserSteerInput {
	pub id: String,
	pub text: String,
}

/// JavaScript's `typeof x === "object" && x !== null`: arrays count.
fn is_object(v: &Json) -> bool {
	matches!(v, Json::Obj(_) | Json::Arr(_))
}

fn non_empty_str(v: &Json) -> Option<&str> {
	v.as_str().filter(|s| !s.is_empty())
}

fn object_input(input: &Json) -> Result<&Json, ChatInputError> {
	if is_object(input) { Ok(input) } else { refuse("input must be an object") }
}

fn unknown_type<T>(input: &Json) -> Result<T, ChatInputError> {
	refuse(format!("unknown input type: {}", js_string(input.get("type"))))
}

/// Parse and validate a dismissal event off a request body.
pub fn parse_dismiss_input(input: &Json) -> Result<DismissInput, ChatInputError> {
	let i = object_input(input)?;
	if i["type"].as_str() == Some("dismiss-problem") {
		let Some(problem_call_id) = non_empty_str(&i["problemCallId"]) else { return refuse("dismiss-problem input requires problemCallId") };
		return Ok(DismissInput::DismissProblem { problem_call_id: problem_call_id.to_owned() });
	}
	if i["type"].as_str() != Some("dismiss") {
		return unknown_type(i);
	}
	let Some(tool_call_id) = non_empty_str(&i["toolCallId"]) else { return refuse("dismiss input requires toolCallId") };
	let answer = &i["answer"];
	if !is_object(answer) {
		return refuse("dismiss input requires the dismissal answer object");
	}
	if answer["dismissed"] != Json::Bool(true) {
		return refuse("dismiss input's answer must be a dismissal (dismissed: true)");
	}
	Ok(DismissInput::Dismiss { tool_call_id: tool_call_id.to_owned(), answer: answer.clone() })
}

/// Parse and validate a steer event off a request body.
pub fn parse_user_steer_input(input: &Json) -> Result<UserSteerInput, ChatInputError> {
	let i = object_input(input)?;
	if i["type"].as_str() != Some("steer") {
		return unknown_type(i);
	}
	let Some(id) = non_empty_str(&i["id"]) else { return refuse("steer input requires a client-minted id") };
	let Some(steer_text) = i["text"].as_str().filter(|t| !text::trim(t).is_empty()) else { return refuse("steer input requires non-empty text") };
	Ok(UserSteerInput { id: id.to_owned(), text: steer_text.to_owned() })
}

/// The native appends a dismissal makes: the call must be a waiting question call, or (for a
/// problem) the active problem.
pub fn dismiss_appends(record: &Json, input: &DismissInput) -> Result<Vec<Json>, ChatInputError> {
	let messages = messages_of(record);
	match input {
		DismissInput::DismissProblem { problem_call_id } => match active_problem_of(messages) {
			Some(active) if active.tool_call_id == *problem_call_id => Ok(vec![new_problem_dismissed_marker(problem_call_id)]),
			_ => refuse("dismiss-problem input targets no active problem"),
		},
		DismissInput::Dismiss { tool_call_id, answer } => {
			let Some(pending) = dangling_question_of(messages).filter(|p| p.tool_call_id == *tool_call_id) else { return refuse("dismiss input targets no pending question call") };
			if answer["kind"].as_str() != Some(tool_question_kind(&pending.tool)) {
				return refuse("dismiss input's answer kind does not match the question");
			}
			Ok(vec![new_answer_result(tool_call_id, &pending.tool, answer, &[])])
		}
	}
}

/// Parse and validate an input event off a request body.
pub fn parse_chat_input(input: &Json) -> Result<ChatInput, ChatInputError> {
	let i = object_input(input)?;
	match i["type"].as_str() {
		Some("text") => {
			let attachments = parse_attachments(i.get("attachments"))?;
			Ok(ChatInput::Text { text: required_text(i, &attachments, "text input requires non-empty text or attachments")?, attachments })
		}
		Some("answer") => {
			let Some(tool_call_id) = non_empty_str(&i["toolCallId"]) else { return refuse("answer input requires toolCallId") };
			if !is_object(&i["answer"]) {
				return refuse("answer input requires the graded answer object");
			}
			let attachments = parse_attachments(i.get("attachments"))?;
			Ok(ChatInput::Answer { tool_call_id: tool_call_id.to_owned(), answer: i["answer"].clone(), attachments })
		}
		Some("continue") => Ok(ChatInput::Continue),
		Some("side") => {
			let attachments = parse_attachments(i.get("attachments"))?;
			Ok(ChatInput::Side { text: required_text(i, &attachments, "side input requires non-empty text or attachments")?, attachments })
		}
		Some("thinking") => {
			let Some(problem_call_id) = non_empty_str(&i["problemCallId"]) else { return refuse("thinking input requires problemCallId") };
			let attachments = parse_attachments(i.get("attachments"))?;
			Ok(ChatInput::Thinking { problem_call_id: problem_call_id.to_owned(), text: required_text(i, &attachments, "thinking input requires non-empty text or attachments")?, attachments })
		}
		Some("next") => Ok(ChatInput::Next),
		_ => unknown_type(i),
	}
}

/// The input's text, which may be blank only when files came with it.
fn required_text(i: &Json, attachments: &Option<Vec<ChatAttachment>>, refusal: &str) -> Result<String, ChatInputError> {
	match i["text"].as_str() {
		Some(t) if attachments.is_some() || !text::trim(t).is_empty() => Ok(t.to_owned()),
		_ => refuse(refusal),
	}
}

/// `^[A-Za-z0-9+/]+={0,2}$`
fn is_base64(data: &str) -> bool {
	let body = data.strip_suffix("==").or_else(|| data.strip_suffix('=')).unwrap_or(data);
	!body.is_empty() && body.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/')
}

/// An input's files: absent, or 1 to MAX_ATTACHMENTS well-formed files the composer would have
/// accepted. Anything else is a 400.
pub fn parse_attachments(raw: Option<&Json>) -> Result<Option<Vec<ChatAttachment>>, ChatInputError> {
	let Some(raw) = raw else { return Ok(None) };
	let Some(files) = raw.as_arr().filter(|a| !a.is_empty()) else { return refuse("attachments must be a non-empty list") };
	if files.len() > MAX_ATTACHMENTS {
		return refuse(TOO_MANY_REFUSAL);
	}
	let mut out = Vec::with_capacity(files.len());
	for file in files {
		let (Some(name), Some(mime_type)) = (file["name"].as_str().filter(|n| !text::trim(n).is_empty()), non_empty_str(&file["mimeType"])) else {
			return refuse("each attachment requires a name and a mimeType");
		};
		let data = file["data"].as_str().filter(|d| text::len16(d).is_multiple_of(4) && is_base64(d));
		let Some(data) = data else { return refuse(format!("{name} is not valid base64")) };
		if let Some(refusal) = attachment_refusal(name, mime_type, base64_bytes(data)) {
			return refuse(refusal);
		}
		out.push(ChatAttachment { name: name.to_owned(), mime_type: mime_type.to_owned(), data: data.to_owned() });
	}
	Ok(Some(out))
}

/// A chat record's messages (none when it has no list).
pub fn messages_of(record: &Json) -> &[Json] {
	record["messages"].as_arr().map_or(&[], Vec::as_slice)
}

/// The native appends an input event makes to the record. `attachments` are the input's files as
/// the server stored them (pictures resized, PDFs saved); they join the learner's message.
///
/// A question's answer must target a waiting question call, and anything else is refused instead
/// of silently interrupting a question or answering one twice.
pub fn input_appends(record: &Json, input: &ChatInput, attachments: &[Json]) -> Result<Vec<Json>, ChatInputError> {
	let messages = messages_of(record);
	match input {
		ChatInput::Text { text, .. } => Ok(with_dismissal_conclusion(messages, new_user_message(text, attachments))),
		ChatInput::Answer { tool_call_id, answer, .. } => {
			let Some(pending) = dangling_question_of(messages).filter(|p| p.tool_call_id == *tool_call_id) else { return refuse("answer input targets no pending question call") };
			if !attachments.is_empty() && !answer_takes_files(&pending.tool) {
				return refuse(format!("a {} answer takes no files", pending.tool));
			}
			Ok(vec![new_answer_result(tool_call_id, &pending.tool, answer, attachments)])
		}
		ChatInput::Continue => Ok(dismissal_conclusion(messages)),
		ChatInput::Side { text, .. } => {
			if dangling_question_of(messages).is_none() && active_problem_of(messages).is_none() {
				return refuse("side input requires a waiting question or problem");
			}
			Ok(vec![new_side_question(text, attachments)])
		}
		ChatInput::Thinking { problem_call_id, text, .. } => {
			if active_problem_of(messages).is_none_or(|a| a.tool_call_id != *problem_call_id) {
				return refuse("thinking input targets no active problem");
			}
			Ok(with_dismissal_conclusion(messages, new_thinking_message(problem_call_id, text, attachments)))
		}
		ChatInput::Next => {
			if !matches!(record["kind"].as_str(), Some("practice" | "study" | "homework")) {
				return refuse("next input is a practice, study or homework session affordance");
			}
			if active_problem_of(messages).is_some() {
				return refuse("next input requires no active problem");
			}
			Ok(with_dismissal_conclusion(messages, new_next_message()))
		}
	}
}

/// A problem dismissal waiting for the learner's next input: the synthetic conclude call and its
/// ack ride ahead of that input, so the teacher reads the dismissal in its own vocabulary and the
/// problem slot frees. Empty when none waits.
fn dismissal_conclusion(messages: &[Json]) -> Vec<Json> {
	// An empty id is falsy in the TypeScript check, so it concludes nothing.
	pending_problem_dismissal_of(messages).filter(|id| !id.is_empty()).map(|problem_call_id| concluded_by_dismissal_pair(&problem_call_id).to_vec()).unwrap_or_default()
}

fn with_dismissal_conclusion(messages: &[Json], message: Json) -> Vec<Json> {
	let mut appends = dismissal_conclusion(messages);
	appends.push(message);
	appends
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn error_of<T: fmt::Debug>(result: Result<T, ChatInputError>) -> String {
		result.unwrap_err().0
	}

	#[test]
	fn text_needs_words_or_files() {
		assert_eq!(parse_chat_input(&json!({ "type": "text", "text": " hi" })).unwrap(), ChatInput::Text { text: " hi".into(), attachments: None });
		assert_eq!(error_of(parse_chat_input(&json!({ "type": "text", "text": "  " }))), "text input requires non-empty text or attachments");
		assert_eq!(error_of(parse_chat_input(&json!({ "type": "side" }))), "side input requires non-empty text or attachments");
		let file = json!({ "name": "a.png", "mimeType": "image/png", "data": "QUJD" });
		let parsed = parse_chat_input(&json!({ "type": "thinking", "problemCallId": "p", "text": "", "attachments": [file] })).unwrap();
		assert_eq!(parsed, ChatInput::Thinking { problem_call_id: "p".into(), text: String::new(), attachments: Some(vec![ChatAttachment { name: "a.png".into(), mime_type: "image/png".into(), data: "QUJD".into() }]) });
	}

	#[test]
	fn unknown_and_malformed_inputs_are_refused_with_the_typescript_words() {
		assert_eq!(error_of(parse_chat_input(&json!("x"))), "input must be an object");
		assert_eq!(error_of(parse_chat_input(&json!(null))), "input must be an object");
		assert_eq!(error_of(parse_chat_input(&json!({ "type": 5 }))), "unknown input type: 5");
		assert_eq!(error_of(parse_chat_input(&json!({}))), "unknown input type: undefined");
		assert_eq!(error_of(parse_chat_input(&json!([]))), "unknown input type: undefined");
		assert_eq!(error_of(parse_chat_input(&json!({ "type": "answer", "toolCallId": "q" }))), "answer input requires the graded answer object");
		assert_eq!(error_of(parse_dismiss_input(&json!({ "type": "dismiss", "toolCallId": "q", "answer": { "kind": "quiz" } }))), "dismiss input's answer must be a dismissal (dismissed: true)");
		assert_eq!(error_of(parse_user_steer_input(&json!({ "type": "steer", "id": "s", "text": " " }))), "steer input requires non-empty text");
	}

	#[test]
	fn attachments_are_checked_one_by_one() {
		let file = |name: &str, data: &str| json!({ "name": name, "mimeType": "image/png", "data": data });
		assert_eq!(error_of(parse_attachments(Some(&json!([])))), "attachments must be a non-empty list");
		assert_eq!(error_of(parse_attachments(Some(&json!(null)))), "attachments must be a non-empty list");
		assert_eq!(error_of(parse_attachments(Some(&Json::Arr(vec![file("a.png", "QUJD"); 6])))), TOO_MANY_REFUSAL);
		assert_eq!(error_of(parse_attachments(Some(&json!([null])))), "each attachment requires a name and a mimeType");
		assert_eq!(error_of(parse_attachments(Some(&json!([file("a.png", "QUJ")])))), "a.png is not valid base64");
		assert_eq!(error_of(parse_attachments(Some(&json!([file("a.png", "QU=D")])))), "a.png is not valid base64");
		assert_eq!(error_of(parse_attachments(Some(&json!([file("a.png", "====")])))), "a.png is not valid base64");
		assert_eq!(error_of(parse_attachments(Some(&json!([{ "name": "a.heic", "mimeType": "image/heic", "data": "QUJD" }])))), "Can't use HEIC photos yet. Export as JPG.");
		assert_eq!(parse_attachments(None), Ok(None));
		assert!(parse_attachments(Some(&json!([file("a.png", "QQ==")]))).unwrap().is_some());
	}

	fn quiz_record() -> Json {
		json!({ "kind": "practice", "messages": [{ "role": "assistant", "content": [{ "type": "toolCall", "id": "q1", "name": "quiz", "arguments": {} }] }] })
	}

	#[test]
	fn an_answer_must_target_the_waiting_question() {
		let record = quiz_record();
		let answer = ChatInput::Answer { tool_call_id: "q1".into(), answer: json!({ "kind": "quiz", "correct": true }), attachments: None };
		let appends = input_appends(&record, &answer, &[]).unwrap();
		assert_eq!(appends.len(), 1);
		assert_eq!(appends[0]["toolName"], json!("quiz"));
		let wrong = ChatInput::Answer { tool_call_id: "q2".into(), answer: json!({}), attachments: None };
		assert_eq!(error_of(input_appends(&record, &wrong, &[])), "answer input targets no pending question call");
		let files = [json!({ "type": "image" })];
		assert_eq!(error_of(input_appends(&record, &answer, &files)), "a quiz answer takes no files");
		let dismissal = parse_dismiss_input(&json!({ "type": "dismiss", "toolCallId": "q1", "answer": { "kind": "quiz", "dismissed": true } })).unwrap();
		assert_eq!(dismiss_appends(&record, &dismissal).unwrap()[0]["details"]["dismissed"], json!(true));
		let mismatched = parse_dismiss_input(&json!({ "type": "dismiss", "toolCallId": "q1", "answer": { "kind": "text", "dismissed": true } })).unwrap();
		assert_eq!(error_of(dismiss_appends(&record, &mismatched)), "dismiss input's answer kind does not match the question");
		assert_eq!(input_appends(&record, &ChatInput::Side { text: "q".into(), attachments: None }, &[]).unwrap()[0]["side"], json!(true));
	}

	#[test]
	fn a_dismissed_problem_concludes_ahead_of_the_next_input() {
		let record = json!({
			"kind": "practice",
			"messages": [
				{ "role": "assistant", "content": [{ "type": "toolCall", "id": "p1", "name": "problem", "arguments": {} }] },
				{ "role": "toolResult", "toolCallId": "p1", "isError": false },
			],
		});
		let thinking = ChatInput::Thinking { problem_call_id: "p1".into(), text: "work".into(), attachments: None };
		assert_eq!(input_appends(&record, &thinking, &[]).unwrap().len(), 1);
		assert_eq!(error_of(input_appends(&record, &ChatInput::Next, &[])), "next input requires no active problem");
		let dismiss = DismissInput::DismissProblem { problem_call_id: "p1".into() };
		let marker = dismiss_appends(&record, &dismiss).unwrap();
		let mut dismissed = record.clone();
		dismissed.get_mut("messages").and_then(Json::as_arr_mut).unwrap().extend(marker);
		let appends = input_appends(&dismissed, &ChatInput::Next, &[]).unwrap();
		assert_eq!(appends.len(), 3);
		assert_eq!(appends[1]["toolCallId"], json!("call_conc_p1"));
		assert_eq!(appends[2]["customType"], json!("practice-next"));
		assert_eq!(input_appends(&dismissed, &ChatInput::Continue, &[]).unwrap().len(), 2);
		let unnamed = json!({ "messages": [{ "role": "custom", "customType": "problem-dismissed", "details": { "problemCallId": "" } }] });
		assert!(input_appends(&unnamed, &ChatInput::Continue, &[]).unwrap().is_empty());
		let teach = json!({ "kind": "teach", "messages": [] });
		assert_eq!(error_of(input_appends(&teach, &ChatInput::Next, &[])), "next input is a practice, study or homework session affordance");
		assert_eq!(error_of(input_appends(&teach, &ChatInput::Side { text: "q".into(), attachments: None }, &[])), "side input requires a waiting question or problem");
	}
}
