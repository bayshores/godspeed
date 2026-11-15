//! The native lesson record: messages, markers, phases, pending questions and learner input.

use gs_json::Json;

pub mod native_messages;
pub mod lesson_markers;
pub mod app_notes;
pub mod pending;
pub mod phases;
pub mod message_id;
pub mod value_debris;
pub mod attachments;
pub mod input_events;
pub mod compaction_marks;
pub mod citations;
pub mod quote_find;
pub mod content_reader;
pub mod talk_export;

/// The tool-call blocks of a message's content, in order.
pub(crate) fn tool_calls_in(content: &Json) -> impl DoubleEndedIterator<Item = &Json> {
	content.items().iter().filter(|b| b["type"].as_str() == Some("toolCall"))
}

/// The tool calls in a message, in order.
pub(crate) fn tool_calls(m: &Json) -> impl DoubleEndedIterator<Item = &Json> {
	tool_calls_in(&m["content"])
}
