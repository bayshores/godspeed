//! The JSON lines between godspeed and its Claude helper (`claude-helper.mjs`), and how the Agent
//! SDK messages the helper passes on become session events.

use std::collections::HashMap;

use gs_json::{Json, json};

use crate::event::{Ask, End, Part, SessionEvent, ToolCall, ToolReply, Usage, Verdict};
use crate::session::SessionSpec;

/// The helper's MCP server for godspeed's tools; Claude Code names them `mcp__<server>__<tool>`.
pub const TOOL_SERVER: &str = "godspeed";

/// How Claude Code starts: the learner's own `claude`, or the learner's own command, which the
/// helper runs through a shell with Claude Code's arguments after it.
#[derive(Clone, Debug, PartialEq)]
pub enum ClaudeProgram {
	Path(String),
	Command(String),
}

pub fn open(session: &str, spec: &SessionSpec, program: &ClaudeProgram) -> Json {
	let tools: Json = spec.tools.iter().map(|tool| json!({ "name": tool.name, "description": tool.description, "inputSchema": tool.input_schema })).collect();
	let mut message = json!({
		"type": "open",
		"session": session,
		"cwd": spec.cwd.to_string_lossy(),
		"model": spec.model,
		"resume": spec.resume,
		"persist": spec.persist,
		"systemPrompt": spec.instructions,
		"tools": tools,
	});
	match program {
		ClaudeProgram::Path(path) => message.set("claudePath", path.as_str()),
		ClaudeProgram::Command(command) => message.set("launcher", command.as_str()),
	}
	message
}

/// Message content as the Anthropic API takes it.
fn content(parts: &[Part]) -> Json {
	parts
		.iter()
		.map(|part| match part {
			Part::Text(text) => json!({ "type": "text", "text": text }),
			Part::Image { mime, base64 } => json!({ "type": "image", "source": { "type": "base64", "media_type": mime, "data": base64 } }),
		})
		.collect()
}

/// A steer goes into the running turn; a send starts the next one.
pub fn send(session: &str, parts: &[Part], steer: bool) -> Json {
	json!({ "type": "send", "session": session, "content": content(parts), "steer": steer })
}

pub fn interrupt(session: &str) -> Json {
	json!({ "type": "interrupt", "session": session })
}

pub fn model(session: &str, model: &str) -> Json {
	json!({ "type": "model", "session": session, "model": model })
}

pub fn close(session: &str) -> Json {
	json!({ "type": "close", "session": session })
}

/// A tool's result as MCP content.
pub fn tool_result(id: &str, reply: &ToolReply) -> Json {
	let content: Json = reply
		.content
		.iter()
		.map(|part| match part {
			Part::Text(text) => json!({ "type": "text", "text": text }),
			Part::Image { mime, base64 } => json!({ "type": "image", "data": base64, "mimeType": mime }),
		})
		.collect();
	json!({ "type": "tool_result", "id": id, "content": content, "isError": reply.is_error, "endTurn": reply.ends_turn })
}

pub fn approval(id: &str, verdict: &Verdict) -> Json {
	json!({ "type": "approval", "id": id, "allow": verdict.allow, "message": verdict.message })
}

/// A line from the helper.
#[derive(Debug, PartialEq)]
pub enum FromHelper {
	Opened { session: String, native_id: String },
	Sdk { session: String, message: Json },
	ToolCall { id: String, session: String, call: ToolCall },
	Approval { id: String, session: String, ask: Ask },
	/// A session's query ended: closed by godspeed, or its Claude Code stopped.
	Closed { session: String },
	Error { session: Option<String>, message: String },
}

pub fn from_helper(line: &str) -> Result<FromHelper, String> {
	let message = gs_json::parse(line).map_err(|err| format!("not JSON ({err})"))?;
	let text = |key: &str| message[key].str_or_empty().to_owned();
	Ok(match message["type"].as_str() {
		Some("opened") => FromHelper::Opened { session: text("session"), native_id: text("nativeId") },
		Some("sdk") => FromHelper::Sdk { session: text("session"), message: message["message"].clone() },
		Some("tool_call") => FromHelper::ToolCall { id: text("id"), session: text("session"), call: ToolCall { id: text("toolUseId"), name: text("name"), args: message["args"].clone() } },
		Some("approval") => FromHelper::Approval { id: text("id"), session: text("session"), ask: Ask::Tool { name: text("tool"), input: message["input"].clone() } },
		Some("closed") => FromHelper::Closed { session: text("session") },
		Some("error") => FromHelper::Error { session: message["session"].as_str().map(str::to_owned), message: text("message") },
		other => return Err(format!("unknown type {other:?}")),
	})
}

/// What one turn's reading keeps between SDK messages.
#[derive(Default)]
pub struct Reading {
	/// Claude Code's own tool calls still running, by tool-use id.
	own: HashMap<String, (String, Json)>,
	/// The model call under way: what it read, until its output count arrives.
	call: Option<Usage>,
}

/// How the SDK says a turn ended.
#[derive(Debug, PartialEq)]
pub enum Finish {
	Done,
	/// Stopped while running, with the SDK's errors.
	Stopped(String),
	Failed(String),
}

impl Finish {
	/// An interrupted turn reports an error; it was godspeed's own Stop.
	pub fn end(self, interrupting: bool) -> End {
		match self {
			Finish::Done => End::Completed,
			Finish::Stopped(_) if interrupting => End::Interrupted,
			Finish::Stopped(why) | Finish::Failed(why) => End::Failed(why),
		}
	}
}

fn godspeed_tool(name: &str) -> bool {
	name.strip_prefix("mcp__").and_then(|rest| rest.strip_prefix(TOOL_SERVER)).is_some_and(|rest| rest.starts_with("__"))
}

fn count(value: &Json) -> u64 {
	value.as_f64().map_or(0, |n| n.max(0.0) as u64)
}

/// Whether an SDK message is the model at work, which every turn starts with.
pub fn model_at_work(message: &Json) -> bool {
	message["type"].as_str() == Some("stream_event")
}

/// The events one SDK message makes, and the turn's end when it is the result. Messages from a
/// subagent (`parent_tool_use_id`) are not the reply.
pub fn read_sdk(message: &Json, reading: &mut Reading) -> (Vec<SessionEvent>, Option<Finish>) {
	let mut events = Vec::new();
	if !message["parent_tool_use_id"].is_null() {
		return (events, None);
	}
	match message["type"].as_str() {
		Some("stream_event") => {
			let event = &message["event"];
			match event["type"].as_str() {
				Some("content_block_delta") if event["delta"]["type"].as_str() == Some("text_delta") => events.push(SessionEvent::TextDelta(event["delta"]["text"].str_or_empty().to_owned())),
				Some("message_start") => {
					let usage = &event["message"]["usage"];
					let cached = count(&usage["cache_read_input_tokens"]);
					reading.call = Some(Usage { input: count(&usage["input_tokens"]) + count(&usage["cache_creation_input_tokens"]) + cached, cached, output: 0 });
				}
				Some("message_delta") => {
					if let Some(mut usage) = reading.call.take() {
						usage.output = count(&event["usage"]["output_tokens"]);
						events.push(SessionEvent::Usage(usage));
					}
				}
				_ => {}
			}
		}
		Some("assistant") => {
			for block in message["message"]["content"].items() {
				match block["type"].as_str() {
					Some("text") if !block["text"].str_or_empty().is_empty() => events.push(SessionEvent::TextDone(block["text"].str_or_empty().to_owned())),
					Some("tool_use") if !godspeed_tool(block["name"].str_or_empty()) => {
						let (id, name, input) = (block["id"].str_or_empty().to_owned(), block["name"].str_or_empty().to_owned(), block["input"].clone());
						reading.own.insert(id.clone(), (name.clone(), input.clone()));
						events.push(SessionEvent::OwnTool { id, name, input, done: false });
					}
					_ => {}
				}
			}
		}
		Some("user") => {
			for block in message["message"]["content"].items() {
				if block["type"].as_str() == Some("tool_result")
					&& let Some((id, (name, input))) = reading.own.remove_entry(block["tool_use_id"].str_or_empty())
				{
					events.push(SessionEvent::OwnTool { id, name, input, done: true });
				}
			}
		}
		Some("system") if message["subtype"].as_str() == Some("compact_boundary") => events.push(SessionEvent::Compacted),
		Some("result") => {
			let subtype = message["subtype"].as_str().unwrap_or("no result");
			let errors = message["errors"].strs().join("; ");
			let why = if errors.is_empty() { format!("the turn ended with {subtype}") } else { errors };
			let finish = match subtype {
				"success" if !message["is_error"].truthy() => Finish::Done,
				"success" => Finish::Failed(message["result"].as_str().unwrap_or("Claude Code reported an error").to_owned()),
				"error_during_execution" => Finish::Stopped(why),
				_ => Finish::Failed(why),
			};
			return (events, Some(finish));
		}
		_ => {}
	}
	(events, None)
}
