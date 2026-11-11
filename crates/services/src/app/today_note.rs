//! The [Today] note for a lesson, built from this computer's clock and the lesson's class as it
//! stands now (gs_core's today_note has the text and the append rule).

use gs_base::clock;
use gs_core::classes::today_note::{today_note_text, today_note_to_append, wall_clock};
use gs_core::session::practice_outcomes::practice_outcomes;
use gs_json::{Json, json};

use crate::App;

/// The class's problems (practice and study) the learner solved only with hints.
fn hinted_problems(app: &App, class_id: &str) -> Vec<Json> {
	app.stores
		.chats
		.list_chats()
		.iter()
		.filter(|chat| chat["classId"].as_str() == Some(class_id))
		.filter_map(|chat| app.stores.chats.get_chat(chat["id"].as_str()?))
		.flat_map(|chat| practice_outcomes(chat["messages"].as_arr().map_or(&[][..], Vec::as_slice)))
		.filter(|outcome| outcome["outcome"].as_str() == Some("solvedWithHints"))
		.map(|outcome| json!({ "statement": outcome["statement"], "at": outcome["at"] }))
		.collect()
}

/// The class part of the note. Archived classes show none.
fn note_class(app: &App, class_id: Option<&str>) -> Option<Json> {
	let id = class_id.filter(|id| !id.is_empty())?;
	let class = app.stores.classes.get_class(id)?;
	if class["archived"].truthy() {
		return None;
	}
	let hinted = hinted_problems(app, id);
	Some(json!({ "deadlines": class["deadlines"].as_arr().cloned().unwrap_or_default(), "files": class["files"], "hinted": hinted }))
}

/// The note as it stands now, for read_class.
pub fn current_today_note(app: &App, class_id: Option<&str>) -> String {
	today_note_text(clock::now_ms(), note_class(app, class_id).as_ref())
}

/// The note to append before the learner's next message, or None.
pub fn today_note_for(app: &App, record: &Json) -> Option<Json> {
	let now = clock::now_ms();
	let text = today_note_text(now, note_class(app, record["classId"].as_str()).as_ref());
	today_note_to_append(record["messages"].as_arr().map_or(&[][..], Vec::as_slice), &text, &wall_clock(now).day)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn a_lesson_without_a_class_gets_the_date_once_a_day() {
		let root = scratch_dir("today-note");
		let app = test_app(&root);
		let record = json!({ "id": "chat_a", "messages": [] });
		let note = today_note_for(&app, &record).unwrap();
		assert_eq!(note["customType"].as_str(), Some("today-context"));
		assert!(note["content"].as_str().unwrap().starts_with("[Today] "));
		let with_note = json!({ "id": "chat_a", "messages": [note] });
		assert_eq!(today_note_for(&app, &with_note), None);
	}

	#[test]
	fn a_missing_or_unknown_class_adds_nothing_to_the_note() {
		let root = scratch_dir("today-note-class");
		let app = test_app(&root);
		assert_eq!(note_class(&app, None), None);
		assert_eq!(note_class(&app, Some("")), None);
		assert_eq!(note_class(&app, Some("cls_gone")), None);
		assert_eq!(hinted_problems(&app, "cls_gone"), Vec::<Json>::new());
	}
}
