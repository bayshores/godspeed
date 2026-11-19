//! data/teacher-chats.json: the chats the teacher had in godspeed's terminal, so the learner can
//! pick one to go back to. A chat is listed once something happened in it (a line typed to it, a
//! lesson it taught); its name is the last lesson it taught, else the first line typed to it.
//! Pure: the store reads and writes the file.

use gs_base::ids::is_uuid;
use gs_json::{Json, json};

/// Chats kept in the file.
const KEPT: usize = 20;
/// Chats the terminal offers.
const SHOWN: usize = 5;
/// A name is cut to this many characters.
const NAME_MAX: usize = 40;

#[derive(Clone, Debug, PartialEq)]
pub struct TeacherChat {
	/// The agent's own session id (a UUID).
	pub id: String,
	/// "claude" or "codex".
	pub agent: String,
	/// The folder it ran in: an agent keeps its chats per folder.
	pub folder: String,
	pub name: Option<String>,
	pub used: bool,
	/// Last start or use, ms since the epoch.
	pub at: i64,
}

impl TeacherChat {
	fn to_json(&self) -> Json {
		json!({ "id": self.id.as_str(), "agent": self.agent.as_str(), "folder": self.folder.as_str(), "name": self.name.clone(), "used": self.used, "at": self.at })
	}

	fn from_json(chat: &Json) -> Option<TeacherChat> {
		let id = chat["id"].as_str().filter(|id| is_uuid(id))?;
		let agent = chat["agent"].as_str().filter(|a| matches!(*a, "claude" | "codex"))?;
		Some(TeacherChat {
			id: id.to_owned(),
			agent: agent.to_owned(),
			folder: chat["folder"].as_str()?.to_owned(),
			name: chat["name"].as_str().map(str::to_owned),
			used: chat["used"] == Json::Bool(true),
			at: chat["at"].as_i64()?,
		})
	}
}

/// The file's chats; anything unreadable reads as none.
pub fn parse_teacher_chats(file: &Json) -> Vec<TeacherChat> {
	file["chats"].as_arr().map(|chats| chats.iter().filter_map(TeacherChat::from_json).collect()).unwrap_or_default()
}

pub fn teacher_chats_json(chats: &[TeacherChat]) -> Json {
	json!({ "chats": chats.iter().map(TeacherChat::to_json).collect::<Vec<_>>() })
}

/// A chat started (or came back) in the teacher's terminal: first in the list, newest 20 kept.
pub fn started(chats: &mut Vec<TeacherChat>, id: &str, agent: &str, folder: &str, now: i64) {
	let chat = match chats.iter().position(|c| c.id == id) {
		Some(at) => TeacherChat { at: now, ..chats.remove(at) },
		None => TeacherChat { id: id.to_owned(), agent: agent.to_owned(), folder: folder.to_owned(), name: None, used: false, at: now },
	};
	chats.insert(0, chat);
	chats.truncate(KEPT);
}

fn cut(name: &str) -> String {
	let line = name.split_whitespace().collect::<Vec<_>>().join(" ");
	if line.chars().count() <= NAME_MAX {
		return line;
	}
	format!("{}…", line.chars().take(NAME_MAX - 1).collect::<String>().trim_end())
}

/// The learner typed a line to the chat: used, and named by it while nothing else named it.
pub fn typed(chats: &mut [TeacherChat], id: &str, line: &str, now: i64) {
	if let Some(chat) = chats.iter_mut().find(|c| c.id == id) {
		if chat.name.is_none() && !line.trim().is_empty() {
			chat.name = Some(cut(line));
		}
		chat.used = true;
		chat.at = now;
	}
}

/// The chat taught a lesson: used, and named after it.
pub fn taught(chats: &mut [TeacherChat], id: &str, lesson: &str, now: i64) {
	if let Some(chat) = chats.iter_mut().find(|c| c.id == id) {
		if !lesson.trim().is_empty() {
			chat.name = Some(cut(lesson));
		}
		chat.used = true;
		chat.at = now;
	}
}

/// What the terminal offers: used chats from this folder, newest first.
pub fn shown(chats: &[TeacherChat], folder: &str) -> Vec<TeacherChat> {
	let mut list: Vec<TeacherChat> = chats.iter().filter(|c| c.used && c.folder == folder).cloned().collect();
	list.sort_by_key(|chat| std::cmp::Reverse(chat.at));
	list.truncate(SHOWN);
	list
}

#[cfg(test)]
mod tests {
	use super::*;

	const A: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";
	const B: &str = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

	#[test]
	fn a_chat_shows_once_used_named_by_its_first_line_then_its_lesson() {
		let mut chats = Vec::new();
		started(&mut chats, A, "claude", "/f", 1);
		assert!(shown(&chats, "/f").is_empty(), "nothing happened in it yet");
		typed(&mut chats, A, "  why is   the sky\nblue?", 2);
		typed(&mut chats, A, "and the sea?", 3);
		assert_eq!(shown(&chats, "/f")[0].name.as_deref(), Some("why is the sky blue?"));
		taught(&mut chats, A, "Limits proof", 4);
		typed(&mut chats, A, "thanks", 5);
		assert_eq!(shown(&chats, "/f")[0].name.as_deref(), Some("Limits proof"));
		assert!(shown(&chats, "/other").is_empty(), "another folder's chats can't be opened here");
	}

	#[test]
	fn newest_first_five_shown_twenty_kept_and_it_reads_back() {
		let mut chats = Vec::new();
		for i in 0..25 {
			let id = format!("0f8fad5b-d9cb-469f-a165-{i:012x}");
			started(&mut chats, &id, "codex", "/f", i);
			typed(&mut chats, &id, "hi", i);
		}
		assert_eq!(chats.len(), 20);
		let list = shown(&chats, "/f");
		assert_eq!(list.len(), 5);
		assert_eq!(list[0].at, 24);
		started(&mut chats, B, "claude", "/f", 30);
		assert_eq!(chats[0].id, B);
		assert_eq!(parse_teacher_chats(&teacher_chats_json(&chats)), chats);
		assert!(parse_teacher_chats(&json!({ "chats": [{ "id": "nope", "agent": "claude", "folder": "/f", "at": 1 }] })).is_empty());
	}

	#[test]
	fn a_long_name_is_cut() {
		let mut chats = Vec::new();
		started(&mut chats, A, "claude", "/f", 1);
		typed(&mut chats, A, &"word ".repeat(20), 2);
		let name = chats[0].name.clone().unwrap();
		assert_eq!(name.chars().count(), 40);
		assert!(name.ends_with('…'));
	}
}
