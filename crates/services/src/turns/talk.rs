//! The Talk chat in the teacher's panel (talk.ts): one ongoing chat outside lessons, made on first
//! use; Clear deletes it so the next message starts fresh.

use std::sync::Arc;

use gs_core::contracts::chat::TALK_CHAT_ID;
use gs_core::graph::graph_deletion::ChatDeleteMode;
use gs_json::{Json, Obj};

use super::chats::{Refusal, delete_chat_session};
use super::turn_liveness::is_turn_running;
use super::turn_runs::turn_failure;
use crate::App;

/// The Talk chat as the panel opens it: `{ id, messages, turnInFlight, turnError? }`.
pub fn open_talk(app: &Arc<App>) -> Result<Json, String> {
	let chat = match app.stores.chats.get_chat(TALK_CHAT_ID) {
		Some(chat) => chat,
		None => app.stores.chats.create_chat("Talk", Some("talk"), None, None)?,
	};
	let mut out = Obj::new();
	out.insert("id", chat["id"].clone());
	out.insert("messages", chat["messages"].clone());
	out.insert("turnInFlight", is_turn_running(app, TALK_CHAT_ID));
	if let Some(error) = turn_failure(app, TALK_CHAT_ID) {
		out.insert("turnError", error);
	}
	Ok(Json::Obj(out))
}

/// Empties the Talk chat. Refused while the teacher is replying.
pub async fn clear_talk(app: &Arc<App>) -> Result<Result<(), Refusal>, String> {
	if app.stores.chats.get_chat(TALK_CHAT_ID).is_none() {
		return Ok(Ok(()));
	}
	Ok(delete_chat_session(app, TALK_CHAT_ID, ChatDeleteMode::PreserveGraph).await?.map(drop))
}
