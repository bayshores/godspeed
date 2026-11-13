//! What the learner does in a lesson that is no input for the agent: Keep going at a stop. It is
//! written to the lesson at once, even while a turn runs, so nothing is lost if he quits during a
//! long wait, and it never starts a turn.

use gs_base::events::EventKind;
use gs_base::locks::LockKey;
use gs_core::messages::lesson_markers::new_keep_going_marker;
use gs_core::study::topic_end::{has_opener, has_stop};
use gs_json::json;

use super::turn_liveness::is_turn_running;
use crate::App;

/// How Keep going landed.
#[derive(Debug, PartialEq, Eq)]
pub enum KeepGoing {
	/// Written; `opener`: a stored opener waits on that stop, so the window shows it at once.
	Kept { opener: bool },
	UnknownLesson,
	/// No turn runs and the record holds no stop on that call.
	NoStop,
}

/// Keep going at the stop the call `stop_of` carries. During a turn the stop may exist only in the
/// live stream, so the marker is stored unchecked; one whose stop never lands is ignored when the
/// lesson is read. Err: the lesson could not be saved.
pub fn keep_going(app: &App, chat_id: &str, stop_of: &str) -> Result<KeepGoing, String> {
	let opener = {
		let _guard = app.locks.lock(LockKey::Chat(chat_id));
		let Some(record) = app.stores.chats.get_chat(chat_id) else { return Ok(KeepGoing::UnknownLesson) };
		let mut messages = record["messages"].as_arr().cloned().unwrap_or_default();
		if !is_turn_running(app, chat_id) && !has_stop(&messages, stop_of) {
			return Ok(KeepGoing::NoStop);
		}
		messages.push(new_keep_going_marker(stop_of));
		app.stores.chats.save_messages(chat_id, &messages)?;
		has_opener(&messages, stop_of)
	};
	app.events.emit(EventKind::RecordChanged, json!({ "chatId": chat_id }));
	Ok(KeepGoing::Kept { opener })
}

#[cfg(test)]
mod tests {
	use gs_json::Json;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::turns::turn_liveness::{begin_turn, end_turn};

	/// Regularization ends on a conclude; with `opener`, topic_done stores the next topic's opener.
	fn ended(opener: bool) -> Vec<Json> {
		let stop = json!({ "kind": "topic", "nodeId": "reg", "activeMinutes": 30, "at": "2026-11-18T21:48:00.000Z" });
		let mut messages = vec![
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "c1", "name": "conclude", "arguments": { "outcome": "solved" } }], "timestamp": 1 }),
			json!({ "role": "toolResult", "toolCallId": "c1", "toolName": "conclude", "details": { "stop": stop }, "isError": false, "timestamp": 1 }),
		];
		if opener {
			messages.push(json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "t1", "name": "topic_done", "arguments": { "nodeId": "reg", "opener": { "lead": "Now split.", "quiz": { "question": "?", "type": "predict", "nodeId": "cv" } } } }], "timestamp": 2 }));
			messages.push(json!({ "role": "toolResult", "toolCallId": "t1", "toolName": "topic_done", "details": { "part": "topic_done", "v": 1, "lead": "Now split." }, "isError": false, "timestamp": 2 }));
		}
		messages
	}

	fn lesson(app: &App, messages: &[Json]) -> String {
		let id = app.stores.chats.create_chat("Midterm", Some("study"), None, None).unwrap()["id"].as_str().unwrap().to_owned();
		app.stores.chats.save_messages(&id, messages).unwrap();
		id
	}

	fn markers(app: &App, id: &str) -> Vec<Json> {
		let record = app.stores.chats.get_chat(id).unwrap();
		record["messages"].as_arr().unwrap().iter().filter(|m| m["customType"].as_str() == Some("keep-going")).map(|m| m["details"]["stopOf"].clone()).collect()
	}

	#[test]
	fn keep_going_writes_its_marker_and_says_whether_an_opener_shows() {
		let root = scratch_dir("keep-going");
		let app = test_app(&root);
		let with = lesson(&app, &ended(true));
		let mut events = app.events.subscribe();
		assert_eq!(keep_going(&app, &with, "c1"), Ok(KeepGoing::Kept { opener: true }));
		assert_eq!(markers(&app, &with), [json!("c1")]);
		assert_eq!(events.try_recv().unwrap().kind, EventKind::RecordChanged);
		let without = lesson(&app, &ended(false));
		assert_eq!(keep_going(&app, &without, "c1"), Ok(KeepGoing::Kept { opener: false }), "no topic_done: the window sends the go-ahead");
	}

	#[test]
	fn with_no_turn_running_the_stop_must_be_in_the_record() {
		let root = scratch_dir("keep-going-refused");
		let app = test_app(&root);
		let id = lesson(&app, &ended(true));
		assert_eq!(keep_going(&app, &id, "t1"), Ok(KeepGoing::NoStop), "topic_done carries no stop here");
		assert_eq!(keep_going(&app, &id, "nope"), Ok(KeepGoing::NoStop));
		assert_eq!(keep_going(&app, "chat_gone", "c1"), Ok(KeepGoing::UnknownLesson));
		assert!(markers(&app, &id).is_empty());
	}

	#[test]
	fn during_a_turn_it_is_stored_unchecked() {
		let root = scratch_dir("keep-going-turn");
		let app = test_app(&root);
		let id = lesson(&app, &[]);
		assert!(begin_turn(&app, &id));
		assert_eq!(keep_going(&app, &id, "c9"), Ok(KeepGoing::Kept { opener: false }));
		end_turn(&app, &id);
		assert_eq!(markers(&app, &id), [json!("c9")]);
	}
}
