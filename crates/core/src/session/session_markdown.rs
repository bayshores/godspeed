//! A teaching session as readable markdown
//! (speaker headers, quiz and check-in blocks, tool notes) for the markdown export and the MCP
//! read_lesson tool. Every message that produces view lines produces a block, in the same order.
//! A failed tool call renders nothing (retry context, not learning evidence), and custom markers
//! are invisible, same as the view, except what the agent was told: a shown opener's lead and
//! question follow its topic_done, and his answer to it is a learner line.
//!
//! Message-id anchors are not ported: every caller asked for the document without them.

use std::collections::{HashMap, HashSet};

use gs_base::re::Re;
use gs_json::{Json, Obj};

use super::code_question::fenced_code;
use gs_json::js_text::{field_text, js_string, or_empty};
use crate::contracts::chat::TOPIC_DONE_TOOL;
use crate::messages::native_messages::{PRACTICE_CONCLUDE_TOOL, PRACTICE_PROBLEM_TOOL, SEND_TO_USER_TOOL, failed_output_call_ids, problem_input_for_conclude, user_facing_text_of};
use crate::study::topic_end::shown_openers;

/// What the practice blocks join: practice tool results are acks, and the statement, outcome and
/// verdict all live in the assistant's call arguments. Calls are keyed by their id.
struct MarkdownContext<'a> {
	messages: &'a [Json],
	calls: HashMap<&'a str, &'a Json>,
	failed_output_calls: HashSet<String>,
	/// The shown openers, by topic_done call id.
	openers: Obj,
}

fn markdown_context(messages: &[Json]) -> MarkdownContext<'_> {
	let mut calls = HashMap::new();
	for message in messages.iter().filter(|m| m["role"].as_str() == Some("assistant")) {
		for block in message["content"].as_arr().into_iter().flatten() {
			if let (Some("toolCall"), Some(id)) = (block["type"].as_str(), block["id"].as_str()) {
				calls.insert(id, block);
			}
		}
	}
	MarkdownContext { messages, calls, failed_output_calls: failed_output_call_ids(messages), openers: shown_openers(messages) }
}

/// solvedWithHints becomes "Solved with hints": the outcome enum read as prose.
fn outcome_label(outcome: &str) -> String {
	let spaced = Re::new("([a-z])([A-Z])", "g").replace_with(outcome, |c| format!("{} {}", c.get(1).unwrap_or_default(), c.get(2).unwrap_or_default().to_lowercase()));
	let mut chars = spaced.chars();
	match chars.next() {
		// The first UTF-16 unit of an astral character is half a pair and has no case.
		Some(first) if first.len_utf16() == 1 => first.to_uppercase().chain(chars).collect(),
		_ => spaced,
	}
}

/// A string field, trimmed, when it holds anything but whitespace.
fn trimmed(v: &Json) -> Option<&str> {
	v.as_str().map(gs_base::text::trim).filter(|s| !s.is_empty())
}

/// `**Q:** ...` for a question text, or its placeholder.
fn question_line(question: &Json) -> String {
	let text = if question.truthy() { js_string(Some(question)) } else { "(no question text)".to_owned() };
	format!("**Q:** {text}")
}

/// The learner's thinking, `thinking ?? note` (`note` is the older key).
fn thinking_of(details: &Json) -> &Json {
	if details.get("thinking").is_some_and(|t| !t.is_null()) { &details["thinking"] } else { &details["note"] }
}

/// The thinking note line for the question cards, which print it only when it is text.
fn text_thinking_line(details: &Json) -> Option<String> {
	thinking_of(details).as_str().filter(|t| !t.is_empty()).map(|t| format!("*(his thinking: {t})*"))
}

/// How he answered a quiz: skipped, did not know, right or wrong, or in his own words, then his
/// thinking.
fn quiz_answer_lines(details: &Json) -> Vec<String> {
	let mut lines = Vec::new();
	if details["dismissed"] == Json::Bool(true) {
		lines.push("The learner skipped this check.".to_owned());
	} else if details["dontKnow"] == Json::Bool(true) {
		lines.push("The learner did not know.".to_owned());
	} else if details["correct"] == Json::Bool(true) {
		lines.push("The learner answered correctly.".to_owned());
	} else if details["correct"] == Json::Bool(false) {
		lines.push("The learner answered incorrectly.".to_owned());
	} else if let Some(text) = trimmed(&details["text"]) {
		lines.push(format!("The learner answered in his own words: {text}"));
	}
	lines.extend(text_thinking_line(details));
	lines
}

/// A shown opener's blocks after its topic_done: the lead as the teacher's words, then its question.
fn opener_blocks(opener: &Json) -> Vec<String> {
	let mut blocks: Vec<String> = trimmed(&opener["lead"]).map(|lead| format!("### Teacher\n\n{lead}")).into_iter().collect();
	blocks.push(format!("### Quiz\n\n{}", question_line(&opener["quiz"]["question"])));
	blocks
}

/// His answer to an opener (a null answer is a skip), in the quiz's words.
fn opener_answer_block(details: &Json) -> Option<String> {
	let answer = &details["answer"];
	let lines = if answer.is_null() { vec!["The learner skipped this check.".to_owned()] } else { quiz_answer_lines(answer) };
	(!lines.is_empty()).then(|| format!("### Learner\n\n{}", lines.join("\n\n")))
}

/// One tool result's learner-visible outcome as a heading and body lines.
fn tool_result_body(result: &Json, ctx: &MarkdownContext) -> (&'static str, Vec<String>) {
	let details = &result["details"];
	let tool = result["toolName"].as_str();
	let call_id = result["toolCallId"].as_str();
	let call_args = call_id.and_then(|id| ctx.calls.get(id)).map_or(&Json::Null, |call| &call["arguments"]);

	if let Some(tool @ ("quiz" | "probe" | "explain" | "recall")) = tool {
		let heading = match tool {
			"quiz" => "Quiz",
			"probe" => "Warm-up",
			"recall" => "Recall",
			_ => "Recall check",
		};
		let question = if details["questionText"].as_str().is_some_and(|q| !q.is_empty()) { &details["questionText"] } else { &Json::Null };
		let mut body = vec![question_line(question)];
		body.extend(quiz_answer_lines(details));
		return (heading, body);
	}

	if tool == Some("write_code") {
		let mut body = vec![question_line(&details["questionText"])];
		if details["dismissed"] == Json::Bool(true) {
			body.push("The learner skipped this question.".to_owned());
		} else if details["dontKnow"] == Json::Bool(true) {
			body.push("The learner did not know.".to_owned());
		} else if let Some(code) = details["code"].as_str() {
			let language = or_empty(details.get("language"));
			body.push(format!("The learner wrote:\n\n{}", fenced_code(code, &language)));
		}
		let thinking = thinking_of(details);
		if thinking.truthy() {
			body.push(format!("*(his thinking: {})*", js_string(Some(thinking))));
		}
		return ("Code", body);
	}

	if tool == Some(PRACTICE_PROBLEM_TOOL) {
		let statement = trimmed(&call_args["statement"]).unwrap_or("(no statement)");
		return ("Problem", vec![statement.to_owned()]);
	}

	if tool == Some(PRACTICE_CONCLUDE_TOOL) {
		let outcome = trimmed(&call_args["outcome"]).unwrap_or_default();
		let verdict = trimmed(&call_args["verdict"]);
		if outcome == "dismissed" {
			return ("Concluded", vec!["The learner skipped this problem.".to_owned()]);
		}
		let label = if outcome.is_empty() { "**Concluded.**".to_owned() } else { format!("**{}.**", outcome_label(outcome)) };
		let mut body = vec![verdict.map_or_else(|| label.clone(), |v| format!("{label} {v}"))];
		// The reveal: the solution committed at pose time, by the newest cleanly posed problem.
		let input = call_id.and_then(|id| problem_input_for_conclude(ctx.messages, id));
		if let Some(solution) = input.as_ref().and_then(|i| trimmed(&i["modelSolution"])) {
			body.push(format!("> **Model solution**\n>\n> {}", solution.replace('\n', "\n> ")));
		}
		return ("Concluded", body);
	}

	if tool == Some("ask_user_question") {
		let question = if details["questionText"].as_str().is_some_and(|q| !q.is_empty()) { &details["questionText"] } else { &Json::Null };
		let mut body = vec![question_line(question)];
		let mut chosen: Vec<String> = details["answers"].as_arr().into_iter().flatten().map(|a| or_empty(a.get("label"))).collect();
		chosen.extend(trimmed(&details["other"]).map(str::to_owned));
		if let Some(text) = trimmed(&details["text"]) {
			body.push(format!("The learner answered: {text}"));
		} else if !chosen.is_empty() {
			body.push(format!("The learner chose: {}", chosen.join(", ")));
		} else if details["dismissed"] == Json::Bool(true) {
			body.push("The learner skipped this question.".to_owned());
		}
		body.extend(text_thinking_line(details));
		return ("Question", body);
	}

	// Other clean tool results are one line.
	("Tool", vec![format!("*{} result delivered*", field_text(result, "toolName"))])
}

/// One message as a markdown block, or None when it renders nothing (a failed tool call, a bare
/// marker, a message with no text).
fn message_markdown(message: &Json, ctx: &MarkdownContext) -> Option<String> {
	let mut parts: Vec<String> = Vec::new();
	match message["role"].as_str() {
		Some("user") => {
			for text in user_facing_text_of(&message["content"], None) {
				parts.push(format!("### Learner\n\n{}", gs_base::text::trim(&text)));
			}
		}
		Some("assistant") => {
			for text in user_facing_text_of(&message["content"], Some(&ctx.failed_output_calls)) {
				parts.push(format!("### Teacher\n\n{}", gs_base::text::trim(&text)));
			}
		}
		Some("toolResult") => {
			if message["isError"].truthy() || message["toolName"].as_str() == Some(SEND_TO_USER_TOOL) {
				return None;
			}
			let (heading, body) = tool_result_body(message, ctx);
			parts.push(format!("### {heading}\n\n{}", body.join("\n\n")));
			if message["toolName"].as_str() == Some(TOPIC_DONE_TOOL)
				&& let Some(opener) = message["toolCallId"].as_str().and_then(|id| ctx.openers.get(id))
			{
				parts.extend(opener_blocks(opener));
			}
		}
		// Only answers to a shown opener; any other is refused when sent.
		Some("custom") if message["customType"].as_str() == Some("opener-answer") && message["details"]["topicDoneCallId"].as_str().is_some_and(|id| ctx.openers.contains_key(id)) => {
			parts.extend(opener_answer_block(&message["details"]));
		}
		_ => {}
	}
	(!parts.is_empty()).then(|| parts.join("\n\n"))
}

/// A whole session (or one extraction batch) as one markdown document. Blocks render in message
/// order and messages that render nothing are skipped. A non-empty title heads the document.
pub fn session_markdown(messages: &[Json], title: Option<&str>) -> String {
	let ctx = markdown_context(messages);
	let mut blocks: Vec<String> = Vec::new();
	if let Some(title) = title.filter(|t| !t.is_empty()) {
		blocks.push(format!("# {title}"));
	}
	blocks.extend(messages.iter().filter_map(|m| message_markdown(m, &ctx)));
	blocks.join("\n\n")
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn outcomes_read_as_prose() {
		assert_eq!(outcome_label("solvedWithHints"), "Solved with hints");
		assert_eq!(outcome_label("movedOn"), "Moved on");
		assert_eq!(outcome_label("x"), "X");
		assert_eq!(outcome_label(""), "");
	}

	fn assistant(blocks: Json) -> Json {
		json!({ "role": "assistant", "content": blocks })
	}

	fn result(tool: &str, call: &str, details: Json) -> Json {
		json!({ "role": "toolResult", "toolName": tool, "toolCallId": call, "details": details, "isError": false })
	}

	#[test]
	fn a_session_reads_in_order_and_skips_what_renders_nothing() {
		let messages = [
			json!({ "role": "user", "content": "  hello  " }),
			assistant(json!([{ "type": "text", "text": "Hi there" }, { "type": "toolCall", "id": "q1", "name": "quiz", "arguments": {} }])),
			result("quiz", "q1", json!({ "questionText": "Pick", "correct": false, "thinking": "hm" })),
			json!({ "role": "toolResult", "toolName": "quiz", "toolCallId": "q2", "isError": true }),
			result("send_to_user", "s1", json!({})),
			json!({ "role": "custom", "customType": "plan-block", "content": "x" }),
			result("web", "w", json!({})),
		];
		assert_eq!(
			session_markdown(&messages, Some("Lesson")),
			"# Lesson\n\n### Learner\n\nhello\n\n### Teacher\n\nHi there\n\n### Quiz\n\n**Q:** Pick\n\nThe learner answered incorrectly.\n\n*(his thinking: hm)*\n\n### Tool\n\n*web result delivered*"
		);
		assert_eq!(session_markdown(&[], Some("")), "");
	}

	#[test]
	fn practice_blocks_join_the_call_arguments() {
		let messages = [
			assistant(json!([{ "type": "toolCall", "id": "p1", "name": "problem", "arguments": { "statement": " Solve it ", "modelSolution": "a\nb" } }])),
			result("problem", "p1", json!({})),
			assistant(json!([{ "type": "toolCall", "id": "c1", "name": "conclude", "arguments": { "outcome": "solvedWithHints", "verdict": "Nice." } }])),
			result("conclude", "c1", json!({})),
			assistant(json!([{ "type": "toolCall", "id": "c2", "name": "conclude", "arguments": { "outcome": "dismissed" } }])),
			result("conclude", "c2", json!({})),
		];
		let text = session_markdown(&messages, None);
		assert!(text.starts_with("### Problem\n\nSolve it\n\n### Concluded\n\n**Solved with hints.** Nice.\n\n> **Model solution**\n>\n> a\n> b"));
		assert!(text.ends_with("### Concluded\n\nThe learner skipped this problem."));
	}

	/// Regularization's conclude carries the stop; topic_done stores Cross-validation's opener.
	fn opener_stored() -> Vec<Json> {
		vec![
			assistant(json!([{ "type": "toolCall", "id": "c1", "name": "conclude", "arguments": { "outcome": "solved", "verdict": "Right." } }])),
			result("conclude", "c1", json!({ "stop": { "kind": "topic", "nodeId": "reg", "activeMinutes": 30, "at": "2026-11-18T21:48:00.000Z" } })),
			assistant(json!([{ "type": "toolCall", "id": "t1", "name": "topic_done", "arguments": { "nodeId": "reg", "opener": { "lead": "Now split.", "quiz": { "question": "How much can the score move?", "type": "predict", "nodeId": "cv" } } } }])),
			result("topic_done", "t1", json!({ "part": "topic_done", "v": 1, "lead": "Now split the data." })),
		]
	}

	fn custom(custom_type: &str, content: &str, details: Json) -> Json {
		json!({ "role": "custom", "customType": custom_type, "content": content, "details": details })
	}

	#[test]
	fn a_shown_opener_and_his_answer_read_like_a_quiz() {
		let kept = custom("keep-going", "", json!({ "stopOf": "c1", "at": "2026-11-18T21:50:00.000Z" }));
		let answer = json!({ "kind": "quiz", "dontKnow": false, "answers": [{ "index": 1, "label": "A lot" }], "correct": true, "thinking": "small folds" });
		let answered = custom("opener-answer", "[Opener] Cross-validation: he picked A, A lot.", json!({ "topicDoneCallId": "t1", "answer": answer }));
		let note = custom("app-note", "[Resumed] He came back to this session after a stop.", json!({}));
		let text = session_markdown(&[opener_stored(), vec![kept.clone(), note, answered.clone()]].concat(), None);
		assert!(
			text.ends_with("### Tool\n\n*topic_done result delivered*\n\n### Teacher\n\nNow split the data.\n\n### Quiz\n\n**Q:** How much can the score move?\n\n### Learner\n\nThe learner answered correctly.\n\n*(his thinking: small folds)*"),
			"{text}"
		);
		let skipped = custom("opener-answer", "[Opener] Cross-validation: he skipped it.", json!({ "topicDoneCallId": "t1", "answer": null }));
		assert!(session_markdown(&[opener_stored(), vec![kept, skipped]].concat(), None).ends_with("### Quiz\n\n**Q:** How much can the score move?\n\n### Learner\n\nThe learner skipped this check."));
		let not_shown = session_markdown(&[opener_stored(), vec![answered]].concat(), None);
		assert!(not_shown.ends_with("### Tool\n\n*topic_done result delivered*"), "no Keep going, no opener: {not_shown}");
	}

	#[test]
	fn code_and_ask_answers() {
		let messages = [
			result("write_code", "w", json!({ "questionText": "Write f", "code": "int f();", "language": "c", "note": "slow" })),
			result("ask_user_question", "a", json!({ "questionText": "Which?", "answers": [{ "label": "A" }, { "label": "B" }], "other": " C " })),
			result("ask_user_question", "b", json!({ "dismissed": true })),
		];
		assert_eq!(
			session_markdown(&messages, None),
			"### Code\n\n**Q:** Write f\n\nThe learner wrote:\n\n```c\nint f();\n```\n\n*(his thinking: slow)*\n\n### Question\n\n**Q:** Which?\n\nThe learner chose: A, B, C\n\n### Question\n\n**Q:** (no question text)\n\nThe learner skipped this question."
		);
	}
}
