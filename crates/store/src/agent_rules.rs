//! data/agent-rules.json, which teaching rules an
//! agent saved and when. Read-modify-write; at most one entry per rule.

use gs_base::config::Paths;
use gs_base::locks::Locks;
use gs_core::records::agent_rules::parse_saved_rules;
use gs_json::{Json, json};

use crate::app_file::AppFile;

pub struct AgentRulesStore {
	file: AppFile,
}

impl AgentRulesStore {
	pub fn new(paths: &Paths, locks: &Locks) -> AgentRulesStore {
		AgentRulesStore { file: AppFile::new(paths, locks, "agent-rules.json", 1) }
	}

	/// Oldest first. A missing file reads as none; a broken one is set aside.
	pub fn read_saved_rules(&self) -> Vec<Json> {
		parse_saved_rules(&self.file.read())
	}

	pub fn write_saved_rules(&self, rules: &[Json]) -> Result<(), String> {
		self.file.write(json!({ "rules": rules.to_vec() }))
	}
}
