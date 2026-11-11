//! The running-turn registry (turn-runs.ts): chat id to the live turn handle. GET
//! /api/chats/{id}/stream attaches through it and the remote abort kills through it. A turn whose
//! settlement failed leaves a small notice here for a view that attaches late.

use gs_engine::turn::ui_stream::TurnHandle;
use gs_json::{json, stringify};

use super::turn_liveness::is_turn_running;
use crate::App;

pub fn remember_turn_failure(app: &App, chat_id: &str, error_text: &str) {
	app.turns.failures.lock().insert(chat_id.to_owned(), error_text.to_owned());
}

pub fn turn_failure(app: &App, chat_id: &str) -> Option<String> {
	app.turns.failures.lock().get(chat_id).cloned()
}

pub fn clear_turn_failure(app: &App, chat_id: &str) {
	app.turns.failures.lock().remove(chat_id);
}

pub fn register_turn(app: &App, chat_id: &str, handle: TurnHandle) {
	app.turns.runs.lock().insert(chat_id.to_owned(), handle);
	app.turns.attachable.notify_waiters();
}

pub fn unregister_turn(app: &App, chat_id: &str) {
	app.turns.runs.lock().remove(chat_id);
}

pub fn running_turn(app: &App, chat_id: &str) -> Option<TurnHandle> {
	app.turns.runs.lock().get(chat_id).cloned()
}

/// The turn a view attaches to. A turn that began but whose handle is still being built (its
/// agent, its job deliveries) is waited for, so a view that reacts to "turn-started" gets the live
/// turn, not the settled terminal.
pub async fn attach_turn(app: &App, chat_id: &str) -> Option<TurnHandle> {
	loop {
		let changed = app.turns.attachable.notified();
		tokio::pin!(changed);
		changed.as_mut().enable();
		if let Some(handle) = running_turn(app, chat_id) {
			return Some(handle);
		}
		if !is_turn_running(app, chat_id) {
			return None;
		}
		changed.await;
	}
}

/// The remote kill. False ("not_running") when no turn runs: nothing to abort.
pub fn abort_turn(app: &App, chat_id: &str) -> bool {
	let Some(handle) = running_turn(app, chat_id) else { return false };
	handle.abort();
	true
}

/// The stream body when no turn runs: a kept failure notice first, then "turn-settled" and the
/// end, so the view refetches the record.
pub fn settled_turn_frames(app: &App, chat_id: &str) -> String {
	let notice = turn_failure(app, chat_id).map_or_else(String::new, |error_text| format!("data: {}\n\n", stringify(&json!({ "type": "error", "errorText": error_text }))));
	format!("{notice}data: {{\"type\":\"turn-settled\"}}\n\ndata: [DONE]\n\n")
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn the_settled_stream_carries_a_kept_failure_once_remembered() {
		let root = scratch_dir("turn-runs");
		let app = test_app(&root);
		assert_eq!(settled_turn_frames(&app, "chat_a"), "data: {\"type\":\"turn-settled\"}\n\ndata: [DONE]\n\n");
		remember_turn_failure(&app, "chat_a", "The reply could not be saved.");
		assert_eq!(settled_turn_frames(&app, "chat_a"), "data: {\"type\":\"error\",\"errorText\":\"The reply could not be saved.\"}\n\ndata: {\"type\":\"turn-settled\"}\n\ndata: [DONE]\n\n");
		clear_turn_failure(&app, "chat_a");
		assert_eq!(turn_failure(&app, "chat_a"), None);
		assert!(!abort_turn(&app, "chat_a"));
	}
}
