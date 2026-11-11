//! The faux provider's made-up token counts (pi-ai providers/faux.ts `withUsageEstimate`): a
//! quarter token per UTF-16 unit of the prompt and of the reply. The context meter reads them.
//! The outside agent's stream turns the prompt cache off, so cache reads and writes stay 0.

use gs_base::text::len16;
use gs_json::{Json, json, stringify};

use super::transcript::system_message_text;

fn quarter(units: usize) -> f64 {
	units.div_ceil(4) as f64
}

/// `JSON.stringify(v)` inside a template string: `undefined` for a missing value.
fn template_json(v: Option<&Json>) -> String {
	v.map_or_else(|| "undefined".to_owned(), stringify)
}

/// `contentToText`: text blocks as they are, anything else as an image marker. Fails where the
/// TypeScript throws (a block without data).
fn content_to_text(content: &Json) -> Result<String, String> {
	let Some(blocks) = content.as_arr() else {
		return Ok(content.as_str().unwrap_or_default().to_owned());
	};
	let parts = blocks.iter().map(|b| {
		if b["type"] == Json::from("text") {
			return Ok(b["text"].as_str().unwrap_or_default().to_owned());
		}
		let len = match b.get("data") {
			None => return Err("Cannot read properties of undefined (reading 'length')".to_owned()),
			Some(Json::Null) => return Err("Cannot read properties of null (reading 'length')".to_owned()),
			Some(Json::Str(s)) => len16(s).to_string(),
			Some(Json::Arr(a)) => a.len().to_string(),
			Some(_) => "undefined".to_owned(),
		};
		Ok(format!("[image:{}:{len}]", b["mimeType"].as_str().unwrap_or("undefined")))
	});
	Ok(parts.collect::<Result<Vec<_>, String>>()?.join("\n"))
}

/// `assistantContentToText`.
pub(crate) fn assistant_text(content: &Json) -> String {
	let blocks = content.as_arr().map_or(&[][..], Vec::as_slice);
	blocks
		.iter()
		.map(|b| match b["type"].as_str() {
			// Array.join writes a missing text as "".
			Some("text") => b["text"].as_str().unwrap_or_default().to_owned(),
			Some("thinking") => b["thinking"].as_str().unwrap_or_default().to_owned(),
			_ => format!("{}:{}", b["name"].as_str().unwrap_or("undefined"), template_json(b.get("arguments"))),
		})
		.collect::<Vec<_>>()
		.join("\n")
}

/// `messageToText`.
fn message_text(m: &Json) -> Result<String, String> {
	Ok(match m["role"].as_str() {
		Some("system") => {
			let mut parts = vec![system_message_text(m)];
			parts.extend(m["toolsRemoved"].as_arr().into_iter().flatten().map(|t| format!("tool-:{}", stringify(t))));
			parts.extend(m["toolsAdded"].as_arr().into_iter().flatten().map(|t| format!("tool+:{}", stringify(t))));
			parts.retain(|p| !p.is_empty());
			parts.join("\n")
		}
		Some("user") => content_to_text(&m["content"])?,
		Some("assistant") => assistant_text(&m["content"]),
		_ => {
			let mut parts = vec![m["toolName"].as_str().unwrap_or("undefined").to_owned()];
			for block in m["content"].as_arr().into_iter().flatten() {
				parts.push(content_to_text(&Json::Arr(vec![block.clone()]))?);
			}
			parts.join("\n")
		}
	})
}

/// The usage record for `reply` answering `context` (the request's messages).
pub fn estimate(context: &[Json], reply: &Json) -> Result<Json, String> {
	let mut units = context.len().saturating_sub(1) * 2;
	for m in context {
		units += len16(m["role"].as_str().unwrap_or("undefined")) + 1 + len16(&message_text(m)?);
	}
	let input = quarter(units);
	let output = quarter(len16(&assistant_text(&reply["content"])));
	Ok(json!({
		"input": input,
		"output": output,
		"cacheRead": 0,
		"cacheWrite": 0,
		"totalTokens": input + output,
		"cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 },
	}))
}
