//! The parts a Study topic opens with, read from the record (src/shared/core/topic-parts.ts; both
//! replay tests/golden/topic_parts.json). A reply is one assistant message; its topic is the
//! nodeId its calls name (refused calls aside), else the latest earlier reply's or shown opener's. A
//! topic's page is the first quoted source mark in the shown opener's lead, else in the reply that
//! opens the topic; later replies never give one.

use std::collections::HashSet;

use gs_json::{Json, json};

use super::items;
use super::topic_end::shown_openers;
use crate::messages::citations::{CiteMark, replace_cite_marks};

/// Every topic the lesson reached, in the order it reached them: `{ nodeId, page }`, where `page`
/// is null or `{ messageId, leadOf, fileId, range, name, quote }` (the reply's message id, or the
/// call id of the topic_done whose opener lead holds the mark).
pub fn topic_parts(messages: &[Json]) -> Vec<Json> {
	let openers = shown_openers(messages);
	let refused: HashSet<&str> = messages.iter().filter(|m| m["role"].as_str() == Some("toolResult") && m["isError"] == Json::Bool(true)).filter_map(|m| m["toolCallId"].as_str()).collect();
	let mut out: Vec<Json> = Vec::new();
	let reached = |out: &[Json], node_id: &str| out.iter().position(|t| t["nodeId"].as_str() == Some(node_id));
	let mut opened: HashSet<String> = HashSet::new();
	let mut current: Option<String> = None;
	for m in messages {
		let opener = (m["role"].as_str() == Some("toolResult")).then(|| m["toolCallId"].as_str().and_then(|id| openers.get(id))).flatten();
		if let Some(opener) = opener
			&& let Some(node_id) = opener["quiz"]["nodeId"].as_str()
			&& reached(&out, node_id).is_none()
		{
			let lead_of = opener["topicDoneCallId"].clone();
			out.push(json!({ "nodeId": node_id, "page": first_quoted(opener["lead"].as_str().unwrap_or_default(), Json::Null, lead_of) }));
			current = Some(node_id.to_owned());
			continue;
		}
		if m["role"].as_str() != Some("assistant") {
			continue;
		}
		current = call_topic(m, &refused).or(current);
		let Some(node_id) = current.clone().filter(|id| !opened.contains(id)) else { continue };
		opened.insert(node_id.clone());
		let at = reached(&out, &node_id).unwrap_or_else(|| {
			out.push(json!({ "nodeId": node_id, "page": null }));
			out.len() - 1
		});
		let page = items(&m["content"])
			.iter()
			.filter(|b| b["type"].as_str() == Some("text"))
			.map(|b| first_quoted(b["text"].as_str().unwrap_or_default(), m["id"].clone(), Json::Null))
			.find(|page| !page.is_null());
		if let Some(page) = page.filter(|_| out[at]["page"].is_null())
			&& let Some(parts) = out[at].as_obj_mut()
		{
			parts.insert("page", page);
		}
	}
	out
}

/// The topic a reply's calls name: the first call with a nodeId that was not refused.
fn call_topic(m: &Json, refused: &HashSet<&str>) -> Option<String> {
	items(&m["content"])
		.iter()
		.filter(|b| b["type"].as_str() == Some("toolCall") && !b["id"].as_str().is_some_and(|id| refused.contains(id)))
		.find_map(|b| b["arguments"]["nodeId"].as_str().map(str::to_owned))
}

fn first_quoted(text: &str, message_id: Json, lead_of: Json) -> Json {
	let mut page = Json::Null;
	replace_cite_marks(text, |mark| {
		if let (true, CiteMark::File { file_id, range, name, quote: Some(quote) }) = (page.is_null(), mark) {
			page = json!({ "messageId": message_id.clone(), "leadOf": lead_of.clone(), "fileId": file_id, "range": range, "name": name, "quote": quote });
		}
		String::new()
	});
	page
}
