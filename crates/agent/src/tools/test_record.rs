//! A lesson record held in memory, for the tools that read it.

use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_json::{Json, json};
use parking_lot::Mutex;

use super::ports::{ChatPort, ProblemPages};
use super::plan::PlanContext;

struct Record(Mutex<Vec<Json>>);

impl ChatPort for Record {
	fn get_chat(&self, _id: &str) -> Option<Json> {
		Some(json!({ "id": "c", "messages": Json::Arr(self.0.lock().clone()) }))
	}
	fn save_tree(&self, _id: &str, _tree: &Json) -> Result<(), String> {
		Ok(())
	}
}

/// The lesson "c" holding `messages`.
pub fn record(messages: Vec<Json>) -> PlanContext {
	PlanContext { chat_id: "c".to_owned(), chat_store: Arc::new(Record(Mutex::new(messages))) }
}

/// A learner message `minutes_ago` minutes before the app clock's now.
pub fn learner_at(minutes_ago: i64) -> Json {
	json!({ "role": "user", "content": "x", "timestamp": gs_base::clock::now_ms() - minutes_ago * 60_000 })
}

/// Pages that answer every ask with `answer` and remember what was asked.
pub struct FakePages {
	pub answer: Result<Json, String>,
	pub asked: Mutex<Vec<(Json, Option<String>)>>,
}

impl FakePages {
	pub fn new(answer: Result<Json, String>) -> Arc<FakePages> {
		Arc::new(FakePages { answer, asked: Mutex::new(Vec::new()) })
	}
}

impl ProblemPages for FakePages {
	fn find<'a>(&'a self, source: &'a Json, typed: Option<&'a str>) -> BoxFuture<'a, Result<Json, String>> {
		self.asked.lock().push((source.clone(), typed.map(str::to_owned)));
		Box::pin(async move { self.answer.clone() })
	}
}
