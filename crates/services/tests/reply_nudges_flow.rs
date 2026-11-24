//! Study's reply nudges against a stored lesson. A reply's words are shown as they come, so their
//! nudges become notes for the next reply, each once a topic: a new topic gets its own, an
//! opener's topic too. A curve in a quiz's question, a problem's statement or an opener's lead
//! refuses that call, once a topic. Only a Study lesson gets any. A wall of prose after his own
//! message or a miss is noted once a learner input.

use std::path::PathBuf;
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::ids;
use gs_core::study::reply_nudges::{Nudge, OPEN_PROBLEM_NOTE, curve_refusal, wall_note};
use gs_json::{Json, json};
use gs_services::App;
use gs_services::turns::reply_nudges::{call_refusal, reply_notes};

struct Fixture {
	app: Arc<App>,
	dir: PathBuf,
}

impl Fixture {
	fn new() -> Fixture {
		let dir = std::env::temp_dir().join(format!("gs-reply-nudges-{}", ids::uuid()));
		for name in ["data", "home", "tmp", "res"] {
			std::fs::create_dir_all(dir.join(name)).unwrap();
		}
		let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.join("res")), None);
		Fixture { app, dir }
	}

	fn lesson(&self, kind: Option<&str>) -> String {
		let chat_id = self.app.stores.chats.create_chat("Study for Midterm", kind, None, None, &[]).unwrap()["id"].as_str().unwrap().to_owned();
		let tree = json!({ "nodes": [{ "id": "reg", "title": "Regularization" }, { "id": "cv", "title": "Cross-validation" }], "edges": [] });
		self.app.stores.chats.save_tree(&chat_id, &tree).unwrap();
		chat_id
	}

	fn record(&self, chat_id: &str, messages: &[Json]) {
		self.app.stores.chats.save_messages(chat_id, messages).unwrap();
	}
}

impl Drop for Fixture {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.dir);
	}
}

const CURVE: &str = "| lambda | error |\n|---|---|\n| 0.1 | 9 |\n| 1 | 4 |\n| 10 | 6 |";
const QUESTIONS: &str = "1. What is the score?\n2. Which lambda wins?";


/// An assistant message with these words and calls.
fn reply(text: Option<&str>, calls: &[(&str, Json)]) -> Json {
	let words = text.map(|t| json!({ "type": "text", "text": t }));
	let calls = calls.iter().enumerate().map(|(i, (name, arguments))| json!({ "type": "toolCall", "id": format!("c{i}"), "name": name, "arguments": arguments }));
	json!({ "role": "assistant", "content": words.into_iter().chain(calls).collect::<Vec<_>>() })
}

/// The notes a reply's words leave for the next one.
fn notes(fx: &Fixture, chat_id: &str, text: &str, calls: &[(&str, Json)]) -> Vec<String> {
	reply_notes(&fx.app, chat_id, &reply(Some(text), calls), text)
}

/// Why the reply's first call is refused, or none.
fn refusal(fx: &Fixture, chat_id: &str, text: Option<&str>, calls: &[(&str, Json)]) -> Option<String> {
	let (name, args) = &calls[0];
	call_refusal(&fx.app, chat_id, &reply(text, calls), name, args)
}

fn note(n: Nudge) -> String {
	n.note().to_owned()
}

#[test]
fn each_nudge_is_noted_once_a_topic() {
	let fx = Fixture::new();
	let chat_id = fx.lesson(Some("study"));
	let both = format!("{CURVE}\n\n{QUESTIONS}");
	assert_eq!(notes(&fx, &chat_id, &both, &[]), [note(Nudge::CurveTable), note(Nudge::QuestionList)]);
	assert!(notes(&fx, &chat_id, &both, &[]).is_empty(), "the same words again are not noted again");
	assert!(notes(&fx, &chat_id, QUESTIONS, &[]).is_empty(), "this topic had its question nudge");
	let next = [("quiz", json!({ "nodeId": "cv" }))];
	assert_eq!(notes(&fx, &chat_id, QUESTIONS, &next), [note(Nudge::QuestionList)], "the next topic gets its own");
	assert!(notes(&fx, &chat_id, "Plain words.", &[]).is_empty());
}

#[test]
fn an_opener_lead_is_checked_for_a_curve_on_the_topic_it_opens() {
	let fx = Fixture::new();
	let chat_id = fx.lesson(Some("study"));
	let lines = "Here is one data set:\n\n- training error: 9.1, 6.0, 4.2, 3.1\n- validation error: 9.5, 7.0, 5.1, 6.8";
	let done = |lead: &str| ("topic_done", json!({ "nodeId": "reg", "opener": { "lead": lead, "quiz": { "nodeId": "cv" } } }));
	assert_eq!(refusal(&fx, &chat_id, None, &[done(lines)]), Some(curve_refusal()));
	assert_eq!(refusal(&fx, &chat_id, None, &[done(lines)]), None, "the same opener sent again goes through");
	assert!(notes(&fx, &chat_id, CURVE, &[("quiz", json!({ "nodeId": "cv" }))]).is_empty(), "the opened topic had its curve nudge");
	assert_eq!(notes(&fx, &chat_id, CURVE, &[done("Next: folds.")]), [note(Nudge::CurveTable)], "the reply's own topic has its own");
}

#[test]
fn a_quiz_question_or_a_problem_statement_is_read_for_a_curve_on_the_replys_topic() {
	let fx = Fixture::new();
	let chat_id = fx.lesson(Some("study"));
	let quiz = ("quiz", json!({ "nodeId": "reg", "question": format!("Which lambda wins?\n\n{CURVE}") }));
	assert_eq!(refusal(&fx, &chat_id, Some("Look."), std::slice::from_ref(&quiz)), Some(curve_refusal()));
	assert_eq!(refusal(&fx, &chat_id, Some("Look."), &[quiz]), None, "the same call sent again goes through");
	let problem = ("problem", json!({ "nodeId": "cv", "statement": CURVE }));
	assert_eq!(refusal(&fx, &chat_id, None, &[problem]), Some(curve_refusal()), "the next topic gets its own");
}

#[test]
fn a_reply_that_sends_a_plot_gets_no_curve_nudge() {
	let fx = Fixture::new();
	let chat_id = fx.lesson(Some("study"));
	let plot = ("plot", json!({ "title": "t" }));
	let quiz = ("quiz", json!({ "nodeId": "reg", "question": CURVE }));
	assert_eq!(refusal(&fx, &chat_id, Some(CURVE), &[quiz.clone(), plot.clone()]), None);
	assert!(notes(&fx, &chat_id, CURVE, &[quiz, plot.clone()]).is_empty());
	let both = format!("{CURVE}\n\n{QUESTIONS}");
	assert_eq!(notes(&fx, &chat_id, &both, &[plot]), [note(Nudge::QuestionList)], "the question nudge still stands");
	assert_eq!(notes(&fx, &chat_id, CURVE, &[]), [note(Nudge::CurveTable)], "the topic's curve nudge is still due");
}

#[test]
fn only_a_study_lesson_is_nudged() {
	let fx = Fixture::new();
	for kind in [None, Some("practice")] {
		let chat_id = fx.lesson(kind);
		assert!(notes(&fx, &chat_id, CURVE, &[]).is_empty(), "{kind:?}");
		assert_eq!(refusal(&fx, &chat_id, None, &[("quiz", json!({ "nodeId": "reg", "question": CURVE }))]), None, "{kind:?}");
	}
	assert!(notes(&fx, "chat_missing", CURVE, &[]).is_empty());
}

#[test]
fn with_a_problem_open_the_question_list_says_its_parts_are_asked() {
	let fx = Fixture::new();
	let chat_id = fx.lesson(Some("study"));
	let posed = [
		json!({ "id": "a1", "role": "assistant", "content": [{ "type": "toolCall", "id": "p1", "name": "problem", "arguments": { "nodeId": "reg", "statement": "(a) Fit. (b) Score." } }] }),
		json!({ "id": "r1", "role": "toolResult", "toolCallId": "p1", "toolName": "problem", "content": [], "details": {}, "isError": false }),
	];
	fx.record(&chat_id, &posed);
	assert_eq!(notes(&fx, &chat_id, QUESTIONS, &[]), [format!("{} {OPEN_PROBLEM_NOTE}", Nudge::QuestionList.note())]);
}

/// A reply of `n` words of prose, then a table and code that are not counted.
fn wall(n: usize) -> String {
	format!("{}\n\n| a | b |\n|---|---|\n| one two | three |\n\n```\nfour five six\n```", vec!["word"; n].join(" "))
}

#[test]
fn a_wall_after_his_own_message_is_noted_once_that_input() {
	let fx = Fixture::new();
	let chat_id = fx.lesson(Some("study"));
	let typed = |id: &str| json!({ "id": id, "role": "user", "content": "Why?", "timestamp": 1 });
	let said = |id: &str| json!({ "id": id, "role": "assistant", "content": [{ "type": "text", "text": "Because." }] });
	fx.record(&chat_id, &[typed("m0")]);
	assert!(notes(&fx, &chat_id, &wall(300), &[]).is_empty(), "the first reply to the lesson's goal may be long");
	fx.record(&chat_id, &[typed("m0"), said("a0"), typed("m1")]);
	assert!(notes(&fx, &chat_id, &wall(150), &[]).is_empty(), "150 words is not over");
	assert_eq!(notes(&fx, &chat_id, &wall(151), &[]), [wall_note(151)]);
	assert!(notes(&fx, &chat_id, &wall(300), &[]).is_empty(), "once that input");

	fx.record(&chat_id, &[typed("m0"), said("a0"), typed("m1"), said("a1"), typed("m2")]);
	assert_eq!(notes(&fx, &chat_id, &wall(200), &[]), [wall_note(200)], "his next message gets its own");
	let both = format!("{}\n\n{QUESTIONS}", wall(200));
	assert_eq!(notes(&fx, &chat_id, &both, &[]), [note(Nudge::QuestionList)], "the next reply for that input passes the wall; the question list still stands");
}

#[test]
fn a_wall_after_a_right_card_answer_is_not_noted() {
	let fx = Fixture::new();
	let chat_id = fx.lesson(Some("study"));
	let answered = |details: Json| {
		[
			json!({ "id": "a1", "role": "assistant", "content": [{ "type": "toolCall", "id": "q1", "name": "quiz", "arguments": { "type": "check", "nodeId": "reg" } }] }),
			json!({ "id": "r1", "role": "toolResult", "toolCallId": "q1", "toolName": "quiz", "content": [], "details": details, "isError": false }),
		]
	};
	fx.record(&chat_id, &answered(json!({ "kind": "quiz", "correct": true })));
	assert!(notes(&fx, &chat_id, &wall(200), &[]).is_empty());
	fx.record(&chat_id, &answered(json!({ "kind": "quiz", "correct": false })));
	assert_eq!(notes(&fx, &chat_id, &wall(200), &[]), [wall_note(200)], "a miss wants a short reply");
}
