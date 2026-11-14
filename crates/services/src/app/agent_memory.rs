//! What godspeed remembers for outside agents: the "Where you left off" briefing an agent gets
//! when it connects, and the saved notes as Settings lists them.

use gs_base::clock;
use gs_core::spaces::agent_briefing::{BriefingSpace, BriefingInput, BriefingLesson, agent_briefing};
use gs_core::spaces::space_setup::missing_setup;
use gs_json::{Json, json};

use crate::App;

/// The briefing, at most `max_chars` long. A note or lesson with a time that isn't one cannot be
/// saved, so the briefing has no failure to report.
pub fn current_agent_briefing(app: &App, max_chars: usize) -> String {
	let spaces = app
		.stores
		.spaces
		.list_space_records()
		.iter()
		.map(|record| BriefingSpace {
			id: record["id"].as_str().unwrap_or_default().to_owned(),
			name: record["name"].as_str().unwrap_or_default().to_owned(),
			archived: record["archived"].truthy(),
			deadlines: record["deadlines"].as_arr().cloned().unwrap_or_default(),
			missing_setup: missing_setup(record).into_iter().map(str::to_owned).collect(),
		})
		.collect();
	let lessons = app
		.stores
		.chats
		.list_chats()
		.iter()
		.map(|chat| BriefingLesson {
			id: chat["id"].as_str().unwrap_or_default().to_owned(),
			title: chat["title"].as_str().unwrap_or_default().to_owned(),
			space_id: chat["spaceId"].as_str().filter(|id| !id.is_empty()).map(str::to_owned),
			updated_at: chat["updatedAt"].as_str().unwrap_or_default().to_owned(),
			waiting: chat["pendingQuestion"].truthy() || chat["pendingProblem"].truthy(),
		})
		.collect();
	let input = BriefingInput { now_ms: clock::now_ms(), spaces, lessons, notes: app.stores.agent_notes.list_agent_notes(), max_chars };
	agent_briefing(&input).unwrap_or_default()
}

/// The notes with their space names, oldest first.
pub fn agent_notes_view(app: &App) -> Json {
	app.stores
		.agent_notes
		.list_agent_notes()
		.iter()
		.map(|note| {
			let space_name = note["spaceId"].as_str().and_then(|id| app.stores.spaces.get_space(id)).map(|space| space["name"].clone());
			json!({ "id": note["id"], "text": note["text"], "spaceName": space_name, "createdAt": note["createdAt"] })
		})
		.collect()
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn notes_show_their_space_name_or_none() {
		let root = scratch_dir("memory-notes");
		let app = test_app(&root);
		app.stores.agent_notes.add_agent_note("Prefers short answers", None).unwrap();
		app.stores.agent_notes.add_agent_note("Test is open book", Some("cls_gone")).unwrap();
		let view = agent_notes_view(&app);
		assert_eq!(stringify(&json!([view[0]["text"], view[0]["spaceName"], view[1]["text"], view[1]["spaceName"]])), r#"["Prefers short answers",null,"Test is open book",null]"#);
		assert_eq!(view[0].as_obj().unwrap().keys().map(String::as_str).collect::<Vec<_>>(), ["id", "text", "spaceName", "createdAt"]);
	}

	#[test]
	fn the_briefing_of_an_empty_app_is_short_and_bounded() {
		let root = scratch_dir("memory-briefing");
		let app = test_app(&root);
		let briefing = current_agent_briefing(&app, 4000);
		assert!(!briefing.is_empty() && briefing.len() <= 4000, "{briefing}");
	}
}
