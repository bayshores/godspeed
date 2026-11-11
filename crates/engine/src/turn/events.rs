//! The agent's lifecycle events (pi-agent-core `AgentEvent`), as the turn stream sends them.

use gs_json::{Json, Obj};

#[derive(Clone, Debug, PartialEq)]
pub enum AgentEvent {
	AgentStart,
	TurnStart,
	MessageStart(Json),
	/// The streaming assistant message so far. pi also sends the provider's chunk event as
	/// `assistantMessageEvent`; nothing reads it, so it is left out (the turn stream dropped it).
	MessageUpdate(Json),
	MessageEnd(Json),
	ToolExecutionStart { tool_call_id: String, tool_name: String, args: Json },
	/// `duration_ms` is set for calls that ran (not for refused or failed-before-running ones).
	ToolExecutionEnd { tool_call_id: String, tool_name: String, result: Json, is_error: bool, duration_ms: Option<f64> },
	TurnEnd { message: Json, tool_results: Vec<Json> },
	AgentEnd { messages: Vec<Json> },
}

impl AgentEvent {
	/// The event as JSON, keys in pi's order (`{"type":"agent_start"}`, …).
	pub fn to_json(&self) -> Json {
		let mut o = Obj::new();
		let mut put = |k: &str, v: Json| {
			o.insert(k, v);
		};
		match self {
			AgentEvent::AgentStart => put("type", "agent_start".into()),
			AgentEvent::TurnStart => put("type", "turn_start".into()),
			AgentEvent::MessageStart(m) | AgentEvent::MessageUpdate(m) | AgentEvent::MessageEnd(m) => {
				let name = match self {
					AgentEvent::MessageStart(_) => "message_start",
					AgentEvent::MessageUpdate(_) => "message_update",
					_ => "message_end",
				};
				put("type", name.into());
				put("message", m.clone());
			}
			AgentEvent::ToolExecutionStart { tool_call_id, tool_name, args } => {
				put("type", "tool_execution_start".into());
				put("toolCallId", tool_call_id.into());
				put("toolName", tool_name.into());
				put("args", args.clone());
			}
			AgentEvent::ToolExecutionEnd { tool_call_id, tool_name, result, is_error, duration_ms } => {
				put("type", "tool_execution_end".into());
				put("toolCallId", tool_call_id.into());
				put("toolName", tool_name.into());
				put("result", result.clone());
				put("isError", (*is_error).into());
				if let Some(ms) = duration_ms {
					put("durationMs", (*ms).into());
				}
			}
			AgentEvent::TurnEnd { message, tool_results } => {
				put("type", "turn_end".into());
				put("message", message.clone());
				put("toolResults", Json::Arr(tool_results.clone()));
			}
			AgentEvent::AgentEnd { messages } => {
				put("type", "agent_end".into());
				put("messages", Json::Arr(messages.clone()));
			}
		}
		Json::Obj(o)
	}
}
