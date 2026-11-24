//! Homework sessions (homework.ts): a new one opens with the space card and a note on the
//! deadline, its assignment file and its problems. Its tools work on the deadline's problem list
//! (`lesson_problems`).

use std::sync::Arc;

use gs_base::clock;
use gs_base::locks::LockKey;
use gs_core::messages::native_messages::{new_space_context_message, new_study_context_message};
use gs_core::spaces::problem_list::problem_list;
use gs_core::study::homework::{due_today_line, has_problems, homework_context_text};
use gs_json::{Json, json};

use super::lessons::{Created, NotFound};
use crate::App;
use crate::graph::study_start::deadline_topics_for;
use crate::spaces::space_card::{space_card_for, space_file_path};

pub(super) fn deadline_of<'a>(space: &'a Json, deadline_id: &str) -> Option<&'a Json> {
	space["deadlines"].as_arr()?.iter().find(|d| d["id"].as_str() == Some(deadline_id))
}

pub(super) fn file_of<'a>(space: &'a Json, deadline: &Json) -> Option<&'a Json> {
	let file_id = deadline["assignmentFileId"].as_str().filter(|id| !id.is_empty())?;
	space["files"].as_arr()?.iter().find(|f| f["id"].as_str() == Some(file_id))
}

/// The clock a homework lesson's work items end with on the day its deadline is due
/// (`due_today_line`); None for any other lesson.
pub fn due_today_line_for(app: &App, lesson: &Json) -> Option<String> {
	if lesson["kind"].as_str() != Some("homework") {
		return None;
	}
	let space = app.stores.spaces.get_space(lesson["spaceId"].as_str()?)?;
	due_today_line(deadline_of(&space, lesson["deadlineId"].as_str()?)?, clock::now_ms())
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
	let chat = app.stores.chats.create_chat(&title, Some("homework"), Some(space_id), deadline["id"].as_str(), &[])?;
	let chat_id = chat["id"].str_or_empty().to_owned();
	let problems = problem_list(&space, deadline);
	let topics = deadline_topics_for(app, space_id, deadline_id)?;
	let note = homework_context_text(space_id, deadline, &assignment, problems, &topics);
	let messages = [new_space_context_message(&space_card_for(app, &space)?), new_study_context_message(&note, "homework-context")];
	app.stores.chats.save_messages(&chat_id, &messages)?;
	let chat = app.stores.chats.get_chat(&chat_id).unwrap_or(chat);
	Ok(Ok(Created { chat, title }))
}
