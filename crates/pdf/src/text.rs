//! Ported from src/backend/server/workers/pdf-text-worker.mjs, pdfExtract in src/backend/agent/subagents/pdf-ops.ts.

use std::path::Path;

use gs_json::lone::{pair_up, standin};
use pdfium_render::prelude::PdfPage;

use crate::open::{INVALID, open, page, page_count};
use crate::ops::parse_page_spec;
use crate::worker::Pdf;

const NO_PAGES: &str = "No pages selected \u{2014} page spec matched nothing.";

/// A page's text with `\n` line ends and none at the very end. The text is what pdf.js gave:
/// only what lies on the page, no spaces before a line end and no blank lines, a line end after a
/// split word's hyphen, and pdf.js's Unicode normalization.
pub(crate) fn page_text(page: &PdfPage) -> Result<String, String> {
	let text = page.text().map_err(|_| INVALID.to_owned())?;
	let view = page.boundaries().bounding().ok().map(|b| b.bounds);
	let mut all = String::new();
	let mut after_hyphen = false;
	for c in text.chars().iter() {
		// pdfium gives a character outside the BMP as two UTF-16 halves; `pair_up` joins them below.
		let ch = match c.unicode_value() {
			0 => continue,
			unit @ 0xd800..=0xdfff => standin(unit as u16),
			value => match char::from_u32(value) {
				Some(ch) => ch,
				None => continue,
			},
		};
		let inside = match (view, c.loose_bounds()) {
			(Some(v), Ok(b)) => {
				let (x, y) = ((b.left().value + b.right().value) / 2.0, (b.bottom().value + b.top().value) / 2.0);
				(v.left().value..=v.right().value).contains(&x) && (v.bottom().value..=v.top().value).contains(&y)
			}
			_ => true,
		};
		if !inside {
			continue;
		}
		// pdfium joins a word split at a line end into one line, and marks its hyphen U+0002.
		if after_hyphen && ch != '\r' && ch != '\n' {
			all.push('\n');
		}
		after_hyphen = c.is_hyphen().unwrap_or(false);
		match (after_hyphen, normalized(ch)) {
			(true, _) => all.push('-'),
			(false, Some(text)) => all.push_str(text),
			(false, None) => all.push(ch),
		}
	}
	let all = pair_up(&all).replace("\r\n", "\n");
	// pdf.js starts a line only at a visible glyph, so a line of nothing but spaces never shows.
	let lines: Vec<&str> = all.split('\n').map(|line| line.trim_end_matches(' ')).filter(|line| !line.is_empty()).collect();
	Ok(lines.join("\n"))
}

/// pdf.js's `normalizeUnicode` (NFKC on a fixed set of characters) for every character in that
/// set except the Hebrew and Arabic presentation forms, which pass through unchanged.
fn normalized(ch: char) -> Option<&'static str> {
	Some(match ch {
		'\u{a0}' | '\u{2000}'..='\u{200a}' | '\u{202f}' => " ",
		'\u{b5}' => "\u{3bc}",
		'\u{37e}' => ";",
		'\u{eb3}' => "\u{ecd}\u{eb2}",
		'\u{2126}' => "\u{3a9}",
		'\u{fb00}' => "ff",
		'\u{fb01}' => "fi",
		'\u{fb02}' => "fl",
		'\u{fb03}' => "ffi",
		'\u{fb04}' => "ffl",
		'\u{fb05}' => "\u{17f}t",
		'\u{fb06}' => "st",
		_ => return None,
	})
}

impl Pdf {
	/// Every page's text exactly as pdf-text-worker.mjs gives it: `--- Page N ---` then the
	/// page's text, or the worker's error text. gs-files calls this; keep the signature.
	pub async fn text(&self, file: &Path) -> Result<String, String> {
		self.pdf_extract(file, "all").await
	}

	/// The text of the pages `page_spec` names (`all`, `1-5`, `1,3,7`, `3`), page by page under
	/// `--- Page N ---` headings.
	pub async fn pdf_extract(&self, file: &Path, page_spec: &str) -> Result<String, String> {
		let (file, page_spec) = (file.to_owned(), page_spec.to_owned());
		self.run(move |pdfium| {
			let doc = open(pdfium, &file)?;
			let pages = parse_page_spec(&page_spec, page_count(&doc));
			if pages.is_empty() {
				return Ok(NO_PAGES.to_owned());
			}
			let mut out = Vec::with_capacity(pages.len() * 2);
			for number in pages {
				out.push(format!("--- Page {number} ---"));
				out.push(page_text(&page(&doc, number)?)?);
			}
			Ok(out.join("\n"))
		})
		.await
	}
}

#[cfg(test)]
mod tests {
	use super::normalized;

	#[test]
	fn normalizes_like_pdfjs() {
		assert_eq!(normalized('\u{2126}'), Some("\u{3a9}"));
		assert_eq!(normalized('\u{fb03}'), Some("ffi"));
		assert_eq!(normalized('\u{2007}'), Some(" "));
		assert_eq!(normalized('a'), None);
		assert_eq!(normalized('\u{3a9}'), None);
	}
}
