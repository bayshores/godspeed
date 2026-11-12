//! Homework sessions (homework.ts): a new one opens with the space card and a note on the
//! deadline, its assignment file and its problems; its tools read and write the deadline's
//! problems through the space store.

use std::sync::Arc;

use gs_agent::tools::homework::HomeworkDeadline;
use gs_base::locks::LockKey;
use gs_core::messages::native_messages::{new_space_context_message, new_study_context_message};
use gs_core::study::homework::{has_problems, homework_context_text, merge_problems};
use gs_json::{Json, json};

use super::lessons::{Created, NotFound};
use crate::App;
use crate::spaces::space_card::{space_card_for, space_file_path};
use crate::spaces::update_space_deadline;

fn deadline_of<'a>(space: &'a Json, deadline_id: &str) -> Option<&'a Json> {
	space["deadlines"].as_arr()?.iter().find(|d| d["id"].as_str() == Some(deadline_id))
}

fn file_of<'a>(space: &'a Json, deadline: &Json) -> Option<&'a Json> {
	let file_id = deadline["assignmentFileId"].as_str().filter(|id| !id.is_empty())?;
	space["files"].as_arr()?.iter().find(|f| f["id"].as_str() == Some(file_id))
}

/// Starts a homework session on one homework or project deadline. Its title is the learner's
/// first message.
pub fn create_homework(app: &Arc<App>, space_id: &str, deadline_id: &str) -> Result<Result<Created, NotFound>, String> {
	// Held from the space check to the finished lesson, as in `create_lesson`.
	let _guard = app.locks.lock(LockKey::Space(space_id));
	let Some(space) = app.stores.spaces.get_space(space_id) else {
		return Ok(Err(NotFound { code: "space_not_found", error: "No such space" }));
	};
	let Some(deadline) = deadline_of(&space, deadline_id).filter(|d| has_problems(d["kind"].as_str().unwrap_or_default())) else {
		return Ok(Err(NotFound { code: "deadline_not_found", error: "No such homework or project" }));
	};
	let assignment = file_of(&space, deadline).map_or(Json::Null, |file| json!({ "id": file["id"], "name": file["name"], "path": space_file_path(app, &space, file) }));
	let title = format!("Work on {}", deadline["name"].as_str().unwrap_or_default());
	let space_id = space["id"].as_str().unwrap_or_default();
	let chat = app.stores.chats.create_chat(&title, Some("homework"), Some(space_id), deadline["id"].as_str())?;
	let chat_id = chat["id"].as_str().unwrap_or_default().to_owned();
	let problems = deadline["problems"].as_arr().map_or(&[][..], Vec::as_slice);
	let messages = [new_space_context_message(&space_card_for(app, &space)?), new_study_context_message(&homework_context_text(space_id, deadline, &assignment, problems), "homework-context")];
	app.stores.chats.save_messages(&chat_id, &messages)?;
	let chat = app.stores.chats.get_chat(&chat_id).unwrap_or(chat);
	Ok(Ok(Created { chat, title }))
}

/// What a homework lesson shows of its deadline; None once it is gone.
pub fn homework_view(app: &Arc<App>, space_id: &str, deadline_id: &str) -> Option<Json> {
	let space = app.stores.spaces.get_space(space_id)?;
	let deadline = deadline_of(&space, deadline_id)?;
	let assignment = file_of(&space, deadline).map_or(Json::Null, |file| json!({ "name": file["name"], "path": space_file_path(app, &space, file) }));
	let problems = if deadline["problems"].is_null() { json!([]) } else { deadline["problems"].clone() };
	Some(json!({ "name": deadline["name"], "problems": problems, "assignment": assignment }))
}

/// The homework tools' view of one deadline: its problems, posting new ones, marking one done.
struct DeadlineProblems {
	app: Arc<App>,
	space_id: String,
	deadline_id: String,
}

pub fn homework_deadline(app: &Arc<App>, space_id: &str, deadline_id: &str) -> Arc<dyn HomeworkDeadline> {
	Arc::new(DeadlineProblems { app: app.clone(), space_id: space_id.to_owned(), deadline_id: deadline_id.to_owned() })
}

impl DeadlineProblems {
	/// Saves the problems; the error text when the deadline could not be updated.
	fn save(&self, next: Vec<Json>) -> Option<String> {
		update_space_deadline(&self.app, &self.space_id, &self.deadline_id, &json!({ "problems": next })).err().map(|failure| failure.error)
	}
}

impl HomeworkDeadline for DeadlineProblems {
	fn problems(&self) -> Vec<Json> {
		let space = self.app.stores.spaces.get_space(&self.space_id);
		space.as_ref().and_then(|c| deadline_of(c, &self.deadline_id)).and_then(|d| d["problems"].as_arr().cloned()).unwrap_or_default()
	}

	fn post(&self, posted: &[Json]) -> Option<String> {
		self.save(merge_problems(&self.problems(), posted))
	}

	fn mark_done(&self, number: &str) {
		let next = self
			.problems()
			.into_iter()
			.map(|p| {
				if p["number"].as_str() != Some(number) {
					return p;
				}
				let mut done = p;
				if let Some(o) = done.as_obj_mut() {
					o.insert("done", true);
				}
				done
			})
			.collect();
		self.save(next);
	}
}
