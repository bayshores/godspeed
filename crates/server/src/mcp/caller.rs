//! Who sent an MCP request: the client's name, the client its `_meta` points to, and whether the
//! request is one that hands over the instructions.

use gs_services::app::terminal_state::display_agent_name;
use gs_json::Json;

use super::protocol::CLIENT_INFO_KEY;

#[derive(Debug, Default, PartialEq)]
pub struct Caller {
	/// The client's own name (from initialize, or a modern request's `_meta`).
	pub name: Option<String>,
	/// The client its `_meta` keys point to when it sends no name.
	pub guessed: Option<String>,
	/// initialize or server/discover: the request returns the instructions.
	pub wants_instructions: bool,
}

/// The caller of a POST body (a message or a batch); a body that is not JSON names nobody.
pub fn caller_of(body: Option<&Json>) -> Caller {
	let mut caller = Caller::default();
	let messages = match body {
		Some(Json::Arr(items)) => items.iter().collect(),
		Some(one) => vec![one],
		None => Vec::new(),
	};
	for m in messages {
		let method = m["method"].as_str();
		let info = if method == Some("initialize") { &m["params"]["clientInfo"] } else { &m["params"]["_meta"][CLIENT_INFO_KEY] };
		if caller.name.is_none() {
			caller.name = display_agent_name(info);
		}
		if caller.guessed.is_none() {
			caller.guessed = client_of_meta(&m["params"]["_meta"]).map(str::to_owned);
		}
		if matches!(method, Some("initialize" | "server/discover")) {
			caller.wants_instructions = true;
		}
	}
	caller
}

/// Only Codex sends turn metadata, and only the godspeed folder's Claude Code connector sends
/// "godspeed/agent".
fn client_of_meta(meta: &Json) -> Option<&'static str> {
	let has = |key: &str| meta.as_obj().is_some_and(|m| m.contains_key(key));
	if has("x-codex-turn-metadata") {
		return Some("Codex");
	}
	has("godspeed/agent").then_some("Claude Code")
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn names_the_caller() {
		let init = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "clientInfo": { "name": "codex-mcp-client" } } });
		assert_eq!(caller_of(Some(&init)), Caller { name: Some("Codex".into()), guessed: None, wants_instructions: true });
		let connector = json!({ "method": "tools/call", "params": { "_meta": { "godspeed/agent": "s1" } } });
		assert_eq!(caller_of(Some(&connector)), Caller { name: None, guessed: Some("Claude Code".into()), wants_instructions: false });
		assert_eq!(caller_of(None), Caller::default());
	}
}
