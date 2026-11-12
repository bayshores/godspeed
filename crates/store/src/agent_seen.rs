//! data/agent-seen.json, what each outside agent has
//! seen of each lesson. Read-modify-write; small by design.
//!
//! A file that cannot be read or parsed reads as nothing seen and is left where it is.

use std::path::PathBuf;

use gs_base::config::Paths;
use gs_base::locks::{LockKey, Locks};
use gs_base::{fsx, time};
use gs_core::records::agent_seen::{SeenMark, SeenStore, parse_agent_seen, with_seen};
use gs_json::{Json, json, parse, stringify_pretty};

const FILE_NAME: &str = "agent-seen.json";
const VERSION: i64 = 1;

pub struct AgentSeenStore {
	file: PathBuf,
	locks: Locks,
}

impl AgentSeenStore {
	pub fn new(paths: &Paths, locks: &Locks) -> AgentSeenStore {
		AgentSeenStore { file: paths.data.join(FILE_NAME), locks: locks.clone() }
	}

	fn read(&self) -> Json {
		let parsed = fsx::read_text(&self.file).ok().and_then(|raw| parse(&raw).ok());
		parse_agent_seen(&parsed.unwrap_or(Json::Null))
	}

	fn write(&self, file: &Json) {
		let record = json!({ "version": VERSION, "agents": file["agents"].clone() });
		if let Err(err) = fsx::write_text_atomic(&self.file, &stringify_pretty(&record, "\t")) {
			eprintln!("[store] could not save what agents have seen: {}", fsx::node_error_message(&err, "open", &self.file));
		}
	}
}

/// The bridge reads and saves marks through this (it holds the store as `Arc<dyn SeenStore>`).
/// A save that fails is logged: the trait has no way to return it, and the next turn then
/// sends the lesson again.
impl SeenStore for AgentSeenStore {
	fn get(&self, agent: &str, conversation: &str) -> Option<SeenMark> {
		SeenMark::from_json(&self.read()["agents"][agent]["conversations"][conversation])
	}

	fn set(&self, agent: &str, conversation: &str, mark: &SeenMark) {
		let _guard = self.locks.lock(LockKey::AppFile(FILE_NAME));
		self.write(&with_seen(&self.read(), agent, conversation, mark, &time::iso_now()));
	}

	fn forget_agent(&self, agent: &str) {
		let _guard = self.locks.lock(LockKey::AppFile(FILE_NAME));
		let mut file = self.read();
		let removed = file.get_mut("agents").and_then(Json::as_obj_mut).and_then(|agents| agents.remove(agent));
		if removed.is_some() {
			self.write(&file);
		}
	}
}
