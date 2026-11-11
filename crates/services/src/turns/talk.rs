//! The Talk chat in the teacher's panel (talk.ts): one ongoing chat outside lessons, made on first
//! use; Clear deletes it so the next message starts fresh.

use std::sync::Arc;

use gs_base::locks::LockKey;
use gs_core::contracts::chat::TALK_CHAT_ID;
use gs_core::graph::graph_deletion::ChatDeleteMode;
use gs_json::{Json, Obj};

use super::chats::{Refusal, delete_chat_session};
use super::turn_liveness::is_turn_running;
use super::turn_runs::turn_failure;
use crate::App;

/// The Talk chat, made when it is missing. Under its lock: creating it writes an empty record, so
/// a second maker must see the first one's chat, and any message saved into it since.
pub fn talk_chat(app: &App) -> Result<Json, String> {
	let _held = app.locks.lock(LockKey::Chat(TALK_CHAT_ID));
	match app.stores.chats.get_chat(TALK_CHAT_ID) {
		Some(chat) => Ok(chat),
		None => app.stores.chats.create_chat("Talk", Some("talk"), None, None),
	}
}

/// The Talk chat as the panel opens it: `{ id, messages, turnInFlight, turnError? }`.
pub fn open_talk(app: &Arc<App>) -> Result<Json, String> {
	let chat = talk_chat(app)?;
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

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn opening_talk_as_it_is_made_keeps_what_was_saved_in_it() {
		let root = scratch_dir("talk-open");
		let app = test_app(&root);
		// Another maker of Talk holds it, makes it and saves a message into it.
		let held = app.locks.lock(LockKey::Chat(TALK_CHAT_ID));
		let opening = app.clone();
		let open = std::thread::spawn(move || open_talk(&opening).unwrap());
		std::thread::sleep(std::time::Duration::from_millis(100));
		app.stores.chats.create_chat("Talk", Some("talk"), None, None).unwrap();
		app.stores.chats.save_messages(TALK_CHAT_ID, &[json!({ "id": "m1", "role": "user", "content": "hi" })]).unwrap();
		drop(held);
		assert_eq!(open.join().unwrap()["messages"].as_arr().map(Vec::len), Some(1));
		assert_eq!(app.stores.chats.get_chat(TALK_CHAT_ID).unwrap()["messages"].as_arr().map(Vec::len), Some(1));
	}
}
