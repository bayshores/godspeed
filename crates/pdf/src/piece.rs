//! Finds one printed problem in a PDF: the piece of its page from the problem's first words to
//! where the next thing starts, going on over the following pages when it does not end on its own.

use std::path::Path;

use gs_json::lone::from_utf16;
use pdfium_render::prelude::{PdfDocument, PdfPage, PdfRect, PdfRenderConfig};

use crate::open::{open, page, page_count, page_size};
use crate::render::PageCrop;
use crate::text::{NEWLINE, QuoteBox, line_boxes, page_units};
use crate::worker::Pdf;

/// The pages a piece may run over.
const MAX_PAGES: u32 = 4;
/// Pixels across a page when it is looked at for what is printed where.
const LOOK_WIDTH: f64 = 480.0;
/// A channel under this is print.
const PRINT: u8 = 235;
/// Air kept around a piece, as a share of the page's width or height.
const PAD: f64 = 0.012;
/// Rows of print this close, as a share of the page's height, are one block.
const BLOCK_GAP: f64 = 0.04;
/// A block no taller than this at a page's end is its page number or running head.
const FOLIO: f64 = 0.03;

/// The part of a piece that lies on one page.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PiecePart {
	pub page: u32,
	pub crop: PageCrop,
	/// The whole page's width over its height.
	pub aspect: f64,
}

/// Where one labelled part of a problem starts: `y` is a fraction of its page from the top.
#[derive(Clone, Debug, PartialEq)]
pub struct PieceLabel {
	pub label: String,
	pub page: u32,
	pub y: f64,
}

/// A printed problem: where it is, and its words as the file has them.
#[derive(Clone, Debug, PartialEq)]
pub struct Piece {
	pub parts: Vec<PiecePart>,
	pub text: String,
	/// Its parts in order, as it labels them (`a`, `b` for "(a)", "(b)"); none when it has none.
	pub labels: Vec<PieceLabel>,
	/// Where the piece starts on a page that is shown whole, because its columns can't be cut.
	pub mark: Option<QuoteBox>,
}

/// What looking for a piece gave.
#[derive(Clone, Debug, PartialEq)]
pub enum Found {
	Piece(Piece),
	/// The page has no words to speak of (a scan), so nothing can be looked for on it; the page's
	/// width over its height.
	Scan { aspect: f64 },
	/// The first words are not on the page, or not just once; the page's own lines, to quote from.
	Missing(Vec<String>),
}

/// A page with fewer characters than this is a scan: what text it has is stray marks.
const SCAN_UNITS: usize = 20;
/// The lines of a page handed back when the first words miss, and how much of each.
const MISSING_LINES: usize = 40;
const MISSING_LINE_UNITS: usize = 60;

/// Where a page has print: each pixel row of a small rendering, and the sides of all of it.
struct Look {
	rows: Vec<bool>,
	left: f64,
	right: f64,
}

impl Look {
	fn at(page: &PdfPage) -> Result<Look, String> {
		let (points_w, points_h) = page_size(page);
		let height = (LOOK_WIDTH * points_h / points_w.max(1.0)).ceil().clamp(1.0, LOOK_WIDTH * 8.0);
		let config = PdfRenderConfig::new().set_target_size(LOOK_WIDTH as i32, height as i32);
		let image = page.render_with_config(&config).and_then(|bitmap| bitmap.as_image()).map_err(|e| format!("The page could not be rendered: {e}"))?.to_rgb8();
		let (mut rows, mut left, mut right) = (vec![false; image.height() as usize], image.width(), 0);
		for (x, y, pixel) in image.enumerate_pixels() {
			if pixel.0.iter().any(|&c| c < PRINT) {
				rows[y as usize] = true;
				(left, right) = (left.min(x), right.max(x + 1));
			}
		}
		let width = f64::from(image.width());
		let (left, right) = if left < right { (f64::from(left) / width, f64::from(right) / width) } else { (0.0, 1.0) };
		Ok(Look { rows, left: (left - PAD).max(0.0), right: (right + PAD).min(1.0) })
	}

	/// The crop that holds the print between `top` and `bottom` (fractions of the page), None when
	/// there is none. `from_page_top` and `to_page_end` say the piece runs on from or to another
	/// page, where a running head or a page number is left out.
	fn crop(&self, top: f64, bottom: f64, from_page_top: bool, to_page_end: bool) -> Option<PageCrop> {
		let height = self.rows.len() as f64;
		// Whole rows only: a row the cut runs through holds the first print of what comes next.
		let (first, last) = ((top * height).floor() as usize, ((bottom * height).floor() as usize).min(self.rows.len()));
		// Blocks of print: runs of printed rows with no more than `BLOCK_GAP` between them.
		let mut blocks: Vec<(usize, usize)> = Vec::new();
		for y in (first..last).filter(|&y| self.rows[y]) {
			match blocks.last_mut().filter(|block| ((y - block.1) as f64) < BLOCK_GAP * height) {
				Some(block) => block.1 = y + 1,
				None => blocks.push((y, y + 1)),
			}
		}
		let short = |block: &(usize, usize)| ((block.1 - block.0) as f64) <= FOLIO * height;
		if to_page_end && blocks.len() > 1 && blocks.last().is_some_and(short) {
			blocks.pop();
		}
		if from_page_top && blocks.len() > 1 && blocks.first().is_some_and(short) {
			blocks.remove(0);
		}
		let (start, end) = (blocks.first()?.0 as f64 / height, blocks.last()?.1 as f64 / height);
		Some(PageCrop { left: self.left, right: self.right, top: (start - PAD).max(0.0), bottom: (end + PAD).min(last as f64 / height) })
	}
}

fn aspect_of(page: &PdfPage) -> f64 {
	let (width, height) = page_size(page);
	width / height.max(1.0)
}

/// How a line labels a part, and the label inside it: "(a)", "a)" or "a.".
#[derive(Clone, Copy, PartialEq)]
enum LabelStyle {
	Paren,
	Close,
	Dot,
}

fn label_of(line: &str) -> Option<(LabelStyle, &str)> {
	let line = line.trim_start();
	let (style, rest) = match line.strip_prefix('(') {
		Some(rest) => (Some(LabelStyle::Paren), rest),
		None => (None, line),
	};
	let end = rest.find(|c: char| !c.is_ascii_alphanumeric())?;
	let (label, after) = rest.split_at(end);
	if label.is_empty() || label.len() > 4 {
		return None;
	}
	let style = match (style, after.chars().next()?) {
		(Some(paren), ')') => paren,
		(None, ')') => LabelStyle::Close,
		// "3." also numbers a step of an algorithm, so only a letter with a dot labels a part.
		(None, '.') if after[1..].starts_with(' ') && label.chars().all(|c| c.is_ascii_alphabetic()) => LabelStyle::Dot,
		_ => return None,
	};
	Some((style, label))
}

const ROMAN: [&str; 10] = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];

/// The lines that label a problem's parts: the first way of labelling (in brackets before a
/// closing bracket before a dot; letters before roman numerals before numbers) that runs in order
/// from its first label over two or more lines.
fn part_labels(lines: &[(String, u32, f64)]) -> Vec<PieceLabel> {
	let orders: [&dyn Fn(usize) -> Option<String>; 3] =
		[&|n| u8::try_from(n).ok().filter(|n| *n < 26).map(|n| char::from(b'a' + n).to_string()), &|n| ROMAN.get(n).map(|r| (*r).to_owned()), &|n| Some((n + 1).to_string())];
	for style in [LabelStyle::Paren, LabelStyle::Close, LabelStyle::Dot] {
		for order in orders {
			let mut found = Vec::new();
			for (line, page, y) in lines {
				let Some(next) = order(found.len()) else { break };
				if label_of(line).is_some_and(|(its, label)| its == style && label.eq_ignore_ascii_case(&next)) {
					found.push(PieceLabel { label: next, page: *page, y: *y });
				}
			}
			if found.len() >= 2 {
				return found;
			}
		}
	}
	Vec::new()
}

/// Each line of the page's text from `from` to `to`, with where it starts on the page.
fn lines_of(page: &PdfPage, number: u32, text: &[u16], boxes: &[Option<PdfRect>], from: usize, to: usize) -> Vec<(String, u32, f64)> {
	let mut lines = Vec::new();
	let mut start = from;
	for at in from..=to {
		if at < to && text[at] != NEWLINE {
			continue;
		}
		if let Some(first) = line_boxes(page, boxes, text, start, at).into_iter().next() {
			lines.push((from_utf16(&text[start..at]), number, first.y));
		}
		start = at + 1;
	}
	lines
}

impl Pdf {
	/// The piece of `file` that starts at the words `starts` on page `number` and ends before the
	/// words `ends`, looked for after it on that page and then on the next ones; without them, or
	/// when they are not found, it ends with its page. `find` gives where words sit in a text, as
	/// UTF-16 offsets.
	pub async fn find_piece(&self, file: &Path, number: u32, starts: String, ends: Option<String>, find: impl Fn(&str, &str) -> Option<(usize, usize)> + Send + 'static) -> Result<Found, String> {
		let file = file.to_owned();
		self.run(move |pdfium| {
			let doc = open(pdfium, &file)?;
			let first = page(&doc, number)?;
			let (text, boxes) = page_units(&first)?;
			let whole = from_utf16(&text);
			if whole.chars().filter(|c| !c.is_whitespace()).count() < SCAN_UNITS {
				return Ok(Found::Scan { aspect: aspect_of(&first) });
			}
			let missing = || Found::Missing(whole.lines().take(MISSING_LINES).map(|line| line.chars().take(MISSING_LINE_UNITS).collect()).collect());
			let Some((s0, s1)) = find(&whole, &starts) else { return Ok(missing()) };
			let Some(start) = line_boxes(&first, &boxes, &text, s0, s1).into_iter().next() else { return Ok(missing()) };
			let look = Look::at(&first)?;
			let aspect = aspect_of(&first);
			let part = |crop: Option<PageCrop>, page: u32| crop.map(|crop| PiecePart { page, crop, aspect });
			let end_here = ends.as_deref().and_then(|ends| find(&from_utf16(&text[s1..]), ends)).map(|(e0, e1)| (e0 + s1, e1 + s1));
			if let Some((e0, e1)) = end_here {
				let said = from_utf16(&text[s0..e0]).trim_end().to_owned();
				let labels = part_labels(&lines_of(&first, number, &text, &boxes, s0, e0));
				let below = line_boxes(&first, &boxes, &text, e0, e1).into_iter().next().filter(|end| end.y > start.y);
				let cut = below.and_then(|end| part(look.crop(start.y, end.y, false, false), number));
				return Ok(Found::Piece(match cut {
					Some(cut) => Piece { parts: vec![cut], text: said, labels, mark: None },
					// The next thing is printed above this one: columns, which a cut across can't follow.
					None => Piece { parts: vec![PiecePart { page: number, crop: PageCrop::WHOLE, aspect }], text: said, labels, mark: Some(start) },
				}));
			}
			let Some(own) = part(look.crop(start.y, 1.0, false, true), number) else { return Ok(missing()) };
			let mut lines = lines_of(&first, number, &text, &boxes, s0, text.len());
			let mut piece = Piece { parts: vec![own], text: from_utf16(&text[s0..]), labels: Vec::new(), mark: None };
			if let Some(more) = ends.as_deref().and_then(|ends| run_on(&doc, number, ends, &find).transpose()).transpose()? {
				piece.parts.extend(more.parts);
				piece.text = [piece.text, more.text].join("\n").trim_end().to_owned();
				lines.extend(more.lines);
			}
			piece.labels = part_labels(&lines);
			Ok(Found::Piece(piece))
		})
		.await
	}
}

/// What a piece has on the pages after its first.
struct RunOn {
	parts: Vec<PiecePart>,
	text: String,
	lines: Vec<(String, u32, f64)>,
}

/// The rest of a piece on the pages after `number`, up to the words `ends`. None when the words
/// are on none of the pages a piece may run over.
fn run_on(doc: &PdfDocument, number: u32, ends: &str, find: &impl Fn(&str, &str) -> Option<(usize, usize)>) -> Result<Option<RunOn>, String> {
	let (mut parts, mut said, mut lines) = (Vec::new(), Vec::new(), Vec::new());
	for next in number + 1..=(number + MAX_PAGES - 1).min(page_count(doc)) {
		let page = page(doc, next)?;
		let (text, boxes) = page_units(&page)?;
		let look = Look::at(&page)?;
		let end = find(&from_utf16(&text), ends);
		let until = end.and_then(|(e0, e1)| line_boxes(&page, &boxes, &text, e0, e1).into_iter().next()).map(|end| end.y);
		let upto = end.map_or(text.len(), |(e0, _)| e0);
		if let Some(crop) = look.crop(0.0, until.unwrap_or(1.0), true, until.is_none()) {
			parts.push(PiecePart { page: next, crop, aspect: aspect_of(&page) });
		}
		said.push(from_utf16(&text[..upto]));
		lines.extend(lines_of(&page, next, &text, &boxes, 0, upto));
		if end.is_some() {
			return Ok(Some(RunOn { parts, text: said.join("\n"), lines }));
		}
	}
	Ok(None)
}

#[cfg(test)]
mod tests {
	use super::*;

	fn labels(lines: &[&str]) -> Vec<String> {
		let lines: Vec<(String, u32, f64)> = lines.iter().enumerate().map(|(i, line)| ((*line).to_owned(), 1, i as f64 / 100.0)).collect();
		part_labels(&lines).into_iter().map(|l| l.label).collect()
	}

	#[test]
	fn parts_are_the_lines_labelled_in_order() {
		assert_eq!(labels(&["3. Dominos is a game", "(a) What is", "with f(b) inside", "(b) What", "  (c) And"]), ["a", "b", "c"]);
		assert_eq!(labels(&["1. lo = 0", "2. hi = n", "a) first", "b) second"]), ["a", "b"], "numbered steps are not parts");
		assert_eq!(labels(&["(i) one", "(ii) two", "(iii) three"]), ["i", "ii", "iii"]);
		assert_eq!(labels(&["(1) one", "(2) two"]), ["1", "2"]);
		assert_eq!(labels(&["a. one", "b. two"]), ["a", "b"]);
		assert_eq!(labels(&["(a) the only part", "(c) out of order"]), Vec::<String>::new());
		assert_eq!(labels(&["A plain problem.", "No parts here."]), Vec::<String>::new());
	}
}
