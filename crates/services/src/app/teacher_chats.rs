//! The teacher's chats in godspeed's terminal (gs_core's records::teacher_chats): the folder's
//! SessionStart hook says which chat a terminal runs, a line typed to it or a lesson it takes
//! marks it used and names it, and the terminal offers the newest to go back to. Each change is
//! announced, so the window's starter keys go once the chat is used.

use gs_base::clock;
use gs_base::events::EventKind;
use gs_base::ids::is_uuid;
use gs_core::records::teacher_chats;
use gs_json::{Json, json};

use super::agent_folder::agent_folder;
use crate::App;

/// The teacher's terminal runs this chat now (a new one, one it went back to, or one `/resume`
/// opened inside the agent). Another terminal's chats are not the teacher's.
pub fn session_started(app: &App, terminal: Option<&str>, id: &str, agent: &str) {
	let Some(terminal) = terminal.filter(|_| app.bridge.is_teacher_terminal(terminal)) else { return };
	if !is_uuid(id) || !matches!(agent, "claude" | "codex") {
		return;
	}
	app.bridge.set_terminal_chat(terminal, id);
	let folder = agent_folder(app);
	app.stores.teacher_chats.update(|chats| teacher_chats::started(chats, id, agent, &folder, clock::now_ms()));
	changed(app);
}

/// The learner typed this line to the teacher in its terminal.
pub fn typed(app: &App, terminal: &str, line: &str) {
	if let Some(id) = app.bridge.terminal_chat(terminal) {
		app.stores.teacher_chats.update(|chats| teacher_chats::typed(chats, &id, line, clock::now_ms()));
		changed(app);
	}
}

/// The teacher took a turn of this lesson.
pub fn taught(app: &App, terminal: Option<&str>, conversation: &str) {
	let Some(id) = terminal.and_then(|t| app.bridge.terminal_chat(t)) else { return };
	let Some(title) = app.stores.chats.get_chat(conversation).and_then(|chat| chat["title"].as_str().map(str::to_owned)) else { return };
	app.stores.teacher_chats.update(|chats| teacher_chats::taught(chats, &id, conversation, &title, clock::now_ms()));
	changed(app);
}

fn changed(app: &App) {
	app.events.emit(EventKind::TeacherChatsChanged, json!({}));
}

/// The chats the terminal offers: `[{id, agent, name, lesson, at, open}]`, newest first. `open`:
/// the teacher's terminal runs it now. `lesson`: the last lesson it taught, while that lesson is kept.
pub fn shown(app: &App) -> Json {
	let chats = teacher_chats::shown(&app.stores.teacher_chats.read(), &agent_folder(app));
	let open = app.bridge.teacher_chat();
	Json::Arr(chats.iter().map(|c| json!({ "id": c.id.as_str(), "agent": c.agent.as_str(), "name": c.name.clone(), "lesson": c.lesson.clone().filter(|l| app.stores.chats.get_chat(l).is_some()), "at": c.at, "open": open.as_deref() == Some(c.id.as_str()) })).collect())
}

/// The agent said the chat is gone: it leaves the list.
pub fn forget(app: &App, id: &str) {
	app.stores.teacher_chats.update(|chats| chats.retain(|c| c.id != id));
}
