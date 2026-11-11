//! The old ways godspeed loaded outside the folder: the retired Claude Code plugin, and the
//! block once pasted into Codex's config.

use std::sync::LazyLock;

use gs_base::re::Re;
use gs_json::{Json, parse, stringify_pretty};

/// ~/.codex/config.toml without the [mcp_servers.godspeed] block godspeed used to have the
/// learner paste (it pointed at the app's /api/mcp), or None when there is none. Codex now gets
/// godspeed only in the folder. Its sub-tables (e.g. tool approvals) go too: left alone they'd
/// still define a godspeed server, one with no url, and Codex refuses that.
pub fn without_old_codex_server(toml: &str) -> Option<String> {
	static TABLE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^\s*\[", ""));
	static GODSPEED_TABLE: LazyLock<Re> = LazyLock::new(|| Re::new(r#"^\s*\[\s*mcp_servers\.("godspeed"|godspeed)\s*\]\s*$"#, ""));
	static GODSPEED_SUBTABLE: LazyLock<Re> = LazyLock::new(|| Re::new(r#"^\s*\[\[?\s*mcp_servers\.("godspeed"|godspeed)\."#, ""));
	static URL: LazyLock<Re> = LazyLock::new(|| Re::new(r#"^\s*url\s*=\s*"[^"]*\/api\/mcp""#, "m"));
	static EXTRA_BLANKS: LazyLock<Re> = LazyLock::new(|| Re::new(r"\n{3,}", "g"));
	let lines: Vec<&str> = toml.split('\n').collect();
	let start = lines.iter().position(|l| GODSPEED_TABLE.test(l))?;
	let mut end = start + 1;
	while end < lines.len() && !TABLE.test(lines[end]) {
		end += 1;
	}
	if !URL.test(&lines[start..end].join("\n")) {
		return None;
	}
	let mut dropping = false;
	let kept: Vec<&str> = lines
		.into_iter()
		.filter(|l| {
			if TABLE.test(l) {
				dropping = GODSPEED_TABLE.test(l) || GODSPEED_SUBTABLE.test(l);
			}
			!dropping
		})
		.collect();
	Some(EXTRA_BLANKS.replace(&kept.join("\n"), "\n\n"))
}

/// A JSON file's text without the entry at `keys` (e.g. ["plugins", "godspeed@godspeed"]), or
/// None when it has none or isn't JSON.
pub fn without_json_entry(text: &str, keys: &[&str]) -> Option<String> {
	let mut root = parse(text).ok()?;
	let (last, path) = keys.split_last()?;
	let mut parent: &mut Json = &mut root;
	for key in path {
		parent = parent.as_obj_mut()?.get_mut(key)?;
	}
	parent.as_obj_mut()?.remove(last)?;
	Some(stringify_pretty(&root, "  "))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_pasted_codex_block_goes() {
		let toml = "model = \"x\"\n\n[mcp_servers.godspeed]\nurl = \"http://127.0.0.1:47613/api/mcp\"\n\n[mcp_servers.godspeed.tools]\na = 1\n\n[other]\nb = 2\n";
		assert_eq!(without_old_codex_server(toml).as_deref(), Some("model = \"x\"\n\n[other]\nb = 2\n"));
		assert_eq!(without_old_codex_server("[mcp_servers.godspeed]\ncommand = \"node\"\n"), None);
		assert_eq!(without_old_codex_server("model = 1\n"), None);
	}

	#[test]
	fn an_entry_leaves_a_json_file() {
		let text = r#"{"plugins":{"godspeed@godspeed":true,"b":1},"c":2}"#;
		assert_eq!(without_json_entry(text, &["plugins", "godspeed@godspeed"]).as_deref(), Some("{\n  \"plugins\": {\n    \"b\": 1\n  },\n  \"c\": 2\n}"));
		assert_eq!(without_json_entry(text, &["plugins", "x"]), None);
		assert_eq!(without_json_entry("not json", &["a"]), None);
		assert_eq!(without_json_entry(r#"{"a":[1]}"#, &["a", "0"]), None);
	}
}
