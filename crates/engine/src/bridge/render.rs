//! The transcript as the outside agent reads it: flat messages, the instructions and tools, and
//! the fingerprints that tell which messages an agent has already seen.

use gs_core::messages::native_messages::render_message;
use gs_core::messages::role::Role;
use gs_core::records::agent_seen::print_hash;
use gs_json::{Json, Obj, lone::to_utf16, stringify};

/// The leading system message's text is the prompt; any system message may add tools (a later
/// definition of a name replaces the earlier one in place).
pub fn instructions_and_tools(messages: &[Json]) -> (String, Vec<Json>) {
	let mut instructions = String::new();
	let mut tools: Vec<Json> = Vec::new();
	for m in messages.iter().filter(|m| Role::System.is(m)) {
		if instructions.is_empty() {
			instructions = render_message(m, None).map(|r| r["text"].str_or_empty().to_owned()).unwrap_or_default();
		}
		for t in m["toolsAdded"].items().iter() {
			let mut tool = Obj::new();
			for key in ["name", "description", "parameters"] {
				if let Some(v) = t.get(key) {
					tool.insert(key, v.clone());
				}
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
	let mut names: Vec<String> = tools.items().iter().filter_map(|t| t["name"].as_str().map(str::to_owned)).collect();
	names.sort_by_key(|n| to_utf16(n));
	names.into_iter().map(Json::from).collect()
}

/// A system message also counts its tool names: the prompt stays the same when the learner
/// switches tools, and the agent must then get the new tools.
pub fn fingerprint(m: &Json) -> String {
	let rendered = render_message(m, None);
	if !Role::System.is(m) {
		return stringify(&rendered.unwrap_or_default());
	}
	let mut out = rendered.and_then(|r| r.as_obj().cloned()).unwrap_or_default();
	out.insert("tools", sorted_names(&m["toolsAdded"]));
	out.insert("removed", sorted_names(&m["toolsRemoved"]));
	stringify(&Json::Obj(out))
}

/// Each message's fingerprint, the instructions (the leading system message) left out, and the
/// instructions' own hash: a saved rule or a Settings change rewrites them without changing the
/// conversation.
pub fn prints_of(messages: &[Json], extra: Option<&Json>) -> (Vec<String>, String) {
	let all: Vec<&Json> = messages.iter().chain(extra).collect();
	let lead_at = all.iter().position(|m| Role::System.is(m));
	let prints = all.iter().enumerate().map(|(i, m)| if Some(i) == lead_at { String::new() } else { fingerprint(m) }).collect();
	(prints, lead_at.map_or_else(String::new, |i| print_hash(&fingerprint(all[i]))))
}
