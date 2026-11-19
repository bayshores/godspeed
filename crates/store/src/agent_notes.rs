//! data/agent-notes.json, the notes outside agents
//! save about the learner. Read-modify-write; small by design.

use gs_base::config::Paths;
use gs_base::locks::Locks;
use gs_base::{ids, time};
use gs_core::records::agent_notes::{NOTE_MAX_CHARS, NOTES_MAX, clean_note_text, parse_agent_notes};
use gs_json::{Json, Obj, json};

use crate::app_file::AppFile;

pub struct AgentNotesStore {
	file: AppFile,
}

impl AgentNotesStore {
	pub fn new(paths: &Paths, locks: &Locks) -> AgentNotesStore {
		AgentNotesStore { file: AppFile::new(paths, locks, "agent-notes.json", 1) }
	}

	/// Oldest first. A missing file reads as no notes; a broken one is set aside.
	pub fn list_agent_notes(&self) -> Vec<Json> {
		parse_agent_notes(&self.file.read())
	}

	/// The saved note, or the message to give the agent.
	pub fn add_agent_note(&self, text: &str, space_id: Option<&str>) -> Result<Json, String> {
		let Some(clean) = clean_note_text(text) else { return Err(format!("A note is one line of 1 to {NOTE_MAX_CHARS} characters.")) };
		self.file.update(|saved| {
			let mut notes = parse_agent_notes(saved);
			if notes.len() >= NOTES_MAX {
				let saved: Vec<String> = notes.iter().map(|n| format!("- {}: {}", n["id"].str_or_empty(), n["text"].str_or_empty())).collect();
				return Err(format!("godspeed already keeps {NOTES_MAX} notes. Forget one that is out of date first.\n{}", saved.join("\n")));
			}
			let mut note = Obj::new();
			note.insert("id", ids::bytes_hex("note", 4));
			note.insert("text", clean);
			if let Some(space_id) = space_id.filter(|c| !c.is_empty()) {
				note.insert("spaceId", space_id);
			}
			note.insert("createdAt", time::iso_now());
			let note = Json::Obj(note);
			notes.push(note.clone());
			Ok((Some(json!({ "notes": notes })), note))
		})
	}

	/// False when no note has that id.
	pub fn remove_agent_note(&self, id: &str) -> Result<bool, String> {
		self.file.update(|saved| {
			let notes = parse_agent_notes(saved);
			let kept: Vec<Json> = notes.iter().filter(|n| n["id"].as_str() != Some(id)).cloned().collect();
			if kept.len() == notes.len() {
				return Ok((None, false));
			}
			Ok((Some(json!({ "notes": kept })), true))
		})
	}
}
