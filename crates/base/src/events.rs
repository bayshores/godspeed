//! The event bus behind `GET /api/events` (src/shared/core/events.ts): every emitter announces a
//! fact, every open window gets it as an SSE frame and fetches what it needs. Each subscriber has
//! its own unbounded queue, so a slow window never loses or reorders events.

use std::sync::Arc;

use gs_json::{Json, stringify};
use parking_lot::Mutex;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};

/// The event names, as the window listens for them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventKind {
	TurnStarted,
	TurnSettled,
	JobsChanged,
	ActivityChanged,
	ChatsChanged,
	SpacesChanged,
	AgentChanged,
	RecordChanged,
	AgentAction,
	RulesChanged,
	CheatSheetChanged,
	FilesAdded,
	FilesRemoved,
}

impl EventKind {
	pub fn name(self) -> &'static str {
		match self {
			EventKind::TurnStarted => "turn-started",
			EventKind::TurnSettled => "turn-settled",
			EventKind::JobsChanged => "jobs-changed",
			EventKind::ActivityChanged => "activity-changed",
			EventKind::ChatsChanged => "chats-changed",
			EventKind::SpacesChanged => "spaces-changed",
			EventKind::AgentChanged => "agent-changed",
			EventKind::RecordChanged => "record-changed",
			EventKind::AgentAction => "agent-action",
			EventKind::RulesChanged => "rules-changed",
			EventKind::CheatSheetChanged => "cheat-sheet-changed",
			EventKind::FilesAdded => "files-added",
			EventKind::FilesRemoved => "files-removed",
		}
	}
}

#[derive(Clone, Debug, PartialEq)]
pub struct Event {
	pub kind: EventKind,
	/// The event's fields without `type`, keys in the order the TypeScript emitter wrote them.
	pub payload: Json,
}

impl Event {
	/// The SSE frame: `event: <name>\ndata: <payload JSON>\n\n`.
	pub fn sse_frame(&self) -> String {
		format!("event: {}\ndata: {}\n\n", self.kind.name(), stringify(&self.payload))
	}
}

#[derive(Clone, Default)]
pub struct Events {
	subscribers: Arc<Mutex<Vec<UnboundedSender<Event>>>>,
}

impl Events {
	pub fn new() -> Events {
		Events::default()
	}

	/// Tells every subscriber; a subscriber that went away is dropped.
	pub fn emit(&self, kind: EventKind, payload: Json) {
		let event = Event { kind, payload };
		self.subscribers.lock().retain(|tx| tx.send(event.clone()).is_ok());
	}

	/// A new subscriber; dropping the receiver unsubscribes it.
	pub fn subscribe(&self) -> UnboundedReceiver<Event> {
		let (tx, rx) = unbounded_channel();
		self.subscribers.lock().push(tx);
		rx
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn subscribers_get_frames_in_order_and_leave_cleanly() {
		let events = Events::new();
		let mut a = events.subscribe();
		let b = events.subscribe();
		drop(b);
		events.emit(EventKind::JobsChanged, gs_json::json!({ "chatId": "chat_x" }));
		events.emit(EventKind::ChatsChanged, gs_json::json!({}));
		assert_eq!(a.try_recv().unwrap().sse_frame(), "event: jobs-changed\ndata: {\"chatId\":\"chat_x\"}\n\n");
		assert_eq!(a.try_recv().unwrap().sse_frame(), "event: chats-changed\ndata: {}\n\n");
		assert_eq!(events.subscribers.lock().len(), 1);
	}
}
