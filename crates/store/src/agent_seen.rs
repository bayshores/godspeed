//! data/agent-seen.json, what each outside agent has
//! seen of each lesson. Read-modify-write; small by design.
//!
//! A file that cannot be read or parsed reads as nothing seen. One that is not valid JSON is kept
//! aside first.

use gs_base::config::Paths;
use gs_base::locks::Locks;
use gs_base::time;
use gs_core::records::agent_seen::{SeenMark, SeenStore, parse_agent_seen, with_seen};
use gs_json::{Json, json};

use crate::app_file::AppFile;

pub struct AgentSeenStore {
	file: AppFile,
}

impl AgentSeenStore {
	pub fn new(paths: &Paths, locks: &Locks) -> AgentSeenStore {
		AgentSeenStore { file: AppFile::new(paths, locks, "agent-seen.json", 1) }
	}

	/// Saves `change`'s result under the file's lock; a save that fails is logged.
	fn update(&self, change: impl FnOnce(Json) -> Option<Json>) {
		let saved = self.file.update(|saved| Ok((change(parse_agent_seen(saved)).map(|file| json!({ "agents": file["agents"].clone() })), ())));
		if let Err(err) = saved {
			eprintln!("[store] could not save what agents have seen: {err}");
		}
	}
}

/// The bridge reads and saves marks through this (it holds the store as `Arc<dyn SeenStore>`).
/// A save that fails is logged: the trait has no way to return it, and the next turn then
/// sends the lesson again.
impl SeenStore for AgentSeenStore {
	fn get(&self, agent: &str, conversation: &str) -> Option<SeenMark> {
		SeenMark::from_json(&parse_agent_seen(&self.file.read())["agents"][agent]["conversations"][conversation])
	}

	fn set(&self, agent: &str, conversation: &str, mark: &SeenMark) {
		self.update(|file| Some(with_seen(&file, agent, conversation, mark, &time::iso_now())));
	}

	fn forget_agent(&self, agent: &str) {
		self.update(|mut file| {
			let removed = file.get_mut("agents").and_then(Json::as_obj_mut).and_then(|agents| agents.remove(agent));
			removed.map(|_| file)
		});
	}
}
