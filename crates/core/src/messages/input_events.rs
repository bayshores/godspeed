//! The events POST /api/chat carries and the record
//! appends each one makes. A send tells the server what happened, never what the client's list
//! looks like, and a refused event appends nothing.

use std::fmt;

use gs_base::{clock, text, time};
use gs_json::{Json, json};

use super::attachments::{ChatAttachment, MAX_ATTACHMENTS, TOO_MANY_REFUSAL, attachment_refusal, base64_bytes};
use gs_json::js_text::js_string;
use super::native_messages::{
	concluded_by_dismissal_pair, dangling_question_of, active_problem_of, new_answer_result, new_next_message, new_problem_dismissed_marker, new_side_question, new_user_message,
	pending_problem_dismissal_of,
};
use super::app_notes::opener_answer_text;
use super::lesson_markers::new_opener_answer_marker;
use super::pending::{answer_takes_files, tool_question_kind};
use crate::study::topic_end::shown_openers;

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

/// What Ask Teacher asks about. Either question stays open.
#[derive(Clone, Debug, PartialEq)]
pub enum About {
	/// A shown opener, by its topic_done call id.
	Opener(String),
	/// The open question from earlier, by the call it came from (`{chatId, toolCallId}`), with the
	/// labels of the options he has picked so far.
	Review { of: Json, picked: Vec<String> },
}

/// One client input event (the POST body's `input`).
#[derive(Clone, Debug, PartialEq)]
pub enum ChatInput {
	/// A learner-authored message; `about` when Ask Teacher sent it.
	Text { text: String, attachments: Option<Vec<ChatAttachment>>, about: Option<About> },
	/// The pending question's graded result.
	Answer { tool_call_id: String, answer: Json, attachments: Option<Vec<ChatAttachment>> },
	/// Run the next turn on the current record.
	Continue,
	/// A side question asked while a question waits. With a problem open, a message is plain text.
	Side { text: String, attachments: Option<Vec<ChatAttachment>> },
	/// The learner's go-ahead between problems.
	Next,
	/// His answer to the next topic's opener, which has no tool call of its own; none is Skip
	/// question.
	OpenerAnswer { topic_done_call_id: String, answer: Option<Json> },
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
			let text = required_text(i, &attachments, "text input requires non-empty text or attachments")?;
			Ok(ChatInput::Text { text, attachments, about: parse_about(i.get("about"))? })
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
		Some("next") => Ok(ChatInput::Next),
		Some("opener-answer") => {
			let Some(topic_done_call_id) = non_empty_str(&i["topicDoneCallId"]) else { return refuse("opener-answer input requires topicDoneCallId") };
			// A missing answer is not a skip: only null is.
			let answer = match i.get("answer") {
				Some(Json::Null) => None,
				Some(answer) if is_object(answer) => Some(answer.clone()),
				_ => return refuse("opener-answer input requires the graded answer object, or null to skip"),
			};
			Ok(ChatInput::OpenerAnswer { topic_done_call_id: topic_done_call_id.to_owned(), answer })
		}
		_ => unknown_type(i),
	}
}

/// A text input's `about`: absent, the opener it asks about, or the question from earlier.
fn parse_about(raw: Option<&Json>) -> Result<Option<About>, ChatInputError> {
	let Some(raw) = raw else { return Ok(None) };
	if let Some(opener) = non_empty_str(&raw["opener"]) {
		return Ok(Some(About::Opener(opener.to_owned())));
	}
	let of = &raw["reviewOf"];
	let (Some(chat_id), Some(tool_call_id)) = (non_empty_str(&of["chatId"]), non_empty_str(&of["toolCallId"])) else {
		return refuse("about requires opener (a topic_done call id) or reviewOf ({chatId, toolCallId})");
	};
	let picked = match raw.get("picked") {
		None => Vec::new(),
		Some(Json::Arr(labels)) if labels.iter().all(|l| l.as_str().is_some()) => labels.iter().filter_map(|l| l.as_str().map(str::to_owned)).collect(),
		Some(_) => return refuse("about.picked must be a list of option labels"),
	};
	Ok(Some(About::Review { of: json!({ "chatId": chat_id, "toolCallId": tool_call_id }), picked }))
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
		ChatInput::Text { text, about, .. } => {
			if let Some(About::Opener(opener)) = about {
				open_opener(messages, opener)?;
			}
			// Ask Teacher on a question from earlier while the teacher's own question waits behind
			// it: a side question, so that one stays open and is posed again.
			if matches!(about, Some(About::Review { .. })) && dangling_question_of(messages).is_some() {
				return Ok(vec![new_side_question(text, attachments)]);
			}
			Ok(with_dismissal_conclusion(messages, new_user_message(text, attachments)))
		}
		ChatInput::Answer { tool_call_id, answer, .. } => {
			let Some(pending) = dangling_question_of(messages).filter(|p| p.tool_call_id == *tool_call_id) else { return refuse("answer input targets no pending question call") };
			if !attachments.is_empty() && !answer_takes_files(&pending.tool) {
				return refuse(format!("a {} answer takes no files", pending.tool));
			}
			Ok(vec![new_answer_result(tool_call_id, &pending.tool, answer, attachments)])
		}
		ChatInput::Continue => Ok(dismissal_conclusion(messages)),
		ChatInput::Side { text, .. } => {
			if dangling_question_of(messages).is_none() {
				return refuse("side input requires a waiting question");
			}
			Ok(vec![new_side_question(text, attachments)])
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
		ChatInput::OpenerAnswer { topic_done_call_id, answer } => {
			open_opener(messages, topic_done_call_id)?;
			let stamped = match answer {
				None => Json::Null,
				Some(answer) => match stamped_quiz_answer(answer) {
					Some(stamped) => stamped,
					None => return refuse("an opener answer is a quiz answer with a pick, or I don't know"),
				},
			};
			let content = opener_answer_text(record, topic_done_call_id, &stamped);
			Ok(with_dismissal_conclusion(messages, new_opener_answer_marker(content, json!({ "topicDoneCallId": topic_done_call_id, "answer": stamped }))))
		}
	}
}

/// A quiz answer with a pick or I don't know, stamped with the server's clock like every record
/// time; none for anything else.
pub fn stamped_quiz_answer(answer: &Json) -> Option<Json> {
	let picked = answer["dontKnow"].truthy() || answer["answers"].as_arr().is_some_and(|a| !a.is_empty());
	if answer["kind"].as_str() != Some("quiz") || !picked {
		return None;
	}
	let mut stamped = answer.clone();
	stamped.as_obj_mut()?.insert("answeredAt", time::iso(clock::now_ms()));
	Some(stamped)
}

/// The 400s of an input about an opener: it must be on screen (its stop kept going) and not
/// answered yet.
fn open_opener(messages: &[Json], topic_done_call_id: &str) -> Result<(), ChatInputError> {
	let openers = shown_openers(messages);
	let Some(opener) = openers.get(topic_done_call_id) else { return refuse("no opener is shown for that topic_done (no Keep going at its stop)") };
	if opener.get("answer").is_some() {
		return refuse("that opener was already answered");
	}
	Ok(())
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
	use crate::study::topic_parts::NO_PLOT_YET;

	fn error_of<T: fmt::Debug>(result: Result<T, ChatInputError>) -> String {
		result.unwrap_err().0
	}

	#[test]
	fn text_needs_words_or_files() {
		assert_eq!(parse_chat_input(&json!({ "type": "text", "text": " hi" })).unwrap(), ChatInput::Text { text: " hi".into(), attachments: None, about: None });
		assert_eq!(error_of(parse_chat_input(&json!({ "type": "text", "text": "  " }))), "text input requires non-empty text or attachments");
		assert_eq!(error_of(parse_chat_input(&json!({ "type": "side" }))), "side input requires non-empty text or attachments");
		let file = json!({ "name": "a.png", "mimeType": "image/png", "data": "QUJD" });
		let parsed = parse_chat_input(&json!({ "type": "side", "text": "", "attachments": [file] })).unwrap();
		assert_eq!(parsed, ChatInput::Side { text: String::new(), attachments: Some(vec![ChatAttachment { name: "a.png".into(), mime_type: "image/png".into(), data: "QUJD".into() }]) });
	}

	#[test]
	fn unknown_and_malformed_inputs_are_refused_with_the_typescript_words() {
		assert_eq!(error_of(parse_chat_input(&json!("x"))), "input must be an object");
		assert_eq!(error_of(parse_chat_input(&json!(null))), "input must be an object");
		assert_eq!(error_of(parse_chat_input(&json!({ "type": 5 }))), "unknown input type: 5");
		assert_eq!(error_of(parse_chat_input(&json!({ "type": "thinking", "problemCallId": "p", "text": "x" }))), "unknown input type: thinking");
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
		let ask = ChatInput::Text { text: "Why?".into(), attachments: None, about: Some(About::Review { of: json!({ "chatId": "c", "toolCallId": "t" }), picked: vec![] }) };
		assert_eq!(input_appends(&record, &ask, &[]).unwrap()[0]["side"], json!(true), "Ask Teacher on a question from earlier keeps the waiting one open");
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
		let work = ChatInput::Text { text: "work".into(), attachments: None, about: None };
		assert_eq!(input_appends(&record, &work, &[]).unwrap().len(), 1);
		let side = ChatInput::Side { text: "q".into(), attachments: None };
		assert_eq!(error_of(input_appends(&record, &side, &[])), "side input requires a waiting question");
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
		assert_eq!(error_of(input_appends(&teach, &ChatInput::Side { text: "q".into(), attachments: None }, &[])), "side input requires a waiting question");
	}

	#[test]
	fn an_opener_answer_is_an_answer_or_null_to_skip() {
		let skip = ChatInput::OpenerAnswer { topic_done_call_id: "t1".into(), answer: None };
		assert_eq!(parse_chat_input(&json!({ "type": "opener-answer", "topicDoneCallId": "t1", "answer": null })).unwrap(), skip);
		let answer = json!({ "kind": "quiz", "answers": [] });
		assert_eq!(parse_chat_input(&json!({ "type": "opener-answer", "topicDoneCallId": "t1", "answer": answer })).unwrap(), ChatInput::OpenerAnswer { topic_done_call_id: "t1".into(), answer: Some(answer) });
		assert_eq!(error_of(parse_chat_input(&json!({ "type": "opener-answer", "answer": null }))), "opener-answer input requires topicDoneCallId");
		for raw in [json!({ "type": "opener-answer", "topicDoneCallId": "t1" }), json!({ "type": "opener-answer", "topicDoneCallId": "t1", "answer": "A" })] {
			assert_eq!(error_of(parse_chat_input(&raw)), "opener-answer input requires the graded answer object, or null to skip", "a missing answer is not a skip");
		}
	}

	#[test]
	fn text_takes_about_an_opener_or_a_question_from_earlier() {
		let ask = parse_chat_input(&json!({ "type": "text", "text": "why?", "about": { "opener": "t1" } })).unwrap();
		assert_eq!(ask, ChatInput::Text { text: "why?".into(), attachments: None, about: Some(About::Opener("t1".into())) });
		let review = parse_chat_input(&json!({ "type": "text", "text": "why?", "about": { "reviewOf": { "chatId": "c", "toolCallId": "t1", "x": 1 }, "picked": ["About 60%"] } })).unwrap();
		let of = json!({ "chatId": "c", "toolCallId": "t1" });
		assert_eq!(review, ChatInput::Text { text: "why?".into(), attachments: None, about: Some(About::Review { of: of.clone(), picked: vec!["About 60%".into()] }) });
		let unpicked = parse_chat_input(&json!({ "type": "text", "text": "why?", "about": { "reviewOf": of } })).unwrap();
		assert_eq!(unpicked, ChatInput::Text { text: "why?".into(), attachments: None, about: Some(About::Review { of: of.clone(), picked: vec![] }) });
		for about in [json!({}), json!(null), json!({ "opener": "" }), json!({ "reviewOf": { "chatId": "c" } })] {
			assert_eq!(error_of(parse_chat_input(&json!({ "type": "text", "text": "why?", "about": about }))), "about requires opener (a topic_done call id) or reviewOf ({chatId, toolCallId})");
		}
		let bad = json!({ "type": "text", "text": "why?", "about": { "reviewOf": of, "picked": [1] } });
		assert_eq!(error_of(parse_chat_input(&bad)), "about.picked must be a list of option labels");
	}

	/// Regularization ends on a conclude, topic_done stores the opener, and he kept going.
	fn kept() -> Vec<Json> {
		vec![
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "c1", "name": "conclude", "arguments": {} }], "timestamp": 0 }),
			json!({ "role": "toolResult", "toolCallId": "c1", "toolName": "conclude", "details": { "stop": { "kind": "topic", "nodeId": "reg", "activeMinutes": 30, "at": "2026-11-18T21:48:00.000Z" } }, "isError": false, "timestamp": 0 }),
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "t1", "name": "topic_done", "arguments": { "nodeId": "reg", "opener": { "lead": "Next.", "quiz": { "question": "?", "type": "predict", "nodeId": "cv" } } } }], "timestamp": 0 }),
			json!({ "role": "toolResult", "toolCallId": "t1", "toolName": "topic_done", "details": { "part": "topic_done", "v": 1 }, "isError": false, "timestamp": 0 }),
			json!({ "role": "custom", "customType": "keep-going", "content": "", "details": { "stopOf": "c1", "at": "2026-11-18T21:50:00.000Z" }, "timestamp": 0 }),
		]
	}

	fn study(messages: Vec<Json>) -> Json {
		json!({ "kind": "study", "messages": messages, "tree": { "nodes": [{ "id": "reg", "title": "Regularization" }, { "id": "cv", "title": "Cross-validation" }], "edges": [] } })
	}

	#[test]
	fn an_opener_answer_writes_its_marker_stamped_with_the_server_clock() {
		let answer = json!({ "kind": "quiz", "dontKnow": false, "answers": [{ "index": 2, "label": "Barely", "value": "Barely" }], "confidence": 80, "answeredAt": "2020-01-01T00:00:00.000Z" });
		let input = ChatInput::OpenerAnswer { topic_done_call_id: "t1".into(), answer: Some(answer) };
		let appends = input_appends(&study(kept()), &input, &[]).unwrap();
		assert_eq!(appends.len(), 1);
		assert_eq!((appends[0]["customType"].as_str(), appends[0]["content"].as_str()), (Some("opener-answer"), Some(format!("[Opener] Cross-validation: he picked B, Barely, sure 4.\n{NO_PLOT_YET}").as_str())));
		assert_eq!(appends[0]["details"]["topicDoneCallId"], json!("t1"));
		let stamped = appends[0]["details"]["answer"]["answeredAt"].as_str().and_then(time::parse_date).unwrap();
		assert!((clock::now_ms() - stamped).abs() < 60_000, "stamped with the server's clock");
		let skipped = input_appends(&study(kept()), &ChatInput::OpenerAnswer { topic_done_call_id: "t1".into(), answer: None }, &[]).unwrap();
		assert_eq!(skipped[0]["details"], json!({ "topicDoneCallId": "t1", "answer": null }));
	}

	#[test]
	fn the_opener_400s() {
		let skip = ChatInput::OpenerAnswer { topic_done_call_id: "t1".into(), answer: None };
		let mut not_kept = kept();
		not_kept.pop();
		assert_eq!(error_of(input_appends(&study(not_kept.clone()), &skip, &[])), "no opener is shown for that topic_done (no Keep going at its stop)");
		let mut answered = kept();
		answered.push(json!({ "role": "custom", "customType": "opener-answer", "content": "x", "details": { "topicDoneCallId": "t1", "answer": null }, "timestamp": 0 }));
		assert_eq!(error_of(input_appends(&study(answered), &skip, &[])), "that opener was already answered");
		for answer in [json!({ "kind": "quiz", "dontKnow": false, "answers": [] }), json!({ "kind": "ask", "dontKnow": true })] {
			let input = ChatInput::OpenerAnswer { topic_done_call_id: "t1".into(), answer: Some(answer) };
			assert_eq!(error_of(input_appends(&study(kept()), &input, &[])), "an opener answer is a quiz answer with a pick, or I don't know");
		}
		let ask = ChatInput::Text { text: "What is a fold?".into(), attachments: None, about: Some(About::Opener("t1".into())) };
		assert_eq!(error_of(input_appends(&study(not_kept), &ask, &[])), "no opener is shown for that topic_done (no Keep going at its stop)");
		let appends = input_appends(&study(kept()), &ask, &[]).unwrap();
		assert_eq!(appends[0]["role"], json!("user"));
		let asked = [kept(), appends].concat();
		assert!(input_appends(&study(asked), &skip, &[]).is_ok(), "the opener stays open after Ask Teacher");
	}
}
