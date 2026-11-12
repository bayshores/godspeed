//! Tool results as MCP's CallToolResult: `{content, isError?}`.

use gs_core::spaces::space_tools::ToolOutcome;
use gs_json::{Json, json, stringify};

/// Compact JSON (indentation costs the agent tokens and tells it nothing); a string as is.
pub fn result(value: &Json) -> Json {
	let text = match value {
		Json::Str(s) => s.clone(),
		other => stringify(other),
	};
	json!({ "content": [text_block(&text)] })
}

pub fn text_block(text: &str) -> Json {
	json!({ "type": "text", "text": text })
}

pub fn failure(message: &str) -> Json {
	json!({ "content": [text_block(message)], "isError": true })
}

/// A space action's outcome as a tool result.
pub fn outcome(outcome: ToolOutcome) -> Json {
	match outcome {
		ToolOutcome::Ok { value, .. } => result(&value),
		ToolOutcome::Err(error) => failure(&error),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn results_are_compact_text() {
		assert_eq!(stringify(&result(&json!({ "a": [1, 2] }))), r#"{"content":[{"type":"text","text":"{\"a\":[1,2]}"}]}"#);
		assert_eq!(stringify(&result(&json!("plain"))), r#"{"content":[{"type":"text","text":"plain"}]}"#);
		assert_eq!(stringify(&failure("No.")), r#"{"content":[{"type":"text","text":"No."}],"isError":true}"#);
	}
}
