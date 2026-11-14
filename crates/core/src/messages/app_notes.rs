//! The hidden lines an input carries to the agent about what happened in the app: he came back to
//! a stopped session ([Resumed]), what he did with the next topic's opener ([Opener]), the
//! questions from earlier he answered or asks about ([From earlier]), the analogies he dropped
//! ([Analogy dropped]) and, after his answer to a quiz with a keep, why it was not all shown. An
//! opener answer carries its lines in its own marker; any other input gets one app-note marker.

use gs_json::{Json, json};
use gs_json::js_text::js_string;

use super::input_events::{About, ChatInput, messages_of};
use super::lesson_markers::{ANALOGY_DROP, new_app_note_marker};
use crate::session::question_core::{confidence_level, keep_of};
use crate::study::kept::{KEEP_NOTE, KeptPart, dropped, keep_notes};
use crate::study::topic_end::{resume_due, shown_openers};
use crate::study::topic_parts::{NO_PLOT_YET, first_topic, has_plot};

const RESUMED_LINE: &str = "[Resumed] He came back to this session after a stop.";
const FROM_EARLIER: &str = "[From earlier]";
const ANALOGY_DROPPED: &str = "[Analogy dropped]";
/// The most words of an analogy's fits line that name it.
const ANALOGY_WORDS: usize = 8;

/// The opener-answer marker's content: [Resumed] first when due, then what he picked, or that he
/// skipped it (a null `answer`), the plot reminder while the topic has none, then the questions
/// from earlier he answered since the agent last heard of them.
pub fn opener_answer_text(record: &Json, topic_done_call_id: &str, answer: &Json) -> String {
	let node_id = opener_node(record, topic_done_call_id);
	let topic = node_title(record, &node_id);
	let line = if answer.is_null() { format!("[Opener] {topic}: he skipped it.") } else { format!("[Opener] {topic}: {}", picked_words(answer)) };
	let messages = messages_of(record);
	let resumed = resume_due(messages).then_some(RESUMED_LINE.to_owned());
	let no_plot = (!has_plot(messages, first_topic(record.get("tree")), &node_id)).then_some(NO_PLOT_YET.to_owned());
	resumed.into_iter().chain(std::iter::once(line)).chain(no_plot).chain(from_earlier_line(messages)).chain(analogy_dropped_lines(record)).collect::<Vec<_>>().join("\n")
}

/// The app-note marker an input carries, or none. An opener answer carries its lines itself, and a
/// continue is not his input. `asked` is the question from earlier a text about one asks about.
pub fn app_note_for(record: &Json, input: &ChatInput, asked: Option<&Json>) -> Option<Json> {
	if matches!(input, ChatInput::Continue | ChatInput::OpenerAnswer { .. }) {
		return None;
	}
	let messages = messages_of(record);
	let mut lines = Vec::new();
	if resume_due(messages) {
		lines.push(RESUMED_LINE.to_owned());
	}
	lines.extend(from_earlier_line(messages));
	lines.extend(analogy_dropped_lines(record));
	let mut details = json!({});
	match input {
		ChatInput::Answer { tool_call_id, .. } => lines.extend(keep_notes(messages, &answered_since_keep_note(messages, tool_call_id)).into_iter().map(str::to_owned)),
		ChatInput::Text { about: Some(About::Opener(opener)), .. } => {
			lines.push(format!("[Opener] {}: he asked about it before answering; it stays open. Answer his question and end your turn.", opener_topic(record, opener)));
		}
		ChatInput::Text { about: Some(About::Review { picked, .. }), .. } => {
			if let Some(item) = asked {
				lines.push(review_ask_line(item, picked));
				// What a reload reads to show the question again, as the note promised.
				details = json!({ "reviewOf": item["of"] });
			}
		}
		_ => {}
	}
	(!lines.is_empty()).then(|| new_app_note_marker(&lines, details))
}

/// "[From earlier] Eigenvalues right, sure 4. Bayes' rule wrong, sure 3, picked About 9%.": the
/// questions from earlier he answered after the last note that told the agent about them.
fn from_earlier_line(messages: &[Json]) -> Option<String> {
	let told = |m: &Json| matches!(m["customType"].as_str(), Some("app-note" | "opener-answer")) && m["content"].as_str().is_some_and(|c| c.lines().any(|l| l.starts_with(FROM_EARLIER)));
	let since = messages.iter().rposition(told).map_or(0, |i| i + 1);
	let answered: Vec<String> = messages[since..].iter().filter(|m| m["role"].as_str() == Some("custom") && m["customType"].as_str() == Some("review")).map(|m| review_words(&m["details"])).collect();
	(!answered.is_empty()).then(|| format!("{FROM_EARLIER} {}", answered.join(" ")))
}

/// The quizzes he answered after the last note that carried a keep note, then `answered` (his
/// answer, not in the record yet): a batch's earlier answers wait for its last one's note.
fn answered_since_keep_note<'a>(messages: &'a [Json], answered: &'a str) -> Vec<&'a str> {
	let told = |m: &Json| m["customType"].as_str() == Some("app-note") && m["content"].as_str().is_some_and(|c| c.lines().any(|l| l.starts_with(KEEP_NOTE)));
	let since = messages.iter().rposition(told).map_or(0, |i| i + 1);
	let results = messages[since..].iter().filter(|m| m["role"].as_str() == Some("toolResult") && !m["isError"].truthy() && !m["details"]["dismissed"].truthy());
	results.filter_map(|m| m["toolCallId"].as_str()).chain([answered]).collect()
}

/// `[Analogy dropped] Regularization: "The leash fits one part"`, one per kept sentence whose
/// analogy he dropped after the last note that told the agent, unless he brought it back since.
fn analogy_dropped_lines(record: &Json) -> Vec<String> {
	let messages = messages_of(record);
	let told = |m: &Json| matches!(m["customType"].as_str(), Some("app-note" | "opener-answer")) && m["content"].as_str().is_some_and(|c| c.lines().any(|l| l.starts_with(ANALOGY_DROPPED)));
	let since = messages.iter().rposition(told).map_or(0, |i| i + 1);
	let mut changed: Vec<&str> = Vec::new();
	for of in messages[since..].iter().filter(|m| m["customType"].as_str() == Some(ANALOGY_DROP)).filter_map(|m| m["details"]["of"].as_str()) {
		if !changed.contains(&of) {
			changed.push(of);
		}
	}
	changed
		.into_iter()
		.filter(|of| dropped(messages, KeptPart::Analogy, of))
		.filter_map(|of| {
			let args = messages.iter().flat_map(|m| m["content"].as_arr().into_iter().flatten()).find(|b| b["type"].as_str() == Some("toolCall") && b["id"].as_str() == Some(of))?.get("arguments")?;
			let fits = keep_of(args)?["fits"].as_str().map(first_words)?;
			Some(format!("{ANALOGY_DROPPED} {}: \"{fits}\"", node_title(record, args["nodeId"].as_str().unwrap_or_default())))
		})
		.collect()
}

/// The words an analogy's fits line opens with: up to its first `:`, `;`, `,` or `.` that ends a
/// clause (a space or the end after it, outside `$...$`), at most ANALOGY_WORDS words, never
/// stopping inside math.
fn first_words(fits: &str) -> String {
	let mut math = false;
	let mut end = fits.len();
	let mut chars = fits.char_indices().peekable();
	while let Some((i, c)) = chars.next() {
		match c {
			'$' => math = !math,
			':' | ';' | ',' | '.' if !math && chars.peek().is_none_or(|(_, next)| next.is_whitespace()) => {
				end = i;
				break;
			}
			_ => {}
		}
	}
	let mut words = Vec::new();
	let mut open = false;
	for word in fits[..end].split_whitespace() {
		if words.len() >= ANALOGY_WORDS && !open {
			break;
		}
		open ^= word.matches('$').count() % 2 == 1;
		words.push(word);
	}
	words.join(" ")
}

/// One answered question from earlier: "Bayes' rule wrong, sure 3, picked About 9%.", "Eigenvalues
/// right, sure 4." or "Bayes' rule: he did not know."
fn review_words(details: &Json) -> String {
	let answer = &details["answer"];
	let topic = review_topic(details);
	if answer["dontKnow"].truthy() {
		return format!("{topic}: he did not know.");
	}
	let sure = answer.get("confidence").map_or_else(String::new, |c| format!(", sure {}", confidence_level(c.as_f64().unwrap_or(f64::NAN))));
	if answer["correct"].as_bool() == Some(true) {
		return format!("{topic} right{sure}.");
	}
	let picks: Vec<String> = answer["answers"].as_arr().into_iter().flatten().map(|a| js_string(a.get("label"))).collect();
	format!("{topic} wrong{sure}, picked {}.", picks.join(" and "))
}

/// A question from earlier's topic name, else its node id.
fn review_topic(item: &Json) -> String {
	item["topic"].as_str().or(item["nodeId"].as_str()).unwrap_or_default().to_owned()
}

/// What Ask Teacher on a question from earlier tells the agent before his message: the question,
/// its options, what he picked so far and the stored explanation.
fn review_ask_line(item: &Json, picked: &[String]) -> String {
	let quiz = &item["quiz"];
	let options: Vec<String> = quiz["options"].as_arr().into_iter().flatten().map(|o| js_string(o.get("label"))).collect();
	let pick = if picked.is_empty() { "He has not picked yet.".to_owned() } else { format!("He picked {} so far.", picked.join(" and ")) };
	format!(
		"{FROM_EARLIER} He asked about this question from earlier before answering; it stays open and godspeed grades his answer. {}: {} Options: {}. {pick} Explanation: {} Answer his question without giving the answer away, and end your turn.",
		review_topic(item),
		js_string(quiz.get("question")),
		options.join("; "),
		js_string(quiz.get("explanation")),
	)
}

/// The opener question's topic: its plan step's title, else its node id.
fn opener_topic(record: &Json, topic_done_call_id: &str) -> String {
	node_title(record, &opener_node(record, topic_done_call_id))
}

fn opener_node(record: &Json, topic_done_call_id: &str) -> String {
	shown_openers(messages_of(record)).get(topic_done_call_id).and_then(|o| o["quiz"]["nodeId"].as_str()).unwrap_or_default().to_owned()
}

/// A plan node's title, else its id.
fn node_title(record: &Json, id: &str) -> String {
	let title = record["tree"]["nodes"].as_arr().into_iter().flatten().find(|n| n["id"].as_str() == Some(id)).map(|n| &n["title"]).filter(|t| !t.is_null());
	title.map_or_else(|| id.to_owned(), |t| js_string(Some(t)))
}

/// "he picked A, It can move a lot, sure 3." with his thinking after it when he wrote some. "did
/// not know" and "his thinking" are the words a quiz answer reads with in a past lesson
/// (session_markdown).
fn picked_words(answer: &Json) -> String {
	let thinking = if answer["thinking"].truthy() { format!(" His thinking: {}", js_string(Some(&answer["thinking"]))) } else { String::new() };
	if answer["dontKnow"].truthy() {
		return format!("he did not know.{thinking}");
	}
	let picks: Vec<String> = answer["answers"]
		.as_arr()
		.into_iter()
		.flatten()
		.map(|a| {
			let letter = a["index"].as_f64().and_then(|i| char::from_u32((64.0 + i) as u32)).map_or_else(String::new, String::from);
			format!("{letter}, {}", js_string(a.get("label")))
		})
		.collect();
	let sure = answer.get("confidence").map_or_else(String::new, |c| format!(", sure {}", confidence_level(c.as_f64().unwrap_or(f64::NAN))));
	format!("he picked {}{sure}.{thinking}", picks.join(" and "))
}

#[cfg(test)]
mod tests {
	use gs_base::time;
	use gs_json::json;

	use super::*;

	const T0: i64 = 1_795_035_600_000;

	fn at(minutes: i64) -> i64 {
		T0 + minutes * 60_000
	}

	fn tree() -> Json {
		json!({ "nodes": [{ "id": "reg", "title": "Regularization" }, { "id": "cv", "title": "Cross-validation" }], "edges": [{ "from": "reg", "to": "cv" }] })
	}

	/// Regularization ends on a conclude at minute 48 and topic_done stores the opener at 49.
	fn ended() -> Vec<Json> {
		vec![
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "c1", "name": "conclude", "arguments": { "outcome": "solved" } }], "timestamp": at(48) }),
			json!({ "role": "toolResult", "toolCallId": "c1", "toolName": "conclude", "details": { "stop": { "kind": "topic", "nodeId": "reg", "activeMinutes": 48, "at": time::iso(at(48)) } }, "isError": false, "timestamp": at(48) }),
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "t1", "name": "topic_done", "arguments": { "nodeId": "reg", "opener": { "lead": "Now split.", "quiz": { "question": "?", "type": "predict", "nodeId": "cv" } } } }], "timestamp": at(49) }),
			json!({ "role": "toolResult", "toolCallId": "t1", "toolName": "topic_done", "details": { "part": "topic_done", "v": 1, "lead": "Now split." }, "isError": false, "timestamp": at(49) }),
		]
	}

	fn kept_at(minutes: i64) -> Json {
		let mut messages = ended();
		messages.push(json!({ "role": "custom", "customType": "keep-going", "content": "", "details": { "stopOf": "c1", "at": time::iso(at(minutes)) }, "timestamp": at(minutes) }));
		json!({ "messages": messages, "tree": tree() })
	}

	fn pick(index: i64, label: &str) -> Json {
		json!({ "index": index, "label": label, "value": label })
	}

	#[test]
	fn the_opener_lines_word_for_word() {
		let record = kept_at(50);
		let answer = json!({ "kind": "quiz", "dontKnow": false, "answers": [pick(1, "It can move a lot")], "confidence": 60 });
		assert_eq!(opener_answer_text(&record, "t1", &answer), format!("[Opener] Cross-validation: he picked A, It can move a lot, sure 3.\n{NO_PLOT_YET}"));
		assert_eq!(opener_answer_text(&record, "t1", &Json::Null), format!("[Opener] Cross-validation: he skipped it.\n{NO_PLOT_YET}"));
		let two = json!({ "kind": "quiz", "dontKnow": false, "answers": [pick(1, "One"), pick(3, "Three")], "thinking": "Folds are small." });
		assert_eq!(opener_answer_text(&record, "t1", &two), format!("[Opener] Cross-validation: he picked A, One and C, Three. His thinking: Folds are small.\n{NO_PLOT_YET}"));
		let unsure = json!({ "kind": "quiz", "dontKnow": true, "answers": [], "thinking": "No idea." });
		assert_eq!(opener_answer_text(&record, "t1", &unsure), format!("[Opener] Cross-validation: he did not know. His thinking: No idea.\n{NO_PLOT_YET}"));
	}

	#[test]
	fn the_topic_falls_back_to_the_node_id() {
		let mut record = kept_at(50);
		record.as_obj_mut().unwrap().remove("tree");
		assert_eq!(opener_answer_text(&record, "t1", &Json::Null), format!("[Opener] cv: he skipped it.\n{NO_PLOT_YET}"));
	}

	#[test]
	fn the_plot_reminder_follows_the_opener_line_until_the_topic_has_a_plot() {
		let mut record = kept_at(50);
		let plotted = json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "p1", "name": "plot", "arguments": { "nodeId": "cv" } }], "timestamp": at(10) });
		record.get_mut("messages").and_then(Json::as_arr_mut).unwrap().insert(0, plotted);
		assert_eq!(opener_answer_text(&record, "t1", &Json::Null), "[Opener] Cross-validation: he skipped it.");
	}

	#[test]
	fn resumed_comes_first_in_a_later_sitting() {
		let record = kept_at(24 * 60);
		assert_eq!(opener_answer_text(&record, "t1", &Json::Null), format!("[Resumed] He came back to this session after a stop.\n[Opener] Cross-validation: he skipped it.\n{NO_PLOT_YET}"));
		let text = ChatInput::Text { text: "why?".into(), attachments: None, about: None };
		let note = app_note_for(&record, &text, None).unwrap();
		assert_eq!(note["content"], json!("[Resumed] He came back to this session after a stop."));
		assert!(app_note_for(&kept_at(50), &text, None).is_none(), "same sitting");
	}

	#[test]
	fn ask_teacher_on_an_opener_says_it_stays_open() {
		let ask = ChatInput::Text { text: "why?".into(), attachments: None, about: Some(About::Opener("t1".into())) };
		let note = app_note_for(&kept_at(50), &ask, None).unwrap();
		assert_eq!(note["content"], json!("[Opener] Cross-validation: he asked about it before answering; it stays open. Answer his question and end your turn."));
		let both = app_note_for(&kept_at(24 * 60), &ask, None).unwrap();
		assert_eq!(both["content"].as_str().unwrap().lines().count(), 2, "[Resumed] and [Opener]");
	}

	#[test]
	fn a_continue_and_an_opener_answer_carry_no_note() {
		let record = kept_at(24 * 60);
		assert!(app_note_for(&record, &ChatInput::Continue, None).is_none());
		assert!(app_note_for(&record, &ChatInput::OpenerAnswer { topic_done_call_id: "t1".into(), answer: None }, None).is_none());
		assert!(app_note_for(&record, &ChatInput::Next, None).is_some());
	}

	fn options() -> Json {
		json!([{ "label": "About 60%" }, { "label": "About 25%" }, { "label": "About 10%" }, { "label": "About 9%" }])
	}

	fn reviewed(topic: &str, answer: Json) -> Json {
		let details = json!({ "of": { "chatId": "c0", "messageId": "m0", "toolCallId": "t0" }, "nodeId": "n", "topic": topic, "quiz": { "question": "How likely?", "options": options() }, "answer": answer, "sitting": "2026-11-11T21:00:00.000Z" });
		json!({ "role": "custom", "customType": "review", "content": "", "display": true, "details": details, "timestamp": at(1) })
	}

	fn graded(correct: bool, label: &str, confidence: i64) -> Json {
		json!({ "kind": "quiz", "dontKnow": false, "correct": correct, "answers": [pick(1, label)], "confidence": confidence })
	}

	#[test]
	fn questions_from_earlier_reach_the_agent_once_on_his_next_input() {
		let mut messages = vec![
			reviewed("Bayes' rule", graded(false, "About 60%", 60)),
			reviewed("Eigenvalues", graded(true, "x", 80)),
			reviewed("Gradient descent", json!({ "kind": "quiz", "dontKnow": true, "answers": [] })),
		];
		let record = json!({ "messages": messages });
		let next = app_note_for(&record, &ChatInput::Next, None).unwrap();
		assert_eq!(next["content"], json!("[From earlier] Bayes' rule wrong, sure 3, picked About 60%. Eigenvalues right, sure 4. Gradient descent: he did not know."));
		messages.push(next);
		let told = json!({ "messages": messages });
		assert!(app_note_for(&told, &ChatInput::Next, None).is_none(), "once");
		messages.push(reviewed("Regularization", graded(true, "x", 80)));
		let answer = ChatInput::Answer { tool_call_id: "q".into(), answer: json!({}), attachments: None };
		assert_eq!(app_note_for(&json!({ "messages": messages }), &answer, None).unwrap()["content"], json!("[From earlier] Regularization right, sure 4."));
	}

	#[test]
	fn an_opener_answer_carries_the_questions_from_earlier_after_its_line() {
		let mut record = kept_at(50);
		record.get_mut("messages").and_then(Json::as_arr_mut).unwrap().push(reviewed("Bayes' rule", graded(true, "About 9%", 60)));
		assert_eq!(opener_answer_text(&record, "t1", &Json::Null), format!("[Opener] Cross-validation: he skipped it.\n{NO_PLOT_YET}\n[From earlier] Bayes' rule right, sure 3."));
	}

	/// Reply 5's quiz carries a keep with an analogy and its verdict; he answered it right.
	fn kept(note: Option<&str>) -> Vec<Json> {
		let keep = json!({ "text": "Lambda prices large weights; it does not cap them.", "fits": "The leash fits one part: for the data you have, a larger lambda gives a shorter leash.", "stops": "It stops at new data." });
		let mut verdict = json!({ "quizCallId": "q5", "keep": "shown", "fits": true, "phrase": false });
		if let (Some(note), Some(v)) = (note, verdict.as_obj_mut()) {
			v.insert("note", note);
		}
		vec![
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "q5", "name": "quiz", "arguments": { "type": "check", "nodeId": "reg", "keep": keep } }], "timestamp": at(9) }),
			json!({ "role": "custom", "customType": "keep-check", "content": "", "display": false, "details": verdict, "timestamp": at(9) }),
		]
	}

	fn drop(back: bool) -> Json {
		json!({ "role": "custom", "customType": "analogy-drop", "content": "", "display": false, "details": if back { json!({ "of": "q5", "back": true }) } else { json!({ "of": "q5" }) }, "timestamp": at(10) })
	}

	#[test]
	fn the_keep_note_follows_his_answer_to_its_quiz() {
		let record = json!({ "messages": kept(Some("keep.fits not shown: this topic already has an analogy.")), "tree": tree() });
		let answer = |id: &str| ChatInput::Answer { tool_call_id: id.into(), answer: json!({ "kind": "quiz", "correct": true }), attachments: None };
		assert_eq!(app_note_for(&record, &answer("q5"), None).unwrap()["content"], json!("keep.fits not shown: this topic already has an analogy."));
		assert!(app_note_for(&record, &answer("q9"), None).is_none(), "another quiz");
		assert!(app_note_for(&json!({ "messages": kept(None) }), &answer("q5"), None).is_none(), "nothing to say");
	}

	#[test]
	fn a_batch_s_last_answer_carries_the_keep_notes_of_every_quiz_answered_since_the_last_one() {
		let check = |id: &str, note: &str| json!({ "role": "custom", "customType": "keep-check", "content": "", "display": false, "details": { "quizCallId": id, "keep": "dropped", "fits": false, "phrase": false, "note": note } });
		let result = |id: &str, details: Json| json!({ "role": "toolResult", "toolCallId": id, "toolName": "quiz", "isError": false, "details": details });
		let long = "keep not stored: text 212 characters, at most 160. Add it to a later quiz.";
		let spacing = "keep not stored: this reply has a plot, or the last one has a plot or keep. Leave the next quiz without a keep.";
		let mut messages = vec![
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "q3", "name": "quiz", "arguments": {} }, { "type": "toolCall", "id": "q4", "name": "quiz", "arguments": {} }] }),
			check("q3", long),
			check("q4", spacing),
			result("q3", json!({ "kind": "quiz", "correct": true })),
		];
		let answer = |id: &str| ChatInput::Answer { tool_call_id: id.into(), answer: json!({}), attachments: None };
		let note = app_note_for(&json!({ "messages": messages.clone() }), &answer("q4"), None).unwrap();
		assert_eq!(note["content"], json!(format!("{long}\n{spacing}")), "the sibling answered first keeps its note");
		messages.extend([result("q4", json!({ "kind": "quiz", "correct": true })), note]);
		messages.extend([json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "q5", "name": "quiz", "arguments": {} }] }), check("q5", long)]);
		assert_eq!(app_note_for(&json!({ "messages": messages.clone() }), &answer("q5"), None).unwrap()["content"], json!(long), "each note once");
		let skipped = vec![messages[0].clone(), check("q3", long), result("q3", json!({ "kind": "quiz", "dismissed": true }))];
		assert!(app_note_for(&json!({ "messages": skipped }), &answer("q9"), None).is_none(), "a skipped quiz sends no note");
	}

	#[test]
	fn a_dropped_analogy_reaches_the_agent_once_on_his_next_input_of_any_kind() {
		let mut messages = kept(None);
		messages.push(drop(false));
		let record = json!({ "messages": messages.clone(), "tree": tree() });
		let line = "[Analogy dropped] Regularization: \"The leash fits one part\"";
		let note = app_note_for(&record, &ChatInput::Next, None).unwrap();
		assert_eq!(note["content"], json!(line));
		let answer = ChatInput::Answer { tool_call_id: "q6".into(), answer: json!({}), attachments: None };
		assert_eq!(app_note_for(&record, &answer, None).unwrap()["content"], json!(line));
		messages.push(note);
		assert!(app_note_for(&json!({ "messages": messages.clone(), "tree": tree() }), &ChatInput::Next, None).is_none(), "once");
		let mut back = kept(None);
		back.extend([drop(false), drop(true)]);
		assert!(app_note_for(&json!({ "messages": back }), &ChatInput::Next, None).is_none(), "brought back first");

		let mut stopped = ended();
		stopped.extend(kept(None));
		stopped.extend([json!({ "role": "custom", "customType": "keep-going", "content": "", "details": { "stopOf": "c1" }, "timestamp": at(50) }), drop(false)]);
		let opener = opener_answer_text(&json!({ "messages": stopped, "tree": tree() }), "t1", &Json::Null);
		assert_eq!(opener, format!("[Opener] Cross-validation: he skipped it.\n{NO_PLOT_YET}\n{line}"));
	}

	#[test]
	fn an_analogy_is_named_by_its_first_words() {
		assert_eq!(first_words("The leash fits one part: for the data you have."), "The leash fits one part");
		assert_eq!(first_words("one two three four five six seven eight nine ten"), "one two three four five six seven eight");
		assert_eq!(first_words("At $\\lambda = 0.5$ the leash is short: it pulls hard."), "At $\\lambda = 0.5$ the leash is short", "a decimal point is no clause end");
		assert_eq!(first_words("The pull $a, b; c.$ grows fast."), "The pull $a, b; c.$ grows fast", "nor a separator inside math");
		assert_eq!(first_words("one two three four five six seven $x + y$ nine"), "one two three four five six seven $x + y$", "the last word's math stays whole");
		assert_eq!(first_words("Ends at 3.5"), "Ends at 3.5");
	}

	#[test]
	fn ask_teacher_on_a_question_from_earlier_sends_it_whole() {
		let item = json!({ "of": { "chatId": "c0", "toolCallId": "t0" }, "nodeId": "n", "topic": "Bayes' rule", "quiz": { "question": "A student got an A. How likely is the tutor?", "options": options(), "correctAnswer": "About 25%", "explanation": "0.06 of 0.24 is a quarter." } });
		let ask = |picked: Vec<String>| ChatInput::Text { text: "Do I divide by all the A students?".into(), attachments: None, about: Some(About::Review { of: item["of"].clone(), picked }) };
		let note = app_note_for(&json!({ "messages": [] }), &ask(vec!["About 60%".into()]), Some(&item)).unwrap();
		assert_eq!(
			note["content"],
			json!("[From earlier] He asked about this question from earlier before answering; it stays open and godspeed grades his answer. Bayes' rule: A student got an A. How likely is the tutor? Options: About 60%; About 25%; About 10%; About 9%. He picked About 60% so far. Explanation: 0.06 of 0.24 is a quarter. Answer his question without giving the answer away, and end your turn.")
		);
		assert_eq!(note["details"], json!({ "reviewOf": { "chatId": "c0", "toolCallId": "t0" } }), "a reload finds the question it asked about");
		let unpicked = app_note_for(&json!({ "messages": [] }), &ask(vec![]), Some(&item)).unwrap();
		assert!(unpicked["content"].as_str().unwrap().contains(" He has not picked yet. "));
	}
}
