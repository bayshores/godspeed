//! A lesson on files (POST /api/chats with fileIds, start_lesson with file_ids). The first file
//! names the lesson and owns its problem list. Its deadline's assignment sheet is that deadline's
//! homework; else an unfinished lesson on the same first file goes on; else a new one starts, tied
//! to the one open deadline that covers every file.

use std::collections::HashSet;
use std::sync::Arc;

use gs_base::clock;
use gs_core::contracts::space::is_upcoming;
use gs_core::study::homework::has_problems;
use gs_json::Json;

use super::deadline_lesson::{DeadlineLesson, continued, created, deadline_lesson, keep_going_at_stop};
use super::lessons::{CreateLessonInput, LessonStart, create_lesson};
use crate::App;
use crate::graph::progress::progress_for;
use crate::spaces::space_actions::{CLOSED_SPACE, no_space_text};

/// Most files one lesson works from.
pub const MAX_LESSON_FILES: usize = 8;

/// The lesson on `file_ids` (first file first) in `space_id`, or in the space that holds them;
/// `deadline_id` ties a new one to that deadline. Ok(Err) is the refusal, in words for the
/// learner's agent; the lesson comes with its space id.
pub fn files_lesson(app: &Arc<App>, space_id: Option<&str>, file_ids: &[String], deadline_id: Option<&str>) -> Result<Result<(String, DeadlineLesson), String>, String> {
	let space = match space_of(app, space_id, file_ids) {
		Ok(space) => space,
		Err(refused) => return Ok(Err(refused)),
	};
	if space["closed"].truthy() {
		return Ok(Err(CLOSED_SPACE.to_owned()));
	}
	let space_id = space["id"].str_or_empty().to_owned();
	let deadlines = space["deadlines"].items();
	if let Some(id) = deadline_id
		&& !deadlines.iter().any(|d| d["id"].as_str() == Some(id))
	{
		return Ok(Err(format!("No deadline \"{id}\" in this space. Use read_space.")));
	}
	let now = clock::now_ms();
	let first = file_ids[0].as_str();
	let homework = deadlines.iter().find(|d| has_problems(d["kind"].str_or_empty()) && d["assignmentFileId"].as_str() == Some(first) && is_upcoming(d, now) && deadline_id.is_none_or(|id| d["id"].as_str() == Some(id)));
	if let Some(deadline) = homework {
		return Ok(deadline_lesson(app, &space_id, deadline["id"].str_or_empty(), true)?.map(|lesson| (space_id, lesson)));
	}
	if let Some(chat_id) = unfinished_on(app, &space_id, first)? {
		keep_going_at_stop(app, &chat_id);
		return Ok(Ok((space_id, continued(app, &chat_id))));
	}
	let tie = deadline_id.map(str::to_owned).or_else(|| {
		let mut covering = deadlines.iter().filter(|d| is_upcoming(d, now) && file_ids.iter().all(|f| covers(d, f)));
		match (covering.next(), covering.next()) {
			(Some(only), None) => only["id"].as_str().map(str::to_owned),
			_ => None,
		}
	});
	let made = create_lesson(app, CreateLessonInput { space_id: Some(space_id.clone()), start: LessonStart::Files(file_ids.to_vec()), for_deadline: tie })?;
	Ok(created(made).map(|lesson| (space_id, lesson)))
}

/// The space that holds every file, which a given `space_id` must be.
fn space_of(app: &App, space_id: Option<&str>, file_ids: &[String]) -> Result<Json, String> {
	if file_ids.is_empty() || file_ids.len() > MAX_LESSON_FILES {
		return Err(format!("Give 1 to {MAX_LESSON_FILES} file ids."));
	}
	let mut seen = HashSet::new();
	if let Some(twice) = file_ids.iter().find(|id| !seen.insert(id.as_str())) {
		return Err(format!("File \"{twice}\" is named twice."));
	}
	if let Some(id) = space_id
		&& app.stores.spaces.get_space(id).is_none()
	{
		return Err(no_space_text(id));
	}
	let spaces = app.stores.spaces.list_space_records();
	let mut homes = Vec::new();
	for id in file_ids {
		let Some(home) = spaces.iter().position(|s| s["files"].items().iter().any(|f| f["id"].as_str() == Some(id.as_str()))) else {
			return Err(format!("No file \"{id}\". Use read_space with files: true."));
		};
		if !homes.contains(&home) {
			homes.push(home);
		}
	}
	let [home] = homes[..] else { return Err("The files are in more than one space. A lesson works from files of one space.".to_owned()) };
	let space = spaces.into_iter().nth(home).unwrap_or_default();
	match space_id {
		Some(id) if space["id"].as_str() != Some(id) => Err(format!("The files are not in space \"{id}\". Use read_space with files: true.")),
		_ => Ok(space),
	}
}

/// Whether the deadline covers the file: one it names, its assignment or its about file, never
/// one it leaves out.
fn covers(deadline: &Json, file_id: &str) -> bool {
	let named = |key: &str| deadline[key].as_str() == Some(file_id);
	let listed = deadline["fileIds"].items().iter().any(|f| f.as_str() == Some(file_id));
	let left_out = deadline["leftOutIds"].items().iter().any(|f| f.as_str() == Some(file_id));
	(listed || named("assignmentFileId") || named("aboutFileId")) && !left_out
}

/// The newest unfinished study lesson whose first file is `file_id`.
fn unfinished_on(app: &App, space_id: &str, file_id: &str) -> Result<Option<String>, String> {
	let on_file: HashSet<String> = app
		.stores
		.chats
		.list_chats()
		.into_iter()
		.filter(|c| c["spaceId"].as_str() == Some(space_id) && c["kind"].as_str() == Some("study") && c["fileIds"][0].as_str() == Some(file_id))
		.filter_map(|c| c["id"].as_str().map(str::to_owned))
		.collect();
	if on_file.is_empty() {
		return Ok(None);
	}
	let progress = progress_for(app, space_id, None)?.unwrap_or(Json::Null);
	// Progress lists lessons newest first.
	Ok(progress["lessons"].items().iter().filter(|l| l["unfinished"].truthy()).filter_map(|l| l["chatId"].as_str()).find(|id| on_file.contains(*id)).map(str::to_owned))
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	fn file(id: &str, name: &str) -> Json {
		json!({ "id": id, "origin": "copied", "name": name, "path": name, "kind": "info", "contentFp": "x", "status": "ready", "addedAt": "t" })
	}

	/// A space with a practice test, its key and notes.
	fn space(app: &App) -> String {
		let id = app.stores.spaces.create_space(&json!({ "name": "Calculus" })).unwrap()["id"].str_or_empty().to_owned();
		app.stores.spaces.save_files(&id, vec![file("f_test", "Practice midterm.pdf"), file("f_key", "Key.pdf"), file("f_notes", "Notes.md")], &[]).unwrap();
		id
	}

	fn ids(list: &[&str]) -> Vec<String> {
		list.iter().map(|id| (*id).to_owned()).collect()
	}

	fn start(app: &Arc<App>, files: &[&str], deadline_id: Option<&str>) -> DeadlineLesson {
		files_lesson(app, None, &ids(files), deadline_id).unwrap().unwrap().1
	}

	fn chat_of(app: &App, lesson: &DeadlineLesson) -> Json {
		let (DeadlineLesson::New { chat_id, .. } | DeadlineLesson::Continued { chat_id, .. }) = lesson;
		app.stores.chats.get_chat(chat_id).unwrap()
	}

	fn deadline(app: &App, space_id: &str, init: Json) -> String {
		app.stores.spaces.add_deadline(space_id, &init).unwrap()["id"].str_or_empty().to_owned()
	}

	#[test]
	fn a_new_lesson_is_named_after_its_first_file_and_goes_on_while_unfinished() {
		let root = scratch_dir("files-lesson-new");
		let app = test_app(&root);
		space(&app);
		let first = start(&app, &["f_test", "f_key"], None);
		assert!(matches!(&first, DeadlineLesson::New { title, .. } if title == "Practice midterm"), "{first:?}");
		let chat = chat_of(&app, &first);
		assert_eq!((chat["kind"].as_str(), chat["fileIds"].clone(), chat.get("deadlineId")), (Some("study"), json!(["f_test", "f_key"]), None));
		let note = chat["messages"].items().iter().filter_map(|m| m["content"].as_str()).find(|t| t.contains("[Files]")).unwrap_or_default().to_owned();
		assert!(note.contains("[Files] Lesson works from Practice midterm.pdf (file id f_test, at ") && note.contains("Key.pdf (file id f_key, at ") && note.contains("No problems posted yet."), "{note}");

		let again = start(&app, &["f_test"], None);
		assert_eq!(again, DeadlineLesson::Continued { chat_id: chat["id"].str_or_empty().to_owned(), title: "Practice midterm".to_owned() }, "the same first file goes on");
		assert!(matches!(start(&app, &["f_key", "f_test"], None), DeadlineLesson::New { title, .. } if title == "Key"), "another first file is another lesson");
	}

	#[test]
	fn an_open_homeworks_sheet_starts_its_homework() {
		let root = scratch_dir("files-lesson-homework");
		let app = test_app(&root);
		let space_id = space(&app);
		let hw = deadline(&app, &space_id, json!({ "name": "HW6", "kind": "homework", "date": "2099-01-15", "assignmentFileId": "f_test" }));
		let lesson = start(&app, &["f_test", "f_key"], None);
		let chat = chat_of(&app, &lesson);
		assert_eq!((chat["kind"].as_str(), chat["deadlineId"].as_str()), (Some("homework"), Some(hw.as_str())));
		assert!(matches!(start(&app, &["f_test"], None), DeadlineLesson::Continued { .. }), "as Work on goes on");
		app.stores.spaces.update_deadline(&space_id, &hw, &json!({ "done": true })).unwrap();
		assert_eq!(chat_of(&app, &start(&app, &["f_test"], None))["kind"].as_str(), Some("study"), "a done homework's sheet is studied");
	}

	#[test]
	fn a_new_lesson_is_tied_to_the_one_open_deadline_covering_every_file() {
		let root = scratch_dir("files-lesson-tie");
		let app = test_app(&root);
		let space_id = space(&app);
		let exam = deadline(&app, &space_id, json!({ "name": "Midterm", "kind": "exam", "date": "2099-01-15", "fileIds": ["f_test", "f_notes"], "aboutFileId": "f_key" }));
		deadline(&app, &space_id, json!({ "name": "Old quiz", "kind": "quiz", "date": "2001-01-15", "fileIds": ["f_test"] }));
		assert_eq!(chat_of(&app, &start(&app, &["f_test", "f_key"], None))["deadlineId"].as_str(), Some(exam.as_str()), "the about file counts, a past deadline does not");
		let final_exam = deadline(&app, &space_id, json!({ "name": "Final", "kind": "exam", "date": "2099-03-15", "fileIds": ["f_key", "f_test"] }));
		assert_eq!(chat_of(&app, &start(&app, &["f_key"], None)).get("deadlineId"), None, "two deadlines cover it: no tie");
		assert_eq!(chat_of(&app, &start(&app, &["f_notes"], Some(&final_exam)))["deadlineId"].as_str(), Some(final_exam.as_str()), "a named deadline wins");
		assert!(!covers(&json!({ "fileIds": ["f_notes"], "leftOutIds": ["f_notes"] }), "f_notes"), "a left-out file is not covered");
	}

	#[test]
	fn refusals_say_why() {
		let root = scratch_dir("files-lesson-refusals");
		let app = test_app(&root);
		let space_id = space(&app);
		let other = app.stores.spaces.create_space(&json!({ "name": "History" })).unwrap()["id"].str_or_empty().to_owned();
		app.stores.spaces.save_files(&other, vec![file("f_essay", "Essay.md")], &[]).unwrap();
		let refused = |space: Option<&str>, files: &[&str], deadline_id: Option<&str>| files_lesson(&app, space, &ids(files), deadline_id).unwrap().unwrap_err();
		assert_eq!(refused(None, &["f_gone"], None), "No file \"f_gone\". Use read_space with files: true.");
		assert_eq!(refused(None, &["f_test", "f_essay"], None), "The files are in more than one space. A lesson works from files of one space.");
		assert_eq!(refused(Some(&other), &["f_test"], None), format!("The files are not in space \"{other}\". Use read_space with files: true."));
		assert_eq!(refused(None, &[], None), "Give 1 to 8 file ids.");
		assert_eq!(refused(None, &["f_test"; 9], None), "Give 1 to 8 file ids.");
		assert_eq!(refused(None, &["f_test", "f_test"], None), "File \"f_test\" is named twice.");
		assert_eq!(refused(None, &["f_test"], Some("ddl_none")), "No deadline \"ddl_none\" in this space. Use read_space.");
		app.stores.spaces.update_space(&space_id, &json!({ "closed": true })).unwrap();
		assert_eq!(refused(None, &["f_test"], None), CLOSED_SPACE);
	}
}
