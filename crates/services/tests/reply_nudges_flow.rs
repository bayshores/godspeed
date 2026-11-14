//! Study's reply nudges against a stored lesson: each is sent once a topic, so the same reply sent
//! again goes through; a new topic gets its own, an opener's curve too, and a curve in a quiz's
//! question or a problem's statement; only a Study lesson gets any.

use std::path::PathBuf;
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::ids;
use gs_core::study::reply_nudges::Nudge;
use gs_engine::bridge::ReplyCall;
use gs_json::json;
use gs_services::App;
use gs_services::turns::reply_nudges::reply_refusal;

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
		let chat_id = self.app.stores.chats.create_chat("Study for Midterm", kind, None, None).unwrap()["id"].as_str().unwrap().to_owned();
		let tree = json!({ "nodes": [{ "id": "reg", "title": "Regularization" }, { "id": "cv", "title": "Cross-validation" }], "edges": [] });
		self.app.stores.chats.save_tree(&chat_id, &tree).unwrap();
		chat_id
	}
}

impl Drop for Fixture {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.dir);
	}
}

const CURVE: &str = "| lambda | error |\n|---|---|\n| 0.1 | 9 |\n| 1 | 4 |\n| 10 | 6 |";
const QUESTIONS: &str = "1. What is the score?\n2. Which lambda wins?";

#[test]
fn each_nudge_is_sent_once_a_topic() {
	let fx = Fixture::new();
	let chat_id = fx.lesson(Some("study"));
	let both = format!("{CURVE}\n\n{QUESTIONS}");
	let refusal = reply_refusal(&fx.app, &chat_id, Some(&both), &[]);
	assert_eq!(refusal.as_deref(), Some(format!("{}\n{}", Nudge::CurveTable.refusal(), Nudge::QuestionList.refusal()).as_str()));
	assert_eq!(reply_refusal(&fx.app, &chat_id, Some(&both), &[]), None, "the same reply sent again goes through");
	assert_eq!(reply_refusal(&fx.app, &chat_id, Some(QUESTIONS), &[]), None, "this topic had its question nudge");

	let next = ReplyCall { name: "quiz".to_owned(), arguments: json!({ "nodeId": "cv" }) };
	assert_eq!(reply_refusal(&fx.app, &chat_id, Some(QUESTIONS), &[next]).as_deref(), Some(Nudge::QuestionList.refusal()), "the next topic gets its own");
	assert_eq!(reply_refusal(&fx.app, &chat_id, Some("Plain words."), &[]), None);
}

#[test]
fn an_opener_lead_is_checked_for_a_curve_on_the_topic_it_opens() {
	let fx = Fixture::new();
	let chat_id = fx.lesson(Some("study"));
	let lines = "Here is one data set:\n\n- training error: 9.1, 6.0, 4.2, 3.1\n- validation error: 9.5, 7.0, 5.1, 6.8";
	let done = |lead: &str| ReplyCall { name: "topic_done".to_owned(), arguments: json!({ "nodeId": "reg", "opener": { "lead": lead, "quiz": { "nodeId": "cv" } } }) };
	assert_eq!(reply_refusal(&fx.app, &chat_id, None, &[done(lines)]).as_deref(), Some(Nudge::CurveTable.refusal()));
	assert_eq!(reply_refusal(&fx.app, &chat_id, None, &[done(lines)]), None, "the same opener sent again goes through");
	assert_eq!(reply_refusal(&fx.app, &chat_id, Some(CURVE), &[ReplyCall { name: "quiz".to_owned(), arguments: json!({ "nodeId": "cv" }) }]), None, "the opened topic had its curve nudge");
	assert_eq!(reply_refusal(&fx.app, &chat_id, Some(CURVE), &[done("Next: folds.")]).as_deref(), Some(Nudge::CurveTable.refusal()), "the reply's own topic has its own");
}

#[test]
fn a_quiz_question_or_a_problem_statement_is_read_for_a_curve_on_the_replys_topic() {
	let fx = Fixture::new();
	let chat_id = fx.lesson(Some("study"));
	let quiz = ReplyCall { name: "quiz".to_owned(), arguments: json!({ "nodeId": "reg", "question": format!("Which lambda wins?\n\n{CURVE}") }) };
	assert_eq!(reply_refusal(&fx.app, &chat_id, Some("Look."), std::slice::from_ref(&quiz)).as_deref(), Some(Nudge::CurveTable.refusal()));
	assert_eq!(reply_refusal(&fx.app, &chat_id, Some("Look."), &[quiz]), None, "the same reply sent again goes through");
	let problem = ReplyCall { name: "problem".to_owned(), arguments: json!({ "nodeId": "cv", "statement": CURVE }) };
	assert_eq!(reply_refusal(&fx.app, &chat_id, None, &[problem]).as_deref(), Some(Nudge::CurveTable.refusal()), "the next topic gets its own");
}

#[test]
fn a_reply_that_sends_a_plot_gets_no_curve_nudge() {
	let fx = Fixture::new();
	let chat_id = fx.lesson(Some("study"));
	let plot = ReplyCall { name: "plot".to_owned(), arguments: json!({ "title": "t" }) };
	let quiz = ReplyCall { name: "quiz".to_owned(), arguments: json!({ "nodeId": "reg", "question": CURVE }) };
	assert_eq!(reply_refusal(&fx.app, &chat_id, Some(CURVE), &[quiz, plot.clone()]), None);
	let both = format!("{CURVE}\n\n{QUESTIONS}");
	assert_eq!(reply_refusal(&fx.app, &chat_id, Some(&both), &[plot]).as_deref(), Some(Nudge::QuestionList.refusal()), "the question nudge still stands");
	assert_eq!(reply_refusal(&fx.app, &chat_id, Some(CURVE), &[]).as_deref(), Some(Nudge::CurveTable.refusal()), "the topic's curve nudge is still due");
}

#[test]
fn only_a_study_lesson_is_nudged() {
	let fx = Fixture::new();
	for kind in [None, Some("practice")] {
		let chat_id = fx.lesson(kind);
		assert_eq!(reply_refusal(&fx.app, &chat_id, Some(CURVE), &[]), None, "{kind:?}");
	}
	assert_eq!(reply_refusal(&fx.app, "chat_missing", Some(CURVE), &[]), None);
}
