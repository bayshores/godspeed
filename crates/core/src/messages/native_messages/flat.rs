//! One record message flattened to its role, its text and its tool calls.

use gs_json::{Json, Obj};

use crate::messages::role::Role;

/// Text with each image as "[image]".
fn text_of(content: &Json) -> String {
	let blocks = match content {
		Json::Str(s) => return s.clone(),
		Json::Arr(blocks) => blocks,
		_ => return String::new(),
	};
	let parts: Vec<String> = blocks
		.iter()
		.map(|c| match c["type"].as_str() {
			Some("text") => c["text"].str_or_empty().to_owned(),
			Some("image") => "[image]".to_owned(),
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

/// One message flattened; none for a system message without text or a role with no flat form.
pub(super) fn render_message(m: &Json) -> Option<Json> {
	let mut out = Obj::new();
	match Role::of(m) {
		Some(Role::System) => {
			let mut parts = vec![text_of(&m["content"])];
			parts.extend(m["sections"].as_obj().into_iter().flat_map(|s| s.values()).filter_map(|v| v.as_str().map(str::to_owned)));
			parts.retain(|p| !p.is_empty());
			if parts.is_empty() {
				return None;
			}
			out.insert("role", Role::System.as_str());
			out.insert("text", parts.join("\n\n"));
		}
		Some(Role::User) => {
			out.insert("role", Role::User.as_str());
			out.insert("text", text_of(&m["content"]));
		}
		Some(Role::Assistant) => {
			let blocks = m["content"].items();
			let text: Vec<&str> = blocks.iter().filter(|c| c["type"] == Json::from("text")).map(|c| c["text"].str_or_empty()).collect();
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
			out.insert("role", Role::Assistant.as_str());
			let text = text.join("\n");
			if !text.is_empty() {
				out.insert("text", text);
			}
			if !calls.is_empty() {
				out.insert("toolCalls", calls);
			}
		}
		Some(Role::ToolResult) => {
			out.insert("role", Role::ToolResult.as_str());
			for key in ["toolCallId", "toolName", "isError"] {
				put(&mut out, key, m.get(key));
			}
			out.insert("text", text_of(&m["content"]));
		}
		_ => return None,
	}
	Some(Json::Obj(out))
}
