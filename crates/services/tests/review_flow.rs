//! Questions from earlier, end to end: which lessons and moments may show one, three a local day
//! per space across lessons, the same question after a reload, a skip that stores nothing, an
//! answer written during a turn that lands before the reply and reaches the agent once as a
//! [From earlier] line, Ask Teacher on one, and the refusals. The app clock is moved, so this
//! file's tests run one at a time.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use gs_base::config::Paths;
use gs_base::{clock, ids, time};
use gs_core::messages::input_events::{About, ChatInput, TurnInput};
use gs_core::messages::native_messages::dangling_question_of;
use gs_engine::bridge::{AgentReply, WaitOptions};
use gs_json::{Json, json, stringify};
use gs_services::App;
use gs_services::turns::chat_handler::REVIEW_NOT_OPEN;
use gs_services::turns::handle_chat_input;
use gs_services::turns::is_turn_running;
use gs_services::turns::review::{ReviewReply, answer_review, next_review, open_question, skip_review};
use gs_store::graph::Ledger;

const DAY_MS: i64 = 86_400_000;
/// The earlier topics, each answered right 10 days ago with a stored question from earlier.
const EARLIER: [(&str, &str); 4] = [("bayes", "Bayes' rule"), ("eig", "Eigenvalues"), ("gd", "Gradient descent"), ("pca", "PCA")];

static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

/// An app over a fresh folder with one space whose earlier lesson holds four questions from
/// earlier, removed when dropped.
struct Fixture {
	app: Arc<App>,
	dir: PathBuf,
	space_id: String,
	_one: MutexGuard<'static, ()>,
}

impl Fixture {
	fn new() -> Fixture {
		let one = ONE_AT_A_TIME.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
		let dir = std::env::temp_dir().join(format!("gs-review-flow-{}", ids::uuid()));
		for name in ["data", "home", "tmp", "res"] {
			std::fs::create_dir_all(dir.join(name)).unwrap();
		}
		let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.join("res")), None);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Machine Learning Foundations" })).unwrap()["id"].as_str().unwrap().to_owned();
		let fx = Fixture { app, dir, space_id, _one: one };
		let earlier = fx.lesson(&[]);
		let then = clock::now_ms() - 10 * DAY_MS;
		let mut messages = Vec::new();
		let mut topics = Vec::new();
		for (node, name) in EARLIER {
			let fact = json!({ "id": format!("f_{node}"), "name": name, "statement": name, "createdAt": time::iso(then), "aliases": [], "provenance": [{ "chatId": earlier, "messageId": format!("m-q-{node}") }] });
			fx.app.stores.graphs.append(Some(&fx.space_id), Ledger::Nodes, &fact).unwrap();
			topics.push(json!({ "id": node, "name": name, "members": [format!("f_{node}")] }));
			let right = json!({ "kind": "quiz", "dontKnow": false, "correct": true, "answers": [{ "index": 1, "label": "A", "value": "A" }], "confidence": 80, "answeredAt": time::iso(then) });
			messages.extend([
				json!({ "role": "assistant", "id": format!("m-q-{node}"), "content": [{ "type": "toolCall", "id": format!("q-{node}"), "name": "quiz", "arguments": quiz(node) }], "timestamp": then }),
				json!({ "role": "toolResult", "toolCallId": format!("q-{node}"), "toolName": "quiz", "details": right, "isError": false, "timestamp": then }),
				json!({ "role": "assistant", "id": format!("m-t-{node}"), "content": [{ "type": "toolCall", "id": format!("t-{node}"), "name": "topic_done", "arguments": { "nodeId": node, "review": quiz(node) } }], "timestamp": then }),
				json!({ "role": "toolResult", "toolCallId": format!("t-{node}"), "toolName": "topic_done", "details": { "part": "topic_done", "v": 1 }, "isError": false, "timestamp": then }),
			]);
		}
		fx.app.stores.graphs.append(Some(&fx.space_id), Ledger::Topics, &json!({ "at": time::iso(then), "topics": topics })).unwrap();
		fx.app.stores.chats.save_messages(&earlier, &messages).unwrap();
		fx
	}

	/// A Study lesson in the space on Regularization and Cross-validation holding `messages`.
	fn lesson(&self, messages: &[Json]) -> String {
		let id = self.app.stores.chats.create_chat("Study for Midterm", Some("study"), Some(&self.space_id), None).unwrap()["id"].as_str().unwrap().to_owned();
		let tree = json!({ "nodes": [{ "id": "reg", "title": "Regularization" }, { "id": "cv", "title": "Cross-validation" }], "edges": [] });
		self.app.stores.chats.save_tree(&id, &tree).unwrap();
		self.app.stores.chats.save_messages(&id, messages).unwrap();
		id
	}

	fn messages(&self, chat_id: &str) -> Vec<Json> {
		self.app.stores.chats.get_chat(chat_id).unwrap()["messages"].as_arr().unwrap().clone()
	}

	fn next(&self, chat_id: &str) -> Option<Json> {
		match next_review(&self.app, chat_id).unwrap() {
			ReviewReply::Next(question) => question,
			other => panic!("{other:?}"),
		}
	}

	/// Answers the open question right.
	fn answer(&self, chat_id: &str) -> Json {
		let question = self.next(chat_id).expect("a question from earlier");
		assert_eq!(answer_review(&self.app, chat_id, &question["of"], &graded()).unwrap(), ReviewReply::Done);
		question
	}
}

impl Drop for Fixture {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.dir);
	}
}

fn quiz(node: &str) -> Json {
	json!({ "type": "check", "nodeId": node, "question": format!("A question on {node}?"), "options": [{ "label": "A" }, { "label": "B" }], "explanation": "Because A.", "correctAnswer": "A" })
}

fn graded() -> Json {
	json!({ "kind": "quiz", "dontKnow": false, "correct": true, "answers": [{ "index": 1, "label": "A", "value": "A" }], "confidence": 80 })
}

fn user(words: &str, at: i64) -> Json {
	json!({ "role": "user", "id": ids::uuid(), "content": words, "timestamp": at })
}

fn reply(words: &str, at: i64) -> Json {
	json!({ "role": "assistant", "id": ids::uuid(), "content": [{ "type": "text", "text": words }], "timestamp": at })
}

fn topic(question: &Option<Json>) -> Option<&str> {
	question.as_ref().and_then(|q| q["nodeId"].as_str())
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

/// Answers the lesson's next work item with plain words; the whole transcript it was sent.
async fn agent_says(app: &App, chat_id: &str, words: &str) -> Vec<Json> {
	let opts = WaitOptions { conversation: Some(chat_id.to_owned()), full: true, ..WaitOptions::default() };
	let view = app.bridge.wait_for_work(10_000, opts).await.expect("a work item");
	app.bridge.respond_to_work(&view.work_id, AgentReply { text: Some(words.to_owned()), tool_calls: Vec::new() }, 0).unwrap();
	view.messages
}

async fn send(app: &Arc<App>, chat_id: &str, input: ChatInput) -> (u16, String) {
	let reply = handle_chat_input(app, chat_id, TurnInput::Chat(input)).await;
	(reply.status, reply.text())
}

fn text(words: &str, about: Option<About>) -> ChatInput {
	ChatInput::Text { text: words.to_owned(), attachments: None, about }
}

#[tokio::test]
async fn the_window_opens_at_a_sittings_start_and_after_his_first_input_on_a_return() {
	let fx = Fixture::new();
	let now = clock::now_ms();
	let starting = fx.lesson(&[user("Study for Midterm", now)]);
	let first = fx.next(&starting).expect("no agent and the first reply not landed");
	assert_eq!(first, json!({ "of": { "chatId": first["of"]["chatId"], "messageId": "m-t-bayes", "toolCallId": "t-bayes" }, "nodeId": "bayes", "topic": "Bayes' rule", "quiz": { "question": "A question on bayes?", "options": [{ "label": "A" }, { "label": "B" }], "correctAnswer": "A", "explanation": "Because A." } }));
	let replied = fx.lesson(&[user("Study for Midterm", now - 60_000), reply("Here is Regularization.", now)]);
	assert_eq!(fx.next(&replied), None, "the reply landed");
	let returned = fx.lesson(&[user("Study for Midterm", now - DAY_MS), reply("Here is Regularization.", now - DAY_MS), user("I am back.", now)]);
	assert!(fx.next(&returned).is_some(), "his first input on a return");
	fx.app.bridge.record_check_in(Some("Claude Code"), true, now);
	assert_eq!(fx.next(&starting), None, "an agent is teaching and no turn runs");
	let teach = fx.app.stores.chats.create_chat("Sets", Some("teach"), Some(&fx.space_id), None).unwrap()["id"].as_str().unwrap().to_owned();
	assert_eq!(fx.next(&teach), None, "Study lessons only");
	assert_eq!(next_review(&fx.app, "chat_gone").unwrap(), ReviewReply::UnknownLesson);
}

#[test]
fn three_a_day_across_two_lessons_and_a_reload_shows_the_same_question() {
	let fx = Fixture::new();
	let now = clock::now_ms();
	let (a, b) = (fx.lesson(&[user("Study", now)]), fx.lesson(&[user("Study", now)]));
	assert_eq!(fx.next(&a), fx.next(&a), "a reload shows the same question");
	assert_eq!(topic(&Some(fx.answer(&a))), Some("bayes"));
	assert_eq!(topic(&Some(fx.answer(&a))), Some("eig"));
	assert_eq!(topic(&Some(fx.answer(&b))), Some("gd"), "the other lesson goes on where this one stopped");
	assert_eq!(fx.next(&b), None, "three today in this space; PCA waits");
	assert_eq!(fx.next(&a), None);
	let markers: Vec<Json> = fx.messages(&a).into_iter().filter(|m| m["customType"].as_str() == Some("review")).collect();
	assert_eq!(markers.len(), 2);
	let details = &markers[0]["details"];
	assert_eq!(details["answer"]["correct"], json!(true));
	let stamped = details["answer"]["answeredAt"].as_str().and_then(time::parse_date).unwrap();
	assert!((clock::now_ms() - stamped).abs() < 60_000, "stamped with the server's clock");
	assert_eq!(details["sitting"], json!(time::iso(now)), "the sitting began with his first message");
}

#[test]
fn a_skip_stores_nothing_and_passes_the_question_by() {
	let fx = Fixture::new();
	let id = fx.lesson(&[user("Study", clock::now_ms())]);
	let first = fx.next(&id).unwrap();
	let before = fx.messages(&id);
	assert_eq!(skip_review(&fx.app, &id, &first["of"]).unwrap(), ReviewReply::Done);
	assert_eq!(fx.messages(&id), before, "nothing stored");
	assert_eq!(topic(&fx.next(&id)), Some("eig"));
	assert_eq!(skip_review(&fx.app, &id, &first["of"]).unwrap(), ReviewReply::NotOpen, "no longer the open one");
	assert_eq!(answer_review(&fx.app, &id, &first["of"], &graded()).unwrap(), ReviewReply::NotOpen);
	let other = fx.lesson(&[user("Study", clock::now_ms())]);
	assert_eq!(topic(&fx.next(&other)), Some("bayes"), "a skip belongs to its lesson's sitting");
}

#[test]
fn the_question_on_screen_stays_answerable_after_the_picks_moved() {
	let fx = Fixture::new();
	let id = fx.lesson(&[user("Study", clock::now_ms())]);
	let first = fx.next(&id).unwrap();
	assert_eq!(skip_review(&fx.app, &id, &first["of"]).unwrap(), ReviewReply::Done);
	let second = fx.next(&id).unwrap();
	assert_eq!(second["nodeId"], json!("eig"));
	// No agent writes anything while he leaves it on screen, so the sitting's skips are forgotten
	// and the first pick is Bayes' rule again.
	clock::advance(31 * 60_000);
	assert_eq!(topic(&fx.next(&id)), Some("bayes"));
	assert_eq!(answer_review(&fx.app, &id, &second["of"], &graded()).unwrap(), ReviewReply::Done, "the question he answered is still due");
	assert_eq!(fx.messages(&id).iter().filter(|m| m["customType"].as_str() == Some("review")).count(), 1);
}

#[test]
fn the_refusals() {
	let fx = Fixture::new();
	let id = fx.lesson(&[user("Study", clock::now_ms())]);
	let open = fx.next(&id).unwrap();
	let other = json!({ "chatId": open["of"]["chatId"], "toolCallId": "t-none" });
	assert_eq!(answer_review(&fx.app, &id, &other, &graded()).unwrap(), ReviewReply::NotOpen);
	for answer in [json!({ "kind": "quiz", "answers": [] }), json!({ "kind": "quiz", "answers": [{ "label": "A" }] }), json!({ "kind": "ask", "dontKnow": true }), json!({ "kind": "quiz", "dismissed": true, "dontKnow": true })] {
		assert_eq!(answer_review(&fx.app, &id, &open["of"], &answer).unwrap(), ReviewReply::NotAnAnswer, "{answer:?}");
	}
	assert_eq!(answer_review(&fx.app, "chat_gone", &open["of"], &graded()).unwrap(), ReviewReply::UnknownLesson);
	assert_eq!(skip_review(&fx.app, "chat_gone", &open["of"]).unwrap(), ReviewReply::UnknownLesson);
	let dont_know = json!({ "kind": "quiz", "dontKnow": true, "answers": [] });
	assert_eq!(answer_review(&fx.app, &id, &open["of"], &dont_know).unwrap(), ReviewReply::Done, "I don't know is an answer");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_answer_during_a_turn_lands_before_the_reply_and_reaches_the_agent_once() {
	let fx = Fixture::new();
	let id = fx.lesson(&[]);
	assert_eq!(send(&fx.app, &id, text("Teach me Regularization.", None)).await.0, 200);
	let question = fx.answer(&id);
	agent_says(&fx.app, &id, "A penalty makes large weights cost something.").await;
	settled(&fx.app, &id).await;
	let record = fx.messages(&id);
	let marker = record.iter().position(|m| m["customType"].as_str() == Some("review")).unwrap();
	let answer = record.iter().position(|m| m["role"].as_str() == Some("assistant")).unwrap();
	assert!(marker < answer, "the answer sits before the turn's reply");
	assert_eq!(question["nodeId"], json!("bayes"));
	assert_eq!(fx.next(&id), None, "the reply landed");

	assert_eq!(send(&fx.app, &id, text("Why does it cost something?", None)).await.0, 200);
	let seen = agent_says(&fx.app, &id, "Because the loss adds it.").await;
	settled(&fx.app, &id).await;
	let lines: Vec<String> = seen.iter().filter(|m| m["role"].as_str() == Some("user")).filter_map(|m| m["text"].as_str()).flat_map(|t| t.lines().map(str::to_owned).collect::<Vec<_>>()).filter(|l| l.starts_with("[From earlier]")).collect();
	assert_eq!(lines, ["[From earlier] Bayes' rule right, sure 4."]);
	assert!(seen.iter().all(|m| !stringify(m).contains("\"review\"")), "the marker itself never reaches the agent");

	assert_eq!(send(&fx.app, &id, text("And then?", None)).await.0, 200);
	let seen = agent_says(&fx.app, &id, "Then we split the data.").await;
	settled(&fx.app, &id).await;
	let told = seen.iter().filter(|m| m["text"].as_str().is_some_and(|t| t.contains("[From earlier]"))).count();
	assert_eq!(told, 1, "told once");
}

#[tokio::test(flavor = "multi_thread")]
async fn ask_teacher_sends_the_open_question_whole_and_refuses_another() {
	let fx = Fixture::new();
	let id = fx.lesson(&[user("Study", clock::now_ms())]);
	let open = fx.next(&id).unwrap();
	let not_open = About::Review { of: json!({ "chatId": open["of"]["chatId"], "toolCallId": "t-none" }), picked: vec![] };
	assert_eq!(send(&fx.app, &id, text("Is it A?", Some(not_open))).await, (400, stringify(&json!({ "error": REVIEW_NOT_OPEN }))));
	let ask = About::Review { of: json!({ "chatId": open["of"]["chatId"], "toolCallId": open["of"]["toolCallId"] }), picked: vec!["B".into()] };
	assert_eq!(send(&fx.app, &id, text("Is it A?", Some(ask))).await.0, 200);
	let seen = agent_says(&fx.app, &id, "Think about what the question asks.").await;
	settled(&fx.app, &id).await;
	let note = seen.iter().filter_map(|m| m["text"].as_str()).find(|t| t.starts_with("[From earlier] He asked")).expect("the note");
	assert_eq!(note, "[From earlier] He asked about this question from earlier before answering; it stays open and godspeed grades his answer. Bayes' rule: A question on bayes? Options: A; B. He picked B so far. Explanation: Because A. Answer his question without giving the answer away, and end your turn.");
	assert_eq!(fx.next(&id), None, "the reply landed");
	assert_eq!(answer_review(&fx.app, &id, &open["of"], &graded()).unwrap(), ReviewReply::Done, "it stays open to answer");
}

#[tokio::test(flavor = "multi_thread")]
async fn ask_teacher_while_the_teachers_question_waits_behind_it_keeps_that_question_open() {
	let fx = Fixture::new();
	let now = clock::now_ms();
	let teacher = json!({ "role": "assistant", "id": "m-teach", "content": [{ "type": "toolCall", "id": "q-teacher", "name": "quiz", "arguments": quiz("reg") }], "timestamp": now });
	let id = fx.lesson(&[user("Study", now - 60_000), teacher]);
	// The question from earlier showed while the turn ran; the teacher's quiz then landed behind it.
	let open = open_question(&fx.app, &id, &fx.app.stores.chats.get_chat(&id).unwrap()).unwrap().expect("a question from earlier");
	let ask = About::Review { of: json!({ "chatId": open["of"]["chatId"], "toolCallId": open["of"]["toolCallId"] }), picked: vec![] };
	assert_eq!(send(&fx.app, &id, text("Why?", Some(ask))).await.0, 200);
	let seen = agent_says(&fx.app, &id, "Think about what the question asks.").await;
	settled(&fx.app, &id).await;
	assert_eq!(dangling_question_of(&fx.messages(&id)).map(|d| d.tool_call_id).as_deref(), Some("q-teacher"), "the teacher's question still waits");
	let seen = stringify(&Json::Arr(seen));
	assert!(seen.contains("The learner asked a side question first") && !seen.contains("interrupted"), "the agent reads it as held, not interrupted: {seen}");
	assert!(seen.contains("[From earlier] He asked about this question from earlier"), "the note still rides with it");
}
