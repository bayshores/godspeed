//! What the tools reach the server through: small seams the services fill in, so the tools never
//! import a service.

use std::sync::Arc;

use gs_core::graph::ports::ChatListing;
use gs_json::Json;
use gs_store::chats::ChatStore;
use gs_store::jobs::{CreateJobInit, JobStore};

/// The chat records the tools read (the open question, the plan tree) and the one thing they write.
pub trait ChatPort: ChatListing {
	fn get_chat(&self, id: &str) -> Option<Json>;
	fn save_tree(&self, id: &str, tree: &Json) -> Result<(), String>;
}

impl ChatPort for ChatStore {
	fn get_chat(&self, id: &str) -> Option<Json> {
		ChatStore::get_chat(self, id)
	}

	fn save_tree(&self, id: &str, tree: &Json) -> Result<(), String> {
		ChatStore::save_tree(self, id, tree)
	}
}

/// The job records the job tools create.
pub trait JobPort: Send + Sync {
	fn find_job_by_tool_call_id(&self, chat_id: &str, tool_call_id: &str) -> Option<Json>;
	/// A new running job, its input saved before the worker spawns.
	fn create_job(&self, kind: &str, chat_id: &str, tool_call_id: &str, input: &Json) -> Result<Json, String>;
}

impl JobPort for JobStore {
	fn find_job_by_tool_call_id(&self, chat_id: &str, tool_call_id: &str) -> Option<Json> {
		JobStore::find_job_by_tool_call_id(self, chat_id, tool_call_id).map(|job| (*job).clone())
	}

	fn create_job(&self, kind: &str, chat_id: &str, tool_call_id: &str, input: &Json) -> Result<Json, String> {
		JobStore::create_job(self, &CreateJobInit { kind, chat_id, tool_call_id, activity: None, input: Some(input.clone()) })
	}
}

/// Queues a steer message for the wake pipeline.
pub type Deliver = Arc<dyn Fn(Json) + Send + Sync>;

/// Starts the background runner for a fresh job. The input rides along because the spawn happens
/// before the tool call is saved.
pub type Spawn = Arc<dyn Fn(&Json, &Json) + Send + Sync>;
