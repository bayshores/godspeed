//! The names the teacher's step words use (a space's, a file's, a lesson's), read from the
//! stores, for Follow's slip and a lesson's desk alike.

use gs_core::session::teacher_steps::StepNames;

use crate::App;

pub(crate) struct AppStepNames<'a>(pub &'a App);

impl StepNames for AppStepNames<'_> {
	fn space(&self, id: &str) -> Option<String> {
		self.0.stores.spaces.get_space(id)?["name"].as_str().map(str::to_owned)
	}

	fn file(&self, space_id: &str, file_id: &str) -> Option<String> {
		let space = self.0.stores.spaces.get_space(space_id)?;
		space["files"].items().iter().find(|f| f["id"].as_str() == Some(file_id))?["name"].as_str().map(str::to_owned)
	}

	fn lesson(&self, id: &str) -> Option<String> {
		self.0.stores.chats.get_chat(id)?["title"].as_str().map(str::to_owned)
	}

	fn obsidian(&self) -> bool {
		crate::vault::notes_in_obsidian(self.0)
	}
}
