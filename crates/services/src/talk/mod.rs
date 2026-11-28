//! Free talk: the learner's chats with the teacher in the teacher panel. A talk chat is a chat
//! record of kind "talk" in the lessons' store, so its turns run like a lesson's (the same lock,
//! stream, Stop, desk and Allow cards); only its instructions and tools differ (`setup`). It is
//! made on its first message, named by that message's first line, and keeps its own model. The
//! chats from the teacher's terminal in an older build carry over the first time the chats are
//! read (`old_chats`).

mod old_chats;
mod prompt;
mod setup;
#[cfg(test)]
mod talk_tests;
pub mod tools;

use gs_core::contracts::chat::ChatKind;
use gs_base::text::{one_line, trim};
use gs_json::Json;

use crate::App;
use crate::app::agent_folder::{chat_model, folder_agent, start_model, usable_model};
use crate::turns::turn_liveness::is_turn_running;
pub use setup::{talk_opening, talk_setup};

/// A talk chat's name is its first line, cut to this many characters.
const NAME_MAX: usize = 60;
/// What a chat with no name of its own is called: one whose first message has no words (a picture
/// alone), or an old chat carried over without one.
const UNNAMED: &str = "A chat";

/// GET /api/chats?kind=talk: every talk chat, newest first (`{id, title, createdAt, updatedAt,
/// kind, model, agent, running}`), `model` being the one its next reply runs on (None: the agent's
/// own default). The terminal's old chats carry over first.
pub fn talk_chats(app: &App) -> Vec<Json> {
	old_chats::carry_over(app);
	let agent = folder_agent(app);
	let start = start_model(app, agent);
	let mut chats = app.stores.chats.list_talk_chats();
	for chat in &mut chats {
		let running = is_turn_running(app, chat["id"].str_or_empty());
		let model = chat_model(chat, agent, start.clone());
		if let Some(fields) = chat.as_obj_mut() {
			fields.insert("running", running);
			fields.insert("model", model.map_or(Json::Null, Json::from));
		}
	}
	chats
}

/// POST /api/chats `{kind: "talk", text, model?}`: a new talk chat, named by the first line of
/// the message it is made for, on the model picked before it was made. Err is the refusal.
pub fn create_talk_chat(app: &App, text: &str, model: Option<&str>) -> Result<Json, String> {
	if model.is_some_and(|model| !usable_model(model)) {
		return Err(MODEL_REFUSED.to_owned());
	}
	let first = text.lines().map(trim).find(|line| !line.is_empty()).map(|line| one_line(line, NAME_MAX));
	app.stores.chats.create_talk_chat(first.as_deref().unwrap_or(UNNAMED), model)
}

const MODEL_REFUSED: &str = "model must be one line naming one of the agent's models";

/// PATCH /api/chats/{id} `{model}`: the model the chat's next reply runs on. Err is the refusal.
pub fn set_talk_model(app: &App, chat_id: &str, model: &str) -> Result<(), String> {
	if !usable_model(model) {
		return Err(MODEL_REFUSED.to_owned());
	}
	if !app.stores.chats.get_chat(chat_id).is_some_and(|chat| ChatKind::of(&chat) == ChatKind::Talk) {
		return Err("no such talk chat".to_owned());
	}
	app.stores.chats.set_chat_model(chat_id, model)
}

/// What a talk chat carried over from the terminal said before it came to godspeed, for its read:
/// `[{role, text}]`, or None for a chat made here.
pub fn earlier_words(app: &App, record: &Json) -> Option<Json> {
	let session = record["terminalChat"].as_str()?;
	let first = record["messages"].items().first().and_then(|m| m["timestamp"].as_f64()).map(|ms| gs_base::time::iso(ms as i64));
	Some(Json::Arr(old_chats::earlier_words(app, session, first.as_deref())))
}
