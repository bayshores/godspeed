//! Source-preserving boundaries in tool-authored Markdown (readContentSpans in
//! src/shared/core/content-reader.ts): which parts are prose, code or math, so a rewrite of prose
//! never enters code or math. The text is never re-serialized. Indexes are UTF-16 units, as in
//! the TS.

use std::sync::LazyLock;

use gs_base::re::Re;
use gs_json::lone;
use markdown::mdast::Node;
use markdown::{Constructs, ParseOptions};

/// What a span of the text is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpanKind {
	Prose,
	Code,
	Math,
}

/// One piece of the text; the pieces in order join back into it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContentSpan {
	pub kind: SpanKind,
	pub raw: String,
}

const BACKSLASH: u16 = b'\\' as u16;
const DOLLAR: u16 = b'$' as u16;
const NEWLINE: u16 = b'\n' as u16;

/// An odd run of backslashes right before `i`.
fn escaped(text: &[u16], mut i: usize) -> bool {
	let mut n = 0;
	while i > 0 {
		i -= 1;
		if text[i] != BACKSLASH {
			break;
		}
		n += 1;
	}
	n % 2 == 1
}

fn run_length(text: &[u16], i: usize, unit: u16) -> usize {
	text[i..].iter().take_while(|&&u| u == unit).count()
}

/// `/^\r?\n[ \t]*\r?\n/` at `j`.
fn blank_line_at(text: &[u16], mut j: usize) -> bool {
	let at = |k: usize| text.get(k).copied();
	if at(j) == Some(b'\r' as u16) {
		j += 1;
	}
	if at(j) != Some(NEWLINE) {
		return false;
	}
	j += 1;
	while matches!(at(j), Some(u) if u == b' ' as u16 || u == b'\t' as u16) {
		j += 1;
	}
	if at(j) == Some(b'\r' as u16) {
		j += 1;
	}
	at(j) == Some(NEWLINE)
}

fn index_of(text: &[u16], needle: u16, from: usize) -> Option<usize> {
	text.get(from..)?.iter().position(|&u| u == needle).map(|k| from + k)
}

fn starts_with_at(text: &[u16], needle: &[u16], at: usize) -> bool {
	text.get(at..at + needle.len()) == Some(needle)
}

/// The code and inline code of the text as CommonMark with math reads it (the grammar the
/// renderer uses, nested quotes and lists included), in UTF-16 offsets, by start.
fn literal_ranges(text: &str) -> Vec<(usize, usize)> {
	let options = ParseOptions { constructs: Constructs { math_flow: true, math_text: true, ..Constructs::default() }, math_text_single_dollar: true, ..ParseOptions::default() };
	// Only MDX can fail to parse, and it is off.
	let Ok(tree) = markdown::to_mdast(text, &options) else { return Vec::new() };
	let mut unit_at = vec![0; text.len() + 1];
	let mut units = 0;
	for (byte, c) in text.char_indices() {
		unit_at[byte] = units;
		units += if lone::unit_of(c).is_some() { 1 } else { c.len_utf16() };
	}
	unit_at[text.len()] = units;
	let mut ranges = Vec::new();
	let mut pending = vec![&tree];
	while let Some(node) = pending.pop() {
		match node {
			Node::Code(_) | Node::InlineCode(_) => {
				if let Some(at) = node.position() {
					ranges.push((unit_at[at.start.offset], unit_at[at.end.offset]));
				}
			}
			_ => pending.extend(node.children().into_iter().flatten()),
		}
	}
	ranges.sort_by_key(|&(start, _)| start);
	ranges
}

/// The text as prose, code and math spans, with the app's dollar-run and `\(` `\[` math
/// conventions, and code and blank lines as inline boundaries.
pub fn read_content_spans(source: &str) -> Vec<ContentSpan> {
	static CLOSING_FENCE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^([ \t]{0,3})(\$+)[ \t]*\r?$", ""));
	let text = lone::to_utf16(source);
	let len = text.len();
	let slice = |from: usize, to: usize| lone::from_utf16(&text[from..to]);
	let literals = literal_ranges(source);
	let mut spans: Vec<ContentSpan> = Vec::new();
	let (mut literal, mut i, mut plain) = (0, 0, 0);
	let push = |spans: &mut Vec<ContentSpan>, kind: SpanKind, from: usize, to: usize| spans.push(ContentSpan { kind, raw: slice(from, to) });
	while i < len {
		while literal < literals.len() && literals[literal].1 <= i {
			literal += 1;
		}
		let barrier = literals.get(literal).map_or(usize::MAX, |r| r.0);
		if i >= barrier {
			let end = literals[literal].1;
			if plain < i {
				push(&mut spans, SpanKind::Prose, plain, i);
			}
			push(&mut spans, SpanKind::Code, i, end);
			i = end;
			plain = end;
			continue;
		}
		let mut open_len = 0;
		let mut found: Option<(usize, usize)> = None;
		if text[i] == BACKSLASH && !escaped(&text, i) && matches!(text.get(i + 1), Some(&u) if u == b'(' as u16 || u == b'[' as u16) {
			open_len = 2;
			let display = text[i + 1] == b'[' as u16;
			let close = [BACKSLASH, if display { b']' } else { b')' } as u16];
			let mut j = i + 2;
			while j + 1 < len {
				if j >= barrier || (!display && blank_line_at(&text, j)) {
					break;
				}
				if starts_with_at(&text, &close, j) && !escaped(&text, j) {
					found = Some((j, j + 2));
					break;
				}
				j += 1;
			}
		} else if text[i] == DOLLAR && !escaped(&text, i) {
			let size = run_length(&text, i, DOLLAR);
			open_len = size;
			let eol = index_of(&text, NEWLINE, i + size);
			let line_start = text[..i].iter().rposition(|&u| u == NEWLINE).map_or(0, |k| k + 1);
			let before_ok = i - line_start <= 3 && text[line_start..i].iter().all(|&u| u == b' ' as u16 || u == b'\t' as u16);
			let display = size >= 2 && before_ok && !text[i + size..eol.unwrap_or(len)].contains(&DOLLAR);
			if display {
				let mut start = eol;
				while let Some(s) = start.filter(|&s| s < len) {
					let from = s + 1;
					let next = index_of(&text, NEWLINE, from);
					if let Some(m) = CLOSING_FENCE.captures(&slice(from, next.unwrap_or(len))) {
						let (indent, fence) = (lone::to_utf16(&m.get(1).unwrap_or_default()).len(), lone::to_utf16(&m.get(2).unwrap_or_default()).len());
						if fence >= size {
							let at = from + indent;
							found = Some((at, at + fence));
							break;
						}
					}
					start = next;
				}
			} else {
				let mut j = i + size;
				while j < len {
					if j >= barrier || blank_line_at(&text, j) {
						break;
					}
					if text[j] == DOLLAR && !escaped(&text, j) {
						let n = run_length(&text, j, DOLLAR);
						if n == size {
							found = Some((j, j + n));
							break;
						}
						j += n;
					} else {
						j += 1;
					}
				}
			}
		}
		match found {
			Some((_, after)) => {
				if plain < i {
					push(&mut spans, SpanKind::Prose, plain, i);
				}
				push(&mut spans, SpanKind::Math, i, after);
				i = after;
				plain = after;
			}
			None => i += open_len.max(1),
		}
	}
	if plain < len {
		push(&mut spans, SpanKind::Prose, plain, len);
	}
	spans
}

#[cfg(test)]
mod tests {
	use super::*;

	/// Each span as "<p|c|m>:<raw>".
	fn spans(text: &str) -> Vec<String> {
		let read = read_content_spans(text);
		assert_eq!(read.iter().map(|s| s.raw.as_str()).collect::<String>(), text, "spans join back into the text");
		read.into_iter().map(|s| format!("{}:{}", match s.kind { SpanKind::Prose => "p", SpanKind::Code => "c", SpanKind::Math => "m" }, s.raw)).collect()
	}

	#[test]
	fn code_and_math_are_their_own_spans() {
		assert_eq!(spans("a `b` c"), ["p:a ", "c:`b`", "p: c"]);
		assert_eq!(spans("x $y$ z"), ["p:x ", "m:$y$", "p: z"]);
		assert_eq!(spans("```\n$a$\n```\nafter"), ["c:```\n$a$\n```", "p:\nafter"]);
		assert_eq!(spans("$$\nx\n$$"), ["m:$$\nx\n$$"]);
		assert_eq!(spans(r"see \(x\) and \[y\]"), ["p:see ", r"m:\(x\)", "p: and ", r"m:\[y\]"]);
	}

	#[test]
	fn an_unclosed_or_escaped_opener_stays_prose() {
		assert_eq!(spans("costs $5 and\n\nthen $6"), ["p:costs $5 and\n\nthen $6"]);
		assert_eq!(spans(r"a \$x$ b"), [r"p:a \$x$ b"]);
		// Math opened first takes the backtick in.
		assert_eq!(spans("$a `$` b$"), ["m:$a `$", "p:` b$"]);
	}

	#[test]
	fn offsets_count_utf16_units() {
		assert_eq!(spans("é😀 `x` $y$"), ["p:é😀 ", "c:`x`", "p: ", "m:$y$"]);
		assert!(read_content_spans("").is_empty());
	}
}
