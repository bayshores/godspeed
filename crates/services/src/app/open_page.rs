//! open_page: the agent opens a page in the learner's window, even with Follow off. The open is
//! an activity entry marked `open`, which the window shows unless the learner has unsent lesson
//! text, a running mock or a dialog (then the strip's peek offers Go to), and the shell brings the window
//! forward, made again on that page when it was closed. A lesson on the cheat sheet's deadline
//! opens the sheet beside itself instead.

use std::sync::Arc;

use gs_agent::tools::open_page::OpenPage;
use gs_core::spaces::space_tools::ToolOutcome;
use gs_core::study::cheat_sheet::ParsedSheet;
use gs_json::{Json, json};

use super::agent_actions::note_agent_action;
use super::settings_record::teacher_name;
use super::terminal_state::WindowPage;
use crate::App;
use crate::spaces::deadline_with_space;
use crate::spaces::space_actions::{CLOSED_SPACE, no_space_text};

/// Where an open goes: the window's path, its space, the page's name for the activity entry, the
/// item Follow lights there (the space's tab, always shown), and a note for the agent.
#[derive(Debug, PartialEq)]
struct PageTarget {
	path: String,
	space_id: Option<String>,
	name: String,
	target: Json,
	note: Option<&'static str>,
}

const NOT_MADE: &str = "Its cheat sheet isn't made yet; the page shows that, and making one starts from there.";
const BESIDE_LESSON: &str = "It opens beside the learner's lesson on that deadline.";

/// The space page's path and name.
fn space_page(page: &str) -> Option<(&'static str, &'static str)> {
	Some(match page {
		"progress" => ("/space", "Progress"),
		"files" => ("/space/files", "Files"),
		"deadlines" => ("/space/deadlines", "Deadlines"),
		"graph" => ("/graph", "Graph"),
		_ => return None,
	})
}

fn space_target(space_id: Option<&str>) -> Json {
	space_id.map_or(Json::Null, |id| json!({ "kind": "space", "id": id }))
}

/// The page `args` asks for (`page`, and `space_id`, `deadline_id` or `lesson_id`), checked; Err
/// holds the refusal.
fn page_for(app: &App, args: &Json) -> Result<PageTarget, String> {
	let page = args["page"].str_or_empty();
	if page == "home" {
		return Ok(PageTarget { path: "/".to_owned(), space_id: None, name: "Home".to_owned(), target: Json::Null, note: None });
	}
	if let Some((path, name)) = space_page(page) {
		let space_id = args["space_id"].as_str().filter(|id| *id != "none");
		let Some(space_id) = space_id else {
			if matches!(page, "files" | "deadlines") {
				return Err(format!("{name} needs a space_id."));
			}
			return Ok(PageTarget { path: path.to_owned(), space_id: None, name: format!("No space's {name}"), target: Json::Null, note: None });
		};
		let space = app.stores.spaces.get_space(space_id).ok_or_else(|| no_space_text(space_id))?;
		if space["closed"].truthy() {
			return Err(CLOSED_SPACE.to_owned());
		}
		let name = format!("{}'s {name}", space["name"].str_or_empty());
		return Ok(PageTarget { path: path.to_owned(), space_id: Some(space_id.to_owned()), name, target: space_target(Some(space_id)), note: None });
	}
	if page == "lesson" {
		let Some(lesson_id) = args["lesson_id"].as_str() else { return Err("lesson needs a lesson_id.".to_owned()) };
		let lesson = app.stores.chats.get_chat(lesson_id).ok_or_else(|| format!("No lesson \"{lesson_id}\". Use list_lessons."))?;
		let space_id = lesson["spaceId"].as_str().map(str::to_owned);
		let name = lesson["title"].str_or_empty().to_owned();
		return Ok(PageTarget { path: format!("/chat/{lesson_id}"), target: space_target(space_id.as_deref()), space_id, name, note: None });
	}
	let Some(deadline_id) = args["deadline_id"].as_str() else { return Err(format!("{page} needs a deadline_id.")) };
	let found = deadline_with_space(app, deadline_id).ok_or_else(|| format!("No deadline \"{deadline_id}\". Use read_space."))?;
	let space_id = found["spaceId"].str_or_empty().to_owned();
	if app.stores.spaces.get_space(&space_id).is_some_and(|s| s["closed"].truthy()) {
		return Err(CLOSED_SPACE.to_owned());
	}
	let deadline = &found["deadline"];
	let name = deadline["name"].str_or_empty();
	let target = space_target(Some(&space_id));
	if page == "deadline" {
		return Ok(PageTarget { path: format!("/space/deadline/{deadline_id}"), space_id: Some(space_id), name: name.to_owned(), target, note: None });
	}
	if deadline["kind"].as_str() == Some("interview") {
		return Err(format!("{name} is an interview, and interviews have no cheat sheet."));
	}
	let made = app.stores.cheat_sheets.read_cheat_sheet(&space_id, deadline_id)?.is_some_and(|sheet| match sheet {
		ParsedSheet::Sheet(sheet) => !sheet["versions"].items().is_empty(),
		ParsedSheet::Newer => true,
	});
	let note = (!made).then_some(NOT_MADE);
	Ok(PageTarget { path: format!("/space/deadline/{deadline_id}/cheat-sheet"), space_id: Some(space_id), name: format!("{name}'s cheat sheet"), target, note })
}

/// The pages that show the window's own space.
const SPACE_PAGES: [&str; 4] = ["/space", "/space/files", "/space/deadlines", "/graph"];

/// What the agent hears when the window shows this page already, or a lesson on the cheat
/// sheet's deadline (the sheet then opens beside it).
fn already_there(app: &App, page: &PageTarget, here: Option<&WindowPage>) -> Option<&'static str> {
	let here = here?;
	let sheet_of = page.path.strip_prefix("/space/deadline/").and_then(|p| p.strip_suffix("/cheat-sheet"));
	if let (Some(lesson_id), Some(deadline_id)) = (here.path.strip_prefix("/chat/"), sheet_of) {
		let lesson = app.stores.chats.get_chat(lesson_id)?;
		return (lesson["deadlineId"].as_str() == Some(deadline_id)).then_some(BESIDE_LESSON);
	}
	let same_space = !SPACE_PAGES.contains(&page.path.as_str()) || here.space_id == page.space_id;
	(here.path == page.path && same_space).then_some("The learner is already on that page, so nothing moved.")
}

/// The page as the shell sends a window it made again there: with its space, so the window
/// switches to it first.
fn with_space(page: &PageTarget) -> String {
	if page.path == "/" {
		return page.path.clone();
	}
	format!("{}?space={}", page.path, page.space_id.as_deref().unwrap_or("none"))
}

/// Opens the page for `caller`; the answer says where it went.
pub fn open_page(app: &App, caller: Option<&str>, args: &Json) -> ToolOutcome {
	let page = match page_for(app, args) {
		Ok(page) => page,
		Err(refused) => return ToolOutcome::Err(refused),
	};
	let here = app.terminals.window_page();
	let there = already_there(app, &page, here.as_ref());
	let action = json!({ "label": format!("Opening {}", page.name), "spaceId": page.space_id, "target": page.target, "page": page.path, "open": true });
	note_agent_action(app, caller, &action);
	if let Some(shell) = &app.shell {
		shell.send(&gs_shell_rpc::ToShell::ShowWindow { page: with_space(&page) });
	}
	let said = there.unwrap_or("Sent to the godspeed window; it may offer Go to instead if the learner is typing.");
	let text = match page.note {
		Some(note) => format!("{said} {note}"),
		None => said.to_owned(),
	};
	ToolOutcome::Ok { value: json!({ "page": page.name, "note": text }), changes: Vec::new() }
}

/// open_page for a lesson's teacher or the cheat sheet's agent, named as the teacher.
pub fn agent_open_page(app: &Arc<App>) -> OpenPage {
	let app = app.clone();
	Arc::new(move |args| match open_page(&app, Some(&teacher_name(&app)), args) {
		ToolOutcome::Ok { value, .. } => Ok(value["note"].str_or_empty().to_owned()),
		ToolOutcome::Err(refused) => Err(refused),
	})
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::agent_actions::recent_agent_actions;
	use crate::app::test_support::{scratch_dir, test_app};

	fn note(outcome: ToolOutcome) -> String {
		match outcome {
			ToolOutcome::Ok { value, .. } => value["note"].str_or_empty().to_owned(),
			ToolOutcome::Err(error) => panic!("{error}"),
		}
	}

	fn refused(app: &App, args: Json) -> String {
		match open_page(app, None, &args) {
			ToolOutcome::Err(error) => error,
			ToolOutcome::Ok { value, .. } => panic!("opened {value:?}"),
		}
	}

	#[test]
	fn every_page_has_its_path_space_and_a_target_the_window_always_shows() {
		let root = scratch_dir("open-page-paths");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "CSE 21" })).unwrap()["id"].str_or_empty().to_owned();
		let deadline_id = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "HW6", "kind": "homework", "date": "2099-01-15" })).unwrap()["id"].str_or_empty().to_owned();
		let lesson_id = app.stores.chats.create_chat("Sums", Some("study"), Some(&space_id), None, &[]).unwrap()["id"].str_or_empty().to_owned();
		let tab = json!({ "kind": "space", "id": space_id });
		let cases = [
			(json!({ "page": "home" }), "/", None, "Home", Json::Null),
			(json!({ "page": "progress", "space_id": space_id }), "/space", Some(&space_id), "CSE 21's Progress", tab.clone()),
			(json!({ "page": "files", "space_id": space_id }), "/space/files", Some(&space_id), "CSE 21's Files", tab.clone()),
			(json!({ "page": "deadlines", "space_id": space_id }), "/space/deadlines", Some(&space_id), "CSE 21's Deadlines", tab.clone()),
			(json!({ "page": "graph", "space_id": space_id }), "/graph", Some(&space_id), "CSE 21's Graph", tab.clone()),
			(json!({ "page": "deadline", "deadline_id": deadline_id }), &format!("/space/deadline/{deadline_id}"), Some(&space_id), "HW6", tab.clone()),
			(json!({ "page": "cheat_sheet", "deadline_id": deadline_id }), &format!("/space/deadline/{deadline_id}/cheat-sheet"), Some(&space_id), "HW6's cheat sheet", tab.clone()),
			(json!({ "page": "lesson", "lesson_id": lesson_id }), &format!("/chat/{lesson_id}"), Some(&space_id), "Sums", tab),
		];
		for (args, path, space, name, target) in cases {
			let page = page_for(&app, &args).unwrap();
			assert_eq!((page.path.as_str(), page.space_id.as_ref(), page.name.as_str(), &page.target), (path, space, name, &target), "{args:?}");
		}
		let page = page_for(&app, &json!({ "page": "files", "space_id": space_id })).unwrap();
		assert_eq!(with_space(&page), format!("/space/files?space={space_id}"));
		assert_eq!(with_space(&page_for(&app, &json!({ "page": "home" })).unwrap()), "/");
	}

	#[test]
	fn each_refusal_says_what_to_fix() {
		let root = scratch_dir("open-page-refusals");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "CSE 21" })).unwrap()["id"].str_or_empty().to_owned();
		let interview = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "Onsite", "kind": "interview", "date": "2099-01-15" })).unwrap()["id"].str_or_empty().to_owned();
		assert_eq!(refused(&app, json!({ "page": "progress", "space_id": "spc_gone" })), "No space \"spc_gone\". Use list_spaces.");
		assert_eq!(refused(&app, json!({ "page": "files" })), "Files needs a space_id.");
		assert_eq!(refused(&app, json!({ "page": "deadlines", "space_id": "none" })), "Deadlines needs a space_id.");
		assert_eq!(refused(&app, json!({ "page": "deadline", "deadline_id": "ddl_gone" })), "No deadline \"ddl_gone\". Use read_space.");
		assert_eq!(refused(&app, json!({ "page": "cheat_sheet" })), "cheat_sheet needs a deadline_id.");
		assert_eq!(refused(&app, json!({ "page": "lesson" })), "lesson needs a lesson_id.");
		assert_eq!(refused(&app, json!({ "page": "lesson", "lesson_id": "chat_gone" })), "No lesson \"chat_gone\". Use list_lessons.");
		assert_eq!(refused(&app, json!({ "page": "cheat_sheet", "deadline_id": interview })), "Onsite is an interview, and interviews have no cheat sheet.");
		app.stores.spaces.update_space(&space_id, &json!({ "closed": true })).unwrap();
		assert_eq!(refused(&app, json!({ "page": "files", "space_id": space_id })), CLOSED_SPACE);
		assert!(recent_agent_actions(&app).is_empty(), "nothing refused is opened");
	}

	fn set_window(app: &App, page: Option<WindowPage>) {
		app.terminals.set_talk_page(None, page);
	}

	#[test]
	fn the_agent_hears_where_it_went_and_asked_twice_it_opens_twice() {
		let root = scratch_dir("open-page-notes");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "CSE 21" })).unwrap()["id"].str_or_empty().to_owned();
		let deadline_id = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "Midterm", "kind": "exam", "date": "2099-01-15" })).unwrap()["id"].str_or_empty().to_owned();
		let sheet = json!({ "page": "cheat_sheet", "deadline_id": deadline_id });
		assert_eq!(note(open_page(&app, Some("Claude Code"), &sheet)), format!("Sent to the godspeed window; it may offer Go to instead if the learner is typing. {NOT_MADE}"));
		note(open_page(&app, Some("Claude Code"), &sheet));
		let opens: Vec<Json> = recent_agent_actions(&app).into_iter().filter(|a| a["label"].as_str() == Some("Opening Midterm's cheat sheet")).collect();
		assert_eq!(opens.len(), 2);
		assert_eq!(opens[0]["open"], json!(true));

		let files = json!({ "page": "files", "space_id": space_id });
		set_window(&app, Some(WindowPage { path: "/space/files".to_owned(), space_id: None }));
		assert!(note(open_page(&app, None, &files)).starts_with("Sent to"), "another space's Files");
		set_window(&app, Some(WindowPage { path: "/space/files".to_owned(), space_id: Some(space_id.clone()) }));
		assert_eq!(note(open_page(&app, None, &files)), "The learner is already on that page, so nothing moved.");

		let lesson_id = app.stores.chats.create_chat("Study for Midterm", Some("study"), Some(&space_id), Some(&deadline_id), &[]).unwrap()["id"].str_or_empty().to_owned();
		set_window(&app, Some(WindowPage { path: format!("/chat/{lesson_id}"), space_id: Some(space_id.clone()) }));
		assert!(note(open_page(&app, None, &sheet)).starts_with(BESIDE_LESSON));
	}
}
