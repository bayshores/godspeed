//! Study's reply nudges (`core::study::reply_nudges`): a reply whose words call for one is not
//! stored, and the teacher reads why. Each is sent once a topic, so the same reply sent again goes
//! through. What was sent lives in memory; after a restart a topic may get one more.

use gs_core::study::reply_nudges::{Nudge, reply_nudges};
use gs_core::study::topic_parts::{first_topic, reply_topic};
use gs_engine::bridge::ReplyCall;
use gs_json::{Json, json};

use crate::App;

/// Why a Study lesson's reply is sent back, or none when it is stored.
pub fn reply_refusal(app: &App, chat_id: &str, text: &str, calls: &[ReplyCall]) -> Option<String> {
	let nudges = reply_nudges(text);
	if nudges.is_empty() {
		return None;
	}
	let lesson = app.stores.chats.get_chat(chat_id).filter(|c| c["kind"].as_str() == Some("study"))?;
	let content: Vec<Json> = std::iter::once(json!({ "type": "text", "text": text })).chain(calls.iter().map(|c| json!({ "type": "toolCall", "id": "", "name": c.name, "arguments": c.arguments }))).collect();
	let messages = lesson["messages"].as_arr().map_or(&[][..], Vec::as_slice);
	let topic = reply_topic(messages, first_topic(lesson.get("tree").filter(|t| !t.is_null())), &json!({ "role": "assistant", "content": content })).unwrap_or_default();
	let mut sent = app.turns.nudged.lock();
	let lines: Vec<&str> = nudges.into_iter().filter(|n| sent.insert((chat_id.to_owned(), topic.clone(), *n))).map(Nudge::refusal).collect();
	(!lines.is_empty()).then(|| lines.join("\n"))
}
