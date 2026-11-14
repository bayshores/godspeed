//! Study's reply nudges (`core::study::reply_nudges`): a reply whose words call for one is not
//! stored, and the teacher reads why. topic_done's opener lead is read for a curve too, on the
//! topic it opens. Each is sent once a topic, so the same reply sent again goes through. What was
//! sent lives in memory; after a restart a topic may get one more.

use gs_core::study::reply_nudges::{Nudge, reply_nudges};
use gs_core::study::topic_parts::{first_topic, reply_topic};
use gs_engine::bridge::ReplyCall;
use gs_json::{Json, json};

use crate::App;

/// Why a Study lesson's reply is sent back, or none when it is stored.
pub fn reply_refusal(app: &App, chat_id: &str, text: Option<&str>, calls: &[ReplyCall]) -> Option<String> {
	let words = text.map(reply_nudges).unwrap_or_default();
	let openers: Vec<&str> = calls
		.iter()
		.filter(|c| c.name == "topic_done" && c.arguments["opener"]["lead"].as_str().is_some_and(|lead| reply_nudges(lead).contains(&Nudge::CurveTable)))
		.filter_map(|c| c.arguments["opener"]["quiz"]["nodeId"].as_str())
		.collect();
	if words.is_empty() && openers.is_empty() {
		return None;
	}
	let lesson = app.stores.chats.get_chat(chat_id).filter(|c| c["kind"].as_str() == Some("study"))?;
	let mut due: Vec<(String, Nudge)> = openers.into_iter().map(|topic| (topic.to_owned(), Nudge::CurveTable)).collect();
	if !words.is_empty() {
		let content: Vec<Json> = text.map(|t| json!({ "type": "text", "text": t })).into_iter().chain(calls.iter().map(|c| json!({ "type": "toolCall", "id": "", "name": c.name, "arguments": c.arguments }))).collect();
		let messages = lesson["messages"].as_arr().map_or(&[][..], Vec::as_slice);
		let topic = reply_topic(messages, first_topic(lesson.get("tree").filter(|t| !t.is_null())), &json!({ "role": "assistant", "content": content })).unwrap_or_default();
		due.extend(words.into_iter().map(|n| (topic.clone(), n)));
	}
	let mut sent = app.turns.nudged.lock();
	// The opener's curve comes first, so a curve in both reads once.
	let mut lines: Vec<&str> = due.into_iter().filter(|(topic, n)| sent.insert((chat_id.to_owned(), topic.clone(), *n))).map(|(_, n)| n.refusal()).collect();
	lines.dedup();
	(!lines.is_empty()).then(|| lines.join("\n"))
}
