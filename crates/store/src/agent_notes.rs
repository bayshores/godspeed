//! data/agent-notes.json, the notes outside agents
//! save about the learner. Read-modify-write; small by design.

use std::path::PathBuf;

use gs_base::config::Paths;
use gs_base::locks::{LockKey, Locks};
use gs_base::{fsx, ids, time};
use gs_core::records::agent_notes::{NOTE_MAX_CHARS, NOTES_MAX, clean_note_text, parse_agent_notes};
use gs_json::{Json, Obj, json, stringify_pretty};

const FILE_NAME: &str = "agent-notes.json";
const VERSION: i64 = 1;

pub struct AgentNotesStore {
	file: PathBuf,
	locks: Locks,
}

impl AgentNotesStore {
	pub fn new(paths: &Paths, locks: &Locks) -> AgentNotesStore {
		AgentNotesStore { file: paths.data.join(FILE_NAME), locks: locks.clone() }
	}

	/// Oldest first. A missing file reads as no notes; a broken one is set aside.
	pub fn list_agent_notes(&self) -> Vec<Json> {
		fsx::read_json_or_set_aside(&self.file).map_or_else(Vec::new, |raw| parse_agent_notes(&raw))
	}

	/// The saved note, or the message to give the agent.
	pub fn add_agent_note(&self, text: &str, class_id: Option<&str>) -> Result<Json, String> {
		let Some(clean) = clean_note_text(text) else { return Err(format!("A note is one line of 1 to {NOTE_MAX_CHARS} characters.")) };
		let _guard = self.locks.lock(LockKey::AppFile(FILE_NAME));
		let mut notes = self.list_agent_notes();
		if notes.len() >= NOTES_MAX {
			let saved: Vec<String> = notes.iter().map(|n| format!("- {}: {}", n["id"].as_str().unwrap_or_default(), n["text"].as_str().unwrap_or_default())).collect();
			return Err(format!("godspeed already keeps {NOTES_MAX} notes. Forget one that is out of date first.\n{}", saved.join("\n")));
		}
		let mut note = Obj::new();
		note.insert("id", ids::bytes_hex("note", 4));
		note.insert("text", clean);
		if let Some(class_id) = class_id.filter(|c| !c.is_empty()) {
			note.insert("classId", class_id);
		}
		note.insert("createdAt", time::iso_now());
		let note = Json::Obj(note);
		notes.push(note.clone());
		self.write_notes(&notes)?;
		Ok(note)
	}

	/// False when no note has that id.
	pub fn remove_agent_note(&self, id: &str) -> Result<bool, String> {
		let _guard = self.locks.lock(LockKey::AppFile(FILE_NAME));
		let notes = self.list_agent_notes();
		let kept: Vec<Json> = notes.iter().filter(|n| n["id"].as_str() != Some(id)).cloned().collect();
		if kept.len() == notes.len() {
			return Ok(false);
		}
		self.write_notes(&kept)?;
		Ok(true)
	}

	fn write_notes(&self, notes: &[Json]) -> Result<(), String> {
		let record = json!({ "version": VERSION, "notes": notes.to_vec() });
		fsx::write_text_atomic(&self.file, &stringify_pretty(&record, "\t")).map_err(|err| fsx::node_error_message(&err, "open", &self.file))
	}
}
