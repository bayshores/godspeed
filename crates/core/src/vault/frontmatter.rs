//! A note's frontmatter, split into top-level key blocks so godspeed rewrites only the blocks
//! it owns. There is no YAML library: every other block, the fences and the body keep their
//! exact bytes and order.

use super::note_keys::{KEEP, OWNER_KEY};

/// One top-level key line with its indented and list lines, line endings included. A block
/// with no key holds comments or stray lines.
#[derive(Debug, Clone, PartialEq)]
pub struct Block {
	pub key: Option<String>,
	pub text: String,
}

/// Who a note belongs to, from its `godspeed` key.
#[derive(Debug, Clone, PartialEq)]
pub enum Owner {
	Topic(String),
	Keep,
}

/// A note split into frontmatter and body. A note with no frontmatter, or whose block is never
/// closed, has all its text as the body.
#[derive(Debug, Clone, PartialEq)]
pub struct Doc {
	head: String,
	blocks: Vec<Block>,
	tail: String,
	pub body: String,
	eol: &'static str,
}

fn is_fence(line: &str) -> bool {
	line.trim_end() == "---"
}

fn is_end_fence(line: &str) -> bool {
	matches!(line.trim_end(), "---" | "...")
}

/// A line without its line break, which the note keeps as it found it (`\n` or `\r\n`).
pub(super) fn line_text(line: &str) -> &str {
	line.trim_end_matches(['\r', '\n'])
}

/// The key of a top-level line, or None for a continuation (indented, a list item, a comment,
/// blank).
fn key_of(line: &str) -> Option<String> {
	let line = line_text(line);
	let first = line.chars().next()?;
	if first.is_whitespace() || first == '#' || line.starts_with("- ") || line == "-" {
		return None;
	}
	let key = line[..line.find(':')?].trim();
	Some(key.trim_matches(['"', '\'']).to_owned())
}

fn eol_of(text: &str) -> &'static str {
	match text.find('\n') {
		Some(at) if text[..at].ends_with('\r') => "\r\n",
		_ => "\n",
	}
}

/// `text` with line endings as `\n` and no trailing whitespace, the form kept to compare a
/// block or section with what godspeed last wrote.
pub fn normal(text: &str) -> String {
	text.replace("\r\n", "\n").trim_end().to_owned()
}

impl Doc {
	/// A note with an empty frontmatter, for building one.
	pub fn empty(body: &str) -> Doc {
		Doc { head: "---\n".to_owned(), blocks: Vec::new(), tail: "---\n".to_owned(), body: body.to_owned(), eol: "\n" }
	}

	pub fn parse(text: &str) -> Doc {
		let eol = eol_of(text);
		let lines: Vec<&str> = text.split_inclusive('\n').collect();
		let close = if lines.first().is_some_and(|l| is_fence(l)) { lines.iter().skip(1).position(|l| is_end_fence(l)).map(|i| i + 1) } else { None };
		let Some(close) = close else {
			return Doc { head: String::new(), blocks: Vec::new(), tail: String::new(), body: text.to_owned(), eol };
		};
		let mut blocks: Vec<Block> = Vec::new();
		for line in &lines[1..close] {
			match key_of(line) {
				Some(key) => blocks.push(Block { key: Some(key), text: (*line).to_owned() }),
				None => match blocks.last_mut() {
					Some(last) => last.text.push_str(line),
					None => blocks.push(Block { key: None, text: (*line).to_owned() }),
				},
			}
		}
		Doc { head: lines[0].to_owned(), blocks, tail: lines[close].to_owned(), body: lines[close + 1..].concat(), eol }
	}

	pub fn has_front(&self) -> bool {
		!self.head.is_empty()
	}

	pub fn eol(&self) -> &'static str {
		self.eol
	}

	pub fn block(&self, key: &str) -> Option<&Block> {
		self.blocks.iter().find(|b| b.key.as_deref() == Some(key))
	}

	/// The value of a one-line key, unquoted; None when the key is missing.
	pub fn scalar(&self, key: &str) -> Option<String> {
		let first = self.block(key)?.text.lines().next()?;
		let value = first[first.find(':')? + 1..].trim();
		let unquoted = match value.as_bytes() {
			[q @ (b'"' | b'\''), .., last] if q == last => &value[1..value.len() - 1],
			_ => value,
		};
		Some(unquoted.to_owned())
	}

	/// The `godspeed` key: a topic id, `keep`, or None when absent or empty.
	pub fn owner(&self) -> Option<Owner> {
		let value = self.scalar(OWNER_KEY)?;
		match value.as_str() {
			"" => None,
			KEEP => Some(Owner::Keep),
			id => Some(Owner::Topic(id.to_owned())),
		}
	}

	/// Replaces the key's block in place, or adds it at the end. `text` uses `\n` and has no
	/// trailing newline; it is written with the note's own line endings.
	pub fn set_block(&mut self, key: &str, text: &str) {
		let eol = self.eol;
		let mut full = text.replace('\n', eol);
		full.push_str(eol);
		match self.blocks.iter_mut().find(|b| b.key.as_deref() == Some(key)) {
			Some(block) => block.text = full,
			None => {
				if let Some(last) = self.blocks.last_mut().filter(|b| !b.text.ends_with('\n')) {
					last.text.push_str(eol);
				}
				self.blocks.push(Block { key: Some(key.to_owned()), text: full });
			}
		}
	}

	pub fn render(&self) -> String {
		let blocks: String = self.blocks.iter().map(|b| b.text.as_str()).collect();
		format!("{}{blocks}{}{}", self.head, self.tail, self.body)
	}
}

/// `key: value`, or `key:` when the value is empty. No trailing newline.
pub fn scalar_block(key: &str, value: &str) -> String {
	match value {
		"" => format!("{key}:"),
		v => format!("{key}: {}", yaml_scalar(v)),
	}
}

/// `key:` with one `  - item` line each, or `key: []` with no items.
pub fn list_block(key: &str, items: &[String]) -> String {
	if items.is_empty() {
		return format!("{key}: []");
	}
	let lines: Vec<String> = items.iter().map(|i| format!("  - {}", yaml_scalar(i))).collect();
	format!("{key}:\n{}", lines.join("\n"))
}

/// A YAML value that reads back as this exact text: plain when that is safe, else quoted.
fn yaml_scalar(value: &str) -> String {
	let flat = value.split_whitespace().collect::<Vec<_>>().join(" ");
	let starts_special = flat.starts_with(['-', '?', ':', ',', '[', ']', '{', '}', '#', '&', '*', '!', '|', '>', '\'', '"', '%', '@', '`']);
	let reserved = matches!(flat.to_lowercase().as_str(), "true" | "false" | "yes" | "no" | "on" | "off" | "y" | "n" | "null" | "~") || flat.parse::<f64>().is_ok();
	if flat.is_empty() || starts_special || reserved || flat.contains(": ") || flat.contains(" #") || flat.ends_with(':') || flat != value {
		return format!("\"{}\"", flat.replace('\\', "\\\\").replace('"', "\\\""));
	}
	flat
}

#[cfg(test)]
mod tests {
	use super::*;

	const REAL: &str = "---\nclass: CSE 21\ntest:\n  - Test 1\nconfidence:\napproved: false\ncssclasses:\n  - concept\nslide: \"[[courses/fa26/cse21/lectures/Day3.pdf#page=14]]\"\nunit: Counting\nmistakes: []\nup: \"[[CSE 21]]\"\n---\n> [!recall] Without looking at your notes\n> What does C(n,k) count?\n";

	#[test]
	fn the_owners_note_round_trips_with_every_block_in_order() {
		let doc = Doc::parse(REAL);
		let keys: Vec<_> = doc.blocks.iter().map(|b| b.key.clone().unwrap()).collect();
		assert_eq!(keys, ["class", "test", "confidence", "approved", "cssclasses", "slide", "unit", "mistakes", "up"]);
		assert_eq!(doc.render(), REAL);
		assert_eq!(doc.block("test").unwrap().text, "test:\n  - Test 1\n");
		assert_eq!(doc.scalar("class").as_deref(), Some("CSE 21"));
		assert_eq!(doc.scalar("up").as_deref(), Some("[[CSE 21]]"));
		assert_eq!(doc.scalar("confidence").as_deref(), Some(""));
	}

	#[test]
	fn setting_a_block_keeps_every_other_byte() {
		let mut doc = Doc::parse(REAL);
		doc.set_block("confidence", "confidence: ok");
		doc.set_block("godspeed", "godspeed: tpc_1");
		assert_eq!(doc.render(), REAL.replace("confidence:\n", "confidence: ok\n").replace("up: \"[[CSE 21]]\"\n", "up: \"[[CSE 21]]\"\ngodspeed: tpc_1\n"));
	}

	#[test]
	fn crlf_notes_keep_crlf() {
		let text = REAL.replace('\n', "\r\n");
		let mut doc = Doc::parse(&text);
		assert_eq!(doc.eol(), "\r\n");
		assert_eq!(doc.render(), text);
		doc.set_block("test", "test:\n  - A\n  - B");
		assert!(doc.render().contains("test:\r\n  - A\r\n  - B\r\nconfidence:\r\n"));
		assert_eq!(doc.scalar("class").as_deref(), Some("CSE 21"));
	}

	#[test]
	fn no_frontmatter_is_all_body() {
		let doc = Doc::parse("# Title\n---\ntext\n");
		assert!(!doc.has_front());
		assert_eq!(doc.body, "# Title\n---\ntext\n");
		assert_eq!(doc.render(), "# Title\n---\ntext\n");
		assert_eq!(doc.owner(), None);
	}

	#[test]
	fn an_unclosed_block_is_body_and_loses_nothing() {
		let text = "---\ngodspeed: tpc_1\nclass: CSE 21\nsome text with no closing fence\n";
		let doc = Doc::parse(text);
		assert!(!doc.has_front());
		assert_eq!(doc.owner(), None);
		assert_eq!(doc.render(), text);
	}

	#[test]
	fn the_owner_is_a_topic_keep_or_absent() {
		assert_eq!(Doc::parse("---\ngodspeed: tpc_9f2\n---\n").owner(), Some(Owner::Topic("tpc_9f2".to_owned())));
		assert_eq!(Doc::parse("---\ngodspeed: keep\n---\n").owner(), Some(Owner::Keep));
		assert_eq!(Doc::parse("---\ngodspeed:\n---\n").owner(), None);
		assert_eq!(Doc::parse("---\nclass: A\n---\n").owner(), None);
	}

	#[test]
	fn comments_before_the_first_key_and_stray_lines_are_kept() {
		let text = "---\n# my comment\nclass: A\nstray line\nunit: B\n---\nbody";
		let doc = Doc::parse(text);
		assert_eq!(doc.blocks.len(), 3);
		assert_eq!(doc.blocks[0].key, None);
		assert_eq!(doc.render(), text);
	}

	#[test]
	fn builders_quote_what_yaml_would_misread() {
		assert_eq!(scalar_block("class", "CSE 21"), "class: CSE 21");
		assert_eq!(scalar_block("confidence", ""), "confidence:");
		assert_eq!(scalar_block("up", "[[CSE 21]]"), "up: \"[[CSE 21]]\"");
		assert_eq!(scalar_block("class", "2026"), "class: \"2026\"");
		assert_eq!(scalar_block("class", "Math: part 1"), "class: \"Math: part 1\"");
		assert_eq!(scalar_block("class", "Say \"hi\" #1"), "class: \"Say \\\"hi\\\" #1\"");
		assert_eq!(list_block("test", &[]), "test: []");
		assert_eq!(list_block("test", &["Midterm 1".to_owned(), "yes".to_owned()]), "test:\n  - Midterm 1\n  - \"yes\"");
	}
}
