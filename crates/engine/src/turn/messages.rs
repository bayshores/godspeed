//! pi message records the loop builds itself, field for field in pi's key order. Messages are
//! `Json` (pi's `AgentMessage`): `{role:"user"|"assistant"|"toolResult"|"system", content, …}`.

use gs_base::clock;
use gs_json::{Json, json};

/// pi-ai's zero usage (`DEFAULT_USAGE`).
pub fn zero_usage() -> Json {
	json!({ "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } })
}

/// pi-ai's `fauxAssistantMessage(content, { stopReason })`: the faux provider's own ids and a
/// fresh timestamp; the faux stream swaps in the model's api, provider and id.
pub fn faux_assistant_message(content: Vec<Json>, stop_reason: &str) -> Json {
	json!({
		"role": "assistant",
		"content": content,
		"api": "faux",
		"provider": "faux",
		"model": "faux-1",
		"usage": zero_usage(),
		"stopReason": stop_reason,
		"timestamp": clock::now_ms(),
	})
}

pub fn text_block(text: &str) -> Json {
	json!({ "type": "text", "text": text })
}

/// pi-agent-core's `createErrorToolResult`: what a failed or refused call returns.
pub fn error_tool_result(text: &str) -> Json {
	json!({ "content": [text_block(text)], "details": {} })
}

/// pi's `toolResult` message for one finished call. `result` is the tool's result record;
/// a missing `details` stays missing.
pub fn tool_result_message(call: &Json, result: &Json, is_error: bool, duration_ms: Option<f64>) -> Json {
	let mut m = gs_json::Obj::new();
	m.insert("role", "toolResult");
	m.insert("toolCallId", call["id"].clone());
	m.insert("toolName", call["name"].clone());
	m.insert("content", match result.get("content") {
		Some(Json::Null) | None => Json::Arr(Vec::new()),
		Some(content) => content.clone(),
	});
	for key in ["details", "usage"] {
		if let Some(v) = result.get(key) {
			m.insert(key, v.clone());
		}
	}
	m.insert("isError", is_error);
	if let Some(ms) = duration_ms {
		m.insert("durationMs", ms);
	}
	m.insert("timestamp", clock::now_ms());
	Json::Obj(m)
}

pub fn role(message: &Json) -> &str {
	message["role"].as_str().unwrap_or("")
}

/// The assistant message's tool-call blocks, in order.
pub fn tool_calls(message: &Json) -> Vec<Json> {
	message["content"].as_arr().map_or_else(Vec::new, |blocks| blocks.iter().filter(|b| b["type"] == Json::from("toolCall")).cloned().collect())
}
