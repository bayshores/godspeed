//! The `role` of a lesson message and the two checks built on it that several modules repeat.

use gs_json::Json;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
	System,
	User,
	Assistant,
	ToolResult,
	Custom,
}

impl Role {
	/// The message's role; None when it has none or an unknown one.
	pub fn of(message: &Json) -> Option<Role> {
		Some(match message["role"].as_str()? {
			"system" => Role::System,
			"user" => Role::User,
			"assistant" => Role::Assistant,
			"toolResult" => Role::ToolResult,
			"custom" => Role::Custom,
			_ => return None,
		})
	}

	pub fn as_str(self) -> &'static str {
		match self {
			Role::System => "system",
			Role::User => "user",
			Role::Assistant => "assistant",
			Role::ToolResult => "toolResult",
			Role::Custom => "custom",
		}
	}

	pub fn is(self, message: &Json) -> bool {
		Role::of(message) == Some(self)
	}
}

/// A custom message of this `customType`.
pub fn is_custom(message: &Json, custom_type: &str) -> bool {
	Role::Custom.is(message) && message["customType"].as_str() == Some(custom_type)
}

/// A tool result that did not fail.
pub fn is_ok_tool_result(message: &Json) -> bool {
	Role::ToolResult.is(message) && !message["isError"].truthy()
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn a_role_is_read_from_its_text_and_an_unknown_or_missing_one_is_none() {
		for role in [Role::System, Role::User, Role::Assistant, Role::ToolResult, Role::Custom] {
			assert_eq!(Role::of(&json!({ "role": role.as_str() })), Some(role));
		}
		assert_eq!(Role::of(&json!({ "role": "you" })), None);
		assert_eq!(Role::of(&json!({ "role": 1 })), None);
		assert_eq!(Role::of(&json!({})), None);
	}

	#[test]
	fn custom_and_tool_result_checks_need_the_role_and_the_rest() {
		assert!(is_custom(&json!({ "role": "custom", "customType": "review" }), "review"));
		assert!(!is_custom(&json!({ "role": "user", "customType": "review" }), "review"));
		assert!(!is_custom(&json!({ "role": "custom", "customType": "other" }), "review"));
		assert!(is_ok_tool_result(&json!({ "role": "toolResult" })));
		assert!(is_ok_tool_result(&json!({ "role": "toolResult", "isError": false })));
		assert!(!is_ok_tool_result(&json!({ "role": "toolResult", "isError": true })));
		assert!(!is_ok_tool_result(&json!({ "role": "assistant" })));
	}
}
