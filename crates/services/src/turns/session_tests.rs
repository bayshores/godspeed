//! Lessons on a stand-in agent (gs-runtime's FakeAgent): whole turns through the chat handler, the
//! record they leave, the agent session the lesson keeps, and what the agent was sent.

use std::sync::Arc;

use gs_base::clock;
use gs_core::messages::input_events::{ChatInput, TurnInput};
use gs_core::messages::native_messages::new_user_steer;
use gs_core::messages::role::Role;
use gs_core::study::reply_nudges::{LAST_REPLY_LEAD, Nudge, curve_refusal};
use gs_json::{Json, json};
use gs_runtime::Runtime;
use gs_engine::turn::events::AgentEvent;
use gs_runtime::fake::{FakeAgent, FakeStep};
use parking_lot::Mutex;

use super::chat_handler::handle_chat_input;
use super::turn_liveness::is_turn_running;
use super::turn_runs::{abort_turn, answer_approval, running_turn};
use super::turn_work::lesson_work;
use crate::App;
use crate::app::agent_folder::set_folder_agent;
use crate::app::agents::use_runtime;
use crate::app::test_support::{Scratch, scratch_dir, test_app};
use crate::jobs::steer_live_chat;

const CURVE: &str = "| lambda | error |\n|---|---|\n| 0.1 | 9 |\n| 1 | 4 |\n| 10 | 6 |";
const QUESTIONS: &str = "1. What is the score?\n2. Which lambda wins?";

struct Lesson {
	app: Arc<App>,
	agent: FakeAgent,
	chat_id: String,
	_root: Scratch,
}

fn text(text: &str) -> FakeStep {
	FakeStep::Text(text.to_owned())
}

fn tool(name: &str, args: Json) -> FakeStep {
	FakeStep::Tool { name: name.to_owned(), args }
}

fn bash() -> FakeStep {
	FakeStep::Approval { tool: "Bash".to_owned(), input: json!({ "command": "ls" }) }
}

/// A lesson of `kind` whose agent plays `turns`, as Claude Code.
fn lesson(label: &str, kind: Option<&str>, turns: Vec<Vec<FakeStep>>) -> Lesson {
	lesson_on(label, kind, turns, FakeAgent::runtime)
}

/// A lesson of `kind` whose agent plays `turns` on the runtime `runtime` makes.
fn lesson_on(label: &str, kind: Option<&str>, turns: Vec<Vec<FakeStep>>, runtime: fn(&FakeAgent) -> Runtime) -> Lesson {
	let root = scratch_dir(label);
	let app = test_app(&root);
	let agent = FakeAgent::new(turns);
	// The lesson runs on the agent the learner picked, so the pick matches the stand-in.
	let runtime = runtime(&agent);
	set_folder_agent(&app, runtime.agent()).unwrap();
	use_runtime(&app, runtime);
	let chat_id = app.stores.chats.create_chat("Sets", kind, None, None, &[]).unwrap()["id"].str_or_empty().to_owned();
	Lesson { app, agent, chat_id, _root: root }
}

impl Lesson {
	/// The learner's words; the turn they start runs in the background.
	async fn say(&self, words: &str) {
		let reply = handle_chat_input(&self.app, &self.chat_id, TurnInput::Chat(ChatInput::Text { text: words.to_owned(), attachments: None, about: None })).await;
		assert!(reply.ok(), "{}", reply.text());
	}

	async fn settled(&self) {
		for _ in 0..500 {
			if !is_turn_running(&self.app, &self.chat_id) {
				return;
			}
			clock::sleep(10).await;
		}
		panic!("the turn never settled");
	}

	fn record(&self) -> Json {
		self.app.stores.chats.get_chat(&self.chat_id).unwrap()
	}

	fn messages(&self) -> Vec<Json> {
		self.record()["messages"].as_arr().cloned().unwrap()
	}

	/// The words of the lesson's assistant messages, in order.
	fn replies(&self) -> Vec<String> {
		let messages = self.messages();
		messages.iter().filter(|m| Role::Assistant.is(m)).flat_map(|m| m["content"].items().iter().filter_map(|b| b["text"].as_str().map(str::to_owned)).collect::<Vec<_>>()).collect()
	}

	/// What the agent was sent of each type, in order.
	fn sent(&self, kind: &str) -> Vec<Json> {
		self.agent.sent().into_iter().filter(|m| m["type"].as_str() == Some(kind)).collect()
	}

	/// What the Codex agent was sent as JSON-RPC `method`, in order.
	fn requests(&self, method: &str) -> Vec<Json> {
		self.agent.sent().into_iter().filter(|m| m["method"].as_str() == Some(method)).collect()
	}

	/// The words of each turn the agent was sent.
	fn sends(&self) -> Vec<String> {
		self.sent("send").iter().map(|m| m["content"].items().iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join("\n")).collect()
	}

	/// The permission question the turn waits on.
	async fn approval(&self) -> String {
		for _ in 0..500 {
			if let Some(id) = lesson_work(&self.app, &self.chat_id).and_then(|w| w["approvals"][0]["id"].as_str().map(str::to_owned)) {
				return id;
			}
			clock::sleep(10).await;
		}
		panic!("no permission question came");
	}
}

#[tokio::test(flavor = "multi_thread")]
async fn a_question_ends_the_turn_and_the_next_turn_goes_on_with_what_is_new() {
	let ask = tool("ask_user_question", json!({ "question": "Which part of sets?" }));
	let fx = lesson("session-question", None, vec![vec![text("One check first."), ask, text("never played")], vec![text("Unions, then.")]]);
	fx.say("Teach me sets").await;
	fx.settled().await;
	assert_eq!(fx.replies(), ["One check first."], "the question ended the turn");
	let calls: Vec<Json> = fx.messages().iter().filter(|m| Role::Assistant.is(m)).flat_map(|m| m["content"].items().iter().filter(|b| b["type"].as_str() == Some("toolCall")).cloned().collect::<Vec<_>>()).collect();
	assert_eq!(calls[0]["name"].as_str(), Some("ask_user_question"));
	let stored = fx.record()["agentSession"].clone();
	assert_eq!((stored["agent"].as_str(), stored["seen"].as_str()), (Some("claude"), fx.messages().last().unwrap()["id"].as_str()));

	fx.say("why?").await;
	fx.settled().await;
	assert_eq!(fx.sent("open").len(), 1, "the lesson's open session goes on");
	let sends = fx.sends();
	assert!(sends[0].contains("Teach me sets"));
	assert!(sends[1].contains("why?") && !sends[1].contains("Teach me sets"), "only what is new: {}", sends[1]);
	assert!(sends[1].ends_with("One idea per reply, at most four short lines, then his move."), "his rules come last: {}", sends[1]);
	assert_eq!(fx.replies(), ["One check first.", "Unions, then."]);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_allowed_permission_question_lets_the_turn_go_on() {
	let fx = lesson("session-allow", None, vec![vec![bash(), text("Listed.")]]);
	fx.say("Look at my folder").await;
	let id = fx.approval().await;
	assert_eq!(lesson_work(&fx.app, &fx.chat_id).unwrap()["approvals"][0]["ask"], json!({ "kind": "tool", "name": "Bash", "input": { "command": "ls" } }));
	assert!(answer_approval(&fx.app, &fx.chat_id, &id, true));
	assert!(!answer_approval(&fx.app, &fx.chat_id, &id, true), "answered once");
	fx.settled().await;
	assert_eq!(fx.replies(), ["Listed."]);
	assert_eq!(fx.sent("approval")[0]["allow"], json!(true));
}

#[tokio::test(flavor = "multi_thread")]
async fn stop_denies_the_waiting_permission_question_and_stops_the_agent() {
	let fx = lesson("session-stop", None, vec![vec![bash(), text("after")]]);
	fx.say("Look at my folder").await;
	fx.approval().await;
	assert!(abort_turn(&fx.app, &fx.chat_id));
	fx.settled().await;
	assert_eq!(fx.sent("approval")[0]["allow"], json!(false));
	for _ in 0..100 {
		if !fx.sent("interrupt").is_empty() {
			return;
		}
		clock::sleep(10).await;
	}
	panic!("the agent was never stopped");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_message_sent_during_the_turn_goes_to_claude_code_as_the_next_turn() {
	let fx = lesson("session-steer", None, vec![vec![bash(), text("first")], vec![text("second")]]);
	fx.say("Look at my folder").await;
	let id = fx.approval().await;
	assert!(steer_live_chat(&fx.app, &fx.chat_id, new_user_steer("also this", "steer_1")));
	answer_approval(&fx.app, &fx.chat_id, &id, true);
	fx.settled().await;
	assert_eq!(fx.replies(), ["first", "second"]);
	assert!(fx.sends()[1].contains("also this"));
	let steer_at = fx.messages().iter().position(|m| m["id"].as_str() == Some("steer_1")).unwrap_or_else(|| panic!("the steer is saved: {:?}", fx.messages()));
	assert_eq!(fx.messages()[steer_at + 1]["content"][0]["text"].as_str(), Some("second"));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_message_sent_during_the_turn_goes_to_codex_in_the_same_turn() {
	let fx = lesson_on("session-steer-codex", None, vec![vec![bash(), text("after")]], FakeAgent::codex_runtime);
	fx.say("Look at my folder").await;
	let id = fx.approval().await;
	assert!(steer_live_chat(&fx.app, &fx.chat_id, new_user_steer("also this", "steer_1")));
	for _ in 0..500 {
		if !fx.requests("turn/steer").is_empty() {
			break;
		}
		clock::sleep(10).await;
	}
	answer_approval(&fx.app, &fx.chat_id, &id, true);
	fx.settled().await;
	let steers = fx.requests("turn/steer");
	assert_eq!(steers.len(), 1, "{:?}", fx.agent.sent());
	assert_eq!(steers[0]["params"]["input"][0]["text"].as_str(), Some("also this"));
	assert_eq!(fx.requests("turn/start").len(), 1, "the message joined the turn that was running");
	assert_eq!(fx.replies(), ["after"]);
	let steer_at = fx.messages().iter().position(|m| m["id"].as_str() == Some("steer_1")).unwrap_or_else(|| panic!("the steer is saved: {:?}", fx.messages()));
	assert_eq!(fx.messages()[steer_at + 1]["content"][0]["text"].as_str(), Some("after"));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_session_the_agent_cannot_go_on_with_rolls_over_to_a_new_one() {
	let fx = lesson("session-resume", None, vec![vec![text("hello")], vec![FakeStep::Fail("No conversation found".to_owned())], vec![text("again")]]);
	fx.say("Teach me sets").await;
	fx.settled().await;
	let first = fx.record()["agentSession"]["id"].str_or_empty().to_owned();
	// As after a restart: the session is no longer open, so the lesson resumes it.
	fx.app.turns.sessions.lock().clear();
	fx.say("more").await;
	fx.settled().await;
	let opens: Vec<Json> = fx.sent("open").iter().map(|o| o["resume"].clone()).collect();
	assert_eq!(opens, [Json::Null, json!(first), Json::Null]);
	assert_eq!(fx.replies(), ["hello", "again"]);
	assert!(fx.sends()[2].contains("Teach me sets"), "the new session gets the whole lesson");
	assert_ne!(fx.record()["agentSession"]["id"].as_str(), Some(first.as_str()));
}

#[tokio::test(flavor = "multi_thread")]
async fn changed_instructions_roll_over_to_a_new_session() {
	let fx = lesson("session-hash", None, vec![vec![text("hello")], vec![text("again")]]);
	fx.say("Teach me sets").await;
	fx.settled().await;
	let mut stored = fx.record()["agentSession"].clone();
	stored.set("promptHash", "an older prompt");
	fx.app.stores.chats.set_agent_session(&fx.chat_id, &stored).unwrap();
	fx.say("more").await;
	fx.settled().await;
	assert_eq!(fx.sent("open")[1]["resume"], Json::Null);
	let sends = fx.sends();
	assert!(sends[1].contains("Teach me sets") && !sends[1].contains("One idea per reply"), "{}", sends[1]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_source_mark_that_points_at_nothing_is_taken_out_and_noted_for_the_next_reply() {
	let fx = lesson("session-cites", None, vec![vec![text("Sets are collections [[f_000000000000:9]].")], vec![text("ok")]]);
	fx.say("Teach me sets").await;
	fx.settled().await;
	assert!(!fx.replies()[0].contains("[["), "{}", fx.replies()[0]);
	fx.say("more").await;
	fx.settled().await;
	assert!(fx.sends()[1].starts_with(&format!("{LAST_REPLY_LEAD}\nRemoved source marks that don't point at a passage of a space file: f_000000000000:9.")), "{}", fx.sends()[1]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_study_quiz_whose_question_reads_as_a_curve_is_refused_once() {
	let options: Vec<Json> = ["U-shaped", "Flat", "Rising"].iter().map(|label| json!({ "label": label, "value": label })).collect();
	let quiz = json!({ "type": "check", "nodeId": "t1", "question": CURVE, "options": options, "explanation": "It dips.", "correctAnswer": "U-shaped" });
	let fx = lesson("session-curve", Some("study"), vec![vec![tool("quiz", quiz), text("ok")]]);
	fx.say("Teach me regularization").await;
	fx.settled().await;
	let result = fx.messages().into_iter().find(|m| Role::ToolResult.is(m)).expect("the call's result is saved");
	assert_eq!((result["isError"].as_bool(), result["content"][0]["text"].as_str()), (Some(true), Some(curve_refusal().as_str())));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_study_reply_with_a_list_of_questions_is_noted_for_the_next_reply() {
	let fx = lesson("session-prose", Some("study"), vec![vec![text(QUESTIONS)], vec![text("ok")]]);
	fx.say("Teach me regularization").await;
	fx.settled().await;
	assert_eq!(fx.replies(), [QUESTIONS], "the words were shown and are kept");
	fx.say("more").await;
	fx.settled().await;
	assert!(fx.sends()[1].starts_with(&format!("{LAST_REPLY_LEAD}\n{}", Nudge::QuestionList.note())), "{}", fx.sends()[1]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_call_with_bad_arguments_is_an_error_and_the_turn_goes_on() {
	let fx = lesson("session-tool-error", None, vec![vec![tool("ask_user_question", json!({})), text("Let me ask that again.")]]);
	fx.say("Teach me sets").await;
	fx.settled().await;
	let result = fx.messages().into_iter().find(|m| Role::ToolResult.is(m)).expect("the failed call's result is saved");
	assert_eq!(result["isError"].as_bool(), Some(true));
	assert_eq!(fx.replies(), ["Let me ask that again."], "a failed question does not end the turn");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_calls_of_one_step_stay_in_one_message() {
	let fx = lesson("session-step", None, Vec::new());
	let home = fx.app.paths.home.to_string_lossy().into_owned();
	fx.agent.push(vec![FakeStep::Calls(vec![("ls".to_owned(), json!({ "path": home })), ("ls".to_owned(), json!({ "path": home }))]), text("Two looks.")]);
	fx.say("What is in my folder?").await;
	fx.settled().await;
	// Each message as its role and the ids of its calls: no call is written twice, none waits.
	let shape: Vec<String> = fx
		.messages()
		.iter()
		.map(|m| {
			let ids: Vec<&str> = m["content"].items().iter().filter(|b| b["type"].as_str() == Some("toolCall")).map(|b| b["id"].str_or_empty()).collect();
			format!("{} {}{}", m["role"].str_or_empty(), ids.join(","), m["toolCallId"].str_or_empty())
		})
		.collect();
	assert_eq!(shape, ["custom ", "user ", "assistant toolu_1.0,toolu_1.1", "toolResult toolu_1.0", "toolResult toolu_1.1", "assistant "], "{:?}", fx.messages());
}

/// Over Codex a plot sent before its guess waits unseen: no message the window gets holds it
/// until the guess comes, and then the two come together.
#[tokio::test(flavor = "multi_thread")]
async fn a_plot_sent_first_is_never_shown_before_its_guess() {
	let plot = json!({
		"title": "One feature, where the weight ends up",
		"x": { "name": "a", "label": "where the data alone put it", "min": 0, "max": 10 },
		"y": { "label": "w", "min": 0, "max": 5 },
		"slider": { "name": "lambda", "min": 0.5, "max": 4, "start": 1 },
		"lines": [{ "label": "penalty", "expr": "a/(1+lambda)", "hidden": true }, { "label": "leash", "expr": "min(a, 4/(1+lambda))" }],
	});
	let options = json!([{ "label": "At 2.", "value": "A" }, { "label": "At 4.", "value": "B" }]);
	let guess = json!({ "type": "predict", "nodeId": "reg", "question": "At a = 8, where does the penalty put it?", "options": options, "explanation": "8/2 = 4.", "correctAnswer": "B", "onPlot": { "line": "penalty", "x": 8 } });
	let fx = lesson_on("session-held-plot", Some("study"), vec![vec![bash(), text("A leash."), tool("plot", plot), text("Guess first."), tool("quiz", guess)]], FakeAgent::codex_runtime);
	fx.app.stores.chats.save_tree(&fx.chat_id, &json!({ "nodes": [{ "id": "reg", "title": "Regularization" }], "edges": [] })).unwrap();
	fx.say("Teach me Regularization.").await;
	// The approval holds the turn while the window's view starts listening.
	let id = fx.approval().await;
	let seen: Arc<Mutex<Vec<Json>>> = Arc::default();
	let sink = seen.clone();
	running_turn(&fx.app, &fx.chat_id).unwrap().turn().subscribe(Arc::new(move |event: &AgentEvent| sink.lock().push(event.to_json())));
	answer_approval(&fx.app, &fx.chat_id, &id, true);
	fx.settled().await;

	let seen = seen.lock();
	let calls = |e: &Json| e["message"]["content"].items().iter().filter_map(|b| b["name"].as_str().map(str::to_owned)).collect::<Vec<_>>();
	let guess_at = seen.iter().position(|e| e["type"].as_str() == Some("tool_execution_start") && e["toolName"].as_str() == Some("quiz")).expect("the guess came");
	assert!(seen[..guess_at].iter().all(|e| !calls(e).contains(&"plot".to_owned())), "the plot was shown before its guess: {:?}", &seen[..guess_at]);
	assert!(seen[guess_at..].iter().any(|e| e["type"].as_str() == Some("message_end") && calls(e) == ["plot", "quiz"]), "then both at once");
}
