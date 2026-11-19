//! data/teacher-chats.json, the teacher's chats in godspeed's terminal (gs_core's
//! records::teacher_chats says what is kept). A file that cannot be read reads as none.

use gs_base::config::Paths;
use gs_base::locks::Locks;
use gs_core::records::teacher_chats::{TeacherChat, parse_teacher_chats, teacher_chats_json};

use crate::app_file::AppFile;

pub struct TeacherChatsStore {
	file: AppFile,
}

impl TeacherChatsStore {
	pub fn new(paths: &Paths, locks: &Locks) -> TeacherChatsStore {
		TeacherChatsStore { file: AppFile::new(paths, locks, "teacher-chats.json", 1) }
	}

	pub fn read(&self) -> Vec<TeacherChat> {
		parse_teacher_chats(&self.file.read())
	}

	/// Changes the list under the file's lock. A save that fails is logged: the list only helps
	/// the learner find a chat again.
	pub fn update(&self, change: impl FnOnce(&mut Vec<TeacherChat>)) {
		let saved = self.file.update(|saved| {
			let mut chats = parse_teacher_chats(saved);
			let before = chats.clone();
			change(&mut chats);
			Ok(((chats != before).then(|| teacher_chats_json(&chats)), ()))
		});
		if let Err(err) = saved {
			eprintln!("[store] could not save the teacher's chats: {err}");
		}
	}
}
