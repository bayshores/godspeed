//! The plot, end to end against a stand-in agent (gs-runtime's FakeAgent): a reply with a plot and
//! its guess ends the turn with no extra agent step and stores both calls as sent, the plot's
//! result naming it, its guess and the drawn value; a refused pair comes back to the agent as short
//! lines, with no echo of the calls, and the agent fixes it in the same turn. Codex sends the two
//! one at a time, in either order: the first waits, and the record is the one a single reply makes.
//! A half still waiting when the turn ends is never shown, and the next turn's input says so. A
//! plot with no guess in a side turn ends that turn too: the next turn is his answer to the open
//! question.

use std::path::PathBuf;
use std::sync::Arc;

use gs_base::clock;
use gs_base::config::Paths;
use gs_base::ids;
use gs_core::messages::input_events::{ChatInput, TurnInput};
use gs_core::messages::native_messages::SIDE_ANSWER_LEAD;
use gs_core::messages::role::Role;
use gs_core::study::topic_parts::{GUESS_HELD, PLOT_DROPPED, PLOT_HELD};
use gs_json::{Json, json};
use gs_runtime::Runtime;
use gs_runtime::fake::{FakeAgent, FakeStep};
use gs_services::App;
use gs_services::app::agent_folder::set_folder_agent;
use gs_services::app::agents::use_runtime;
use gs_services::turns::{handle_chat_input, is_turn_running};

/// An app over a fresh folder whose lessons run on a stand-in agent, removed when dropped.
struct Fixture {
	app: Arc<App>,
	agent: FakeAgent,
	dir: PathBuf,
}

impl Fixture {
	fn new() -> Fixture {
		Fixture::on(FakeAgent::runtime)
	}

	/// The stand-in plays the agent `runtime` runs, picked as the learner picks it.
	fn on(runtime: fn(&FakeAgent) -> Runtime) -> Fixture {
		let dir = std::env::temp_dir().join(format!("gs-plot-flow-{}", ids::uuid()));
		for name in ["data", "home", "tmp", "res"] {
			std::fs::create_dir_all(dir.join(name)).unwrap();
		}
		let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.join("res")), None);
		let agent = FakeAgent::default();
		let runtime = runtime(&agent);
		set_folder_agent(&app, runtime.agent()).unwrap();
		use_runtime(&app, runtime);
		Fixture { app, agent, dir }
	}

	/// His input; the turn it starts plays `turn` to its end.
	async fn turn(&self, chat_id: &str, input: ChatInput, turn: Vec<FakeStep>) {
		self.agent.push(turn);
		let reply = handle_chat_input(&self.app, chat_id, TurnInput::Chat(input)).await;
		assert_eq!(reply.status, 200, "{}", reply.text());
		for _ in 0..2000 {
			if !is_turn_running(&self.app, chat_id) {
				return;
			}
			clock::sleep(5).await;
		}
		panic!("the turn never settled");
	}

	fn messages(&self, chat_id: &str) -> Vec<Json> {
		self.app.stores.chats.get_chat(chat_id).unwrap()["messages"].as_arr().unwrap().clone()
	}

	/// The words of the lesson's assistant messages, in order.
	fn replies(&self, chat_id: &str) -> Vec<String> {
		let messages = self.messages(chat_id);
		messages.iter().filter(|m| Role::Assistant.is(m)).flat_map(|m| m["content"].items().iter().filter_map(|b| b["text"].as_str().map(str::to_owned)).collect::<Vec<_>>()).collect()
	}

	/// The text of each tool result the agent was sent, in order: Claude Code's helper takes a
	/// `tool_result`, Codex an answer with `contentItems`.
	fn results(&self) -> Vec<String> {
		let text = |m: &Json| if m["type"].as_str() == Some("tool_result") { m["content"][0]["text"].clone() } else { m["result"]["contentItems"][0]["text"].clone() };
		self.agent.sent().iter().filter_map(|m| text(m).as_str().map(str::to_owned)).collect()
	}

	/// The text parts of the last turn the agent was sent.
	fn input(&self) -> Vec<String> {
		let sent = self.agent.sent().into_iter().rfind(|m| m["type"].as_str() == Some("send") || m["method"].as_str() == Some("turn/start")).expect("a turn was sent");
		let parts = if sent["type"].as_str() == Some("send") { &sent["content"] } else { &sent["params"]["input"] };
		parts.items().iter().filter_map(|p| p["text"].as_str().map(str::to_owned)).collect()
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

fn says(words: &str) -> FakeStep {
	FakeStep::Text(words.to_owned())
}

/// The reply: its words, then the plot and its guess in one message, the plot first, since the
/// guess ends the turn.
fn pair(plot: Json, right: &str) -> Vec<FakeStep> {
	vec![says("A common picture is a leash on the weights."), FakeStep::Calls(vec![("plot".to_owned(), plot), ("quiz".to_owned(), guess(right))])]
}

fn text(words: &str) -> ChatInput {
	ChatInput::Text { text: words.to_owned(), attachments: None, about: None }
}

/// A Study lesson on Regularization whose learner asked to start; the teacher plays `first`.
async fn study_lesson(fx: &Fixture, first: Vec<FakeStep>) -> String {
	let chat_id = fx.app.stores.chats.create_chat("Study for Midterm", Some("study"), None, None, &[]).unwrap()["id"].as_str().unwrap().to_owned();
	let tree = json!({ "nodes": [{ "id": "reg", "title": "Regularization" }], "edges": [] });
	fx.app.stores.chats.save_tree(&chat_id, &tree).unwrap();
	fx.turn(&chat_id, text("Teach me Regularization."), first).await;
	chat_id
}

fn call(name: &str, args: Json) -> FakeStep {
	FakeStep::Tool { name: name.to_owned(), args }
}

/// Each stored message as its role and its parts: text, or a call's tool name.
fn shape(record: &[Json]) -> Vec<String> {
	record
		.iter()
		.filter(|m| m["role"].as_str() != Some("custom"))
		.map(|m| {
			let parts: Vec<&str> = match m["content"].as_str() {
				Some(words) => vec![words],
				None => m["content"].items().iter().map(|b| b["name"].as_str().or(b["text"].as_str()).unwrap_or_default()).collect(),
			};
			format!("{} {}{}", m["role"].str_or_empty(), m["toolName"].str_or_empty(), parts.join(", "))
		})
		.collect()
}

fn results(record: &[Json], name: &str) -> Vec<Json> {
	record.iter().filter(|m| m["role"].as_str() == Some("toolResult") && m["toolName"].as_str() == Some(name)).cloned().collect()
}

fn call_of<'a>(record: &'a [Json], name: &str) -> &'a Json {
	record.iter().rev().flat_map(|m| m["content"].items().iter()).find(|b| b["type"].as_str() == Some("toolCall") && b["name"].as_str() == Some(name)).unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_valid_pair_ends_the_turn_with_no_extra_step() {
	let fx = Fixture::new();
	let chat_id = study_lesson(&fx, [pair(plot(), "B"), vec![says("never played")]].concat()).await;
	assert_eq!(fx.replies(&chat_id), ["A common picture is a leash on the weights."], "the pair ended the turn");

	let record = fx.messages(&chat_id);
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
	let mut broken = plot();
	if let Some(lines) = broken.as_obj_mut().and_then(|p| p.get_mut("lines")).and_then(Json::as_arr_mut) {
		lines[1] = json!({ "label": "leash", "expr": "min(a, 4/(1+lamda))" });
	}
	let chat_id = study_lesson(&fx, [pair(broken, "B"), pair(plot(), "B")].concat()).await;
	assert_eq!(fx.results()[..2], ["lines[1].expr: unknown name \"lamda\". Use only a, lambda, pi, e.", "quiz: refused with the plot above. Re-send both, or the guess alone without onPlot."]);

	let record = fx.messages(&chat_id);
	let plots = results(&record, "plot");
	assert_eq!(plots.iter().map(|r| r["isError"].as_bool()).collect::<Vec<_>>(), [Some(true), Some(false)]);
	assert_eq!(plots[1]["details"]["id"], json!("p1"), "a refused plot takes no id");
	assert_eq!(record.iter().filter(|m| m["role"].as_str() == Some("user")).count(), 1, "one turn");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_plot_with_no_guess_ends_its_side_turn_and_the_next_turn_is_his_answer() {
	let fx = Fixture::new();
	let mut quiz = guess("B");
	if let Some(q) = quiz.as_obj_mut() {
		q.remove("onPlot");
	}
	let chat_id = study_lesson(&fx, vec![says("A leash on the weights."), FakeStep::Tool { name: "quiz".to_owned(), args: quiz }]).await;

	let mut open = plot();
	if let Some(lines) = open.as_obj_mut().and_then(|p| p.get_mut("lines")).and_then(Json::as_arr_mut) {
		lines[0] = json!({ "label": "penalty", "expr": "a/(1+lambda)" });
	}
	let side = ChatInput::Side { text: "Can I see it on a plot?".to_owned(), attachments: None };
	fx.turn(&chat_id, side, vec![says("Here it is."), FakeStep::Tool { name: "plot".to_owned(), args: open }, says("never played")]).await;
	assert_eq!(fx.replies(&chat_id), ["A leash on the weights.", "Here it is."], "the plot ended the side turn");
	assert!(results(&fx.messages(&chat_id), "plot")[0]["details"].get("onPlot").is_none());

	let quiz_id = call_of(&fx.messages(&chat_id), "quiz")["id"].as_str().unwrap().to_owned();
	let picked = json!({ "kind": "quiz", "dontKnow": false, "correct": true, "answers": [{ "index": 2, "label": "At 4.", "value": "B" }], "confidence": 80 });
	fx.turn(&chat_id, ChatInput::Answer { tool_call_id: quiz_id, answer: picked, attachments: None }, vec![says("Right.")]).await;
	let input = fx.input();
	assert!(input[0].starts_with(SIDE_ANSWER_LEAD), "the next turn is his answer: {input:?}");
}

/// Codex sends the plot first and its guess in a later step: the plot waits, the guess completes
/// it, and the lesson stores what a single reply with both stores.
#[tokio::test(flavor = "multi_thread")]
async fn over_codex_a_plot_first_waits_for_its_guess_and_lands_as_one_reply() {
	let fx = Fixture::on(FakeAgent::codex_runtime);
	let chat_id = study_lesson(&fx, vec![says("A common picture is a leash on the weights."), call("plot", plot()), says("Before you move it:"), call("quiz", guess("B")), says("never played")]).await;
	assert_eq!(fx.results(), [PLOT_HELD, "p1 drawn. At lambda 1, a = 0, 5, 10: penalty 0, 2.5, 5. leash 0, 2, 2."]);

	let record = fx.messages(&chat_id);
	assert_eq!(shape(&record), ["user Teach me Regularization.", "assistant A common picture is a leash on the weights., Before you move it:, plot, quiz", "toolResult plotp1 drawn. At lambda 1, a = 0, 5, 10: penalty 0, 2.5, 5. leash 0, 2, 2."]);
	let quiz_id = call_of(&record, "quiz")["id"].clone();
	assert_eq!(results(&record, "plot")[0]["details"]["onPlot"], json!({ "toolCallId": quiz_id, "value": 4.0 }));
	assert!(results(&record, "quiz").is_empty(), "the guess waits for his answer");
}

#[tokio::test(flavor = "multi_thread")]
async fn over_codex_a_guess_first_waits_for_its_plot_and_lands_as_one_reply() {
	let fx = Fixture::on(FakeAgent::codex_runtime);
	let chat_id = study_lesson(&fx, vec![says("A common picture is a leash on the weights."), call("quiz", guess("B")), call("plot", plot()), says("never played")]).await;
	assert_eq!(fx.results(), [GUESS_HELD, "p1 drawn. At lambda 1, a = 0, 5, 10: penalty 0, 2.5, 5. leash 0, 2, 2."]);

	let record = fx.messages(&chat_id);
	assert_eq!(shape(&record), ["user Teach me Regularization.", "assistant A common picture is a leash on the weights., quiz, plot", "toolResult plotp1 drawn. At lambda 1, a = 0, 5, 10: penalty 0, 2.5, 5. leash 0, 2, 2."]);
	let quiz_id = call_of(&record, "quiz")["id"].clone();
	assert_eq!(results(&record, "plot")[0]["details"]["onPlot"], json!({ "toolCallId": quiz_id, "value": 4.0 }));
	assert!(results(&record, "quiz").is_empty(), "the guess waits for his answer");
}

/// A plot whose guess never comes is never shown, and the teacher's next turn starts with a note.
#[tokio::test(flavor = "multi_thread")]
async fn over_codex_a_half_still_waiting_at_the_end_is_dropped_and_noted() {
	let fx = Fixture::on(FakeAgent::codex_runtime);
	let chat_id = study_lesson(&fx, vec![says("Here is the picture."), call("plot", plot()), says("Look at it.")]).await;
	assert_eq!(shape(&fx.messages(&chat_id)), ["user Teach me Regularization.", "assistant Here is the picture., Look at it."], "no plot shown");

	fx.turn(&chat_id, text("Where is it?"), vec![says("Here.")]).await;
	assert_eq!(fx.input()[0], format!("About your last reply:\n{PLOT_DROPPED}"));
}
