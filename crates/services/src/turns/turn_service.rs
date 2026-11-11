//! The turn services (turn-service.ts): the canonical save of a turn and the graph write channel.

use std::sync::Arc;

use gs_base::clock;
use gs_base::locks::LockKey;
use gs_core::graph::coverage::coverage_of;
use gs_core::messages::message_id::new_message_id;
use gs_core::messages::pending::is_question_tool;
use gs_core::session::plan_blocks::plan_blocks_for;
use gs_json::Json;
use gs_store::graph::Ledger;

use super::turn_liveness::is_turn_running;
use crate::App;
use crate::graph::extraction::extraction;
use crate::graph::extraction_runs::runs;

/// The message a failed canonical save reports (TurnPersistenceError).
pub const PERSISTENCE_ERROR: &str = "The reply could not be saved.";

/// How long a lesson sits idle before its last stretch (under a chunk) is extracted.
pub const LEFTOVER_IDLE_MS: i64 = 5 * 60_000;

/// Appends the turn's own messages past `base_count`, even after an abort (the partial transcript
/// is what makes resume work):
///
/// - each message gets an id;
/// - a cleanly posed question's placeholder result is never saved (the record ends at the
///   unanswered call); an errored question call is (the model's retry context);
/// - one frozen plan block per successful plan_init call.
///
/// Returns the stamped new messages. Err is PERSISTENCE_ERROR.
pub fn persist_turn(app: &App, chat_id: &str, base_count: usize, turn_messages: &[Json]) -> Result<Vec<Json>, String> {
	save_turn(app, chat_id, base_count, turn_messages).map_err(|err| {
		eprintln!("[chat {chat_id}] persist failed: {err}");
		PERSISTENCE_ERROR.to_owned()
	})
}

fn save_turn(app: &App, chat_id: &str, base_count: usize, turn_messages: &[Json]) -> Result<Vec<Json>, String> {
	let _guard = app.locks.lock(LockKey::Chat(chat_id));
	let record = app.stores.chats.get_chat(chat_id).ok_or_else(|| format!("Chat not found: {chat_id}"))?;
	let mut stamped = Vec::new();
	for message in turn_messages.iter().skip(base_count) {
		let placeholder = message["role"].as_str() == Some("toolResult") && is_question_tool(message["toolName"].as_str().unwrap_or_default()) && !message["isError"].truthy();
		if placeholder {
			continue;
		}
		stamped.push(if message["id"].truthy() { message.clone() } else { with_id(message) });
	}
	let messages = record["messages"].as_arr().map_or(&[][..], Vec::as_slice);
	let transcript: Vec<Json> = messages.iter().chain(&stamped).cloned().collect();
	let tree = record.get("tree").filter(|t| !t.is_null());
	let blocks = plan_blocks_for(messages, &stamped, tree, &transcript);
	let all: Vec<Json> = transcript.into_iter().chain(blocks).collect();
	app.stores.chats.save_messages(chat_id, &all)?;
	Ok(stamped)
}

/// `{ ...message, id }`: the id goes last unless the message already has the key.
fn with_id(message: &Json) -> Json {
	let mut out = message.clone();
	if let Some(o) = out.as_obj_mut() {
		o.insert("id", new_message_id());
	}
	out
}

/// Starts extraction once the lesson's uncovered tokens reach a chunk; less than that (or a run
/// already going) waits for the lesson to sit idle. Fire and forget: failures are logged and the
/// next trigger runs what is left.
pub fn trigger_extraction(app: &Arc<App>, chat_id: &str, scope: Option<&str>, chunk_tokens: f64) {
	let run = || -> Result<(), String> {
		let uncovered = uncovered_tokens(app, chat_id, scope)?;
		if uncovered >= chunk_tokens && !runs(app).in_flight(chat_id) {
			run_extraction(app, chat_id);
			return Ok(());
		}
		if uncovered > 0.0 {
			extract_when_idle(app, chat_id, scope, LEFTOVER_IDLE_MS);
		}
		Ok(())
	};
	if let Err(err) = run() {
		eprintln!("[chat {chat_id}] extraction trigger failed: {err}");
	}
}

/// Extracts what the lesson has left after `delay_ms`, unless a newer call resets the wait. A
/// turn or an extraction still going pushes it back; the graph may be switched off by then.
pub fn extract_when_idle(app: &Arc<App>, chat_id: &str, scope: Option<&str>, delay_ms: i64) {
	let number = {
		let mut count = app.turns.leftover_count.lock();
		*count += 1;
		*count
	};
	app.turns.leftover_timers.lock().insert(chat_id.to_owned(), number);
	let (app, chat_id, scope) = (app.clone(), chat_id.to_owned(), scope.map(str::to_owned));
	tokio::spawn(async move {
		clock::sleep(delay_ms).await;
		{
			let mut timers = app.turns.leftover_timers.lock();
			if timers.get(&chat_id) != Some(&number) {
				return;
			}
			timers.remove(&chat_id);
		}
		if let Err(err) = leftover(&app, &chat_id, scope.as_deref()) {
			eprintln!("[chat {chat_id}] leftover extraction failed: {err}");
		}
	});
}

fn leftover(app: &Arc<App>, chat_id: &str, scope: Option<&str>) -> Result<(), String> {
	if !app.stores.settings.effective_settings()?["graph"]["enabled"].truthy() {
		return Ok(());
	}
	if is_turn_running(app, chat_id) || runs(app).in_flight(chat_id) {
		extract_when_idle(app, chat_id, scope, LEFTOVER_IDLE_MS);
		return Ok(());
	}
	if uncovered_tokens(app, chat_id, scope)? > 0.0 {
		run_extraction(app, chat_id);
	}
	Ok(())
}

pub(super) fn uncovered_tokens(app: &App, chat_id: &str, scope: Option<&str>) -> Result<f64, String> {
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return Ok(0.0) };
	let entries = app.stores.graphs.read(scope, Ledger::Coverage)?;
	let messages = record["messages"].as_arr().map_or(&[][..], Vec::as_slice);
	Ok(coverage_of(messages, &entries, chat_id).uncovered_tokens as f64)
}

pub(super) fn run_extraction(app: &Arc<App>, chat_id: &str) {
	let (app, chat_id) = (app.clone(), chat_id.to_owned());
	tokio::spawn(async move {
		if let Err(err) = extraction(&app).run_extraction(&chat_id).await {
			eprintln!("[chat {chat_id}] extraction pipeline failed: {err}");
		}
	});
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn a_turn_saves_its_own_messages_with_ids_and_no_question_placeholder() {
		let root = scratch_dir("persist");
		let app = test_app(&root);
		let id = app.stores.chats.create_chat("t", None, None, None).unwrap()["id"].as_str().unwrap().to_owned();
		let before = json!({ "id": "msg_user", "role": "user", "content": "hi", "timestamp": 1 });
		app.stores.chats.save_messages(&id, std::slice::from_ref(&before)).unwrap();
		let call = json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "c1", "name": "quiz", "arguments": {} }], "stopReason": "toolUse" });
		let placeholder = json!({ "role": "toolResult", "toolCallId": "c1", "toolName": "quiz", "content": [], "isError": false });
		let refused = json!({ "role": "toolResult", "toolCallId": "c1", "toolName": "quiz", "content": [], "isError": true });
		let stamped = persist_turn(&app, &id, 1, &[before.clone(), call, placeholder, refused]).unwrap();
		assert_eq!(stamped.len(), 2);
		assert!(stamped.iter().all(|m| m["id"].as_str().is_some_and(|i| i.starts_with("msg_"))));
		assert_eq!(stamped[0].as_obj().unwrap().keys().last().map(String::as_str), Some("id"), "a new id goes last");
		let saved = app.stores.chats.get_chat(&id).unwrap()["messages"].as_arr().unwrap().clone();
		assert_eq!(saved.len(), 3);
		assert_eq!(saved[2]["isError"], json!(true));
		assert_eq!(persist_turn(&app, "chat_gone", 0, &[]).unwrap_err(), PERSISTENCE_ERROR);
	}
}
