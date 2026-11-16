//! data/teacher-chats.json, the teacher's chats in godspeed's terminal (gs_core's
//! records::teacher_chats says what is kept). A file that cannot be read reads as none.

use std::path::PathBuf;

use gs_base::config::Paths;
use gs_base::fsx;
use gs_base::locks::{LockKey, Locks};
use gs_core::records::teacher_chats::{TeacherChat, parse_teacher_chats, teacher_chats_json};
use gs_json::{Json, stringify_pretty};

const FILE_NAME: &str = "teacher-chats.json";

pub struct TeacherChatsStore {
	file: PathBuf,
	locks: Locks,
}

impl TeacherChatsStore {
	pub fn new(paths: &Paths, locks: &Locks) -> TeacherChatsStore {
		TeacherChatsStore { file: paths.data.join(FILE_NAME), locks: locks.clone() }
	}

	pub fn read(&self) -> Vec<TeacherChat> {
		parse_teacher_chats(&fsx::read_json(&self.file).unwrap_or(Json::Null))
	}

	/// Changes the list under the file's lock. A save that fails is logged: the list only helps
	/// the learner find a chat again.
	pub fn update(&self, change: impl FnOnce(&mut Vec<TeacherChat>)) {
		let _guard = self.locks.lock(LockKey::AppFile(FILE_NAME));
		let mut chats = self.read();
		let before = chats.clone();
		change(&mut chats);
		if chats == before {
			return;
		}
		if let Err(err) = fsx::write_text_atomic(&self.file, &stringify_pretty(&teacher_chats_json(&chats), "\t")) {
			eprintln!("[store] could not save the teacher's chats: {}", fsx::node_error_message(&err, "open", &self.file));
		}
	}
}
