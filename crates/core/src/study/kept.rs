//! Kept sentences: the one sentence a Study quiz's `keep` gives him when he answers it right. Its
//! verdict is decided once, when the turn that posed it is saved (a keep-check marker), and never
//! refuses the quiz: a keep that breaks a rule is not stored and the teacher reads why after his
//! answer. A topic keeps at most 2 sentences and shows the analogy lines on at most 1, a keep
//! needs a reply with nothing new before it, and a reply stores one. A sentence he kept comes back
//! on the row of a question from earlier about its topic. Which quiz shows a kept card, and with
//! which parts, is twin to src/shared/core/kept-view.ts; both replay tests/golden/kept.json.

use std::collections::{HashMap, HashSet};

use gs_base::{text, time};
use gs_json::{Json, Obj, json};

use super::review::item_key;
use super::topic_parts::{calls, kept_calls, visits};
use crate::messages::citations::MARK_MAX;
use crate::messages::lesson_markers::{ANALOGY_DROP, KEEP_CHECK, PHRASE_DROP};
use crate::session::question_core::{keep_fields_note, keep_of, keep_phrase_note, normalize_quiz_type};

/// At most this many kept sentences a topic.
const PER_TOPIC: usize = 2;

/// Every keep note starts with this word.
pub(crate) const KEEP_NOTE: &str = "keep";
const SPACING: &str = "keep not stored: this reply or the last one has a page, plot or keep. Add it to a later quiz.";
const NOT_A_CHECK: &str = "keep not stored: a keep goes on a check quiz, not a prediction. Add it to a later quiz.";
const TWO_A_TOPIC: &str = "keep not stored: this topic already has 2 kept sentences.";
const ONE_ANALOGY: &str = "keep.fits not shown: this topic already has an analogy.";
const NO_PASSAGE: &str = "keep.source dropped: it does not point at a passage.";

fn words<'a>(keep: &'a Json, field: &str) -> Option<&'a str> {
	keep[field].as_str().filter(|s| !s.trim().is_empty())
}

/// Each keep-check verdict by its quiz call id.
fn verdicts(messages: &[Json]) -> HashMap<&str, &Json> {
	messages.iter().filter(|m| m["customType"].as_str() == Some(KEEP_CHECK)).filter_map(|m| Some((m["details"]["quizCallId"].as_str()?, &m["details"]))).collect()
}

/// The keep-check verdicts the record still lacks, in record order: one per quiz call that carries
/// a keep, was not refused and has none yet. `check_source` gives a keep's `source` as the stored
/// passage mark, or none when it does not point at a passage. Each is `{quizCallId, keep: "shown"
/// | "dropped", fits, phrase, source?: "ok" | "dropped", sourceMark?, note?}`; `source` only when
/// the keep has one, `note` the line the teacher reads after his answer.
pub fn keep_verdicts(messages: &[Json], check_source: &dyn Fn(&str) -> Option<String>) -> Vec<Json> {
	let checked = verdicts(messages);
	let refused: HashSet<&str> = messages.iter().filter(|m| m["role"].as_str() == Some("toolResult") && m["isError"] == Json::Bool(true)).filter_map(|m| m["toolCallId"].as_str()).collect();
	let kept = kept_calls(messages);
	let visits = visits(messages);
	// The sentences he saw: where each sits, its topic and whether its analogy lines showed.
	let mut seen: Vec<(usize, &str, bool)> = Vec::new();
	let mut out = Vec::new();
	for (at, m) in messages.iter().enumerate().filter(|(_, m)| m["role"].as_str() == Some("assistant")) {
		// Whether this reply already stores a keep: a second one is crowded out, so it never
		// reaches the topic's count either.
		let mut stores_one = false;
		for call in calls(m).filter(|c| c["name"].as_str() == Some("quiz") && c["arguments"].get("keep").is_some_and(|k| !k.is_null())) {
			let id = call["id"].as_str().unwrap_or_default();
			let node = call["arguments"]["nodeId"].as_str().unwrap_or_default();
			if kept.contains(id) {
				seen.push((at, node, checked.get(id).is_some_and(|v| v["fits"] == Json::Bool(true))));
			}
			if refused.contains(id) {
				continue;
			}
			if let Some(verdict) = checked.get(id) {
				stores_one |= verdict["keep"].as_str() == Some("shown");
				continue;
			}
			let own = visits.iter().position(|v| v.at == at);
			let before = own.and_then(|i| visits[..i].iter().rev().find(|v| v.node_id == visits[i].node_id));
			let crowded = stores_one || own.is_some_and(|i| visits[i].page || visits[i].plot) || before.is_some_and(|v| v.page || v.plot || v.keep);
			let topic: Vec<bool> = seen.iter().filter(|(a, n, _)| *a < at && *n == node).map(|(_, _, fits)| *fits).collect();
			let keep = keep_of(&call["arguments"]).unwrap_or_else(|| call["arguments"]["keep"].clone());
			let check = normalize_quiz_type(&call["arguments"]["type"]) == Some("check");
			let dropped = (!check).then(|| NOT_A_CHECK.to_owned()).or_else(|| keep_fields_note(&keep)).or_else(|| crowded.then(|| SPACING.to_owned())).or_else(|| (topic.len() >= PER_TOPIC).then(|| TWO_A_TOPIC.to_owned()));
			let verdict = match dropped {
				Some(note) => json!({ "quizCallId": id, "keep": "dropped", "fits": false, "phrase": false, "note": note }),
				None => shown(id, &keep, topic.contains(&true), check_source),
			};
			stores_one |= verdict["keep"].as_str() == Some("shown");
			out.push(verdict);
		}
	}
	out
}

/// The verdict on a keep that is stored: its analogy lines unless the topic showed one, its phrase
/// unless too long, its source when it points at a passage.
fn shown(id: &str, keep: &Json, analogy_shown: bool, check_source: &dyn Fn(&str) -> Option<String>) -> Json {
	let mut notes = Vec::new();
	let fits = words(keep, "fits").is_some() && !analogy_shown;
	if words(keep, "fits").is_some() && analogy_shown {
		notes.push(ONE_ANALOGY.to_owned());
	}
	let phrase_note = keep_phrase_note(keep);
	let phrase = words(keep, "phrase").is_some() && phrase_note.is_none();
	notes.extend(phrase_note);
	let mut out: Obj = [("quizCallId", Json::from(id)), ("keep", "shown".into()), ("fits", fits.into()), ("phrase", phrase.into())].into_iter().collect();
	if let Some(source) = words(keep, "source") {
		// Longer than one mark can be, it points at no single passage and is never checked.
		let one_mark = text::len16(source) <= MARK_MAX + "[[]]".len();
		match one_mark.then(|| check_source(source)).flatten() {
			Some(mark) => {
				out.insert("source", "ok");
				out.insert("sourceMark", mark);
			}
			None => {
				out.insert("source", "dropped");
				notes.push(NO_PASSAGE.to_owned());
			}
		}
	}
	if !notes.is_empty() {
		out.insert("note", notes.join(" "));
	}
	Json::Obj(out)
}

/// The notes the keeps of these quizzes left for the teacher, read after his answers to them.
pub fn keep_notes<'a>(messages: &'a [Json], quiz_call_ids: &[&str]) -> Vec<&'a str> {
	let verdicts = verdicts(messages);
	quiz_call_ids.iter().filter_map(|id| verdicts.get(id)?["note"].as_str()).collect()
}

/// The part of a kept sentence a drop takes away.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeptPart {
	/// Its fits and stops lines.
	Analogy,
	/// Its memory phrase.
	Phrase,
}

impl KeptPart {
	/// The marker type that drops it.
	pub fn drop_marker(self) -> &'static str {
		match self {
			KeptPart::Analogy => ANALOGY_DROP,
			KeptPart::Phrase => PHRASE_DROP,
		}
	}

	/// The keep-check verdict's flag that says it showed.
	fn verdict_flag(self) -> &'static str {
		match self {
			KeptPart::Analogy => "fits",
			KeptPart::Phrase => "phrase",
		}
	}
}

/// Whether his last drop marker of `part` for the quiz call `of` took it away; one with `back`
/// brings it back.
pub fn dropped(messages: &[Json], part: KeptPart, of: &str) -> bool {
	messages.iter().rfind(|m| m["customType"].as_str() == Some(part.drop_marker()) && m["details"]["of"].as_str() == Some(of)).is_some_and(|m| !m["details"]["back"].truthy())
}

/// Whether the quiz call `of` earned a kept sentence he saw with the part a drop takes away.
pub fn has_kept_part(messages: &[Json], of: &str, part: KeptPart) -> bool {
	kept_calls(messages).contains(of) && verdicts(messages).get(of).is_some_and(|v| v[part.verdict_flag()] == Json::Bool(true))
}

/// A sentence he kept, as a question from earlier carries it: its quiz, its topic, the sentence
/// (`{of: {chatId, messageId, toolCallId}, text, source?, phrase?}`, never the analogy lines; the
/// phrase unless he dropped it) and when he answered its quiz.
#[derive(Clone)]
pub struct KeptSentence {
	pub node_id: String,
	pub sentence: Json,
	pub answered_at: i64,
}

/// Every sentence he kept in one lesson, in record order.
pub fn kept_sentences(chat_id: &str, messages: &[Json]) -> Vec<KeptSentence> {
	let kept = kept_calls(messages);
	let verdicts = verdicts(messages);
	let answered: HashMap<&str, i64> = messages.iter().filter(|m| m["role"].as_str() == Some("toolResult")).filter_map(|m| Some((m["toolCallId"].as_str()?, answer_time(m)))).collect();
	let mut out = Vec::new();
	for m in messages.iter().filter(|m| m["role"].as_str() == Some("assistant")) {
		for call in calls(m) {
			let id = call["id"].as_str().unwrap_or_default();
			let (Some(verdict), Some(keep)) = (verdicts.get(id).filter(|_| kept.contains(id)), keep_of(&call["arguments"])) else { continue };
			let mut sentence: Obj = [("of", json!({ "chatId": chat_id, "messageId": m["id"], "toolCallId": id })), ("text", keep["text"].clone())].into_iter().collect();
			if verdict["source"].as_str() == Some("ok") {
				sentence.insert("source", verdict["sourceMark"].clone());
			}
			if verdict["phrase"] == Json::Bool(true) && !dropped(messages, KeptPart::Phrase, id) {
				sentence.insert("phrase", keep["phrase"].clone());
			}
			let node_id = call["arguments"]["nodeId"].as_str().unwrap_or_default().to_owned();
			out.push(KeptSentence { node_id, sentence: Json::Obj(sentence), answered_at: answered.get(id).copied().unwrap_or(0) });
		}
	}
	out
}

/// When an answer was given: its stamp, else its message's time.
fn answer_time(result: &Json) -> i64 {
	result["details"]["answeredAt"].as_str().and_then(time::parse_date).or_else(|| result["timestamp"].as_i64()).unwrap_or(0)
}

/// When each kept sentence came back on a question from earlier in one lesson: `(item_key of its
/// quiz, time)`.
pub fn kept_comebacks(messages: &[Json]) -> Vec<(String, i64)> {
	messages
		.iter()
		.filter(|m| m["customType"].as_str() == Some("review") && m["details"]["kept"].as_obj().is_some())
		.map(|m| (item_key(&m["details"]["kept"]["of"]), m["timestamp"].as_i64().unwrap_or(0)))
		.collect()
}

/// The sentence a question from earlier about `node_id` brings back: of the topic's kept
/// sentences, the one shown longest ago (on its card when he answered, or on an earlier question
/// from earlier), the first kept on a tie.
pub fn kept_for<'a>(node_id: &str, kept: &'a [KeptSentence], comebacks: &[(String, i64)]) -> Option<&'a Json> {
	let last_shown = |k: &KeptSentence| {
		let key = item_key(&k.sentence["of"]);
		comebacks.iter().filter(|(c, _)| *c == key).map(|(_, at)| *at).fold(k.answered_at, i64::max)
	};
	kept.iter().filter(|k| k.node_id == node_id).min_by_key(|k| last_shown(k)).map(|k| &k.sentence)
}

#[cfg(test)]
mod tests {
	use super::*;

	const MARK: &str = "[[f_1a2b3c4d5e6f/p. 14/Lecture 6.pdf]]";

	fn reply(id: &str, text: &str, calls: Vec<Json>) -> Json {
		let mut content = if text.is_empty() { Vec::new() } else { vec![json!({ "type": "text", "text": text })] };
		content.extend(calls);
		json!({ "id": id, "role": "assistant", "content": content })
	}

	fn quiz(id: &str, keep: Json) -> Json {
		let mut args = json!({ "type": "check", "nodeId": "reg", "question": "Where is that weight now?", "options": [{ "label": "6", "value": "B" }, { "label": "3", "value": "C" }], "explanation": "Linear in y.", "correctAnswer": "B" });
		if !keep.is_null()
			&& let Some(a) = args.as_obj_mut()
		{
			a.insert("keep", keep);
		}
		json!({ "type": "toolCall", "id": id, "name": "quiz", "arguments": args })
	}

	fn answer(id: &str, correct: bool) -> Json {
		json!({ "role": "toolResult", "toolCallId": id, "toolName": "quiz", "isError": false, "details": { "kind": "quiz", "correct": correct, "answers": [], "answeredAt": "2026-11-18T21:09:25.000Z" }, "timestamp": 5 })
	}

	fn sentence(text: &str) -> Json {
		json!({ "text": text, "fits": "The leash fits one part: for the data you have.", "stops": "It stops at new data." })
	}

	fn check(details: Json) -> Json {
		json!({ "role": "custom", "customType": "keep-check", "content": "", "display": false, "details": details })
	}

	fn no_source(_: &str) -> Option<String> {
		None
	}

	/// A plain opening reply and a plain reply, both answered.
	fn lesson() -> Vec<Json> {
		vec![reply("r1", "Here.", vec![quiz("q1", Json::Null)]), answer("q1", true), reply("r2", "So.", vec![quiz("q2", Json::Null)]), answer("q2", true)]
	}

	/// The lesson, then reply `id` carrying `keep`, its verdict added once decided.
	fn with_keep(mut messages: Vec<Json>, id: &str, keep: Json, right: bool) -> Vec<Json> {
		messages.push(reply(&format!("r_{id}"), "", vec![quiz(id, keep)]));
		let verdict = keep_verdicts(&messages, &no_source);
		messages.extend(verdict.into_iter().map(check));
		messages.push(answer(id, right));
		messages
	}

	#[test]
	fn a_keep_after_a_plain_reply_is_shown_with_its_analogy() {
		let mut messages = lesson();
		messages.push(reply("r3", "", vec![quiz("q3", sentence("Lambda prices large weights; it does not cap them."))]));
		assert_eq!(keep_verdicts(&messages, &no_source), [json!({ "quizCallId": "q3", "keep": "shown", "fits": true, "phrase": false })]);
	}

	#[test]
	fn a_keep_waits_one_plain_reply_after_a_page_or_another_keep() {
		let mut after_page = vec![reply("r1", "Here.[[f_1a2b3c4d5e6f/p. 14/Lecture 6.pdf|degree 12]]", vec![quiz("q1", Json::Null)]), answer("q1", true)];
		after_page.push(reply("r2", "", vec![quiz("q2", json!({ "text": "t" }))]));
		assert_eq!(keep_verdicts(&after_page, &no_source)[0]["note"], json!(SPACING));
		let on_page = vec![reply("r1", "Here.[[f_1a2b3c4d5e6f/p. 14/Lecture 6.pdf|degree 12]]", vec![quiz("q1", json!({ "text": "t" }))])];
		assert_eq!(keep_verdicts(&on_page, &no_source)[0]["note"], json!(SPACING), "its own reply shows the page");

		let kept = with_keep(lesson(), "q3", json!({ "text": "One." }), true);
		let mut next = kept;
		next.push(reply("r4", "", vec![quiz("q4", json!({ "text": "Two." }))]));
		assert_eq!(keep_verdicts(&next, &no_source)[0]["note"], json!(SPACING), "right after a kept sentence");
		let missed = with_keep(lesson(), "q3", json!({ "text": "One." }), false);
		let mut after_miss = missed;
		after_miss.push(reply("r4", "", vec![quiz("q4", json!({ "text": "Two." }))]));
		assert_eq!(keep_verdicts(&after_miss, &no_source)[0]["keep"], json!("shown"), "a missed keep was never seen");
	}

	#[test]
	fn two_a_topic_counting_only_right_answers_and_one_analogy() {
		let mut messages = with_keep(lesson(), "q3", sentence("One."), true);
		messages.extend([reply("r5", "Plain.", vec![quiz("q5", Json::Null)]), answer("q5", true)]);
		messages = with_keep(messages, "q6", json!({ "text": "Two.", "fits": "f", "stops": "s" }), false);
		messages.extend([reply("r7", "Plain.", vec![quiz("q7", Json::Null)]), answer("q7", true)]);
		messages.push(reply("r8", "", vec![quiz("q8", sentence("Three."))]));
		let verdict = &keep_verdicts(&messages, &no_source)[0];
		assert_eq!(verdict, &json!({ "quizCallId": "q8", "keep": "shown", "fits": false, "phrase": false, "note": ONE_ANALOGY }), "the missed one does not count");
		messages.extend([check(verdict.clone()), answer("q8", true), reply("r9", "Plain.", vec![quiz("q9", Json::Null)]), answer("q9", true)]);
		messages.push(reply("r10", "", vec![quiz("q10", json!({ "text": "Four." }))]));
		assert_eq!(keep_verdicts(&messages, &no_source)[0]["note"], json!(TWO_A_TOPIC));
	}

	#[test]
	fn a_keep_on_a_prediction_is_not_stored() {
		let mut messages = lesson();
		let mut guess = quiz("q3", json!({ "text": "Lambda prices large weights." }));
		guess.get_mut("arguments").and_then(Json::as_obj_mut).unwrap().insert("type", "predict");
		messages.push(reply("r3", "", vec![guess]));
		assert_eq!(keep_verdicts(&messages, &no_source), [json!({ "quizCallId": "q3", "keep": "dropped", "fits": false, "phrase": false, "note": NOT_A_CHECK })]);
	}

	#[test]
	fn a_second_keep_in_one_reply_is_not_stored() {
		let mut messages = with_keep(lesson(), "q3", json!({ "text": "One." }), true);
		messages.extend([reply("r4", "Plain.", vec![quiz("q4", Json::Null)]), answer("q4", true)]);
		messages.push(reply("r5", "", vec![quiz("q5", sentence("Two.")), quiz("q6", sentence("Three."))]));
		let verdicts = keep_verdicts(&messages, &no_source);
		assert_eq!(verdicts[0], json!({ "quizCallId": "q5", "keep": "shown", "fits": true, "phrase": false }));
		assert_eq!(verdicts[1], json!({ "quizCallId": "q6", "keep": "dropped", "fits": false, "phrase": false, "note": SPACING }));
		messages.extend(verdicts.into_iter().map(check));
		messages.extend([answer("q5", true), answer("q6", true)]);
		assert_eq!(kept_sentences("c", &messages).len(), 2, "the topic keeps 2");
		let broken_first = vec![reply("r1", "", vec![quiz("q1", json!({ "text": "x".repeat(212) })), quiz("q2", json!({ "text": "t" }))])];
		assert_eq!(keep_verdicts(&broken_first, &no_source)[1]["keep"], json!("shown"), "a keep the reply does not store crowds nothing");
	}

	#[test]
	fn a_broken_keep_is_dropped_with_its_own_note_and_a_refused_quiz_gets_none() {
		let mut messages = lesson();
		messages.push(reply("r3", "", vec![quiz("q3", json!({ "text": "x".repeat(212) }))]));
		assert_eq!(keep_verdicts(&messages, &no_source), [json!({ "quizCallId": "q3", "keep": "dropped", "fits": false, "phrase": false, "note": "keep not stored: text 212 characters, at most 160. Add it to a later quiz." })]);
		messages.push(json!({ "role": "toolResult", "toolCallId": "q3", "toolName": "quiz", "isError": true }));
		assert!(keep_verdicts(&messages, &no_source).is_empty());
		let decided = with_keep(lesson(), "q3", json!({ "text": "t" }), true);
		assert!(keep_verdicts(&decided, &no_source).is_empty(), "decided once");
	}

	#[test]
	fn the_source_and_the_phrase_are_checked_on_their_own() {
		let mut messages = lesson();
		messages.push(reply("r3", "", vec![quiz("q3", json!({ "text": "t", "source": "[[f_1a2b3c4d5e6f:7]]", "phrase": "SOH CAH TOA" }))]));
		let found = |_: &str| Some(MARK.to_owned());
		assert_eq!(keep_verdicts(&messages, &found), [json!({ "quizCallId": "q3", "keep": "shown", "fits": false, "phrase": true, "source": "ok", "sourceMark": MARK })]);
		messages.pop();
		messages.push(reply("r3", "", vec![quiz("q3", json!({ "text": "t", "source": "nowhere", "phrase": "p".repeat(74) }))]));
		assert_eq!(
			keep_verdicts(&messages, &no_source),
			[json!({ "quizCallId": "q3", "keep": "shown", "fits": false, "phrase": false, "source": "dropped", "note": "keep.phrase not shown: 74 characters, at most 60. keep.source dropped: it does not point at a passage." })]
		);
	}

	#[test]
	fn a_source_longer_than_a_mark_is_dropped_unchecked_and_the_sentence_stays() {
		let mut messages = lesson();
		messages.push(reply("r3", "", vec![quiz("q3", json!({ "text": "t", "source": "x".repeat(2_000_000) }))]));
		let never = |_: &str| -> Option<String> { panic!("checked a source longer than a mark") };
		assert_eq!(keep_verdicts(&messages, &never), [json!({ "quizCallId": "q3", "keep": "shown", "fits": false, "phrase": false, "source": "dropped", "note": NO_PASSAGE })]);
		messages.pop();
		let longest = format!("[[{}]]", "x".repeat(MARK_MAX));
		messages.push(reply("r3", "", vec![quiz("q3", json!({ "text": "t", "source": longest }))]));
		assert_eq!(keep_verdicts(&messages, &|_| Some(MARK.to_owned()))[0]["source"], json!("ok"), "the longest mark is checked");
	}

	#[test]
	fn the_note_drops_and_kept_parts_read_from_the_record() {
		let mut messages = with_keep(lesson(), "q3", json!({ "text": "t", "fits": "f", "stops": "s", "phrase": "SOH CAH TOA" }), true);
		assert!(keep_notes(&messages, &["q3"]).is_empty());
		assert!(has_kept_part(&messages, "q3", KeptPart::Analogy) && has_kept_part(&messages, "q3", KeptPart::Phrase));
		assert!(!has_kept_part(&messages, "q1", KeptPart::Analogy));
		messages.push(json!({ "role": "custom", "customType": ANALOGY_DROP, "details": { "of": "q3" } }));
		assert!(dropped(&messages, KeptPart::Analogy, "q3") && !dropped(&messages, KeptPart::Phrase, "q3"));
		messages.push(json!({ "role": "custom", "customType": ANALOGY_DROP, "details": { "of": "q3", "back": true } }));
		assert!(!dropped(&messages, KeptPart::Analogy, "q3"), "the last one wins");
		let missed = with_keep(lesson(), "q3", json!({ "text": "t", "fits": "f", "stops": "s" }), false);
		assert!(!has_kept_part(&missed, "q3", KeptPart::Analogy), "never shown");
	}

	#[test]
	fn a_question_from_earlier_brings_back_the_sentence_shown_longest_ago() {
		let mut messages = with_keep(lesson(), "q3", json!({ "text": "One.", "source": "s", "phrase": "SOH CAH TOA", "fits": "f", "stops": "s" }), true);
		messages.extend([reply("r5", "Plain.", vec![quiz("q5", Json::Null)]), answer("q5", true)]);
		messages = with_keep(messages, "q6", json!({ "text": "Two." }), true);
		let kept = kept_sentences("c1", &messages);
		assert_eq!(kept.len(), 2);
		assert_eq!(kept[0].sentence, json!({ "of": { "chatId": "c1", "messageId": "r_q3", "toolCallId": "q3" }, "text": "One.", "phrase": "SOH CAH TOA" }), "no analogy lines, no unchecked source");
		assert_eq!(kept[0].answered_at, time::parse_date("2026-11-18T21:09:25.000Z").unwrap());
		assert_eq!(kept_for("reg", &kept, &[]).unwrap()["text"], json!("One."), "both shown on their cards at once: the first kept");
		let first_came_back = [(item_key(&kept[0].sentence["of"]), kept[0].answered_at + 1)];
		assert_eq!(kept_for("reg", &kept, &first_came_back).unwrap()["text"], json!("Two."));
		assert_eq!(kept_for("cv", &kept, &[]), None);
		messages.push(json!({ "role": "custom", "customType": PHRASE_DROP, "details": { "of": "q3" } }));
		assert!(kept_sentences("c1", &messages)[0].sentence.get("phrase").is_none(), "a dropped phrase stays dropped");
		let row = json!({ "role": "custom", "customType": "review", "details": { "kept": { "of": { "chatId": "c1", "toolCallId": "q3" } } }, "timestamp": 9 });
		assert_eq!(kept_comebacks(&[row]), [("c1:q3".to_owned(), 9)]);
	}
}
