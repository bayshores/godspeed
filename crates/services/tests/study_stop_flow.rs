//! Places to stop, end to end against a stand-in agent (gs-runtime's FakeAgent): a Study topic
//! ends on a conclude, the agent reads and stores the next topic's opener in the same turn, Keep
//! going lands before or after that, the learner's answer, skip or question about the opener
//! reaches the agent as one [Opener] line ([Resumed] first on a later day, the plot reminder after
//! it), and a practice or homework problem of 25 active minutes ends on a problem stop. The app
//! clock is moved, so this file's tests run one at a time and no other file shares their process.

use std::path::PathBuf;
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::{clock, ids};
use gs_core::contracts::chat::{CONCLUDE_ACK_TEXT, STUDY_TOPIC_END_ACK_TEXT, TOPIC_DONE_STORED_TEXT};
use gs_core::messages::input_events::{About, ChatInput, TurnInput};
use gs_core::messages::role::is_custom;
use gs_core::spaces::problem_list::ListOwner;
use gs_core::study::topic_end::{lesson_stop, shown_openers};
use gs_core::study::topic_parts::NO_PLOT_YET;
use gs_json::{Json, json};
use gs_runtime::fake::{FakeAgent, FakeStep};
use gs_services::App;
use gs_services::app::agents::use_runtime;
use gs_services::turns::homework::create_homework;
use gs_services::turns::lesson_events::{KeepGoing, keep_going};
use gs_services::turns::turn_runs::running_turn;
use gs_services::turns::turn_work::lesson_work;
use gs_services::turns::{answer_approval, every_turn_rules_for, handle_chat_input, is_turn_running};
use tokio::sync::Mutex;

/// Every test moves or reads the one app clock.
static ONE_AT_A_TIME: Mutex<()> = Mutex::const_new(());

const MINUTE_MS: i64 = 60_000;

/// An app over a fresh folder whose lessons run on a stand-in agent, removed when dropped.
struct Fixture {
	app: Arc<App>,
	agent: FakeAgent,
	dir: PathBuf,
}

impl Fixture {
	fn new() -> Fixture {
		let dir = std::env::temp_dir().join(format!("gs-study-stop-{}", ids::uuid()));
		for name in ["data", "home", "tmp", "res"] {
			std::fs::create_dir_all(dir.join(name)).unwrap();
		}
		let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.join("res")), None);
		let agent = FakeAgent::default();
		use_runtime(&app, agent.runtime());
		Fixture { app, agent, dir }
	}

	/// The learner's input; its turn starts and runs in the background.
	async fn send(&self, chat_id: &str, input: ChatInput) {
		let reply = handle_chat_input(&self.app, chat_id, TurnInput::Chat(input)).await;
		assert_eq!(reply.status, 200, "{}", reply.text());
	}

	async fn settled(&self, chat_id: &str) {
		for _ in 0..2000 {
			if !is_turn_running(&self.app, chat_id) {
				return;
			}
			clock::sleep(5).await;
		}
		panic!("the turn never settled");
	}

	/// The permission question the turn waits on.
	async fn approval(&self, chat_id: &str) -> String {
		for _ in 0..2000 {
			if let Some(id) = lesson_work(&self.app, chat_id).and_then(|w| w["approvals"][0]["id"].as_str().map(str::to_owned)) {
				return id;
			}
			clock::sleep(5).await;
		}
		panic!("no permission question came");
	}

	fn messages(&self, chat_id: &str) -> Vec<Json> {
		self.app.stores.chats.get_chat(chat_id).unwrap()["messages"].as_arr().unwrap().clone()
	}

	/// The text parts of the last turn the agent was sent, without the learner's rules that close
	/// every turn of a session that goes on.
	fn input(&self, chat_id: &str) -> Vec<String> {
		let sent = self.agent.sent().into_iter().rfind(|m| m["type"].as_str() == Some("send")).expect("a turn was sent");
		let mut parts: Vec<String> = sent["content"].items().iter().filter_map(|p| p["text"].as_str().map(str::to_owned)).collect();
		let rules = every_turn_rules_for(&self.app, &self.app.stores.chats.get_chat(chat_id).unwrap());
		if parts.last() == Some(&rules) {
			parts.pop();
		}
		parts
	}

	/// The text of each tool result the agent was sent, in order.
	fn results(&self) -> Vec<String> {
		self.agent.sent().iter().filter(|m| m["type"].as_str() == Some("tool_result")).map(|m| m["content"][0]["text"].str_or_empty().to_owned()).collect()
	}
}

impl Drop for Fixture {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.dir);
	}
}

fn says(words: &str) -> FakeStep {
	FakeStep::Text(words.to_owned())
}

fn call(name: &str, args: Json) -> FakeStep {
	FakeStep::Tool { name: name.to_owned(), args }
}

/// A permission question: the turn waits there until the test answers it.
fn pause() -> FakeStep {
	FakeStep::Approval { tool: "Bash".to_owned(), input: json!({ "command": "ls" }) }
}

fn text(words: &str) -> ChatInput {
	ChatInput::Text { text: words.to_owned(), attachments: None, about: None }
}

/// Where the call `name` sits in `messages`, and its id.
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
async fn study_lesson(fx: &Fixture) -> String {
	let chat_id = fx.app.stores.chats.create_chat("Study for Midterm", Some("study"), None, None, &[]).unwrap()["id"].as_str().unwrap().to_owned();
	fx.app.stores.chats.save_tree(&chat_id, &tree()).unwrap();
	let problem = json!({ "statement": "Why does an L2 penalty shrink the weights?", "mode": "recall", "modelSolution": "The penalty grows with each weight, so smaller weights lower the loss.", "nodeId": "reg" });
	fx.agent.push(vec![call("problem", problem)]);
	fx.send(&chat_id, text("Teach me Regularization.")).await;
	fx.settled(&chat_id).await;
	chat_id
}

/// His answer is right: the agent concludes, reads, then stores the opener, all in one turn.
/// With `keep_mid_turn` he presses Keep going while the agent reads. The conclude's call id.
async fn end_regularization(fx: &Fixture, chat_id: &str, keep_mid_turn: bool) -> String {
	let conclude = json!({ "outcome": "solved", "verdict": "You named the cost of a large weight exactly.", "rung": null, "missClass": null, "retest": false });
	let mut turn = vec![call("conclude", conclude), call("ls", json!({ "path": fx.app.paths.home.to_string_lossy() }))];
	if keep_mid_turn {
		turn.push(pause());
	}
	turn.push(call("topic_done", topic_done_args()));
	fx.agent.push(turn);
	fx.send(chat_id, text("Bigger weights cost more, so the fit keeps them small.")).await;
	if keep_mid_turn {
		let approval = fx.approval(chat_id).await;
		let so_far = running_turn(&fx.app, chat_id).expect("the turn runs").turn().messages();
		let (_, conclude_id) = call_of(&so_far, "conclude");
		assert_eq!(keep_going(&fx.app, chat_id, &conclude_id), Ok(KeepGoing::Kept { opener: false, running: true }), "stored unchecked during the turn");
		assert!(answer_approval(&fx.app, chat_id, &approval, true));
	}
	fx.settled(chat_id).await;
	let read = fx.results();
	assert_eq!(read[read.len() - 3], STUDY_TOPIC_END_ACK_TEXT, "the conclude's result the agent read, before the read and topic_done");
	call_of(&fx.messages(chat_id), "conclude").1
}

#[tokio::test(flavor = "multi_thread")]
async fn a_topic_ends_on_a_stop_and_its_opener_is_stored_in_the_same_turn() {
	let _one = ONE_AT_A_TIME.lock().await;
	let fx = Fixture::new();
	let chat_id = study_lesson(&fx).await;
	let conclude_id = end_regularization(&fx, &chat_id, true).await;

	let record = fx.messages(&chat_id);
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

	let keep_at = record.iter().position(|m| is_custom(m, "keep-going")).unwrap();
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
	let chat_id = study_lesson(&fx).await;
	let conclude_id = end_regularization(&fx, &chat_id, false).await;
	assert_eq!(keep_going(&fx.app, &chat_id, &conclude_id), Ok(KeepGoing::Kept { opener: true, running: false }));

	let (_, done_id) = call_of(&fx.messages(&chat_id), "topic_done");
	let answer_data = json!({ "kind": "quiz", "dontKnow": false, "answers": [{ "index": 1, "label": "It can move a lot", "value": "It can move a lot" }], "confidence": 60 });
	fx.agent.push(vec![says("Yes: each split sees different points.")]);
	fx.send(&chat_id, ChatInput::OpenerAnswer { topic_done_call_id: done_id, answer: Some(answer_data) }).await;
	fx.settled(&chat_id).await;
	assert_eq!(fx.input(&chat_id), [format!("[Opener] Cross-validation: he picked A, It can move a lot, sure 3 of 5.\n{NO_PLOT_YET}")]);
}

#[tokio::test(flavor = "multi_thread")]
async fn asking_about_the_opener_keeps_it_open_and_skipping_it_says_so() {
	let _one = ONE_AT_A_TIME.lock().await;
	let fx = Fixture::new();
	let chat_id = study_lesson(&fx).await;
	end_regularization(&fx, &chat_id, true).await;
	let (_, done_id) = call_of(&fx.messages(&chat_id), "topic_done");

	let ask = ChatInput::Text { text: "What is a split?".to_owned(), attachments: None, about: Some(About::Opener(done_id.clone())) };
	fx.agent.push(vec![says("A split is one way to divide the data.")]);
	fx.send(&chat_id, ask).await;
	fx.settled(&chat_id).await;
	assert_eq!(fx.input(&chat_id), ["[Opener] Cross-validation: he asked about it before answering; it stays open. Answer his question and end your turn.", "What is a split?"]);

	fx.agent.push(vec![says("Fine, let's look at it together.")]);
	fx.send(&chat_id, ChatInput::OpenerAnswer { topic_done_call_id: done_id, answer: None }).await;
	fx.settled(&chat_id).await;
	assert_eq!(fx.input(&chat_id), [format!("[Opener] Cross-validation: he skipped it.\n{NO_PLOT_YET}")]);
}

#[tokio::test(flavor = "multi_thread")]
async fn coming_back_the_next_day_tells_the_agent_he_resumed() {
	let _one = ONE_AT_A_TIME.lock().await;
	let fx = Fixture::new();
	let chat_id = study_lesson(&fx).await;
	let conclude_id = end_regularization(&fx, &chat_id, false).await;
	clock::advance(24 * 60 * MINUTE_MS);
	assert_eq!(keep_going(&fx.app, &chat_id, &conclude_id), Ok(KeepGoing::Kept { opener: true, running: false }));
	let (_, done_id) = call_of(&fx.messages(&chat_id), "topic_done");
	fx.agent.push(vec![says("Let's start with the split.")]);
	fx.send(&chat_id, ChatInput::OpenerAnswer { topic_done_call_id: done_id, answer: None }).await;
	fx.settled(&chat_id).await;
	assert_eq!(fx.input(&chat_id), [format!("[Resumed] He came back to this session after a stop.\n[Opener] Cross-validation: he skipped it.\n{NO_PLOT_YET}")]);
}

/// Five learner messages five minutes apart, each answered: with his answer next, 25 active minutes.
async fn work_25_minutes(fx: &Fixture, chat_id: &str) {
	for step in 1..=5 {
		clock::advance(5 * MINUTE_MS);
		fx.agent.push(vec![says("Go on.")]);
		fx.send(chat_id, text(&format!("Step {step} of my work."))).await;
		fx.settled(chat_id).await;
	}
}

/// His answer, which the agent concludes before its closing words: the conclude's stored result.
async fn concluded(fx: &Fixture, chat_id: &str, conclude: Json) -> Json {
	fx.agent.push(vec![call("conclude", conclude), says("Well done.")]);
	fx.send(chat_id, text("Here is my answer.")).await;
	fx.settled(chat_id).await;
	let record = fx.messages(chat_id);
	result_of(&record, &call_of(&record, "conclude").1).clone()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_practice_problem_of_25_active_minutes_ends_on_a_problem_stop() {
	let _one = ONE_AT_A_TIME.lock().await;
	let fx = Fixture::new();
	let chat_id = fx.app.stores.chats.create_chat("Practice ridge regression", Some("practice"), None, None, &[]).unwrap()["id"].as_str().unwrap().to_owned();
	let problem = json!({ "statement": "Pick lambda for a model that overfits.", "mode": "composition", "modelSolution": "Raise lambda until the validation error stops falling." });
	fx.agent.push(vec![call("problem", problem)]);
	fx.send(&chat_id, text("Give me a problem.")).await;
	fx.settled(&chat_id).await;
	work_25_minutes(&fx, &chat_id).await;

	let result = concluded(&fx, &chat_id, json!({ "outcome": "solved", "verdict": "Right.", "rung": null, "missClass": null, "retest": false })).await;
	assert_eq!(fx.results().last().map(String::as_str), Some(CONCLUDE_ACK_TEXT), "practice keeps its text");
	let stop = &result["details"]["stop"];
	assert_eq!(stop["kind"], json!("problem"));
	assert!(stop["activeMinutes"].as_f64().unwrap() >= 25.0, "{stop:?}");
	let at_stop = lesson_stop(&fx.messages(&chat_id), None, None).unwrap();
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
	app.stores.spaces.save_problems(&space_id, ListOwner::Deadline(&deadline_id), &problems).unwrap();
	let created = create_homework(app, &space_id, &deadline_id).unwrap().unwrap();
	let chat_id = created.chat["id"].as_str().unwrap().to_owned();
	fx.agent.push(vec![call("problem", json!({ "number": "1", "statement": "Fit ridge regression for three values of lambda." }))]);
	fx.send(&chat_id, text("Let's start.")).await;
	fx.settled(&chat_id).await;
	work_25_minutes(&fx, &chat_id).await;

	concluded(&fx, &chat_id, json!({ "outcome": "solved", "verdict": "All three fits are right." })).await;
	assert_eq!(fx.results().last().map(String::as_str), Some(CONCLUDE_ACK_TEXT));
	let space = app.stores.spaces.get_space(&space_id).unwrap();
	let marks = space["deadlines"][0]["problems"].as_arr().unwrap().clone();
	let at_stop = lesson_stop(&fx.messages(&chat_id), None, Some(&marks)).unwrap();
	assert_eq!((at_stop["kind"].as_str(), at_stop["next"].as_str()), (Some("problem"), Some("problem 2")));
	assert!(at_stop["activeMinutes"].as_f64().unwrap() >= 25.0);
}
