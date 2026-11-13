//! Tool-call ids made unique at the turn's wire. Some
//! providers restart their ids every response (`call_0` each turn), and everything in the app
//! keys on the id, so a reused id gets a fresh `<id>~2`, `~3`, … once, for the wire, the saved
//! record and the next turn alike. History already in the record is never rewritten.
//!
//! Each assistant message opens a table (orig → unique) at its `message_start`; its updates,
//! its end and the tool events after it use that table. pi joins the settled transcript to
//! those tables by object identity; here the k-th assistant message the run added is the one
//! of the k-th assistant `message_end`.

use std::collections::{HashMap, HashSet};

use gs_json::{Json, Obj};

use super::events::AgentEvent;
use super::messages::role;

fn call_ids(message: &Json) -> impl Iterator<Item = &str> {
	message["content"].as_arr().into_iter().flatten().filter(|b| b["type"] == Json::from("toolCall")).filter_map(|b| b["id"].as_str())
}

/// Every call id and result id in a message list (the chat record, duplicates included).
pub fn collect_tool_call_ids(messages: &[Json]) -> Vec<String> {
	let mut ids = Vec::new();
	for m in messages {
		match role(m) {
			"assistant" => ids.extend(call_ids(m).map(str::to_owned)),
			"toolResult" => ids.extend(m["toolCallId"].as_str().map(str::to_owned)),
			_ => {}
		}
	}
	ids
}

pub struct ToolCallIdUniquifier {
	seen: HashSet<String>,
	tables: Vec<HashMap<String, String>>,
	/// The current assistant message's table.
	epoch: Option<usize>,
	/// The table of each assistant `message_end`, in order (none: it had no calls).
	ended: Vec<Option<usize>>,
}

impl ToolCallIdUniquifier {
	pub fn new(used_ids: impl IntoIterator<Item = String>) -> ToolCallIdUniquifier {
		ToolCallIdUniquifier { seen: used_ids.into_iter().collect(), tables: Vec::new(), epoch: None, ended: Vec::new() }
	}

	/// Keeps `orig` if never used, else the first unused `<orig>~n`.
	fn claim(&mut self, orig: &str) -> String {
		let mut candidate = orig.to_owned();
		let mut n = 2;
		while self.seen.contains(&candidate) {
			candidate = format!("{orig}~{n}");
			n += 1;
		}
		self.seen.insert(candidate.clone());
		candidate
	}

	fn open_table(&mut self) -> usize {
		self.tables.push(HashMap::new());
		self.tables.len() - 1
	}

	/// Registers and rewrites one assistant message's call ids in `table`.
	fn remap_with(&mut self, message: &Json, table: usize) -> Json {
		self.epoch = Some(table);
		let mut changed = false;
		let content: Vec<Json> = message["content"]
			.as_arr()
			.into_iter()
			.flatten()
			.map(|block| {
				let Some(orig) = block["id"].as_str().filter(|_| block["type"] == Json::from("toolCall")) else { return block.clone() };
				let mapped = match self.tables[table].get(orig) {
					Some(m) => m.clone(),
					None => {
						let m = self.claim(orig);
						self.tables[table].insert(orig.to_owned(), m.clone());
						m
					}
				};
				if mapped == orig {
					return block.clone();
				}
				changed = true;
				let mut b = block.as_obj().cloned().unwrap_or_default();
				b.insert("id", mapped);
				Json::Obj(b)
			})
			.collect();
		if !changed {
			return message.clone();
		}
		let mut m: Obj = message.as_obj().cloned().unwrap_or_default();
		m.insert("content", content);
		Json::Obj(m)
	}

	/// An assistant message on the wire, in the current table.
	fn remap(&mut self, message: &Json) -> Json {
		if role(message) != "assistant" || call_ids(message).next().is_none() {
			return message.clone();
		}
		let table = match self.epoch {
			Some(t) => t,
			None => self.open_table(),
		};
		self.remap_with(message, table)
	}

	fn mapped_id(&self, id: &str) -> String {
		self.epoch.and_then(|t| self.tables[t].get(id)).cloned().unwrap_or_else(|| id.to_owned())
	}

	/// Every event, ids made unique.
	pub fn event(&mut self, event: AgentEvent) -> AgentEvent {
		match event {
			AgentEvent::MessageStart(m) => {
				if role(&m) == "assistant" {
					self.epoch = Some(self.open_table());
				}
				AgentEvent::MessageStart(self.remap(&m))
			}
			AgentEvent::MessageUpdate(m) => AgentEvent::MessageUpdate(self.remap(&m)),
			AgentEvent::MessageEnd(m) => {
				let remapped = self.remap(&m);
				if role(&m) == "assistant" {
					self.ended.push(self.epoch.filter(|_| call_ids(&m).next().is_some()));
				}
				AgentEvent::MessageEnd(remapped)
			}
			AgentEvent::ToolExecutionStart { tool_call_id, tool_name, args } => AgentEvent::ToolExecutionStart { tool_call_id: self.mapped_id(&tool_call_id), tool_name, args },
			AgentEvent::ToolExecutionEnd { tool_call_id, tool_name, result, is_error, duration_ms } => {
				AgentEvent::ToolExecutionEnd { tool_call_id: self.mapped_id(&tool_call_id), tool_name, result, is_error, duration_ms }
			}
			AgentEvent::TurnEnd { message, tool_results } => {
				let message = self.remap(&message);
				let tool_results = tool_results.iter().map(|r| self.with_result_id(r, self.epoch)).collect();
				AgentEvent::TurnEnd { message, tool_results }
			}
			AgentEvent::AgentEnd { messages } => AgentEvent::AgentEnd { messages: self.remap_settled(&messages, 0) },
			other => other,
		}
	}

	fn with_result_id(&self, result: &Json, table: Option<usize>) -> Json {
		let mapped = table.and_then(|t| result["toolCallId"].as_str().and_then(|id| self.tables[t].get(id)));
		match mapped {
			Some(id) => {
				let mut r = result.as_obj().cloned().unwrap_or_default();
				r.insert("toolCallId", id.clone());
				Json::Obj(r)
			}
			None => result.clone(),
		}
	}

	/// The settled transcript with the ids the wire showed. Messages before `first_new` are
	/// history and pass through; a tool result takes the table of the assistant message before it.
	pub fn remap_settled(&mut self, messages: &[Json], first_new: usize) -> Vec<Json> {
		let mut ended = self.ended.clone().into_iter();
		let mut scope = None;
		messages
			.iter()
			.enumerate()
			.map(|(i, m)| match role(m) {
				"assistant" => {
					scope = if i < first_new { None } else { ended.next().flatten() };
					match scope {
						Some(t) => self.remap_with(m, t),
						None => m.clone(),
					}
				}
				"toolResult" => self.with_result_id(m, scope),
				_ => m.clone(),
			})
			.collect()
	}
}
