//! data/agent-actions.json, the activity log,
//! oldest first. Rewritten whole on each change; small by design.

use gs_base::config::Paths;
use gs_base::locks::Locks;
use gs_core::records::agent_actions::parse_agent_actions;
use gs_json::{Json, json};

use crate::app_file::AppFile;

pub struct AgentActionsStore {
	file: AppFile,
}

impl AgentActionsStore {
	pub fn new(paths: &Paths, locks: &Locks) -> AgentActionsStore {
		AgentActionsStore { file: AppFile::new(paths, locks, "agent-actions.json", 1) }
	}

	/// Oldest first. A missing file reads as no actions; a broken one is set aside.
	pub fn read_agent_actions(&self) -> Vec<Json> {
		parse_agent_actions(&self.file.read())
	}

	pub fn write_agent_actions(&self, actions: &[Json]) -> Result<(), String> {
		self.file.write(json!({ "actions": actions.to_vec() }))
	}
}
