//! The stores as the lesson tools reach them: the tools keep their ports for the whole turn, so
//! each port holds the app rather than borrowing a store.

use std::sync::Arc;

use gs_agent::extraction::ledgers::ScopedGraph;
use gs_agent::tools::ports::{ChatPort, JobPort};
use gs_core::graph::ports::{GraphStore, LedgerRewrite};
use gs_json::Json;

use crate::App;

pub(super) struct ChatRecords(pub Arc<App>);

impl ChatPort for ChatRecords {
	fn get_chat(&self, id: &str) -> Option<Json> {
		ChatPort::get_chat(&self.0.stores.chats, id)
	}

	fn list_chats(&self) -> Vec<Json> {
		ChatPort::list_chats(&self.0.stores.chats)
	}

	fn save_tree(&self, id: &str, tree: &Json) -> Result<(), String> {
		ChatPort::save_tree(&self.0.stores.chats, id, tree)
	}
}

pub(super) struct JobRecords(pub Arc<App>);

impl JobPort for JobRecords {
	fn find_job_by_tool_call_id(&self, chat_id: &str, tool_call_id: &str) -> Option<Json> {
		JobPort::find_job_by_tool_call_id(&self.0.stores.jobs, chat_id, tool_call_id)
	}

	fn create_job(&self, kind: &str, chat_id: &str, tool_call_id: &str, input: &Json) -> Result<Json, String> {
		JobPort::create_job(&self.0.stores.jobs, kind, chat_id, tool_call_id, input)
	}
}

/// One scope's graph ledgers: None is "No class", a class id its own graph.
pub(super) struct ScopeGraph {
	pub app: Arc<App>,
	pub scope: Option<String>,
}

impl ScopeGraph {
	fn ledgers(&self) -> ScopedGraph<'_> {
		ScopedGraph::new(&self.app.stores.graphs, self.scope.as_deref())
	}
}

impl GraphStore for ScopeGraph {
	fn append_node(&self, node: &Json) -> Result<(), String> {
		self.ledgers().append_node(node)
	}

	fn read_nodes(&self) -> Result<Vec<Json>, String> {
		self.ledgers().read_nodes()
	}

	fn append_chain(&self, assertion: &Json) -> Result<(), String> {
		self.ledgers().append_chain(assertion)
	}

	fn read_chains(&self) -> Result<Vec<Json>, String> {
		self.ledgers().read_chains()
	}

	fn append_checkpoint(&self, checkpoint: &Json) -> Result<(), String> {
		self.ledgers().append_checkpoint(checkpoint)
	}

	fn read_checkpoints(&self) -> Result<Vec<Json>, String> {
		self.ledgers().read_checkpoints()
	}

	fn append_coverage(&self, entry: &Json) -> Result<(), String> {
		self.ledgers().append_coverage(entry)
	}

	fn read_coverage(&self) -> Result<Vec<Json>, String> {
		self.ledgers().read_coverage()
	}

	fn read_sources(&self) -> Result<Vec<Json>, String> {
		self.ledgers().read_sources()
	}

	fn remove_source(&self, id: &str) -> Result<bool, String> {
		self.ledgers().remove_source(id)
	}

	fn rewrite_ledgers(&self, next: LedgerRewrite) -> Result<(), String> {
		self.ledgers().rewrite_ledgers(next)
	}
}
