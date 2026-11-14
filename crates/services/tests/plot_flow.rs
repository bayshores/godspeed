//! The plot, end to end against a stand-in agent on the bridge: a reply with a plot and its guess
//! ends the turn with no extra agent step and stores both calls as sent, the plot's result naming
//! it, its guess and the drawn value; a refused pair comes back to the agent as short lines, with
//! no echo of the calls, and the agent fixes it in the same turn. A plot with no guess in a side
//! turn ends that turn too: the next work is his answer to the open question.

use std::path::PathBuf;
use std::sync::Arc;

use gs_base::clock;
use gs_base::config::Paths;
use gs_base::ids;
use gs_core::messages::input_events::{ChatInput, TurnInput};
use gs_engine::bridge::{AgentReply, ReplyCall, WaitOptions};
use gs_json::{Json, json};
use gs_services::App;
use gs_services::turns::{handle_chat_input, is_turn_running};

/// An app over a fresh folder, removed when dropped.
struct Fixture {
	app: Arc<App>,
	dir: PathBuf,
}

impl Fixture {
	fn new() -> Fixture {
		let dir = std::env::temp_dir().join(format!("gs-plot-flow-{}", ids::uuid()));
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

fn plot() -> Json {
	json!({
		"title": "One feature, where the weight ends up",
		"x": { "name": "a", "label": "where the data alone put it", "min": 0, "max": 10 },
		"y": { "label": "w", "min": 0, "max": 5 },
		"slider": { "name": "lambda", "min": 0.5, "max": 4, "start": 1 },
		"lines": [{ "label": "penalty", "expr": "a/(1+lambda)", "hidden": true }, { "label": "leash", "expr": "min(a, 4/(1+lambda))" }],
	})
}

fn guess(right: &str) -> Json {
	let options = json!([{ "label": "At 2, the leash's length.", "value": "A" }, { "label": "At 4.", "value": "B" }, { "label": "At 3.", "value": "C" }, { "label": "At 8.", "value": "D" }]);
	json!({
		"type": "predict",
		"nodeId": "reg",
		"question": "Now the data pull twice as hard, a = 8, still at lambda = 1. Where does the penalty put it?",
		"options": options,
		"explanation": "a/(1+lambda) is 8/2 = 4.",
		"correctAnswer": right,
		"onPlot": { "line": "penalty", "x": 8 },
	})
}

/// The reply: its words, the guess, then the plot.
fn pair(plot: Json, right: &str) -> AgentReply {
	let calls = vec![ReplyCall { name: "quiz".to_owned(), arguments: guess(right) }, ReplyCall { name: "plot".to_owned(), arguments: plot }];
	AgentReply { text: Some("A common picture is a leash on the weights.".to_owned()), tool_calls: calls }
}

/// Answers the lesson's next work item with `reply`; the whole transcript it was sent.
async fn answer(app: &App, chat_id: &str, reply: AgentReply) -> Vec<Json> {
	let opts = WaitOptions { conversation: Some(chat_id.to_owned()), full: true, ..WaitOptions::default() };
	let view = app.bridge.wait_for_work(10_000, opts).await.expect("a work item");
	app.bridge.respond_to_work(&view.work_id, reply, 0).unwrap();
	view.messages
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

/// A Study lesson on Regularization whose learner asked to start.
async fn study_lesson(app: &Arc<App>) -> String {
	let chat_id = app.stores.chats.create_chat("Study for Midterm", Some("study"), None, None).unwrap()["id"].as_str().unwrap().to_owned();
	let tree = json!({ "nodes": [{ "id": "reg", "title": "Regularization" }], "edges": [] });
	app.stores.chats.save_tree(&chat_id, &tree).unwrap();
	let input = ChatInput::Text { text: "Teach me Regularization.".to_owned(), attachments: None, about: None };
	let reply = handle_chat_input(app, &chat_id, TurnInput::Chat(input)).await;
	assert_eq!(reply.status, 200, "{}", reply.text());
	chat_id
}

fn messages(app: &App, chat_id: &str) -> Vec<Json> {
	app.stores.chats.get_chat(chat_id).unwrap()["messages"].as_arr().unwrap().clone()
}

fn results(record: &[Json], name: &str) -> Vec<Json> {
	record.iter().filter(|m| m["role"].as_str() == Some("toolResult") && m["toolName"].as_str() == Some(name)).cloned().collect()
}

fn call_of<'a>(record: &'a [Json], name: &str) -> &'a Json {
	record.iter().rev().flat_map(|m| m["content"].as_arr().into_iter().flatten()).find(|b| b["type"].as_str() == Some("toolCall") && b["name"].as_str() == Some(name)).unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_valid_pair_ends_the_turn_with_no_extra_step() {
	let fx = Fixture::new();
	let chat_id = study_lesson(&fx.app).await;
	answer(&fx.app, &chat_id, pair(plot(), "B")).await;
	// A turn that needed another step would wait for a work item that never comes.
	settled(&fx.app, &chat_id).await;

	let record = messages(&fx.app, &chat_id);
	assert_eq!(call_of(&record, "plot")["arguments"], plot(), "the plot is stored as sent");
	assert_eq!(call_of(&record, "quiz")["arguments"], guess("B"), "the guess is stored as sent");
	let quiz_id = call_of(&record, "quiz")["id"].clone();
	let plots = results(&record, "plot");
	assert_eq!(plots.len(), 1);
	assert_eq!(plots[0]["content"], json!([{ "type": "text", "text": "p1 drawn. At lambda 1, a = 0, 5, 10: penalty 0, 2.5, 5. leash 0, 2, 2." }]));
	assert_eq!(plots[0]["details"], json!({ "part": "plot", "v": 1, "id": "p1", "onPlot": { "toolCallId": quiz_id, "value": 4.0 }, "y": { "min": 0, "max": 5 } }));
	assert!(results(&record, "quiz").is_empty(), "the guess waits for his answer");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_refused_pair_is_fixed_in_the_same_turn() {
	let fx = Fixture::new();
	let chat_id = study_lesson(&fx.app).await;
	let mut broken = plot();
	if let Some(lines) = broken.as_obj_mut().and_then(|p| p.get_mut("lines")).and_then(Json::as_arr_mut) {
		lines[1] = json!({ "label": "leash", "expr": "min(a, 4/(1+lamda))" });
	}
	answer(&fx.app, &chat_id, pair(broken, "B")).await;
	let seen = answer(&fx.app, &chat_id, pair(plot(), "B")).await;
	let told: Vec<&str> = seen.iter().filter(|m| m["role"].as_str() == Some("toolResult")).filter_map(|m| m["text"].as_str()).collect();
	assert_eq!(told, ["quiz: refused with the plot above. Re-send both, or the guess alone without onPlot.", "lines[1].expr: unknown name \"lamda\". Use only a, lambda, pi, e."]);
	settled(&fx.app, &chat_id).await;

	let record = messages(&fx.app, &chat_id);
	let plots = results(&record, "plot");
	assert_eq!(plots.iter().map(|r| r["isError"].as_bool()).collect::<Vec<_>>(), [Some(true), Some(false)]);
	assert_eq!(plots[1]["details"]["id"], json!("p1"), "a refused plot takes no id");
	assert_eq!(record.iter().filter(|m| m["role"].as_str() == Some("user")).count(), 1, "one turn");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_plot_with_no_guess_ends_its_side_turn_and_the_next_work_is_his_answer() {
	let fx = Fixture::new();
	let chat_id = study_lesson(&fx.app).await;
	let mut quiz = guess("B");
	if let Some(q) = quiz.as_obj_mut() {
		q.remove("onPlot");
	}
	answer(&fx.app, &chat_id, AgentReply { text: Some("A leash on the weights.".to_owned()), tool_calls: vec![ReplyCall { name: "quiz".to_owned(), arguments: quiz }] }).await;
	settled(&fx.app, &chat_id).await;

	let side = ChatInput::Side { text: "Can I see it on a plot?".to_owned(), attachments: None };
	assert_eq!(handle_chat_input(&fx.app, &chat_id, TurnInput::Chat(side)).await.status, 200);
	let mut open = plot();
	if let Some(lines) = open.as_obj_mut().and_then(|p| p.get_mut("lines")).and_then(Json::as_arr_mut) {
		lines[0] = json!({ "label": "penalty", "expr": "a/(1+lambda)" });
	}
	answer(&fx.app, &chat_id, AgentReply { text: Some("Here it is.".to_owned()), tool_calls: vec![ReplyCall { name: "plot".to_owned(), arguments: open }] }).await;
	settled(&fx.app, &chat_id).await;
	assert_eq!(fx.app.bridge.pending_turn_count(), 0, "no work waits for the agent");
	assert!(results(&messages(&fx.app, &chat_id), "plot")[0]["details"].get("onPlot").is_none());

	let quiz_id = call_of(&messages(&fx.app, &chat_id), "quiz")["id"].as_str().unwrap().to_owned();
	let picked = json!({ "kind": "quiz", "dontKnow": false, "correct": true, "answers": [{ "index": 2, "label": "At 4.", "value": "B" }], "confidence": 80 });
	let answered = ChatInput::Answer { tool_call_id: quiz_id.clone(), answer: picked, attachments: None };
	assert_eq!(handle_chat_input(&fx.app, &chat_id, TurnInput::Chat(answered)).await.status, 200);
	let seen = answer(&fx.app, &chat_id, AgentReply { text: Some("Right.".to_owned()), tool_calls: Vec::new() }).await;
	let last = seen.last().unwrap();
	assert!(last["text"].as_str().is_some_and(|t| t.starts_with("The learner answered your open question:")), "the next work is his answer: {last:?}");
}
