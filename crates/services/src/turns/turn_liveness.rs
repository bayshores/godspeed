//! Which chats have a turn in flight (turn-liveness.ts). A returning view tells "the teacher is
//! mid-turn" from "the record is current" by this. Memory only: a restart clears it, and the
//! write-ahead record covers a turn that died with the process.

use gs_base::events::EventKind;
use gs_json::json;

use super::turn_runs::clear_turn_failure;
use crate::App;

/// Marks a turn as starting; false when one already runs for the chat (one turn per chat). The
/// "turn-started" event goes out after the registry write, so a listener reads the truth.
pub fn begin_turn(app: &App, chat_id: &str) -> bool {
	if is_turn_running(app, chat_id) {
		return false;
	}
	clear_turn_failure(app, chat_id);
	if !app.turns.in_flight.lock().insert(chat_id.to_owned()) {
		return false;
	}
	app.events.emit(EventKind::TurnStarted, json!({ "chatId": chat_id }));
	true
}

/// Marks the chat's turn as finished; "turn-settled" only when one was marked.
pub fn end_turn(app: &App, chat_id: &str) {
	if app.turns.in_flight.lock().remove(chat_id) {
		app.events.emit(EventKind::TurnSettled, json!({ "chatId": chat_id }));
	}
}

pub fn is_turn_running(app: &App, chat_id: &str) -> bool {
	app.turns.in_flight.lock().contains(chat_id)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::turns::turn_runs::{remember_turn_failure, turn_failure};

	#[test]
	fn one_turn_per_chat_and_events_only_for_real_changes() {
		let root = scratch_dir("liveness");
		let app = test_app(&root);
		let mut events = app.events.subscribe();
		remember_turn_failure(&app, "chat_a", "old");
		assert!(begin_turn(&app, "chat_a"));
		assert_eq!(turn_failure(&app, "chat_a"), None, "an accepted begin clears the old notice");
		assert!(!begin_turn(&app, "chat_a"));
		assert!(is_turn_running(&app, "chat_a"));
		end_turn(&app, "chat_a");
		end_turn(&app, "chat_a");
		let seen: Vec<_> = std::iter::from_fn(|| events.try_recv().ok()).map(|e| (e.kind, e.payload)).collect();
		assert_eq!(seen, [(EventKind::TurnStarted, json!({ "chatId": "chat_a" })), (EventKind::TurnSettled, json!({ "chatId": "chat_a" }))]);
	}
}
