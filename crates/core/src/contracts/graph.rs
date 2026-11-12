//! Graph constants and the chat title rule (src/shared/core/contracts/graph.ts).

use std::sync::LazyLock;

use gs_base::{re::Re, text};

/// The graph family's format stamp (format.json); absent means 1.
pub const CURRENT_GRAPH_FORMAT_VERSION: i64 = 1;

/// The main work a topic asks of a learner; Study picks its opening move by it.
pub const TOPIC_MATERIALS: [&str; 4] = ["term", "procedure", "concept", "proof"];

pub const TITLE_MAX_CHARS: usize = 72;

/// A chat title from the learner's first message: one line, cut at a word boundary at or under
/// TITLE_MAX_CHARS with "…" (one long word is cut at the cap, never inside an emoji).
pub fn title_from_prompt(prompt: &str) -> String {
	static SPACES: LazyLock<Re> = LazyLock::new(|| Re::new(r"\s+", "g"));
	let spaced = SPACES.replace(prompt, " ");
	let one_line = text::trim(&spaced);
	if text::len16(one_line) <= TITLE_MAX_CHARS {
		return one_line.to_owned();
	}
	let units = gs_json::lone::to_utf16(one_line);
	let space = units[..=TITLE_MAX_CHARS].iter().rposition(|&u| u == u16::from(b' ')).filter(|&s| s > 0);
	let mut cut = space.unwrap_or(TITLE_MAX_CHARS);
	if space.is_none() && (0xD800..0xDC00).contains(&units[cut - 1]) {
		cut -= 1;
	}
	format!("{}…", text::slice16(one_line, 0, Some(cut as i64)))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn titles_cut_at_words() {
		assert_eq!(title_from_prompt("  short\n prompt "), "short prompt");
		let long = "word ".repeat(20);
		let t = title_from_prompt(&long);
		assert!(t.ends_with("word…") && text::len16(&t) <= TITLE_MAX_CHARS + 1);
		let emoji = format!("{}😀tail", "x".repeat(71));
		assert_eq!(title_from_prompt(&emoji), format!("{}…", "x".repeat(71)));
	}
}
