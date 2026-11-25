//! The pass that writes a lesson's notes, end to end against a stand-in agent: the block rides the
//! topic grouping, or goes as a job of its own when no grouping took it in time, a lesson that is
//! left or found at the start is sent once, the keys follow the record once a day, and the
//! "My words" asks stop at three and at two skips.

use std::path::PathBuf;
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::{clock, ids, time};
use gs_json::{Json, json};
use gs_runtime::fake::{FakeAgent, FakeStep};
use gs_services::App;
use gs_services::app::agents::use_runtime;
use gs_services::turns::catch_up;
use gs_services::vault::{Ask, AskReply, answer_ask, change_vault, lesson_left, lesson_vault_notes, minute_check, queue_lesson, reviewed, send_waiting, take_block};
use gs_store::graph::Ledger;

/// The tests move the app clock, which every test in this file shares, so they run one at a time.
static ONE_AT_A_TIME: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

struct Fixture {
	_one_at_a_time: parking_lot::MutexGuard<'static, ()>,
	app: Arc<App>,
	/// The learner's agent.
	agent: FakeAgent,
	dir: PathBuf,
	vault: PathBuf,
	space_id: String,
}

impl Fixture {
	/// A space "CSE 21" with the `(id, name)` topics and an empty vault picked.
	fn new(topics: &[(&str, &str)]) -> Fixture {
		let one_at_a_time = ONE_AT_A_TIME.lock();
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
		let agent = FakeAgent::default();
		use_runtime(&app, agent.runtime());
		Fixture { _one_at_a_time: one_at_a_time, app, agent, dir, vault, space_id }
	}

	/// No topic grouping came for the space's waiting block in time, so it goes on its own.
	fn grouping_wait_over(&self) {
		clock::advance(GROUPING_WAIT_MS);
		send_waiting(&self.app);
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

	/// The agent's next job writes the topics' notes, then says it is done.
	fn will_write(&self, topics: &[&str]) {
		let calls: Vec<(String, Json)> = topics.iter().map(|topic| ("write_vault_note".to_owned(), json!({ "topic_id": topic, "text": format!("What {topic} is."), "recall": format!("Say what {topic} is?") }))).collect();
		let writes = (!calls.is_empty()).then_some(FakeStep::Calls(calls));
		self.agent.push(writes.into_iter().chain([FakeStep::Text("Done.".to_owned())]).collect());
	}

	/// The jobs that ran on the agent: their tools and what each was asked.
	fn jobs(&self) -> Vec<(Vec<String>, String)> {
		let sent = self.agent.sent();
		let opens = sent.iter().filter(|m| m["type"].as_str() == Some("open"));
		opens
			.map(|open| {
				let tools = open["tools"].items().iter().filter_map(|t| t["name"].as_str().map(str::to_owned)).collect();
				let asked = sent.iter().find(|m| m["type"].as_str() == Some("send") && m["session"] == open["session"]).map(|m| m["content"][0]["text"].str_or_empty().to_owned());
				(tools, asked.unwrap_or_default())
			})
			.collect()
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

/// How long a waiting block waits for a topic grouping.
const GROUPING_WAIT_MS: i64 = 3 * 60_000;

/// Gives any job started a moment to run.
async fn settle() {
	clock::sleep(100).await;
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

#[tokio::test]
async fn a_block_no_grouping_took_goes_as_a_job_of_its_own() {
	let f = Fixture::new(&[("t1", "Binary search"), ("t2", "Pigeonhole")]);
	let chat = f.lesson(&["t1", "t2"]);
	f.will_write(&["t1", "t2"]);
	queue_lesson(&f.app, &chat);
	settle().await;
	assert!(f.jobs().is_empty() && f.passes()[chat.as_str()].is_null(), "the block waits for the grouping");
	f.grouping_wait_over();
	sent(&f, &chat).await;
	let (tools, block) = f.jobs().remove(0);
	assert_eq!(tools, ["write_vault_note"]);
	assert!(block.contains("[Vault notes] One write_vault_note per idea") && block.contains("Binary search") && block.contains(r#"wrong: "Question on t1 a?""#), "{block}");
	assert!(f.note_file("Binary search.md").contains("What t1 is."));
	let record = f.app.stores.vault_notes.read();
	assert_eq!(record["notes"]["t1"]["mistakeIds"].items().len(), 0, "the agent sent no mistake, so none is marked");

	queue_lesson(&f.app, &chat);
	settle().await;
	assert_eq!(f.jobs().len(), 1, "sent once");
}

#[tokio::test]
async fn the_grouping_takes_the_block_and_a_failed_run_waits_before_it_is_offered_again() {
	let f = Fixture::new(&[("t1", "Binary search")]);
	let chat = f.lesson(&["t1"]);
	queue_lesson(&f.app, &chat);
	send_waiting(&f.app);
	settle().await;
	assert!(f.jobs().is_empty() && f.passes()[chat.as_str()].is_null(), "nothing was sent on its own");

	let taken = take_block(&f.app, &f.space_id).await.expect("the grouping takes the block");
	assert!(taken.riding().block.contains("Binary search"));
	assert!(take_block(&f.app, &f.space_id).await.is_none(), "taken once");
	taken.done(&f.app, false);
	assert!(f.passes()[chat.as_str()].is_null());
	assert!(take_block(&f.app, &f.space_id).await.is_none(), "a failed run waits before it is offered again");
}

#[tokio::test]
async fn a_grouping_that_carried_the_block_marks_the_lesson_sent() {
	let f = Fixture::new(&[("t1", "Binary search")]);
	let chat = f.lesson(&["t1"]);
	queue_lesson(&f.app, &chat);
	take_block(&f.app, &f.space_id).await.unwrap().done(&f.app, true);
	assert!(f.passes()[chat.as_str()].as_str().is_some());
}

#[tokio::test]
async fn leaving_a_lesson_sends_it_once() {
	let f = Fixture::new(&[("t1", "Binary search")]);
	let chat = f.lesson(&["t1"]);
	f.will_write(&[]);
	lesson_left(&f.app, Some(&format!("/chat/{chat}")), Some(&format!("/chat/{chat}")));
	lesson_left(&f.app, Some("/progress"), Some("/home"));
	settle().await;
	assert!(f.passes()[chat.as_str()].is_null(), "still in the lesson, or never in one");
	lesson_left(&f.app, Some(&format!("/chat/{chat}")), Some("/progress"));
	f.grouping_wait_over();
	sent(&f, &chat).await;
	assert_eq!(f.jobs().len(), 1);
}

#[tokio::test]
async fn a_lesson_found_at_the_start_is_sent_once() {
	let g = Fixture::new(&[("t1", "Binary search")]);
	let found = g.lesson(&["t1"]);
	g.will_write(&[]);
	catch_up(&g.app);
	g.grouping_wait_over();
	sent(&g, &found).await;
	catch_up(&g.app);
	settle().await;
	assert_eq!(g.jobs().len(), 1, "found once");
}

#[tokio::test]
async fn no_vault_means_no_pass() {
	let f = Fixture::new(&[("t1", "Binary search")]);
	change_vault(&f.app, &json!({ "path": null })).unwrap();
	let chat = f.lesson(&["t1"]);
	queue_lesson(&f.app, &chat);
	f.grouping_wait_over();
	settle().await;
	assert!(f.jobs().is_empty());
}

#[tokio::test]
async fn the_keys_follow_the_record_once_a_day_and_again_after_a_review() {
	let f = Fixture::new(&[("t1", "Binary search")]);
	let chat = f.lesson(&["t1"]);
	f.will_write(&["t1"]);
	queue_lesson(&f.app, &chat);
	f.grouping_wait_over();
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
	f.will_write(&["t1", "t2", "t3", "t4"]);
	queue_lesson(&f.app, &chat);
	f.grouping_wait_over();
	sent(&f, &chat).await;
	assert!(f.jobs()[0].1.contains("Mode: learner adds My words"));

	let view = lesson_vault_notes(&f.app, &chat).unwrap().unwrap();
	assert_eq!(view["pages"].items().len(), 4);
	assert_eq!(view["pages"][0]["kind"].as_str(), Some("godspeed"));
	assert_eq!(view["asks"].items().len(), 3, "at most three asks");
	assert_eq!(view["asks"][0]["maxLength"].as_i64(), Some(600), "each ask says how long the words may be");
	let asked: Vec<String> = view["asks"].items().iter().map(|a| a["topicId"].as_str().unwrap().to_owned()).collect();

	assert!(matches!(answer_ask(&f.app, &chat, &asked[0], Ask::Words("It halves the range.".to_owned())).unwrap(), AskReply::Done));
	assert!(f.vault.join("CSE 21").read_dir().unwrap().flatten().any(|e| std::fs::read_to_string(e.path()).unwrap().contains("## My words\nIt halves the range.")));
	assert!(matches!(answer_ask(&f.app, &chat, &asked[0], Ask::Skip).unwrap(), AskReply::NotAsked), "answered once");
	assert!(matches!(answer_ask(&f.app, &chat, &asked[1], Ask::Words(String::new())).unwrap(), AskReply::Refused(_)));
	assert!(matches!(answer_ask(&f.app, &chat, &asked[1], Ask::Skip).unwrap(), AskReply::Done));

	// The next passes ride the topic grouping.
	f.answer_wrong(&chat, &[asked[1].as_str()], "b");
	queue_lesson(&f.app, &chat);
	take_block(&f.app, &f.space_id).await.expect("the grouping takes the block").done(&f.app, true);
	assert!(lesson_vault_notes(&f.app, &chat).unwrap().unwrap()["asks"].items().iter().any(|a| a["topicId"].as_str() == Some(asked[1].as_str())));
	assert!(matches!(answer_ask(&f.app, &chat, &asked[1], Ask::Skip).unwrap(), AskReply::Done), "skipped once, asked again, skipped again");

	f.answer_wrong(&chat, &[asked[1].as_str()], "c");
	queue_lesson(&f.app, &chat);
	take_block(&f.app, &f.space_id).await.expect("the grouping takes the block").done(&f.app, true);
	let view = lesson_vault_notes(&f.app, &chat).unwrap().unwrap();
	assert!(view["asks"].items().iter().all(|a| a["topicId"].as_str() != Some(asked[1].as_str())), "skipped twice: never again");
}
