//! Kept sentences, end to end against a stand-in agent on the bridge: a keep that breaks its own
//! rules never refuses its quiz, the call is stored as sent and the teacher reads why right after
//! his answer; a stored keep gets its verdict when the turn is saved; dropping its analogy during a
//! turn reaches the teacher as one [Analogy dropped] line on his next input, and none when he
//! brought it back first; no keep-check or drop marker ever reaches the agent.

use std::path::PathBuf;
use std::sync::Arc;

use gs_base::clock;
use gs_base::config::Paths;
use gs_base::ids;
use gs_core::messages::input_events::{ChatInput, TurnInput};
use gs_engine::bridge::{AgentReply, ReplyCall, WaitOptions};
use gs_json::{Json, json, stringify};
use gs_services::App;
use gs_services::turns::lesson_events::{KeptDrop, KeptPart, drop_kept_part};
use gs_services::turns::{handle_chat_input, is_turn_running};

/// An app over a fresh folder, removed when dropped.
struct Fixture {
	app: Arc<App>,
	dir: PathBuf,
}

impl Fixture {
	fn new() -> Fixture {
		let dir = std::env::temp_dir().join(format!("gs-keep-flow-{}", ids::uuid()));
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

fn quiz(keep: Json) -> Json {
	let options = json!([{ "label": "1.5", "value": "A" }, { "label": "6", "value": "B" }, { "label": "3", "value": "C" }, { "label": "0.375", "value": "D" }]);
	json!({
		"type": "check",
		"nodeId": "reg",
		"question": "A penalized fit at lambda = 2 puts one weight at 1.5. Every y is multiplied by 4. Where is that weight now?",
		"options": options,
		"explanation": "The fit is linear in y.",
		"correctAnswer": "B",
		"keep": keep,
	})
}

fn leash() -> Json {
	json!({ "text": "Lambda prices large weights; it does not cap them.", "fits": "The leash fits one part: for the data you have, a larger lambda gives a shorter leash.", "stops": "It stops at new data: double the pull and every weight doubles." })
}

fn asks(words: &str, keep: Json) -> AgentReply {
	AgentReply { text: Some(words.to_owned()), tool_calls: vec![ReplyCall { name: "quiz".to_owned(), arguments: quiz(keep) }] }
}

fn says(words: &str) -> AgentReply {
	AgentReply { text: Some(words.to_owned()), tool_calls: Vec::new() }
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

async fn send(app: &Arc<App>, chat_id: &str, input: ChatInput) {
	let reply = handle_chat_input(app, chat_id, TurnInput::Chat(input)).await;
	assert_eq!(reply.status, 200, "{}", reply.text());
}

fn text(words: &str) -> ChatInput {
	ChatInput::Text { text: words.to_owned(), attachments: None, about: None }
}

fn right(tool_call_id: &str) -> ChatInput {
	let answer = json!({ "kind": "quiz", "dontKnow": false, "correct": true, "answers": [{ "index": 2, "label": "6", "value": "B" }], "confidence": 80 });
	ChatInput::Answer { tool_call_id: tool_call_id.to_owned(), answer, attachments: None }
}

/// A Study lesson on Regularization whose learner asked to start.
async fn study_lesson(app: &Arc<App>) -> String {
	let chat_id = app.stores.chats.create_chat("Study for Midterm", Some("study"), None, None).unwrap()["id"].as_str().unwrap().to_owned();
	let tree = json!({ "nodes": [{ "id": "reg", "title": "Regularization" }], "edges": [] });
	app.stores.chats.save_tree(&chat_id, &tree).unwrap();
	send(app, &chat_id, text("Teach me Regularization.")).await;
	chat_id
}

fn messages(app: &App, chat_id: &str) -> Vec<Json> {
	app.stores.chats.get_chat(chat_id).unwrap()["messages"].as_arr().unwrap().clone()
}

/// The newest quiz call in the record.
fn last_quiz(record: &[Json]) -> Json {
	record.iter().rev().flat_map(|m| m["content"].as_arr().into_iter().flatten()).find(|b| b["type"].as_str() == Some("toolCall") && b["name"].as_str() == Some("quiz")).unwrap().clone()
}

fn verdict_of(record: &[Json], quiz_call_id: &Json) -> Json {
	record.iter().find(|m| m["customType"].as_str() == Some("keep-check") && &m["details"]["quizCallId"] == quiz_call_id).expect("a verdict")["details"].clone()
}

/// Every line the agent was sent that starts with `prefix`.
fn lines_seen(seen: &[Json], prefix: &str) -> Vec<String> {
	let text = stringify(&Json::Arr(seen.to_vec()));
	let found: Vec<String> = seen.iter().filter_map(|m| m["text"].as_str()).flat_map(str::lines).filter(|l| l.starts_with(prefix)).map(str::to_owned).collect();
	assert!(!text.contains("keep-check") && !text.contains("analogy-drop"), "no marker reaches the agent");
	found
}

#[tokio::test(flavor = "multi_thread")]
async fn a_keep_over_its_cap_poses_its_quiz_and_the_teacher_reads_why_after_his_answer() {
	let fx = Fixture::new();
	let chat_id = study_lesson(&fx.app).await;
	let long = json!({ "text": "x".repeat(212) });
	answer(&fx.app, &chat_id, asks("So how far does it move?", long.clone())).await;
	// A refused quiz would wait for a work item that never comes.
	settled(&fx.app, &chat_id).await;

	let record = messages(&fx.app, &chat_id);
	let call = last_quiz(&record);
	assert_eq!(call["arguments"], quiz(long), "the stored call is the call as sent");
	let note = "keep not stored: text 212 characters, at most 160. Add it to a later quiz.";
	assert_eq!(verdict_of(&record, &call["id"]), json!({ "quizCallId": call["id"], "keep": "dropped", "fits": false, "phrase": false, "note": note }));

	send(&fx.app, &chat_id, right(call["id"].as_str().unwrap())).await;
	let seen = answer(&fx.app, &chat_id, says("Right, it scales with y.")).await;
	settled(&fx.app, &chat_id).await;
	let at = seen.iter().position(|m| m["toolCallId"] == call["id"]).expect("his answer");
	assert_eq!(seen[at + 1]["text"], json!(note), "right after the answer's result");
	assert_eq!(lines_seen(&seen, "keep not stored").len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_dropped_analogy_reaches_the_teacher_once_and_not_when_brought_back() {
	let fx = Fixture::new();
	let chat_id = study_lesson(&fx.app).await;
	answer(&fx.app, &chat_id, asks("So how far does it move?", leash())).await;
	settled(&fx.app, &chat_id).await;
	let record = messages(&fx.app, &chat_id);
	let call = last_quiz(&record);
	assert_eq!(verdict_of(&record, &call["id"]), json!({ "quizCallId": call["id"], "keep": "shown", "fits": true, "phrase": false }));
	let of = call["id"].as_str().unwrap();
	assert_eq!(drop_kept_part(&fx.app, &chat_id, of, KeptPart::Analogy, false), Ok(KeptDrop::NoSuchPart), "not seen before his answer");

	send(&fx.app, &chat_id, right(of)).await;
	assert_eq!(drop_kept_part(&fx.app, &chat_id, of, KeptPart::Analogy, false), Ok(KeptDrop::Done), "during the turn");
	let seen = answer(&fx.app, &chat_id, says("Next, how lambda is picked.")).await;
	settled(&fx.app, &chat_id).await;
	assert!(lines_seen(&seen, "[Analogy dropped]").is_empty(), "the drop came after this input");

	send(&fx.app, &chat_id, text("How is it picked?")).await;
	let seen = answer(&fx.app, &chat_id, says("On a validation split.")).await;
	settled(&fx.app, &chat_id).await;
	assert_eq!(lines_seen(&seen, "[Analogy dropped]"), ["[Analogy dropped] Regularization: \"The leash fits one part\""]);

	send(&fx.app, &chat_id, text("And then?")).await;
	let seen = answer(&fx.app, &chat_id, says("Then we split again.")).await;
	settled(&fx.app, &chat_id).await;
	assert_eq!(lines_seen(&seen, "[Analogy dropped]").len(), 1, "told once");

	assert_eq!(drop_kept_part(&fx.app, &chat_id, of, KeptPart::Analogy, true), Ok(KeptDrop::Done));
	assert_eq!(drop_kept_part(&fx.app, &chat_id, of, KeptPart::Analogy, false), Ok(KeptDrop::Done));
	assert_eq!(drop_kept_part(&fx.app, &chat_id, of, KeptPart::Analogy, true), Ok(KeptDrop::Done));
	send(&fx.app, &chat_id, text("One more?")).await;
	let seen = answer(&fx.app, &chat_id, says("Sure.")).await;
	settled(&fx.app, &chat_id).await;
	assert_eq!(lines_seen(&seen, "[Analogy dropped]").len(), 1, "brought back before his input: no new line");
}
