//! The [Today] note for a lesson, built from this computer's clock and the lesson's space as it
//! stands now (gs_core's today_note has the text and the append rule).

use gs_base::clock;
use gs_core::spaces::today_note::{today_note_text, today_note_to_append, wall_clock};
use gs_core::session::practice_outcomes::practice_outcomes;
use gs_json::{Json, json};

use crate::App;

/// The space's problems (practice and study) the learner solved only with hints.
fn hinted_problems(app: &App, space_id: &str) -> Vec<Json> {
	app.stores
		.chats
		.list_chats()
		.iter()
		.filter(|chat| chat["spaceId"].as_str() == Some(space_id))
		.filter_map(|chat| app.stores.chats.get_chat(chat["id"].as_str()?))
		.flat_map(|chat| practice_outcomes(chat["messages"].as_arr().map_or(&[][..], Vec::as_slice)))
		.filter(|outcome| outcome["outcome"].as_str() == Some("solvedWithHints"))
		.map(|outcome| json!({ "statement": outcome["statement"], "at": outcome["at"] }))
		.collect()
}

/// The space part of the note. Closed spaces show none.
fn note_space(app: &App, space_id: Option<&str>) -> Option<Json> {
	let id = space_id.filter(|id| !id.is_empty())?;
	let space = app.stores.spaces.get_space(id)?;
	if space["closed"].truthy() {
		return None;
	}
	let hinted = hinted_problems(app, id);
	Some(json!({ "deadlines": space["deadlines"].as_arr().cloned().unwrap_or_default(), "files": space["files"], "hinted": hinted }))
}

/// The note as it stands now, for read_space.
pub fn current_today_note(app: &App, space_id: Option<&str>) -> String {
	today_note_text(clock::now_ms(), note_space(app, space_id).as_ref())
}

/// The note to append before the learner's next message, or None.
pub fn today_note_for(app: &App, record: &Json) -> Option<Json> {
	let now = clock::now_ms();
	let text = today_note_text(now, note_space(app, record["spaceId"].as_str()).as_ref());
	today_note_to_append(record["messages"].as_arr().map_or(&[][..], Vec::as_slice), &text, &wall_clock(now).day)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn a_lesson_without_a_space_gets_the_date_once_a_day() {
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
	fn a_missing_or_unknown_space_adds_nothing_to_the_note() {
		let root = scratch_dir("today-note-space");
		let app = test_app(&root);
		assert_eq!(note_space(&app, None), None);
		assert_eq!(note_space(&app, Some("")), None);
		assert_eq!(note_space(&app, Some("cls_gone")), None);
		assert_eq!(hinted_problems(&app, "cls_gone"), Vec::<Json>::new());
	}
}
