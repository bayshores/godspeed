//! A chat on a stand-in agent (gs-runtime's FakeAgent), for tests: whole turns through the chat
//! handler, the record they leave, and what the agent was sent. A lesson by default; kind "talk"
//! makes a talk chat.

use std::sync::Arc;

use gs_base::clock;
use gs_core::messages::input_events::{ChatInput, TurnInput};
use gs_core::messages::role::Role;
use gs_json::{Json, json};
use gs_runtime::Runtime;
use gs_runtime::fake::{FakeAgent, FakeStep};

use super::chat_handler::handle_chat_input;
use super::turn_liveness::is_turn_running;
use super::turn_work::lesson_work;
use crate::App;
use crate::app::agent_folder::set_folder_agent;
use crate::app::agents::use_runtime;
use crate::app::test_support::{Scratch, scratch_dir, test_app};

pub(crate) struct Lesson {
	pub app: Arc<App>,
	pub agent: FakeAgent,
	pub chat_id: String,
	_root: Scratch,
}

pub(crate) fn text(text: &str) -> FakeStep {
	FakeStep::Text(text.to_owned())
}

pub(crate) fn tool(name: &str, args: Json) -> FakeStep {
	FakeStep::Tool { name: name.to_owned(), args }
}

pub(crate) fn bash() -> FakeStep {
	FakeStep::Approval { tool: "Bash".to_owned(), input: json!({ "command": "ls" }) }
}

/// A lesson of `kind` whose agent plays `turns`, as Claude Code.
pub(crate) fn lesson(label: &str, kind: Option<&str>, turns: Vec<Vec<FakeStep>>) -> Lesson {
	lesson_on(label, kind, turns, FakeAgent::runtime)
}

/// A lesson of `kind` whose agent plays `turns` on the runtime `runtime` makes.
pub(crate) fn lesson_on(label: &str, kind: Option<&str>, turns: Vec<Vec<FakeStep>>, runtime: fn(&FakeAgent) -> Runtime) -> Lesson {
	let root = scratch_dir(label);
	let app = test_app(&root);
	lesson_in(app, root, kind, turns, runtime)
}

/// A lesson of `kind` in `app` whose agent plays `turns` on the runtime `runtime` makes.
pub(crate) fn lesson_in(app: Arc<App>, root: Scratch, kind: Option<&str>, turns: Vec<Vec<FakeStep>>, runtime: fn(&FakeAgent) -> Runtime) -> Lesson {
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
	pub async fn say(&self, words: &str) {
		let reply = handle_chat_input(&self.app, &self.chat_id, TurnInput::Chat(ChatInput::Text { text: words.to_owned(), attachments: None, about: None })).await;
		assert!(reply.ok(), "{}", reply.text());
	}

	pub async fn settled(&self) {
		for _ in 0..500 {
			if !is_turn_running(&self.app, &self.chat_id) {
				return;
			}
			clock::sleep(10).await;
		}
		panic!("the turn never settled");
	}

	pub fn record(&self) -> Json {
		self.app.stores.chats.get_chat(&self.chat_id).unwrap()
	}

	pub fn messages(&self) -> Vec<Json> {
		self.record()["messages"].as_arr().cloned().unwrap()
	}

	/// The words of the lesson's assistant messages, in order.
	pub fn replies(&self) -> Vec<String> {
		let messages = self.messages();
		messages.iter().filter(|m| Role::Assistant.is(m)).flat_map(|m| m["content"].items().iter().filter_map(|b| b["text"].as_str().map(str::to_owned)).collect::<Vec<_>>()).collect()
	}

	/// What the agent was sent of each type, in order.
	pub fn sent(&self, kind: &str) -> Vec<Json> {
		self.agent.sent().into_iter().filter(|m| m["type"].as_str() == Some(kind)).collect()
	}

	/// What the Codex agent was sent as JSON-RPC `method`, in order.
	pub fn requests(&self, method: &str) -> Vec<Json> {
		self.agent.sent().into_iter().filter(|m| m["method"].as_str() == Some(method)).collect()
	}

	/// The words of each turn the agent was sent.
	pub fn sends(&self) -> Vec<String> {
		self.sent("send").iter().map(|m| m["content"].items().iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join("\n")).collect()
	}

	/// The permission question the turn waits on.
	pub async fn approval(&self) -> String {
		for _ in 0..500 {
			if let Some(id) = lesson_work(&self.app, &self.chat_id).and_then(|w| w["approvals"][0]["id"].as_str().map(str::to_owned)) {
				return id;
			}
			clock::sleep(10).await;
		}
		panic!("no permission question came");
	}
}
