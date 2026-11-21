//! The pass that writes a lesson's notes, end to end against a stand-in agent on the bridge: the
//! block goes as the teacher's own item when no helper is here and rides the topic grouping when
//! one is, a lesson that is left or found at the start is sent once, the keys follow the record
//! once a day, and the "My words" asks stop at three and at two skips.

use std::path::PathBuf;
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::{clock, ids, time};
use gs_engine::bridge::{AgentReply, ReplyCall, WaitOptions, WorkView};
use gs_json::{Json, json};
use gs_services::App;
use gs_services::turns::agent_catch_up::catch_up_for_agent;
use gs_services::vault::{Ask, AskReply, answer_ask, change_vault, lesson_left, lesson_vault_notes, minute_check, queue_lesson, reviewed, send_waiting, take_for_grouping};
use gs_store::graph::Ledger;

struct Fixture {
	app: Arc<App>,
	dir: PathBuf,
	vault: PathBuf,
	space_id: String,
}

impl Fixture {
	/// A space "CSE 21" with the `(id, name)` topics and an empty vault picked.
	fn new(topics: &[(&str, &str)]) -> Fixture {
		let dir = std::env::temp_dir().join(format!("gs-vault-pass-{}", ids::uuid()));
		for name in ["data", "home", "tmp", "res", "Notes"] {
			std::fs::create_dir_all(dir.join(name)).unwrap();
		}
		let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.join("res")), None);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "CSE 21" })).unwrap()["id"].as_str().unwrap().to_owned();
		let at = time::iso(clock::now_ms());
		let mut snapshot = Vec::new();
		for (id, name) in topics {
			let fact = json!({ "id": format!("f_{id}"), "name": name, "statement": name, "createdAt": at, "aliases": [], "provenance": [] });
			app.stores.graphs.append(Some(&space_id), Ledger::Nodes, &fact).unwrap();
			snapshot.push(json!({ "id": id, "name": name, "members": [format!("f_{id}")] }));
		}
		app.stores.graphs.append(Some(&space_id), Ledger::Topics, &json!({ "at": at, "topics": snapshot })).unwrap();
		let vault = dir.join("Notes");
		change_vault(&app, &json!({ "path": vault.to_string_lossy() })).unwrap();
		Fixture { app, dir, vault, space_id }
	}

	/// A lesson of this space in which each topic's question was answered wrong.
	fn lesson(&self, topics: &[&str]) -> String {
		let chat_id = self.app.stores.chats.create_chat("Study", Some("study"), Some(&self.space_id), None, &[]).unwrap()["id"].as_str().unwrap().to_owned();
		self.app.stores.chats.set_vault_picked(&chat_id, true).unwrap();
		self.answer_wrong(&chat_id, topics, "a");
		chat_id
	}

	fn answer_wrong(&self, chat_id: &str, topics: &[&str], tag: &str) {
		let mut messages = self.app.stores.chats.get_chat(chat_id).unwrap()["messages"].as_arr().cloned().unwrap_or_default();
		for topic in topics {
			let call = format!("q-{topic}-{tag}");
			let details = json!({ "kind": "quiz", "dontKnow": false, "correct": false, "answers": [], "questionText": format!("Question on {topic} {tag}?"), "answeredAt": time::iso(clock::now_ms()) });
			messages.extend([
				json!({ "role": "assistant", "id": format!("m-{call}"), "content": [{ "type": "toolCall", "id": call, "name": "quiz", "arguments": { "nodeId": topic, "type": "check", "question": "?" } }], "timestamp": clock::now_ms() }),
				json!({ "role": "toolResult", "toolCallId": call, "toolName": "quiz", "details": details, "isError": false, "timestamp": clock::now_ms() }),
			]);
		}
		self.app.stores.chats.save_messages(chat_id, &messages).unwrap();
	}

	fn passes(&self) -> Json {
		self.app.stores.vault_notes.read()["passes"].clone()
	}

	fn write_call(&self, topic: &str) -> ReplyCall {
		ReplyCall { name: "write_vault_note".to_owned(), arguments: json!({ "topic_id": topic, "text": format!("What {topic} is."), "recall": format!("Say what {topic} is?") }) }
	}

	fn note_file(&self, name: &str) -> String {
		std::fs::read_to_string(self.vault.join("CSE 21").join(name)).unwrap()
	}
}

impl Drop for Fixture {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.dir);
	}
}

async fn answer(app: &App, helper: bool, reply: AgentReply) -> WorkView {
	let view = app.bridge.wait_for_work(10_000, WaitOptions { full: true, helper, ..WaitOptions::default() }).await.expect("a work item");
	app.bridge.respond_to_work(&view.work_id, reply, 0).unwrap();
	view
}

async fn no_item(app: &App, helper: bool) {
	assert!(app.bridge.wait_for_work(100, WaitOptions { helper, ..WaitOptions::default() }).await.is_none(), "no work item should wait");
}

/// Waits until the lesson's pass is marked sent.
async fn sent(f: &Fixture, chat_id: &str) {
	for _ in 0..2000 {
		if f.passes()[chat_id].as_str().is_some() {
			return;
		}
		clock::sleep(5).await;
	}
	panic!("the pass was never marked sent");
}

fn block_of(view: &WorkView) -> String {
	gs_json::stringify(&Json::Arr(view.messages.clone()))
}

#[tokio::test]
async fn with_no_helper_the_block_goes_as_the_teachers_own_item_once() {
	let f = Fixture::new(&[("t1", "Binary search"), ("t2", "Pigeonhole")]);
	let chat = f.lesson(&["t1", "t2"]);
	queue_lesson(&f.app, &chat);
	let first = answer(&f.app, false, AgentReply { text: None, tool_calls: vec![f.write_call("t1"), f.write_call("t2")] }).await;
	assert_eq!(first.label.as_deref(), Some("Notes: CSE 21"));
	let tools: Vec<&str> = first.tools.iter().flatten().filter_map(|t| t["name"].as_str()).collect();
	assert_eq!(tools, ["write_vault_note"]);
	let block = block_of(&first);
	assert!(block.contains("[Vault notes] One write_vault_note per idea") && block.contains("Binary search") && block.contains("wrong: \\\"Question on t1 a?\\\""), "{block}");
	answer(&f.app, false, AgentReply { text: Some("Wrote both notes.".to_owned()), tool_calls: Vec::new() }).await;
	sent(&f, &chat).await;
	assert!(f.note_file("Binary search.md").contains("What t1 is."));
	let record = f.app.stores.vault_notes.read();
	assert_eq!(record["notes"]["t1"]["mistakeIds"].items().len(), 0, "the agent sent no mistake, so none is marked");

	queue_lesson(&f.app, &chat);
	no_item(&f.app, false).await;
}

#[tokio::test]
async fn with_a_helper_here_the_block_waits_for_the_grouping_and_a_failed_run_waits_before_it_is_offered_again() {
	let f = Fixture::new(&[("t1", "Binary search")]);
	let chat = f.lesson(&["t1"]);
	no_item(&f.app, true).await;
	queue_lesson(&f.app, &chat);
	send_waiting(&f.app);
	no_item(&f.app, false).await;
	assert!(f.passes()[chat.as_str()].is_null(), "nothing was sent on its own");

	let taken = take_for_grouping(&f.app, &f.space_id).await.expect("the grouping takes the block");
	assert!(taken.riding().block.contains("Binary search"));
	assert!(take_for_grouping(&f.app, &f.space_id).await.is_none(), "taken once");
	taken.done(&f.app, false);
	assert!(f.passes()[chat.as_str()].is_null());
	assert!(take_for_grouping(&f.app, &f.space_id).await.is_none(), "a failed run waits before it is offered again");

}

#[tokio::test]
async fn a_grouping_that_carried_the_block_marks_the_lesson_sent() {
	let f = Fixture::new(&[("t1", "Binary search")]);
	let chat = f.lesson(&["t1"]);
	no_item(&f.app, true).await;
	queue_lesson(&f.app, &chat);
	take_for_grouping(&f.app, &f.space_id).await.unwrap().done(&f.app, true);
	assert!(f.passes()[chat.as_str()].as_str().is_some());
}

#[tokio::test]
async fn leaving_a_lesson_or_finding_one_at_the_start_sends_it_once() {
	let f = Fixture::new(&[("t1", "Binary search")]);
	let chat = f.lesson(&["t1"]);
	lesson_left(&f.app, Some(&format!("/chat/{chat}")), Some(&format!("/chat/{chat}")));
	no_item(&f.app, false).await;
	lesson_left(&f.app, Some("/progress"), Some("/home"));
	no_item(&f.app, false).await;
	lesson_left(&f.app, Some(&format!("/chat/{chat}")), Some("/progress"));
	answer(&f.app, false, AgentReply { text: Some("Done.".to_owned()), tool_calls: Vec::new() }).await;
	sent(&f, &chat).await;

	let g = Fixture::new(&[("t1", "Binary search")]);
	let found = g.lesson(&["t1"]);
	catch_up_for_agent(&g.app, clock::now_ms());
	let view = answer(&g.app, false, AgentReply { text: Some("Done.".to_owned()), tool_calls: Vec::new() }).await;
	assert_eq!(view.label.as_deref(), Some("Notes: CSE 21"));
	sent(&g, &found).await;
	catch_up_for_agent(&g.app, clock::now_ms());
	no_item(&g.app, false).await;
}

#[tokio::test]
async fn no_vault_means_no_pass() {
	let f = Fixture::new(&[("t1", "Binary search")]);
	change_vault(&f.app, &json!({ "path": null })).unwrap();
	let chat = f.lesson(&["t1"]);
	queue_lesson(&f.app, &chat);
	no_item(&f.app, false).await;
}

#[tokio::test]
async fn the_keys_follow_the_record_once_a_day_and_again_after_a_review() {
	let f = Fixture::new(&[("t1", "Binary search")]);
	let chat = f.lesson(&["t1"]);
	queue_lesson(&f.app, &chat);
	answer(&f.app, false, AgentReply { text: None, tool_calls: vec![f.write_call("t1")] }).await;
	answer(&f.app, false, AgentReply { text: Some("Done.".to_owned()), tool_calls: Vec::new() }).await;
	sent(&f, &chat).await;
	minute_check(&f.app);
	assert!(f.note_file("Binary search.md").contains("answered: 0 of 1 right"));
	f.answer_wrong(&chat, &["t1"], "b");
	minute_check(&f.app);
	assert!(f.note_file("Binary search.md").contains("answered: 0 of 1 right"), "once a day: the first check already ran");
	reviewed(&f.app, &f.space_id);
	minute_check(&f.app);
	assert!(f.note_file("Binary search.md").contains("answered: 0 of 2 right"), "a review asks for the keys again");
}

#[tokio::test]
async fn the_asks_stop_at_three_and_a_skipped_note_is_asked_once_more_then_never() {
	let f = Fixture::new(&[("t1", "A"), ("t2", "B"), ("t3", "C"), ("t4", "D")]);
	change_vault(&f.app, &json!({ "words": "mine" })).unwrap();
	let chat = f.lesson(&["t1", "t2", "t3", "t4"]);
	queue_lesson(&f.app, &chat);
	let calls = ["t1", "t2", "t3", "t4"].iter().map(|t| f.write_call(t)).collect();
	let first = answer(&f.app, false, AgentReply { text: None, tool_calls: calls }).await;
	assert!(block_of(&first).contains("Mode: learner adds My words"));
	answer(&f.app, false, AgentReply { text: Some("Done.".to_owned()), tool_calls: Vec::new() }).await;
	sent(&f, &chat).await;

	let view = lesson_vault_notes(&f.app, &chat).unwrap().unwrap();
	assert_eq!(view["pages"].items().len(), 4);
	assert_eq!(view["asks"].items().len(), 3, "at most three asks");
	assert_eq!(view["asks"][0]["maxLength"].as_i64(), Some(600), "each ask says how long the words may be");
	let asked: Vec<String> = view["asks"].items().iter().map(|a| a["topicId"].as_str().unwrap().to_owned()).collect();

	assert!(matches!(answer_ask(&f.app, &chat, &asked[0], Ask::Words("It halves the range.".to_owned())).unwrap(), AskReply::Done));
	assert!(f.vault.join("CSE 21").read_dir().unwrap().flatten().any(|e| std::fs::read_to_string(e.path()).unwrap().contains("## My words\nIt halves the range.")));
	assert!(matches!(answer_ask(&f.app, &chat, &asked[0], Ask::Skip).unwrap(), AskReply::NotAsked), "answered once");
	assert!(matches!(answer_ask(&f.app, &chat, &asked[1], Ask::Words(String::new())).unwrap(), AskReply::Refused(_)));
	assert!(matches!(answer_ask(&f.app, &chat, &asked[1], Ask::Skip).unwrap(), AskReply::Done));

	f.answer_wrong(&chat, &[asked[1].as_str()], "b");
	queue_lesson(&f.app, &chat);
	answer(&f.app, false, AgentReply { text: Some("Done.".to_owned()), tool_calls: Vec::new() }).await;
	for _ in 0..2000 {
		if lesson_vault_notes(&f.app, &chat).unwrap().unwrap()["asks"].items().iter().any(|a| a["topicId"].as_str() == Some(asked[1].as_str())) {
			break;
		}
		clock::sleep(5).await;
	}
	assert!(matches!(answer_ask(&f.app, &chat, &asked[1], Ask::Skip).unwrap(), AskReply::Done), "skipped once, asked again, skipped again");

	f.answer_wrong(&chat, &[asked[1].as_str()], "c");
	queue_lesson(&f.app, &chat);
	answer(&f.app, false, AgentReply { text: Some("Done.".to_owned()), tool_calls: Vec::new() }).await;
	clock::sleep(300).await;
	let view = lesson_vault_notes(&f.app, &chat).unwrap().unwrap();
	assert!(view["asks"].items().iter().all(|a| a["topicId"].as_str() != Some(asked[1].as_str())), "skipped twice: never again");
}
