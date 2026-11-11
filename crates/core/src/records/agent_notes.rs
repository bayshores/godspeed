//! Ported from src/shared/core/agent-notes.ts: notes an outside agent saves about the learner.

use std::sync::LazyLock;

use gs_base::{re::Re, text};
use gs_json::{Json, Obj};

pub const NOTE_MAX_CHARS: usize = 200;
/// Kept small so the briefing stays cheap for every agent that connects.
pub const NOTES_MAX: usize = 30;

/// The note as one trimmed line; None when empty or too long.
pub fn clean_note_text(raw: &str) -> Option<String> {
	static SPACES: LazyLock<Re> = LazyLock::new(|| Re::new(r"\s+", "g"));
	let line = SPACES.replace(raw, " ");
	let line = text::trim(&line);
	(!line.is_empty() && text::len16(line) <= NOTE_MAX_CHARS).then(|| line.to_owned())
}

/// The notes in a parsed agent-notes.json; malformed entries are dropped.
pub fn parse_agent_notes(raw: &Json) -> Vec<Json> {
	let Some(list) = raw["notes"].as_arr() else { return Vec::new() };
	list.iter()
		.filter_map(|entry| {
			let (id, note, created_at) = (entry["id"].as_str()?, entry["text"].as_str()?, entry["createdAt"].as_str()?);
			let mut out = Obj::new();
			out.insert("id", id);
			out.insert("text", note);
			if let Some(class_id) = entry["classId"].as_str() {
				out.insert("classId", class_id);
			}
			out.insert("createdAt", created_at);
			Some(Json::Obj(out))
		})
		.collect()
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;

	#[test]
	fn notes_are_one_short_line() {
		assert_eq!(clean_note_text("  a \n\t b  ").as_deref(), Some("a b"));
		assert_eq!(clean_note_text(" \n "), None);
		assert_eq!(clean_note_text(&"x".repeat(200)).as_deref(), Some("x".repeat(200).as_str()));
		assert_eq!(clean_note_text(&"x".repeat(201)), None);
	}

	#[test]
	fn malformed_entries_are_dropped() {
		let raw = json!({ "notes": [{ "id": "n1", "text": "t", "classId": 5, "createdAt": "now", "extra": 1 }, { "id": "n2", "text": "t" }, "x", { "id": "n3", "text": "u", "classId": "cls_a", "createdAt": "z" }] });
		assert_eq!(stringify(&json!(parse_agent_notes(&raw))), r#"[{"id":"n1","text":"t","createdAt":"now"},{"id":"n3","text":"u","classId":"cls_a","createdAt":"z"}]"#);
		assert!(parse_agent_notes(&json!({ "notes": "x" })).is_empty());
		assert!(parse_agent_notes(&Json::Null).is_empty());
	}
}
