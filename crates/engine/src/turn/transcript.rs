//! System messages and tool declarations in the transcript (pi-ai utils/transcript.ts and
//! utils/text.ts): the leading system message carries the prompt and the tools, and a later
//! system message declares what changed.

use gs_base::clock;
use gs_json::{Json, Obj, json, stringify};

use super::messages::role;
use super::tool::Tool;

/// `toToolDeclaration`: what the model sees of a tool.
pub fn tool_declaration(tool: &dyn Tool) -> Json {
	json!({ "name": tool.name(), "description": tool.description(), "parameters": tool.parameters().clone() })
}

/// `createInitialSystemMessage`: none when both the prompt and the tools are empty.
pub fn initial_system_message(system_prompt: &str, declarations: &[Json]) -> Option<Json> {
	if system_prompt.is_empty() && declarations.is_empty() {
		return None;
	}
	let mut m = Obj::new();
	m.insert("role", "system");
	m.insert("content", system_prompt);
	if !declarations.is_empty() {
		m.insert("toolsAdded", declarations.to_vec());
	}
	m.insert("timestamp", 0);
	Some(Json::Obj(m))
}

/// `normalizeContext({ systemPrompt, messages, tools })`: the prompt and tools fold into a
/// leading system message.
pub fn normalize_context(system_prompt: &str, messages: &[Json], declarations: &[Json]) -> Vec<Json> {
	initial_system_message(system_prompt, declarations).into_iter().chain(messages.iter().cloned()).collect()
}

/// `contentText`: a string, or its text blocks joined.
fn content_text(content: &Json) -> String {
	match content {
		Json::Str(s) => s.clone(),
		Json::Arr(blocks) => blocks.iter().filter(|b| b["type"] == Json::from("text")).map(|b| b["text"].as_str().unwrap_or_default()).collect::<Vec<_>>().join("\n"),
		_ => String::new(),
	}
}

/// `getSystemMessageText`: the content, then each section, blank-line separated.
pub fn system_message_text(message: &Json) -> String {
	let mut parts = vec![content_text(&message["content"])];
	if let Some(sections) = message["sections"].as_obj() {
		parts.extend(sections.values().filter_map(|v| v.as_str().map(str::to_owned)));
	}
	parts.retain(|p| !p.is_empty());
	parts.join("\n\n")
}

fn named<'a>(list: &'a Json, key: &str) -> impl Iterator<Item = &'a Json> {
	list[key].as_arr().into_iter().flatten()
}

fn name_of(tool: &Json) -> &str {
	tool["name"].as_str().unwrap_or_default()
}

/// `getCurrentTools`: every system message's removals and additions, replayed in order.
fn current_tools(messages: &[Json]) -> Vec<Json> {
	let mut tools: Vec<Json> = Vec::new();
	for m in messages.iter().filter(|m| role(m) == "system") {
		for removed in named(m, "toolsRemoved") {
			tools.retain(|t| name_of(t) != name_of(removed));
		}
		for added in named(m, "toolsAdded") {
			match tools.iter_mut().find(|t| name_of(t) == name_of(added)) {
				Some(slot) => *slot = added.clone(),
				None => tools.push(added.clone()),
			}
		}
	}
	tools
}

/// `getToolStateChanges`: a changed definition is a removal plus an addition.
fn tool_state_changes(previous: &[Json], current: &[Json]) -> (Vec<Json>, Vec<Json>) {
	let differs = |a: &Json, list: &[Json]| list.iter().find(|t| name_of(t) == name_of(a)).is_none_or(|b| stringify(a) != stringify(b));
	let added = current.iter().filter(|t| differs(t, previous)).cloned().collect();
	let removed = previous.iter().filter(|t| differs(t, current)).map(|t| json!({ "name": name_of(t) })).collect();
	(added, removed)
}

/// `withToolChanges`: the message with its tool fields replaced; empty lists are left out.
fn with_tool_changes(message: &Json, added: &[Json], removed: &[Json]) -> Json {
	let mut m = message.as_obj().cloned().unwrap_or_default();
	m.remove("toolsAdded");
	m.remove("toolsRemoved");
	if !added.is_empty() {
		m.insert("toolsAdded", added.to_vec());
	}
	if !removed.is_empty() {
		m.insert("toolsRemoved", removed.to_vec());
	}
	Json::Obj(m)
}

/// `declareToolChanges`: before a request, the difference between the tools the transcript
/// declares and the tools that can run goes on a system message among `pending`.
pub fn declare_tool_changes(transcript: &[Json], declarations: &[Json], pending: Vec<Json>) -> Vec<Json> {
	let system_index = pending.iter().rposition(|m| role(m) == "system");
	let baseline: Vec<Json> = match system_index {
		Some(i) => pending.iter().enumerate().map(|(k, m)| if k == i { with_tool_changes(m, &[], &[]) } else { m.clone() }).collect(),
		None => pending.clone(),
	};
	let declared: Vec<Json> = transcript.iter().chain(&baseline).cloned().collect();
	let (added, removed) = tool_state_changes(&current_tools(&declared), declarations);
	let unchanged = added.is_empty() && removed.is_empty();
	if let Some(i) = system_index {
		let has = |key: &str| pending[i][key].as_arr().is_some_and(|l| !l.is_empty());
		if unchanged && !has("toolsAdded") && !has("toolsRemoved") {
			return pending;
		}
		return baseline.into_iter().enumerate().map(|(k, m)| if k == i { with_tool_changes(&pending[i], &added, &removed) } else { m }).collect();
	}
	if unchanged {
		return pending;
	}
	let update = with_tool_changes(&json!({ "role": "system", "content": "", "timestamp": clock::now_ms() }), &added, &removed);
	let at = pending.iter().position(|m| role(m) != "system").unwrap_or(pending.len());
	let mut out = pending;
	out.insert(at, update);
	out
}
