//! Ported from src/backend/store/agent-rules.ts: data/agent-rules.json, which teaching rules an
//! agent saved and when. Read-modify-write; at most one entry per rule.

use std::path::PathBuf;

use gs_base::config::Paths;
use gs_base::fsx;
use gs_base::locks::{LockKey, Locks};
use gs_core::records::agent_rules::parse_saved_rules;
use gs_json::{Json, json, stringify_pretty};

use crate::agent_notes::read_json_or_set_aside;

const FILE_NAME: &str = "agent-rules.json";
const VERSION: i64 = 1;

pub struct AgentRulesStore {
	file: PathBuf,
	locks: Locks,
}

impl AgentRulesStore {
	pub fn new(paths: &Paths, locks: &Locks) -> AgentRulesStore {
		AgentRulesStore { file: paths.data.join(FILE_NAME), locks: locks.clone() }
	}

	/// Oldest first. A missing file reads as none; a broken one is set aside.
	pub fn read_saved_rules(&self) -> Vec<Json> {
		read_json_or_set_aside(&self.file).map_or_else(Vec::new, |raw| parse_saved_rules(&raw))
	}

	pub fn write_saved_rules(&self, rules: &[Json]) -> Result<(), String> {
		let _guard = self.locks.lock(LockKey::AppFile(FILE_NAME));
		let record = json!({ "version": VERSION, "rules": rules.to_vec() });
		fsx::write_text_atomic(&self.file, &stringify_pretty(&record, "\t")).map_err(|err| fsx::node_error_message(&err, "open", &self.file))
	}
}
