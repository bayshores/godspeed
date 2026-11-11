//! Parked dismissals (dismissal-park.ts): the learner discards a question while the turn still
//! works, so the stored record does not hold it yet. The dismiss route parks the intent (202) and
//! the turn's settle path applies it to the persisted record, before `end_turn`. If the dismissed
//! question or problem never landed, the park is dropped. One per chat, the last one wins.

use gs_base::events::EventKind;
use gs_base::locks::LockKey;
use gs_core::messages::input_events::{DismissInput, dismiss_appends};
use gs_json::{Json, json};

use crate::App;

pub fn park_dismissal(app: &App, chat_id: &str, input: DismissInput) {
	app.turns.parked.lock().insert(chat_id.to_owned(), input);
}

pub fn take_parked_dismissal(app: &App, chat_id: &str) -> Option<DismissInput> {
	app.turns.parked.lock().remove(chat_id)
}

/// Applies the parked dismissal, if any, the way the dismiss route would have written it.
/// "record-changed" goes out only when something was written.
pub fn apply_parked_dismissal(app: &App, chat_id: &str) -> Result<(), String> {
	let Some(input) = take_parked_dismissal(app, chat_id) else { return Ok(()) };
	{
		let _guard = app.locks.lock(LockKey::Chat(chat_id));
		let Some(record) = app.stores.chats.get_chat(chat_id) else { return Ok(()) };
		// A refusal means the dismissed thing never materialized: drop the park.
		let Ok(appends) = dismiss_appends(&record, &input) else { return Ok(()) };
		let mut messages: Vec<Json> = record["messages"].as_arr().cloned().unwrap_or_default();
		messages.extend(appends);
		app.stores.chats.save_messages(chat_id, &messages)?;
	}
	app.events.emit(EventKind::RecordChanged, json!({ "chatId": chat_id }));
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	fn quiz_call(id: &str) -> Json {
		json!({ "id": "msg_a", "role": "assistant", "content": [{ "type": "toolCall", "id": id, "name": "quiz", "arguments": {} }], "stopReason": "toolUse" })
	}

	fn dismiss(call: &str) -> DismissInput {
		DismissInput::Dismiss { tool_call_id: call.to_owned(), answer: json!({ "kind": "quiz", "dismissed": true }) }
	}

	#[test]
	fn a_park_lands_only_when_its_question_waits() {
		let root = scratch_dir("park");
		let app = test_app(&root);
		let id = app.stores.chats.create_chat("t", None, None, None).unwrap()["id"].as_str().unwrap().to_owned();
		park_dismissal(&app, &id, dismiss("call_gone"));
		apply_parked_dismissal(&app, &id).unwrap();
		assert_eq!(app.stores.chats.get_chat(&id).unwrap()["messages"], json!([]), "nothing to dismiss: dropped");
		assert_eq!(take_parked_dismissal(&app, &id), None);

		app.stores.chats.save_messages(&id, &[quiz_call("call_1")]).unwrap();
		park_dismissal(&app, &id, dismiss("call_0"));
		park_dismissal(&app, &id, dismiss("call_1"));
		let mut events = app.events.subscribe();
		apply_parked_dismissal(&app, &id).unwrap();
		let messages = app.stores.chats.get_chat(&id).unwrap()["messages"].as_arr().unwrap().clone();
		assert_eq!(messages.len(), 2, "the last park wins");
		assert_eq!(messages[1]["toolCallId"], json!("call_1"));
		assert_eq!(events.try_recv().unwrap().kind, EventKind::RecordChanged);
	}
}
