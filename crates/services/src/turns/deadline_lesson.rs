//! A deadline's lesson as its keys start it (use-lesson-start.ts): Study continues its unfinished
//! Study session, else starts one on its topics; Work on continues its latest homework session,
//! else starts one. start_lesson runs it for the agent.

use std::sync::Arc;

use gs_base::clock;
use gs_core::contracts::space::due_at;
use gs_core::study::homework::has_problems;
use gs_core::study::topic_end::lesson_stop;

use super::homework::create_homework;
use super::lesson_events::keep_going;
use super::lessons::{CreateLessonInput, Created, LessonStart, NotFound, create_lesson};
use crate::App;
use crate::graph::progress::progress_for;

#[derive(Debug, PartialEq)]
pub enum DeadlineLesson {
	/// Made now: its title is the learner's first message.
	New { chat_id: String, title: String },
	/// An earlier session, where the learner goes on.
	Continued { chat_id: String, title: String },
}

/// The deadline's Work on key with `homework`, else its Study key, in a space that exists.
/// Ok(Err) holds the refusal for a key the window doesn't show.
pub fn deadline_lesson(app: &Arc<App>, space_id: &str, deadline_id: &str, homework: bool) -> Result<Result<DeadlineLesson, String>, String> {
	let Some(progress) = progress_for(app, space_id, None)? else { return Ok(Err(no_deadline(deadline_id))) };
	let Some(deadline) = progress["deadlines"].items().iter().find(|d| d["id"].as_str() == Some(deadline_id)).cloned() else {
		return Ok(Err(no_deadline(deadline_id)));
	};
	let name = deadline["name"].str_or_empty();
	if deadline["done"].truthy() {
		return Ok(Err(format!("{name} is marked done.")));
	}
	if homework {
		if !has_problems(deadline["kind"].str_or_empty()) {
			return Ok(Err(format!("{name} is not homework or a project, so it has no problems to work on. Leave homework out to study for it.")));
		}
		if let Some(chat_id) = deadline["continueHomework"].as_str() {
			return Ok(Ok(continued(app, chat_id)));
		}
		return Ok(created(create_homework(app, space_id, deadline_id)?));
	}
	if due_at(&deadline).is_some_and(|due| due <= clock::now_ms()) {
		return Ok(Err(format!("{name} is past its due time, so it has no Study session. Start a lesson with a topic instead.")));
	}
	if let Some(chat_id) = deadline["continueStudy"]["chatId"].as_str() {
		if deadline["continueStudy"]["stop"].truthy() {
			keep_going_at_stop(app, chat_id);
		}
		return Ok(Ok(continued(app, chat_id)));
	}
	Ok(created(create_lesson(app, CreateLessonInput { space_id: Some(space_id.to_owned()), start: LessonStart::Deadline(deadline_id.to_owned()), for_deadline: None })?))
}

fn no_deadline(deadline_id: &str) -> String {
	format!("No deadline \"{deadline_id}\" in this space. Use read_space.")
}

pub(super) fn continued(app: &App, chat_id: &str) -> DeadlineLesson {
	let title = app.stores.chats.get_chat(chat_id).map(|c| c["title"].str_or_empty().to_owned()).unwrap_or_default();
	DeadlineLesson::Continued { chat_id: chat_id.to_owned(), title }
}

pub(super) fn created(made: Result<Created, NotFound>) -> Result<DeadlineLesson, String> {
	made.map(|c| DeadlineLesson::New { chat_id: c.chat["id"].str_or_empty().to_owned(), title: c.title }).map_err(|not_found| not_found.error.to_owned())
}

/// Keep going is stored first, as the window does, so the next topic's opener shows. One that
/// can't be stored leaves the lesson at its stop, where its card offers Keep going again.
pub(super) fn keep_going_at_stop(app: &App, chat_id: &str) {
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return };
	let Some(stop) = lesson_stop(record["messages"].items(), None, None).filter(|s| !s["keptGoing"].truthy()) else { return };
	if let Err(err) = keep_going(app, chat_id, stop["stopOf"].str_or_empty()) {
		eprintln!("[start_lesson] keep going at {chat_id}'s stop failed: {err}");
	}
}

#[cfg(test)]
mod tests {
	use gs_base::time;
	use gs_json::json;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	fn space(app: &App) -> String {
		app.stores.spaces.create_space(&json!({ "name": "Algebra" })).unwrap()["id"].str_or_empty().to_owned()
	}

	fn deadline(app: &App, space_id: &str, kind: &str, date: &str) -> String {
		app.stores.spaces.add_deadline(space_id, &json!({ "name": "HW6", "kind": kind, "date": date })).unwrap()["id"].str_or_empty().to_owned()
	}

	fn id(lesson: &DeadlineLesson) -> &str {
		match lesson {
			DeadlineLesson::New { chat_id, .. } | DeadlineLesson::Continued { chat_id, .. } => chat_id,
		}
	}

	#[test]
	fn study_starts_by_name_then_continues_the_same_session() {
		let root = scratch_dir("deadline-lesson-study");
		let app = test_app(&root);
		let space_id = space(&app);
		let deadline_id = deadline(&app, &space_id, "exam", "2099-01-15");
		let first = deadline_lesson(&app, &space_id, &deadline_id, false).unwrap().unwrap();
		assert!(matches!(&first, DeadlineLesson::New { title, .. } if title == "Study for HW6"), "{first:?}");
		let again = deadline_lesson(&app, &space_id, &deadline_id, false).unwrap().unwrap();
		assert_eq!(again, DeadlineLesson::Continued { chat_id: id(&first).to_owned(), title: "Study for HW6".to_owned() });
	}

	#[test]
	fn continuing_at_a_stop_stores_keep_going_first() {
		let root = scratch_dir("deadline-lesson-stop");
		let app = test_app(&root);
		let space_id = space(&app);
		let deadline_id = deadline(&app, &space_id, "exam", "2099-01-15");
		let chat_id = id(&deadline_lesson(&app, &space_id, &deadline_id, false).unwrap().unwrap()).to_owned();
		app.stores.chats.save_tree(&chat_id, &json!({ "nodes": [{ "id": "reg", "title": "Regularization" }, { "id": "cv", "title": "Cross-validation" }], "edges": [] })).unwrap();
		let stop = json!({ "kind": "topic", "nodeId": "reg", "activeMinutes": 30, "at": time::iso(clock::now_ms()) });
		let stopped = vec![
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "c1", "name": "conclude", "arguments": { "outcome": "solved" } }], "timestamp": clock::now_ms() }),
			json!({ "role": "toolResult", "toolCallId": "c1", "toolName": "conclude", "details": { "stop": stop }, "isError": false, "timestamp": clock::now_ms() }),
		];
		app.stores.chats.save_messages(&chat_id, &stopped).unwrap();
		let again = deadline_lesson(&app, &space_id, &deadline_id, false).unwrap().unwrap();
		assert_eq!(id(&again), chat_id);
		let messages = app.stores.chats.get_chat(&chat_id).unwrap()["messages"].items().to_vec();
		assert_eq!(messages.last().unwrap()["customType"], json!("keep-going"));
		assert_eq!(messages.last().unwrap()["details"]["stopOf"], json!("c1"));
	}

	#[test]
	fn work_on_starts_homework_then_continues_it() {
		let root = scratch_dir("deadline-lesson-homework");
		let app = test_app(&root);
		let space_id = space(&app);
		let deadline_id = deadline(&app, &space_id, "homework", "2099-01-15");
		let first = deadline_lesson(&app, &space_id, &deadline_id, true).unwrap().unwrap();
		assert!(matches!(&first, DeadlineLesson::New { title, .. } if title == "Work on HW6"), "{first:?}");
		assert_eq!(app.stores.chats.get_chat(id(&first)).unwrap()["kind"], json!("homework"));
		let again = deadline_lesson(&app, &space_id, &deadline_id, true).unwrap().unwrap();
		assert_eq!(again, DeadlineLesson::Continued { chat_id: id(&first).to_owned(), title: "Work on HW6".to_owned() });
	}

	#[test]
	fn refuses_what_the_window_offers_no_key_for() {
		let root = scratch_dir("deadline-lesson-refusals");
		let app = test_app(&root);
		let space_id = space(&app);
		let refused = |deadline_id: &str, homework: bool| deadline_lesson(&app, &space_id, deadline_id, homework).unwrap().unwrap_err();
		assert_eq!(refused("ddl_gone", false), "No deadline \"ddl_gone\" in this space. Use read_space.");
		let exam = deadline(&app, &space_id, "exam", "2099-01-15");
		assert_eq!(refused(&exam, true), "HW6 is not homework or a project, so it has no problems to work on. Leave homework out to study for it.");
		let past = deadline(&app, &space_id, "homework", "2001-01-15");
		assert!(refused(&past, false).starts_with("HW6 is past its due time"));
		assert!(deadline_lesson(&app, &space_id, &past, true).unwrap().is_ok(), "Work on stays after the date");
		app.stores.spaces.update_deadline(&space_id, &exam, &json!({ "done": true })).unwrap();
		assert_eq!(refused(&exam, false), "HW6 is marked done.");
	}
}
