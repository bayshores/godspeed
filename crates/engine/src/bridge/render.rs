//! The transcript as the outside agent reads it: flat messages, the instructions and tools, and
//! the fingerprints that tell which messages an agent has already seen.

use gs_base::hash::sha256_text;
use gs_json::{Json, Obj, json, lone::to_utf16, stringify};

use crate::turn::messages::role;

/// Text with each image as "[image N]", the image itself going to `images` as
/// `{data, mimeType}`. Without a collector (fingerprints) an image is "[image]".
fn text_of(content: &Json, mut images: Option<&mut Vec<Json>>) -> String {
	let blocks = match content {
		Json::Str(s) => return s.clone(),
		Json::Arr(blocks) => blocks,
		_ => return String::new(),
	};
	let parts: Vec<String> = blocks
		.iter()
		.map(|c| match c["type"].as_str() {
			Some("text") => c["text"].as_str().unwrap_or_default().to_owned(),
			Some("image") => match (images.as_deref_mut(), c["data"].as_str(), c["mimeType"].as_str()) {
				(Some(images), Some(data), Some(mime_type)) => {
					images.push(json!({ "data": data, "mimeType": mime_type }));
					format!("[image {}]", images.len())
				}
				_ => "[image]".to_owned(),
			},
			_ => String::new(),
		})
		.filter(|p| !p.is_empty())
		.collect();
	parts.join("\n")
}

fn put(obj: &mut Obj, key: &str, value: Option<&Json>) {
	if let Some(v) = value {
		obj.insert(key, v.clone());
	}
}

/// One message flattened for an outside reader; none for a system message without text.
pub fn render_message(m: &Json, images: Option<&mut Vec<Json>>) -> Option<Json> {
	let mut out = Obj::new();
	match role(m) {
		"system" => {
			let mut parts = vec![text_of(&m["content"], None)];
			parts.extend(m["sections"].as_obj().into_iter().flat_map(|s| s.values()).filter_map(|v| v.as_str().map(str::to_owned)));
			parts.retain(|p| !p.is_empty());
			if parts.is_empty() {
				return None;
			}
			out.insert("role", "system");
			out.insert("text", parts.join("\n\n"));
		}
		"user" => {
			out.insert("role", "user");
			out.insert("text", text_of(&m["content"], images));
		}
		"assistant" => {
			let blocks = m["content"].as_arr().map_or(&[][..], Vec::as_slice);
			let text: Vec<&str> = blocks.iter().filter(|c| c["type"] == Json::from("text")).map(|c| c["text"].as_str().unwrap_or_default()).collect();
			let calls: Vec<Json> = blocks
				.iter()
				.filter(|c| c["type"] == Json::from("toolCall"))
				.map(|c| {
					let mut call = Obj::new();
					for key in ["id", "name", "arguments"] {
						put(&mut call, key, c.get(key));
					}
					Json::Obj(call)
				})
				.collect();
			out.insert("role", "assistant");
			let text = text.join("\n");
			if !text.is_empty() {
				out.insert("text", text);
			}
			if !calls.is_empty() {
				out.insert("toolCalls", calls);
			}
		}
		"toolResult" => {
			out.insert("role", "toolResult");
			for key in ["toolCallId", "toolName", "isError"] {
				put(&mut out, key, m.get(key));
			}
			out.insert("text", text_of(&m["content"], images));
		}
		// The TS returns undefined, which JSON writes as null.
		_ => return Some(Json::Null),
	}
	Some(Json::Obj(out))
}

/// The leading system message's text is the prompt; any system message may add tools (a later
/// definition of a name replaces the earlier one in place).
pub fn instructions_and_tools(messages: &[Json]) -> (String, Vec<Json>) {
	let mut instructions = String::new();
	let mut tools: Vec<Json> = Vec::new();
	for m in messages.iter().filter(|m| role(m) == "system") {
		if instructions.is_empty() {
			instructions = render_message(m, None).map(|r| r["text"].as_str().unwrap_or_default().to_owned()).unwrap_or_default();
		}
		for t in m["toolsAdded"].as_arr().into_iter().flatten() {
			let mut tool = Obj::new();
			for key in ["name", "description", "parameters"] {
				put(&mut tool, key, t.get(key));
			}
			let tool = Json::Obj(tool);
			match tools.iter_mut().find(|known| known["name"] == t["name"]) {
				Some(slot) => *slot = tool,
				None => tools.push(tool),
			}
		}
	}
	(instructions, tools)
}

fn sorted_names(tools: &Json) -> Vec<Json> {
	let mut names: Vec<String> = tools.as_arr().into_iter().flatten().filter_map(|t| t["name"].as_str().map(str::to_owned)).collect();
	names.sort_by_key(|n| to_utf16(n));
	names.into_iter().map(Json::from).collect()
}

/// A system message also counts its tool names: the prompt stays the same when the learner
/// switches tools, and the agent must then get the item in full with the new tools.
pub fn fingerprint(m: &Json) -> String {
	let rendered = render_message(m, None);
	if role(m) != "system" {
		return stringify(&rendered.unwrap_or_default());
	}
	let mut out = rendered.and_then(|r| r.as_obj().cloned()).unwrap_or_default();
	out.insert("tools", sorted_names(&m["toolsAdded"]));
	out.insert("removed", sorted_names(&m["toolsRemoved"]));
	stringify(&Json::Obj(out))
}

/// The first 32 hex digits of the SHA-256 of `value`.
pub fn hash_of(value: &str) -> String {
	sha256_text(value)[..32].to_owned()
}
