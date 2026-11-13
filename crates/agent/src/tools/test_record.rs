//! A lesson record held in memory, for the tools that read it.

use std::sync::Arc;

use gs_core::graph::ports::ChatListing;
use gs_json::{Json, json};
use parking_lot::Mutex;

use super::ports::ChatPort;
use super::practice::LessonRecord;

struct Record(Mutex<Vec<Json>>);

impl ChatListing for Record {
	fn list_chats(&self) -> Vec<Json> {
		Vec::new()
	}
}

impl ChatPort for Record {
	fn get_chat(&self, _id: &str) -> Option<Json> {
		Some(json!({ "id": "c", "messages": Json::Arr(self.0.lock().clone()) }))
	}
	fn save_tree(&self, _id: &str, _tree: &Json) -> Result<(), String> {
		Ok(())
	}
}

/// The lesson "c" holding `messages`.
pub fn record(messages: Vec<Json>) -> LessonRecord {
	LessonRecord { chat_id: "c".to_owned(), chat_store: Arc::new(Record(Mutex::new(messages))) }
}

/// A learner message `minutes_ago` minutes before the app clock's now.
pub fn learner_at(minutes_ago: i64) -> Json {
	json!({ "role": "user", "content": "x", "timestamp": gs_base::clock::now_ms() - minutes_ago * 60_000 })
}
