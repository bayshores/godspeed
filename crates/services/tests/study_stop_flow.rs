//! Places to stop, end to end against a stand-in agent on the bridge: a Study topic ends on a
//! conclude, the agent reads and stores the next topic's opener in the same turn, Keep going
//! lands before or after that, the learner's answer, skip or question about the opener reaches the
//! agent as one [Opener] line ([Resumed] first on a later day), and a practice or homework problem
//! of 25 active minutes ends on a problem stop. The app clock is moved, so this file's tests run
//! one at a time and no other file shares their process.

use std::path::PathBuf;
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::{clock, ids};
use gs_core::contracts::chat::{CONCLUDE_ACK_TEXT, STUDY_TOPIC_END_ACK_TEXT, TOPIC_DONE_STORED_TEXT};
use gs_core::messages::input_events::{ChatInput, TurnInput};
use gs_core::study::topic_end::{lesson_stop, shown_openers};
use gs_engine::bridge::{AgentReply, ReplyCall, WaitOptions};
use gs_json::{Json, json};
use gs_services::App;
use gs_services::turns::handle_chat_input;
use gs_services::turns::homework::create_homework;
use gs_services::turns::is_turn_running;
use gs_services::turns::lesson_events::{KeepGoing, keep_going};
use tokio::sync::Mutex;

/// Every test moves or reads the one app clock.
static ONE_AT_A_TIME: Mutex<()> = Mutex::const_new(());

const MINUTE_MS: i64 = 60_000;

/// An app over a fresh folder, removed when dropped.
struct Fixture {
	app: Arc<App>,
	dir: PathBuf,
}

impl Fixture {
	fn new() -> Fixture {
		let dir = std::env::temp_dir().join(format!("gs-study-stop-{}", ids::uuid()));
		for name in ["data", "home", "tmp", "res"] {
			std::fs::create_dir_all(dir.join(name)).unwrap();
		}
		let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.join("res")), None);
		Fixture { app, dir }
	}
}

impl Drop for Fixture {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.dir);
	}
}

fn call(name: &str, arguments: Json) -> AgentReply {
	AgentReply { text: None, tool_calls: vec![ReplyCall { name: name.to_owned(), arguments }] }
}

fn says(text: &str) -> AgentReply {
	AgentReply { text: Some(text.to_owned()), tool_calls: Vec::new() }
}

/// Answers the lesson's next work item with `reply`; the whole transcript it was sent.
async fn answer(app: &App, chat_id: &str, reply: AgentReply) -> Vec<Json> {
	let opts = WaitOptions { conversation: Some(chat_id.to_owned()), full: true, ..WaitOptions::default() };
	let view = app.bridge.wait_for_work(10_000, opts).await.expect("a work item");
	app.bridge.respond_to_work(&view.work_id, reply, 0).unwrap();
	view.messages
}

/// The learner's input; its turn starts and runs in the background.
async fn send(app: &Arc<App>, chat_id: &str, input: ChatInput) {
	let reply = handle_chat_input(app, chat_id, TurnInput::Chat(input)).await;
	assert_eq!(reply.status, 200, "{}", reply.text());
}

fn text(words: &str) -> ChatInput {
	ChatInput::Text { text: words.to_owned(), attachments: None, about: None }
}

async fn settled(app: &App, chat_id: &str) {
	for _ in 0..2000 {
		if !is_turn_running(app, chat_id) {
			return;
		}
		clock::sleep(5).await;
	}
	panic!("the turn never settled");
}

fn messages(app: &App, chat_id: &str) -> Vec<Json> {
	app.stores.chats.get_chat(chat_id).unwrap()["messages"].as_arr().unwrap().clone()
}

/// The last user message the agent was sent.
fn last_user_text(seen: &[Json]) -> String {
	seen.iter().rev().find(|m| m["role"].as_str() == Some("user")).unwrap()["text"].as_str().unwrap().to_owned()
}

/// Where the call `name` sits in the record, and its id.
fn call_of(messages: &[Json], name: &str) -> (usize, String) {
	let at = messages.iter().position(|m| m["content"].as_arr().is_some_and(|c| c.iter().any(|b| b["name"].as_str() == Some(name)))).unwrap();
	let block = messages[at]["content"].as_arr().unwrap().iter().find(|b| b["name"].as_str() == Some(name)).unwrap();
	(at, block["id"].as_str().unwrap().to_owned())
}

fn result_of<'a>(messages: &'a [Json], call_id: &str) -> &'a Json {
	messages.iter().find(|m| m["role"].as_str() == Some("toolResult") && m["toolCallId"].as_str() == Some(call_id)).unwrap()
}

fn tree() -> Json {
	json!({ "nodes": [{ "id": "reg", "title": "Regularization" }, { "id": "cv", "title": "Cross-validation" }], "edges": [{ "from": "reg", "to": "cv" }] })
}

fn quiz(kind: &str, node_id: &str, question: &str) -> Json {
	let options = json!([{ "label": "It can move a lot" }, { "label": "It barely moves" }, { "label": "It always drops" }, { "label": "It always rises" }]);
	json!({ "type": kind, "nodeId": node_id, "question": question, "options": options, "explanation": "Each split sees different points.", "correctAnswer": "It can move a lot" })
}

fn topic_done_args() -> Json {
	json!({
		"nodeId": "reg",
		"review": quiz("check", "reg", "What does a larger lambda do to the weights?"),
		"opener": { "lead": "One split of the data can mislead you.", "quiz": quiz("predict", "cv", "If you split the data again, how much can the test score move?") },
	})
}

/// A Study lesson on Regularization then Cross-validation with Regularization's problem posed.
async fn study_lesson(app: &Arc<App>) -> String {
	let chat_id = app.stores.chats.create_chat("Study for Midterm", Some("study"), None, None).unwrap()["id"].as_str().unwrap().to_owned();
	app.stores.chats.save_tree(&chat_id, &tree()).unwrap();
	send(app, &chat_id, text("Teach me Regularization.")).await;
	let problem = json!({ "statement": "Why does an L2 penalty shrink the weights?", "mode": "recall", "modelSolution": "The penalty grows with each weight, so smaller weights lower the loss.", "nodeId": "reg" });
	answer(app, &chat_id, call("problem", problem)).await;
	settled(app, &chat_id).await;
	chat_id
}

/// His answer is right: the agent concludes, reads, then stores the opener, all in one turn.
/// With `keep_mid_turn` he presses Keep going while the agent reads. The conclude's call id.
async fn end_regularization(app: &Arc<App>, chat_id: &str, keep_mid_turn: bool) -> String {
	send(app, chat_id, text("Bigger weights cost more, so the fit keeps them small.")).await;
	let conclude = json!({ "outcome": "solved", "verdict": "You named the cost of a large weight exactly.", "rung": null, "missClass": null, "retest": false });
	answer(app, chat_id, call("conclude", conclude)).await;
	let seen = answer(app, chat_id, call("ls", json!({ "path": app.paths.home.to_string_lossy() }))).await;
	let result = seen.iter().rev().find(|m| m["toolName"].as_str() == Some("conclude")).unwrap();
	assert_eq!(result["text"], json!(STUDY_TOPIC_END_ACK_TEXT), "the Study topic-end text");
	let conclude_id = result["toolCallId"].as_str().unwrap().to_owned();
	if keep_mid_turn {
		assert_eq!(keep_going(app, chat_id, &conclude_id), Ok(KeepGoing::Kept { opener: false }), "stored unchecked during the turn");
	}
	answer(app, chat_id, call("topic_done", topic_done_args())).await;
	settled(app, chat_id).await;
	conclude_id
}

#[tokio::test(flavor = "multi_thread")]
async fn a_topic_ends_on_a_stop_and_its_opener_is_stored_in_the_same_turn() {
	let _one = ONE_AT_A_TIME.lock().await;
	let fx = Fixture::new();
	let chat_id = study_lesson(&fx.app).await;
	let conclude_id = end_regularization(&fx.app, &chat_id, true).await;

	let record = messages(&fx.app, &chat_id);
	let (conclude_at, _) = call_of(&record, "conclude");
	let (ls_at, _) = call_of(&record, "ls");
	let (done_at, done_id) = call_of(&record, "topic_done");
	assert!(conclude_at < ls_at && ls_at < done_at);
	assert!(record[conclude_at..].iter().all(|m| m["role"].as_str() != Some("user")), "conclude, reads and topic_done in one turn");

	let stop = &result_of(&record, &conclude_id)["details"]["stop"];
	assert_eq!((stop["kind"].as_str(), stop["nodeId"].as_str()), (Some("topic"), Some("reg")));
	assert!(stop["activeMinutes"].as_f64().is_some() && stop["at"].as_str().is_some());

	let stored = result_of(&record, &done_id);
	assert_eq!(stored["content"], json!([{ "type": "text", "text": TOPIC_DONE_STORED_TEXT }]));
	assert_eq!(stored["details"], json!({ "part": "topic_done", "v": 1, "lead": "One split of the data can mislead you." }));
	assert_eq!(record[done_at]["content"][0]["arguments"], topic_done_args(), "the call is stored as sent");

	let keep_at = record.iter().position(|m| m["customType"].as_str() == Some("keep-going")).unwrap();
	assert!(keep_at < conclude_at, "a Keep going written mid-turn sits before that turn's messages");
	assert_eq!(record[keep_at]["details"]["stopOf"], json!(conclude_id));
	assert!(shown_openers(&record).contains_key(&done_id), "the opener shows once topic_done landed");
	let at_stop = lesson_stop(&record, Some(&tree()), None).unwrap();
	assert_eq!((at_stop["kind"].as_str(), at_stop["next"].as_str(), at_stop["keptGoing"].as_bool()), (Some("topic"), Some("Cross-validation"), Some(true)));
}

#[tokio::test(flavor = "multi_thread")]
async fn keep_going_after_the_opener_landed_shows_it_and_his_pick_reaches_the_agent() {
	let _one = ONE_AT_A_TIME.lock().await;
	let fx = Fixture::new();
	let chat_id = study_lesson(&fx.app).await;
	let conclude_id = end_regularization(&fx.app, &chat_id, false).await;
	assert_eq!(keep_going(&fx.app, &chat_id, &conclude_id), Ok(KeepGoing::Kept { opener: true }));

	let (_, done_id) = call_of(&messages(&fx.app, &chat_id), "topic_done");
	let answer_data = json!({ "kind": "quiz", "dontKnow": false, "answers": [{ "index": 1, "label": "It can move a lot", "value": "It can move a lot" }], "confidence": 60 });
	send(&fx.app, &chat_id, ChatInput::OpenerAnswer { topic_done_call_id: done_id, answer: Some(answer_data) }).await;
	let seen = answer(&fx.app, &chat_id, says("Yes: each split sees different points.")).await;
	assert_eq!(last_user_text(&seen), "[Opener] Cross-validation: he picked A, It can move a lot, sure 3.");
	settled(&fx.app, &chat_id).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn asking_about_the_opener_keeps_it_open_and_skipping_it_says_so() {
	let _one = ONE_AT_A_TIME.lock().await;
	let fx = Fixture::new();
	let chat_id = study_lesson(&fx.app).await;
	end_regularization(&fx.app, &chat_id, true).await;
	let (_, done_id) = call_of(&messages(&fx.app, &chat_id), "topic_done");

	let ask = ChatInput::Text { text: "What is a split?".to_owned(), attachments: None, about: Some(done_id.clone()) };
	send(&fx.app, &chat_id, ask).await;
	let seen = answer(&fx.app, &chat_id, says("A split is one way to divide the data.")).await;
	let users: Vec<&str> = seen.iter().filter(|m| m["role"].as_str() == Some("user")).filter_map(|m| m["text"].as_str()).collect();
	assert_eq!(users[users.len() - 2..], ["[Opener] Cross-validation: he asked about it before answering; it stays open. Answer his question and end your turn.", "What is a split?"]);
	settled(&fx.app, &chat_id).await;

	send(&fx.app, &chat_id, ChatInput::OpenerAnswer { topic_done_call_id: done_id, answer: None }).await;
	let seen = answer(&fx.app, &chat_id, says("Fine, let's look at it together.")).await;
	assert_eq!(last_user_text(&seen), "[Opener] Cross-validation: he skipped it.");
	settled(&fx.app, &chat_id).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn coming_back_the_next_day_tells_the_agent_he_resumed() {
	let _one = ONE_AT_A_TIME.lock().await;
	let fx = Fixture::new();
	let chat_id = study_lesson(&fx.app).await;
	let conclude_id = end_regularization(&fx.app, &chat_id, false).await;
	clock::advance(24 * 60 * MINUTE_MS);
	assert_eq!(keep_going(&fx.app, &chat_id, &conclude_id), Ok(KeepGoing::Kept { opener: true }));
	let (_, done_id) = call_of(&messages(&fx.app, &chat_id), "topic_done");
	send(&fx.app, &chat_id, ChatInput::OpenerAnswer { topic_done_call_id: done_id, answer: None }).await;
	let seen = answer(&fx.app, &chat_id, says("Let's start with the split.")).await;
	assert_eq!(last_user_text(&seen), "[Resumed] He came back to this session after a stop.\n[Opener] Cross-validation: he skipped it.");
	settled(&fx.app, &chat_id).await;
}

/// Five learner messages five minutes apart, each answered, then his last one: 25 active minutes.
async fn work_25_minutes(app: &Arc<App>, chat_id: &str) {
	for step in 1..=5 {
		clock::advance(5 * MINUTE_MS);
		send(app, chat_id, text(&format!("Step {step} of my work."))).await;
		answer(app, chat_id, says("Go on.")).await;
		settled(app, chat_id).await;
	}
	send(app, chat_id, text("Here is my answer.")).await;
}

/// The conclude result the agent read, after which it says its closing words.
async fn concluded(app: &Arc<App>, chat_id: &str, conclude: Json) -> Json {
	answer(app, chat_id, call("conclude", conclude)).await;
	let seen = answer(app, chat_id, says("Well done.")).await;
	settled(app, chat_id).await;
	seen.iter().rev().find(|m| m["toolName"].as_str() == Some("conclude")).unwrap().clone()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_practice_problem_of_25_active_minutes_ends_on_a_problem_stop() {
	let _one = ONE_AT_A_TIME.lock().await;
	let fx = Fixture::new();
	let chat_id = fx.app.stores.chats.create_chat("Practice ridge regression", Some("practice"), None, None).unwrap()["id"].as_str().unwrap().to_owned();
	send(&fx.app, &chat_id, text("Give me a problem.")).await;
	let problem = json!({ "statement": "Pick lambda for a model that overfits.", "mode": "composition", "modelSolution": "Raise lambda until the validation error stops falling." });
	answer(&fx.app, &chat_id, call("problem", problem)).await;
	settled(&fx.app, &chat_id).await;
	work_25_minutes(&fx.app, &chat_id).await;

	let result = concluded(&fx.app, &chat_id, json!({ "outcome": "solved", "verdict": "Right.", "rung": null, "missClass": null, "retest": false })).await;
	assert_eq!(result["text"], json!(CONCLUDE_ACK_TEXT), "practice keeps its text");
	let record = messages(&fx.app, &chat_id);
	let stop = &result_of(&record, result["toolCallId"].as_str().unwrap())["details"]["stop"];
	assert_eq!(stop["kind"], json!("problem"));
	assert!(stop["activeMinutes"].as_f64().unwrap() >= 25.0, "{stop:?}");
	let at_stop = lesson_stop(&record, None, None).unwrap();
	assert_eq!((at_stop["kind"].as_str(), &at_stop["next"]), (Some("problem"), &Json::Null), "practice has no second line");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_homework_problem_of_25_active_minutes_names_the_next_problem() {
	let _one = ONE_AT_A_TIME.lock().await;
	let fx = Fixture::new();
	let app = &fx.app;
	let space_id = app.stores.spaces.create_space(&json!({ "name": "Machine Learning Foundations" })).unwrap()["id"].as_str().unwrap().to_owned();
	let deadline_id = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "Homework 3", "kind": "homework", "date": "2099-01-20" })).unwrap()["id"].as_str().unwrap().to_owned();
	let problems = json!([{ "number": "1", "text": "Fit ridge regression for three values of lambda." }, { "number": "2", "text": "Pick lambda by 5-fold cross-validation." }]);
	app.stores.spaces.update_deadline(&space_id, &deadline_id, &json!({ "problems": problems })).unwrap();
	let created = create_homework(app, &space_id, &deadline_id).unwrap().unwrap();
	let chat_id = created.chat["id"].as_str().unwrap().to_owned();
	send(app, &chat_id, text("Let's start.")).await;
	answer(app, &chat_id, call("problem", json!({ "number": "1", "statement": "Fit ridge regression for three values of lambda." }))).await;
	settled(app, &chat_id).await;
	work_25_minutes(app, &chat_id).await;

	let result = concluded(app, &chat_id, json!({ "outcome": "solved", "verdict": "All three fits are right." })).await;
	assert_eq!(result["text"], json!(CONCLUDE_ACK_TEXT));
	let space = app.stores.spaces.get_space(&space_id).unwrap();
	let marks = space["deadlines"][0]["problems"].as_arr().unwrap().clone();
	let at_stop = lesson_stop(&messages(app, &chat_id), None, Some(&marks)).unwrap();
	assert_eq!((at_stop["kind"].as_str(), at_stop["next"].as_str()), (Some("problem"), Some("problem 2")));
	assert!(at_stop["activeMinutes"].as_f64().unwrap() >= 25.0);
}
