//! Outside agents cap each tool result: Codex keeps about 12k tokens and drops the middle, and
//! Claude Code moves text over 50k characters into a file. A long work item therefore goes out
//! in pages that each fit both. Pages are measured in UTF-8 bytes, because Codex counts tokens
//! from bytes: a page of Chinese or Japanese text holds about a third as many characters as an
//! English one.
//!
//! Positions are UTF-16 units, as in the original, so a page never ends inside a character.

use gs_base::text;
use gs_json::lone::{from_utf16, to_utf16};

pub const WORK_PAGE_BYTES: usize = 24_000;

/// How many UTF-16 units from the start of `units` fit in `max_bytes` of UTF-8. A high
/// surrogate with any unit after it counts as one four-byte character.
fn fitting(units: &[u16], max_bytes: f64) -> usize {
	let mut bytes = 0.0;
	let mut i = 0;
	while i < units.len() {
		let code = units[i];
		let pair = (0xd800..=0xdbff).contains(&code) && i + 1 < units.len();
		let size = if code < 0x80 {
			1.0
		} else if code < 0x800 {
			2.0
		} else if pair {
			4.0
		} else {
			3.0
		};
		if bytes + size > max_bytes {
			return i;
		}
		bytes += size;
		if pair {
			i += 1;
		}
		i += 1;
	}
	units.len()
}

/// Where a page of `units` ends: all of it when it fits, else at a line break in the page's
/// second half, else at the limit.
fn cut_at(units: &[u16], max_bytes: f64) -> usize {
	let limit = fitting(units, max_bytes);
	if limit >= units.len() {
		return units.len();
	}
	// `lastIndexOf("\n", limit - 1)`: a negative start is read as 0.
	let from = limit.saturating_sub(1);
	let cut = units[..=from].iter().rposition(|&u| u == 0x0a).map_or(0, |i| i + 1);
	if cut * 2 <= limit { limit } else { cut }
}

/// Splits text into pages of at most `max_bytes` of UTF-8. A page ends at a line break when one
/// falls in its second half, and never inside a character.
pub fn split_pages(text: &str, max_bytes: usize) -> Vec<String> {
	let max = max_bytes as f64;
	let mut pages = Vec::new();
	let units = to_utf16(text);
	let mut rest = &units[..];
	loop {
		let at = cut_at(rest, max);
		if at >= rest.len() {
			break;
		}
		pages.push(from_utf16(&rest[..at]));
		rest = &rest[at..];
	}
	pages.push(from_utf16(rest));
	pages
}

/// Packs text blocks into pages of at most `max_bytes` of UTF-8 in all. A block too long for
/// what is left of a page fills it when at least half a page is left, and goes on on the next
/// pages, cut as `split_pages` cuts.
pub fn page_blocks(blocks: &[String], max_bytes: usize) -> Vec<Vec<String>> {
	let max = max_bytes as f64;
	let mut pages: Vec<Vec<String>> = Vec::new();
	let mut page: Vec<String> = Vec::new();
	let mut room = max;
	for block in blocks {
		let units = to_utf16(block);
		let mut rest = &units[..];
		loop {
			let at = cut_at(rest, room);
			if at == rest.len() {
				let tail = from_utf16(rest);
				room -= text::utf8_bytes(&tail).len() as f64;
				page.push(tail);
				break;
			}
			if page.is_empty() || room >= max / 2.0 {
				page.push(from_utf16(&rest[..at]));
				rest = &rest[at..];
			}
			pages.push(std::mem::take(&mut page));
			room = max;
		}
	}
	pages.push(page);
	pages
}

#[cfg(test)]
mod tests {
	use super::*;

	fn strings(items: &[&str]) -> Vec<String> {
		items.iter().map(|s| (*s).to_owned()).collect()
	}

	#[test]
	fn short_blocks_share_one_page() {
		let blocks = strings(&["{}", "instructions", "[text 1]\nhello"]);
		assert_eq!(page_blocks(&blocks, WORK_PAGE_BYTES), [blocks]);
		assert_eq!(split_pages("hello", WORK_PAGE_BYTES), ["hello"]);
	}

	#[test]
	fn a_long_block_continues_on_the_next_pages() {
		let long = format!("{}\n{}", "a".repeat(80), "b".repeat(150));
		let pages = page_blocks(&strings(&["head", &long, "tail"]), 100);
		let joined: Vec<String> = pages.iter().map(|p| p.join("")).collect();
		assert_eq!(joined.concat(), format!("head{long}tail"));
		assert!(joined.iter().all(|p| p.len() <= 100));
		let split = split_pages(&format!("{}\n{}", "x".repeat(60), "y".repeat(60)), 100);
		assert_eq!(split.len(), 2);
		assert!(split[0].ends_with('\n'));
	}

	#[test]
	fn a_page_never_ends_inside_a_character() {
		let text = "\u{1F600}".repeat(10);
		let pages = split_pages(&text, 10);
		assert_eq!(pages.len(), 5);
		assert!(pages.iter().all(|p| p.chars().count() == 2));
	}
}
