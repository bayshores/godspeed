use std::collections::HashSet;

use gs_base::{hash, text};
use gs_json::{Json, json, stringify};

use crate::contracts::chat::TOPIC_DONE_TOOL;
use crate::messages::citations::cites_in_words;
use crate::messages::native_messages::{failed_output_call_ids, user_facing_text_of};
use crate::messages::pending::is_graded_tool;
use crate::session::question_core::{keep_fields_note, keep_of};

/// The extraction-relevant lines of one message: for a teacher message, one line per prose block,
/// topic_done opener lead and kept sentence, then one per graded question (topic_done's opener and
/// review questions too); everything else yields none. `mid` is part of each line, so the
/// same prose in two messages is two slots. `failed` defaults to this message's own failures.
pub fn message_view_lines(message: &Json, mid: &str, failed: Option<&HashSet<String>>) -> Vec<String> {
	if message["role"].as_str() != Some("assistant") {
		return Vec::new();
	}
	let own;
	let failed = match failed {
		Some(failed) => failed,
		None => {
			own = failed_output_call_ids(std::slice::from_ref(message));
			&own
		}
	};
	let content = &message["content"];
	let prose = user_facing_text_of(content, Some(failed)).into_iter().map(|t| format!("TEACHER [{mid}] {}", text::trim(&t)));
	let (leads, opener_questions) = topic_done_texts(content);
	let leads = leads.into_iter().chain(kept_texts(content)).map(|line| format!("TEACHER [{mid}] {line}"));
	let questions = graded_questions_of(content).into_iter().chain(opener_questions).map(|q| format!("QUESTION [{mid}] {q}"));
	prose.chain(leads).chain(questions).collect()
}

/// The sentence each quiz call offers him to keep, as its question counts, when its fields hold
/// (a keep that breaks them is never shown, at any length).
fn kept_texts(content: &Json) -> Vec<String> {
	let quizzes = content.as_arr().into_iter().flatten().filter(|b| b["type"].as_str() == Some("toolCall") && b["name"].as_str() == Some("quiz"));
	quizzes
		.filter_map(|b| keep_of(&b["arguments"]).filter(|k| keep_fields_note(k).is_none()))
		.filter_map(|k| k["text"].as_str().map(|t| text::trim(t).to_owned()))
		.collect()
}

/// What a topic_done call teaches: the opener's lead, and the questions of its opener and review.
fn topic_done_texts(content: &Json) -> (Vec<String>, Vec<String>) {
	let text_of = |t: &str| Some(text::trim(t).to_owned()).filter(|t| !t.is_empty());
	let mut leads = Vec::new();
	let mut questions = Vec::new();
	for block in content.as_arr().into_iter().flatten().filter(|b| b["type"].as_str() == Some("toolCall") && b["name"].as_str() == Some(TOPIC_DONE_TOOL)) {
		let args = &block["arguments"];
		leads.extend(args["opener"]["lead"].as_str().and_then(|lead| text_of(&cites_in_words(lead))));
		questions.extend([&args["opener"]["quiz"]["question"], &args["review"]["question"]].into_iter().filter_map(|q| q.as_str().and_then(text_of)));
	}
	(leads, questions)
}

/// The question text of each graded question call in a message's content.
fn graded_questions_of(content: &Json) -> Vec<String> {
	content
		.as_arr()
		.into_iter()
		.flatten()
		.filter(|block| block["type"].as_str() == Some("toolCall") && is_graded_tool(block["name"].as_str().unwrap_or("")))
		.filter_map(|block| block["arguments"]["question"].as_str().map(text::trim).filter(|q| !q.is_empty()).map(str::to_owned))
		.collect()
}

/// Tokens of a message's view: characters / 4, rounded up.
fn view_tokens(lines: &[String]) -> usize {
	text::len16(&lines.join("\n")).div_ceil(4)
}

fn message_id(message: &Json) -> &str {
	message["id"].as_str().unwrap_or("undefined")
}

/// sha256 of the role and the view lines: it changes exactly when the teacher prose changes.
pub fn message_fingerprint(message: &Json, failed: Option<&HashSet<String>>) -> String {
	let lines = message_view_lines(message, message_id(message), failed);
	hash::sha256_text(&stringify(&json!([message["role"], lines])))
}

/// One message's coverage projection.
#[derive(Clone)]
pub struct CoverageSlot<'a> {
	pub message: &'a Json,
	pub fp: String,
	pub tokens: usize,
}

/// Fingerprints a whole transcript, in order.
pub fn coverage_slots(messages: &[Json]) -> Vec<CoverageSlot<'_>> {
	let failed = failed_output_call_ids(messages);
	messages
		.iter()
		.map(|message| CoverageSlot {
			message,
			fp: message_fingerprint(message, Some(&failed)),
			tokens: view_tokens(&message_view_lines(message, message_id(message), Some(&failed))),
		})
		.collect()
}

/// Which slots are uncovered (indexes into `slots`) and the token totals. Messages with no view
/// lines are invisible: neither covered nor uncovered.
pub struct Coverage<'a> {
	pub slots: Vec<CoverageSlot<'a>>,
	pub uncovered: Vec<usize>,
	pub covered_tokens: usize,
	pub uncovered_tokens: usize,
	pub covered_count: usize,
	pub uncovered_count: usize,
}

pub fn coverage_of<'a>(messages: &'a [Json], entries: &[Json], chat_id: &str) -> Coverage<'a> {
	let covered: HashSet<&str> = entries.iter().filter(|e| e["chatId"].as_str() == Some(chat_id)).filter_map(|e| e["fp"].as_str()).collect();
	let slots = coverage_slots(messages);
	let mut uncovered = Vec::new();
	let (mut covered_tokens, mut uncovered_tokens) = (0, 0);
	for (i, slot) in slots.iter().enumerate() {
		if slot.tokens == 0 {
			continue;
		}
		if covered.contains(slot.fp.as_str()) {
			covered_tokens += slot.tokens;
		} else {
			uncovered.push(i);
			uncovered_tokens += slot.tokens;
		}
	}
	let visible_count = slots.iter().filter(|s| s.tokens > 0).count();
	let uncovered_count = uncovered.len();
	Coverage { slots, uncovered, covered_tokens, uncovered_tokens, covered_count: visible_count - uncovered_count, uncovered_count }
}

/// Batches the uncovered slots into runs: consecutive, oldest first, filled greedily up to
/// `budget` tokens. A message is never split; one over the budget rides alone.
pub fn batch_runs<'a>(slots: &[CoverageSlot<'a>], uncovered: &[usize], budget: f64) -> Vec<Vec<CoverageSlot<'a>>> {
	if budget <= 0.0 || uncovered.is_empty() {
		return Vec::new();
	}
	let mut runs = Vec::new();
	let mut current: Vec<CoverageSlot<'a>> = Vec::new();
	let mut current_tokens = 0.0;
	for &i in uncovered {
		let slot = &slots[i];
		if !current.is_empty() && current_tokens + slot.tokens as f64 > budget {
			runs.push(std::mem::take(&mut current));
			current_tokens = 0.0;
		}
		current.push(slot.clone());
		current_tokens += slot.tokens as f64;
	}
	if !current.is_empty() {
		runs.push(current);
	}
	runs
}

#[cfg(test)]
mod tests {
	use super::*;

	fn teacher(id: &str, prose: &str) -> Json {
		json!({ "id": id, "role": "assistant", "content": [{ "type": "text", "text": prose }] })
	}

	#[test]
	fn teacher_prose_and_graded_questions_make_the_view() {
		let message = json!({ "id": "m1", "role": "assistant", "content": [
			{ "type": "text", "text": "  Hello  " },
			{ "type": "toolCall", "id": "c1", "name": "quiz", "arguments": { "question": " Why? " } },
			{ "type": "toolCall", "id": "c2", "name": "explain", "arguments": { "question": "Skipped" } },
			{ "type": "toolCall", "id": "c3", "name": "send_to_user", "arguments": { "message": "Sent" } },
		] });
		assert_eq!(message_view_lines(&message, "m1", None), ["TEACHER [m1] Hello", "TEACHER [m1] Sent", "QUESTION [m1] Why?"]);
		assert!(message_view_lines(&json!({ "role": "user", "content": "hi" }), "u", None).is_empty());
	}

	#[test]
	fn a_topic_done_teaches_its_opener_lead_and_questions() {
		let call = json!({ "type": "toolCall", "id": "t1", "name": "topic_done", "arguments": {
			"nodeId": "reg",
			"review": { "question": " Why ridge? " },
			"opener": { "lead": " Now split the data. ", "quiz": { "question": "How much does it move?" } },
		} });
		let message = json!({ "id": "m1", "role": "assistant", "content": [{ "type": "text", "text": "Done." }, call] });
		assert_eq!(message_view_lines(&message, "m1", None), ["TEACHER [m1] Done.", "TEACHER [m1] Now split the data.", "QUESTION [m1] How much does it move?", "QUESTION [m1] Why ridge?"]);
		let bare = json!({ "id": "m2", "role": "assistant", "content": [{ "type": "toolCall", "id": "t2", "name": "topic_done", "arguments": { "nodeId": "reg" } }] });
		assert!(message_view_lines(&bare, "m2", None).is_empty(), "a free-recall topic_done teaches nothing new");
	}

	#[test]
	fn a_kept_sentence_joins_the_teaching_lines() {
		let quiz = |keep: Json| json!({ "id": "m5", "role": "assistant", "content": [{ "type": "toolCall", "id": "q5", "name": "quiz", "arguments": { "question": "Where is it now?", "keep": keep } }] });
		let keep = json!({ "text": " Lambda prices large weights. ", "fits": "The leash fits one part.", "stops": "It stops at new data." });
		assert_eq!(message_view_lines(&quiz(keep), "m5", None), ["TEACHER [m5] Lambda prices large weights.", "QUESTION [m5] Where is it now?"]);
		for broken in [json!({ "text": "x".repeat(50_000) }), json!({ "text": "Lambda prices large weights.", "fits": "The leash fits one part." })] {
			assert_eq!(message_view_lines(&quiz(broken), "m5", None), ["QUESTION [m5] Where is it now?"], "never shown, never counted");
		}
	}

	#[test]
	fn failed_output_calls_leave_the_view() {
		let call = json!({ "type": "toolCall", "id": "c3", "name": "send_to_user", "arguments": { "message": "Lost" } });
		let aborted = json!({ "id": "m1", "role": "assistant", "stopReason": "aborted", "content": [call] });
		assert!(message_view_lines(&aborted, "m1", None).is_empty());
	}

	#[test]
	fn tokens_are_a_quarter_of_the_characters_rounded_up() {
		assert_eq!(view_tokens(&["abcd".into()]), 1);
		assert_eq!(view_tokens(&["abcde".into()]), 2);
		assert_eq!(view_tokens(&["ab".into(), "cd".into()]), 2);
		assert_eq!(view_tokens(&[]), 0);
	}

	#[test]
	fn coverage_diffs_the_ledger_and_ignores_invisible_messages() {
		let messages = [json!({ "id": "u1", "role": "user", "content": "q" }), teacher("m1", "First"), teacher("m2", "Second")];
		let first = message_fingerprint(&messages[1], None);
		let entries = [json!({ "chatId": "c", "fp": first }), json!({ "chatId": "other", "fp": message_fingerprint(&messages[2], None) })];
		let got = coverage_of(&messages, &entries, "c");
		assert_eq!(got.uncovered, [2]);
		assert_eq!((got.covered_count, got.uncovered_count), (1, 1));
		assert_eq!(got.covered_tokens, got.slots[1].tokens);
		assert_eq!(got.uncovered_tokens, got.slots[2].tokens);
		assert_eq!(got.slots[0].tokens, 0);
	}

	#[test]
	fn runs_fill_greedily_and_never_split_a_message() {
		let owned: Vec<Json> = (0..5).map(|i| teacher(&format!("m{i}"), "12345678")).collect();
		let slots = coverage_slots(&owned);
		let sizes = |budget| batch_runs(&slots, &[0, 1, 2, 3, 4], budget).iter().map(Vec::len).collect::<Vec<_>>();
		assert_eq!(slots[0].tokens, 6);
		assert_eq!(sizes(12.0), [2, 2, 1]);
		assert_eq!(sizes(18.0), [3, 2]);
		assert_eq!(sizes(6.0), [1, 1, 1, 1, 1]);
		// One message over the budget rides alone.
		assert_eq!(sizes(1.0), [1, 1, 1, 1, 1]);
		assert!(sizes(0.0).is_empty());
		assert!(batch_runs(&slots, &[], 100.0).is_empty());
	}
}
