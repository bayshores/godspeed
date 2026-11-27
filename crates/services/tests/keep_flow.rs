//! Kept sentences, end to end against a stand-in agent (gs-runtime's FakeAgent): a keep that
//! breaks its own rules never refuses its quiz, the call is stored as sent and the teacher reads
//! why right after his answer; a stored keep gets its verdict when the turn is saved; dropping its
//! analogy during a turn reaches the teacher as one [Analogy dropped] line on his next input, and
//! none when he brought it back first; no keep-check or drop marker ever reaches the agent; only a
//! Study lesson stores verdicts.

use std::path::PathBuf;
use std::sync::Arc;

use gs_base::clock;
use gs_base::config::Paths;
use gs_base::ids;
use gs_core::messages::input_events::{ChatInput, TurnInput};
use gs_core::messages::native_messages::SIDE_ANSWER_LEAD;
use gs_core::messages::role::is_custom;
use gs_core::study::kept::KeptPart;
use gs_json::{Json, json, stringify};
use gs_runtime::fake::{FakeAgent, FakeStep};
use gs_services::App;
use gs_services::app::agents::use_runtime;
use gs_services::turns::lesson_events::{KeptDrop, drop_kept_part};
use gs_services::turns::turn_service::persist_turn;
use gs_services::turns::turn_work::lesson_work;
use gs_services::turns::{answer_approval, every_turn_rules_for, handle_chat_input, is_turn_running};

/// An app over a fresh folder whose lessons run on a stand-in agent, removed when dropped.
struct Fixture {
	app: Arc<App>,
	agent: FakeAgent,
	dir: PathBuf,
}

impl Fixture {
	fn new() -> Fixture {
		let dir = std::env::temp_dir().join(format!("gs-keep-flow-{}", ids::uuid()));
		for name in ["data", "home", "tmp", "res"] {
			std::fs::create_dir_all(dir.join(name)).unwrap();
		}
		let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.join("res")), None);
		let agent = FakeAgent::default();
		use_runtime(&app, agent.runtime());
		Fixture { app, agent, dir }
	}

	/// His input; the turn it starts plays `turn` to its end.
	async fn turn(&self, chat_id: &str, input: ChatInput, turn: Vec<FakeStep>) {
		self.agent.push(turn);
		self.send(chat_id, input).await;
		self.settled(chat_id).await;
	}

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

	/// The text parts of each turn the agent was sent; none names a marker.
	fn sends(&self) -> Vec<Vec<String>> {
		let sends: Vec<Json> = self.agent.sent().into_iter().filter(|m| m["type"].as_str() == Some("send")).collect();
		let all = stringify(&Json::Arr(sends.clone()));
		assert!(!all.contains("keep-check") && !all.contains("analogy-drop"), "no marker reaches the agent");
		sends.iter().map(|m| m["content"].items().iter().filter_map(|p| p["text"].as_str().map(str::to_owned)).collect()).collect()
	}

	/// The text parts of the last turn the agent was sent, without the learner's rules that close
	/// every turn of a session that goes on.
	fn input(&self, chat_id: &str) -> Vec<String> {
		let mut parts = self.sends().pop().expect("a turn was sent");
		let rules = every_turn_rules_for(&self.app, &self.app.stores.chats.get_chat(chat_id).unwrap(), &self.app.stores.settings.effective_settings().unwrap(), true);
		if parts.last() == Some(&rules) {
			parts.pop();
		}
		parts
	}

	/// Every line the agent was sent in its turns that starts with `prefix`.
	fn lines_sent(&self, prefix: &str) -> Vec<String> {
		self.sends().concat().iter().flat_map(|p| p.lines()).filter(|l| l.starts_with(prefix)).map(str::to_owned).collect()
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

/// The teacher's words, then its quiz carrying `keep`.
fn asks(words: &str, keep: Json) -> Vec<FakeStep> {
	vec![says(words), FakeStep::Tool { name: "quiz".to_owned(), args: quiz(keep) }]
}

fn says(words: &str) -> FakeStep {
	FakeStep::Text(words.to_owned())
}

/// A permission question: the turn waits there until the test answers it.
fn pause() -> FakeStep {
	FakeStep::Approval { tool: "Bash".to_owned(), input: json!({ "command": "ls" }) }
}

fn text(words: &str) -> ChatInput {
	ChatInput::Text { text: words.to_owned(), attachments: None, about: None }
}

fn right(tool_call_id: &str) -> ChatInput {
	let answer = json!({ "kind": "quiz", "dontKnow": false, "correct": true, "answers": [{ "index": 2, "label": "6", "value": "B" }], "confidence": 80 });
	ChatInput::Answer { tool_call_id: tool_call_id.to_owned(), answer, attachments: None }
}

/// A Study lesson on Regularization whose learner asked to start, and the teacher's first turn.
async fn study_lesson(fx: &Fixture, first: Vec<FakeStep>) -> String {
	let chat_id = fx.app.stores.chats.create_chat("Study for Midterm", Some("study"), None, None, &[]).unwrap()["id"].as_str().unwrap().to_owned();
	let tree = json!({ "nodes": [{ "id": "reg", "title": "Regularization" }], "edges": [] });
	fx.app.stores.chats.save_tree(&chat_id, &tree).unwrap();
	fx.turn(&chat_id, text("Teach me Regularization."), first).await;
	chat_id
}

fn messages(app: &App, chat_id: &str) -> Vec<Json> {
	app.stores.chats.get_chat(chat_id).unwrap()["messages"].as_arr().unwrap().clone()
}

/// The newest quiz call in the record.
fn last_quiz(record: &[Json]) -> Json {
	record.iter().rev().flat_map(|m| m["content"].items().iter()).find(|b| b["type"].as_str() == Some("toolCall") && b["name"].as_str() == Some("quiz")).unwrap().clone()
}

fn verdict_of(record: &[Json], quiz_call_id: &Json) -> Json {
	record.iter().find(|m| is_custom(m, "keep-check") && &m["details"]["quizCallId"] == quiz_call_id).expect("a verdict")["details"].clone()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_keep_over_its_cap_poses_its_quiz_and_the_teacher_reads_why_after_his_answer() {
	let fx = Fixture::new();
	let long = json!({ "text": "x".repeat(212) });
	let chat_id = study_lesson(&fx, asks("So how far does it move?", long.clone())).await;
	let posed = fx.agent.sent().into_iter().rfind(|m| m["type"].as_str() == Some("tool_result")).unwrap();
	assert_eq!(posed["isError"], json!(false), "the keep never refuses its quiz: {posed:?}");

	let record = messages(&fx.app, &chat_id);
	let call = last_quiz(&record);
	assert_eq!(call["arguments"], quiz(long), "the stored call is the call as sent");
	let note = "keep not stored: text 212 characters, at most 160. Add it to a later quiz.";
	assert_eq!(verdict_of(&record, &call["id"]), json!({ "quizCallId": call["id"], "keep": "dropped", "fits": false, "phrase": false, "note": note }));

	fx.turn(&chat_id, right(call["id"].as_str().unwrap()), vec![says("Right, it scales with y.")]).await;
	let input = fx.input(&chat_id);
	assert_eq!(input.len(), 2, "{input:?}");
	assert!(input[0].starts_with(SIDE_ANSWER_LEAD), "his answer: {}", input[0]);
	assert_eq!(input[1], note, "right after the answer");
	assert_eq!(fx.lines_sent("keep not stored").len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_dropped_analogy_reaches_the_teacher_once_and_not_when_brought_back() {
	let fx = Fixture::new();
	let chat_id = study_lesson(&fx, asks("So how far does it move?", leash())).await;
	let record = messages(&fx.app, &chat_id);
	let call = last_quiz(&record);
	assert_eq!(verdict_of(&record, &call["id"]), json!({ "quizCallId": call["id"], "keep": "shown", "fits": true, "phrase": false }));
	let of = call["id"].as_str().unwrap();
	assert_eq!(drop_kept_part(&fx.app, &chat_id, of, KeptPart::Analogy, false), Ok(KeptDrop::NoSuchPart), "not seen before his answer");

	fx.agent.push(vec![pause(), says("Next, how lambda is picked.")]);
	fx.send(&chat_id, right(of)).await;
	let approval = fx.approval(&chat_id).await;
	assert_eq!(drop_kept_part(&fx.app, &chat_id, of, KeptPart::Analogy, false), Ok(KeptDrop::Done), "during the turn");
	assert!(answer_approval(&fx.app, &chat_id, &approval, true));
	fx.settled(&chat_id).await;
	assert!(fx.lines_sent("[Analogy dropped]").is_empty(), "the drop came after this input");

	fx.turn(&chat_id, text("How is it picked?"), vec![says("On a validation split.")]).await;
	let told: Vec<String> = fx.input(&chat_id).iter().flat_map(|p| p.lines()).filter(|l| l.starts_with("[Analogy dropped]")).map(str::to_owned).collect();
	assert_eq!(told, ["[Analogy dropped] Regularization: \"The leash fits one part\""]);

	fx.turn(&chat_id, text("And then?"), vec![says("Then we split again.")]).await;
	assert_eq!(fx.lines_sent("[Analogy dropped]").len(), 1, "told once");

	assert_eq!(drop_kept_part(&fx.app, &chat_id, of, KeptPart::Analogy, true), Ok(KeptDrop::Done));
	assert_eq!(drop_kept_part(&fx.app, &chat_id, of, KeptPart::Analogy, false), Ok(KeptDrop::Done));
	assert_eq!(drop_kept_part(&fx.app, &chat_id, of, KeptPart::Analogy, true), Ok(KeptDrop::Done));
	fx.turn(&chat_id, text("One more?"), vec![says("Sure.")]).await;
	assert_eq!(fx.lines_sent("[Analogy dropped]").len(), 1, "brought back before his input: no new line");
}

#[tokio::test(flavor = "multi_thread")]
async fn only_a_study_lesson_stores_a_verdict() {
	let fx = Fixture::new();
	for (kind, verdicts) in [(Some("study"), 1), (None, 0), (Some("practice"), 0)] {
		let chat_id = fx.app.stores.chats.create_chat("Lesson", kind, None, None, &[]).unwrap()["id"].as_str().unwrap().to_owned();
		let reply = json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "q1", "name": "quiz", "arguments": quiz(leash()) }] });
		persist_turn(&fx.app, &chat_id, 0, &[reply]).unwrap();
		let checks = messages(&fx.app, &chat_id).iter().filter(|m| is_custom(m, "keep-check")).count();
		assert_eq!(checks, verdicts, "{kind:?}");
	}
}
