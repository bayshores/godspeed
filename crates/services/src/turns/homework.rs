//! Homework sessions (homework.ts): a new one opens with the space card and a note on the
//! deadline, its assignment file and its problems; its tools read and write the deadline's
//! problem list (`problem_list`) through the space store.

use std::sync::Arc;

use gs_agent::tools::homework::ProblemList;
use gs_base::locks::LockKey;
use gs_core::messages::native_messages::{new_space_context_message, new_study_context_message};
use gs_core::spaces::problem_list::problem_list;
use gs_core::study::homework::{has_problems, homework_context_text, merge_problems};
use gs_json::{Json, json};

use super::lessons::{Created, NotFound};
use crate::App;
use crate::graph::study_start::deadline_topics_for;
use crate::spaces::space_card::{space_card_for, space_file_path};
use crate::spaces::save_deadline_problems;

pub(super) fn deadline_of<'a>(space: &'a Json, deadline_id: &str) -> Option<&'a Json> {
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
	let Some(deadline) = deadline_of(&space, deadline_id).filter(|d| has_problems(d["kind"].str_or_empty())) else {
		return Ok(Err(NotFound { code: "deadline_not_found", error: "No such homework or project" }));
	};
	let assignment = file_of(&space, deadline).map_or(Json::Null, |file| json!({ "id": file["id"], "name": file["name"], "path": space_file_path(app, &space, file) }));
	let title = format!("Work on {}", deadline["name"].str_or_empty());
	let space_id = space["id"].str_or_empty();
	let chat = app.stores.chats.create_chat(&title, Some("homework"), Some(space_id), deadline["id"].as_str())?;
	let chat_id = chat["id"].str_or_empty().to_owned();
	let problems = problem_list(&space, deadline);
	let topics = deadline_topics_for(app, space_id, deadline_id)?;
	let note = homework_context_text(space_id, deadline, &assignment, problems, &topics);
	let messages = [new_space_context_message(&space_card_for(app, &space)?), new_study_context_message(&note, "homework-context")];
	app.stores.chats.save_messages(&chat_id, &messages)?;
	let chat = app.stores.chats.get_chat(&chat_id).unwrap_or(chat);
	Ok(Ok(Created { chat, title }))
}

/// What a homework lesson shows of its deadline; None once it is gone.
pub fn homework_view(app: &Arc<App>, space_id: &str, deadline_id: &str) -> Option<Json> {
	let space = app.stores.spaces.get_space(space_id)?;
	let deadline = deadline_of(&space, deadline_id)?;
	let assignment = file_of(&space, deadline).map_or(Json::Null, |file| json!({ "name": file["name"], "path": space_file_path(app, &space, file) }));
	Some(json!({ "name": deadline["name"], "problems": problem_list(&space, deadline), "assignment": assignment }))
}

/// The homework tools' view of one deadline's problem list: reading it, posting a new one,
/// marking one problem done.
struct DeadlineProblems {
	app: Arc<App>,
	space_id: String,
	deadline_id: String,
}

pub fn deadline_problem_list(app: &Arc<App>, space_id: &str, deadline_id: &str) -> Arc<dyn ProblemList> {
	Arc::new(DeadlineProblems { app: app.clone(), space_id: space_id.to_owned(), deadline_id: deadline_id.to_owned() })
}

impl DeadlineProblems {
	/// Saves the problems; the error text when they could not be saved.
	fn save(&self, next: Vec<Json>) -> Option<String> {
		save_deadline_problems(&self.app, &self.space_id, &self.deadline_id, &Json::Arr(next)).err().map(|failure| failure.error)
	}
}

impl ProblemList for DeadlineProblems {
	fn problems(&self) -> Vec<Json> {
		let space = self.app.stores.spaces.get_space(&self.space_id);
		space.as_ref().and_then(|c| Some(problem_list(c, deadline_of(c, &self.deadline_id)?).to_vec())).unwrap_or_default()
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

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::spaces::list_open_deadlines;

	#[test]
	fn the_tools_read_and_write_the_assignment_files_list_and_readers_see_it_on_the_deadline() {
		let root = scratch_dir("homework-file-list");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Algorithms" })).unwrap()["id"].str_or_empty().to_owned();
		let sheet = json!({ "id": "f_sheet", "origin": "copied", "name": "HW6.pdf", "path": "p", "kind": "info", "contentFp": "x", "status": "ready", "addedAt": "t" });
		app.stores.spaces.save_files(&space_id, vec![sheet], &[]).unwrap();
		let deadline_id = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "HW6", "kind": "homework", "date": "2099-01-15", "assignmentFileId": "f_sheet" })).unwrap()["id"].str_or_empty().to_owned();
		let problems = deadline_problem_list(&app, &space_id, &deadline_id);
		assert_eq!(problems.post(&[json!({ "number": "1", "title": "Sums", "text": "Sum 1 to n." }), json!({ "number": "2", "title": "Bound", "text": "Bound it." })]), None);
		problems.mark_done("1");

		let record = app.stores.spaces.get_space(&space_id).unwrap();
		assert!(record["deadlines"][0].get("problems").is_none());
		assert_eq!(record["files"][0]["problems"][0]["done"], json!(true), "kept on the assignment file");
		assert_eq!(problems.problems().len(), 2);
		assert_eq!(homework_view(&app, &space_id, &deadline_id).unwrap()["problems"], record["files"][0]["problems"]);
		assert_eq!(list_open_deadlines(&app)[0]["problems"], record["files"][0]["problems"]);
	}
}
