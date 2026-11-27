//! data/teacher-chats.json from an older build: the chats the teacher had in godspeed's terminal,
//! read once so they carry over as talk chats. Pure: the services read and set aside the file.

use gs_base::ids::is_uuid;
use gs_json::Json;

use crate::spaces::agent_folder::FolderAgent;

#[derive(Clone, Debug, PartialEq)]
pub struct TeacherChat {
	/// The agent's own session id (a UUID).
	pub id: String,
	pub agent: FolderAgent,
	/// The folder it ran in: an agent keeps its chats per folder.
	pub folder: String,
	pub name: Option<String>,
	/// A line was typed to it.
	pub used: bool,
	/// Last start or use, ms since the epoch.
	pub at: i64,
}

impl TeacherChat {
	fn from_json(chat: &Json) -> Option<TeacherChat> {
		let id = chat["id"].as_str().filter(|id| is_uuid(id))?;
		let agent = FolderAgent::from_name(chat["agent"].as_str()?)?;
		Some(TeacherChat {
			id: id.to_owned(),
			agent,
			folder: chat["folder"].as_str()?.to_owned(),
			name: chat["name"].as_str().map(str::to_owned),
			used: chat["used"] == Json::Bool(true),
			at: chat["at"].as_i64()?,
		})
	}
}

/// The file's chats; an entry that is not one is skipped.
pub fn parse_teacher_chats(file: &Json) -> Vec<TeacherChat> {
	file["chats"].as_arr().map(|chats| chats.iter().filter_map(TeacherChat::from_json).collect()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	const A: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";

	#[test]
	fn reads_the_chats_and_skips_what_is_not_one() {
		let file = json!({ "chats": [
			{ "id": A, "agent": "claude", "folder": "/f", "name": "Limits proof", "lesson": "chat_limits", "used": true, "at": 4 },
			{ "id": "nope", "agent": "claude", "folder": "/f", "at": 1 },
			{ "id": A, "agent": "gemini", "folder": "/f", "at": 1 },
		] });
		assert_eq!(parse_teacher_chats(&file), [TeacherChat { id: A.to_owned(), agent: FolderAgent::Claude, folder: "/f".to_owned(), name: Some("Limits proof".to_owned()), used: true, at: 4 }]);
		assert!(parse_teacher_chats(&Json::Null).is_empty());
	}
}
