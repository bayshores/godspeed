//! data/agent-actions.json, the activity log,
//! oldest first. Rewritten whole on each change; small by design.

use std::path::PathBuf;

use gs_base::config::Paths;
use gs_base::fsx;
use gs_base::locks::{LockKey, Locks};
use gs_core::records::agent_actions::parse_agent_actions;
use gs_json::{Json, json};

const FILE_NAME: &str = "agent-actions.json";
const VERSION: i64 = 1;

pub struct AgentActionsStore {
	file: PathBuf,
	locks: Locks,
}

impl AgentActionsStore {
	pub fn new(paths: &Paths, locks: &Locks) -> AgentActionsStore {
		AgentActionsStore { file: paths.data.join(FILE_NAME), locks: locks.clone() }
	}

	/// Oldest first. A missing file reads as no actions; a broken one is set aside.
	pub fn read_agent_actions(&self) -> Vec<Json> {
		let Some(raw) = fsx::read_json_or_set_aside(&self.file) else { return Vec::new() };
		parse_agent_actions(&raw)
	}

	pub fn write_agent_actions(&self, actions: &[Json]) -> Result<(), String> {
		let _guard = self.locks.lock(LockKey::AppFile(FILE_NAME));
		let record = json!({ "version": VERSION, "actions": actions.to_vec() });
		fsx::write_json_atomic(&self.file, &record)
	}
}
