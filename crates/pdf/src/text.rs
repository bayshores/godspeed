use std::path::Path;

use gs_json::lone::from_utf16;
use pdfium_render::prelude::{PdfPage, PdfPoints, PdfRect, PdfRenderConfig};

use crate::open::{INVALID, open, page, page_count, page_size};
use crate::ops::parse_page_spec;
use crate::worker::Pdf;

const NO_PAGES: &str = "No pages selected \u{2014} page spec matched nothing.";

/// A page's text with `\n` line ends and none at the very end. The text is what pdf.js gave:
/// only what lies on the page, no spaces before a line end and no blank lines, a line end after a
/// split word's hyphen, and pdf.js's Unicode normalization.
pub(crate) fn page_text(page: &PdfPage) -> Result<String, String> {
	page_units(page).map(|(units, _)| from_utf16(&units))
}

/// The page text's UTF-16 units, each with the box of the character it came from (none for a line
/// end the text adds).
fn page_units(page: &PdfPage) -> Result<(Vec<u16>, Vec<Option<PdfRect>>), String> {
	let text = page.text().map_err(|_| INVALID.to_owned())?;
	let view = page.boundaries().bounding().ok().map(|b| b.bounds);
	let (mut units, mut boxes) = (Vec::new(), Vec::new());
	let mut push = |piece: &[u16], at: Option<PdfRect>| {
		units.extend_from_slice(piece);
		boxes.extend(piece.iter().map(|_| at));
	};
	let mut after_hyphen = false;
	for c in text.chars().iter() {
		let bounds = c.loose_bounds().ok();
		let inside = match (view, bounds) {
			(Some(v), Some(b)) => {
				let (x, y) = ((b.left().value + b.right().value) / 2.0, (b.bottom().value + b.top().value) / 2.0);
				(v.left().value..=v.right().value).contains(&x) && (v.bottom().value..=v.top().value).contains(&y)
			}
			_ => true,
		};
		// pdfium gives a character outside the BMP as two UTF-16 halves, kept as units here.
		let ch = match c.unicode_value() {
			0 => continue,
			unit @ 0xd800..=0xdfff => Err(unit as u16),
			value => match char::from_u32(value) {
				Some(ch) => Ok(ch),
				None => continue,
			},
		};
		if !inside {
			continue;
		}
		// pdfium joins a word split at a line end into one line, and marks its hyphen U+0002.
		if after_hyphen && !matches!(ch, Ok('\r' | '\n')) {
			push(&[NEWLINE], None);
		}
		after_hyphen = c.is_hyphen().unwrap_or(false);
		match (after_hyphen, ch) {
			(true, _) => push(&[u16::from(b'-')], bounds),
			(false, Err(unit)) => push(&[unit], bounds),
			(false, Ok(ch)) => push(&normalized(ch).map_or_else(|| ch.encode_utf16(&mut [0; 2]).to_vec(), |text| text.encode_utf16().collect()), bounds),
		}
	}
	// pdf.js starts a line only at a visible glyph, so a line of nothing but spaces never shows.
	let (mut text, mut text_boxes) = (Vec::with_capacity(units.len()), Vec::with_capacity(units.len()));
	let mut line_start = 0;
	for i in 0..=units.len() {
		let end = i == units.len();
		if !end && units[i] != NEWLINE {
			continue;
		}
		let mut line_end = i;
		if !end && line_end > line_start && units[line_end - 1] == u16::from(b'\r') {
			line_end -= 1;
		}
		while line_end > line_start && units[line_end - 1] == u16::from(b' ') {
			line_end -= 1;
		}
		if line_end > line_start {
			if !text.is_empty() {
				text.push(NEWLINE);
				text_boxes.push(None);
			}
			text.extend_from_slice(&units[line_start..line_end]);
			text_boxes.extend_from_slice(&boxes[line_start..line_end]);
		}
		line_start = i + 1;
	}
	Ok((text, text_boxes))
}

const NEWLINE: u16 = b'\n' as u16;

/// Where quoted words sit on a page, as fractions of the page image from its top left.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct QuoteBox {
	pub x: f64,
	pub y: f64,
	pub w: f64,
	pub h: f64,
}

/// One box per line of the text from `start` to `end`: the union of its characters' boxes, turned
/// and cropped the way the page renders.
fn line_boxes(page: &PdfPage, boxes: &[Option<PdfRect>], text: &[u16], start: usize, end: usize) -> Vec<QuoteBox> {
	let mut lines: Vec<(f32, f32, f32, f32)> = Vec::new();
	let mut open = false;
	for i in start..end.min(text.len()) {
		if text[i] == NEWLINE {
			open = false;
			continue;
		}
		let Some(b) = boxes[i] else { continue };
		let (l, bottom, r, top) = (b.left().value, b.bottom().value, b.right().value, b.top().value);
		match lines.last_mut().filter(|_| open) {
			Some(line) => *line = (line.0.min(l), line.1.min(bottom), line.2.max(r), line.3.max(top)),
			None => lines.push((l, bottom, r, top)),
		}
		open = true;
	}
	// A fine grid in the page's rendered shape: pdfium turns page points into it as it draws.
	let (width, height) = page_size(page);
	let (grid_w, grid_h) = ((width * GRID).ceil().max(1.0), (height * GRID).ceil().max(1.0));
	let config = PdfRenderConfig::new().set_target_size(grid_w as i32, grid_h as i32);
	let to_grid = |x: f32, y: f32| page.points_to_pixels(PdfPoints::new(x), PdfPoints::new(y), &config).ok();
	lines
		.into_iter()
		.filter_map(|(l, bottom, r, top)| {
			let corners = [to_grid(l, bottom)?, to_grid(r, top)?];
			let (x0, x1) = (corners[0].0.min(corners[1].0), corners[0].0.max(corners[1].0));
			let (y0, y1) = (corners[0].1.min(corners[1].1), corners[0].1.max(corners[1].1));
			let fraction = |v: i32, side: f64| (f64::from(v) / side).clamp(0.0, 1.0);
			let (x, y) = (fraction(x0, grid_w), fraction(y0, grid_h));
			Some(QuoteBox { x, y, w: fraction(x1, grid_w) - x, h: fraction(y1, grid_h) - y })
		})
		.filter(|b| b.w > 0.0 && b.h > 0.0)
		.collect()
}

/// Grid cells per point when page points become fractions of the page.
const GRID: f64 = 20.0;

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

	/// The boxes of the words `find` picks out of page `number`'s text (UTF-16 offsets into
	/// exactly what `pdf_extract` gives for that page); none when it finds nothing, or the page
	/// has no text (a scan).
	pub async fn quote_boxes(&self, file: &Path, number: u32, find: impl FnOnce(&str) -> Option<(usize, usize)> + Send + 'static) -> Result<Vec<QuoteBox>, String> {
		let file = file.to_owned();
		self.run(move |pdfium| {
			let doc = open(pdfium, &file)?;
			let page = page(&doc, number)?;
			let (text, boxes) = page_units(&page)?;
			Ok(find(&from_utf16(&text)).map_or_else(Vec::new, |(start, end)| line_boxes(&page, &boxes, &text, start, end)))
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
