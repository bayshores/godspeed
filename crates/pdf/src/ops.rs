//! Ported from pdfProbe, pdfShape, parsePageSpec, pdfSearch in src/backend/agent/subagents/pdf-ops.ts
//! (pdfInfo is in info.rs).

use std::collections::BTreeSet;
use std::path::Path;

use gs_base::re::{self, Re};
use gs_base::regexp::new_regexp;
use gs_base::text::{trim, trim_start};
use gs_json::{Json, json};

use crate::open::{open, page, page_count, page_size};
use crate::text::page_text;
use crate::worker::Pdf;

/// Page count and the first page's width over height.
#[derive(Debug, Clone, PartialEq)]
pub struct PdfShape {
	pub page_count: u32,
	pub aspect: f64,
}

/// One matching line: the page, the line (both from 1) and the lines around it.
#[derive(Debug, Clone, PartialEq)]
pub struct PdfSearchHit {
	pub page: u32,
	pub line: u32,
	/// The hit line marked with `>>>` among its neighbours.
	pub context: String,
}

impl PdfSearchHit {
	/// The hit as the pdf_search tool returns it.
	pub fn to_json(&self) -> Json {
		json!({ "page": self.page, "line": self.line, "context": self.context })
	}
}

/// `parseInt(text, 10)`: the leading whole number, NaN when there is none.
fn parse_int(text: &str) -> f64 {
	let text = trim_start(text);
	let (sign, digits) = match text.as_bytes().first() {
		Some(b'-') => (-1.0, &text[1..]),
		Some(b'+') => (1.0, &text[1..]),
		_ => (1.0, text),
	};
	let end = digits.bytes().position(|b| !b.is_ascii_digit()).unwrap_or(digits.len());
	if end == 0 {
		return f64::NAN;
	}
	sign * digits[..end].parse::<f64>().unwrap_or(f64::NAN)
}

/// `Math.max(low, x)`: NaN stays NaN (Rust's `max` would skip it).
fn clamp_low(x: f64, low: f64) -> f64 {
	if x.is_nan() { x } else { x.max(low) }
}

/// `Math.min(high, x)`.
fn clamp_high(x: f64, high: f64) -> f64 {
	if x.is_nan() { x } else { x.min(high) }
}

/// Parse `all` | `1-5` | `1,3,7` | `3` into a sorted 1-indexed page list.
pub fn parse_page_spec(spec: &str, total: u32) -> Vec<u32> {
	if trim(spec).to_lowercase() == "all" {
		return (1..=total).collect();
	}
	let last = f64::from(total);
	let mut pages = BTreeSet::new();
	for part in spec.split(',') {
		let part = trim(part);
		if part.is_empty() {
			continue;
		}
		if part.contains('-') {
			let mut halves = part.split('-');
			let mut number = clamp_low(parse_int(halves.next().unwrap_or("")), 1.0);
			let end = clamp_high(parse_int(halves.next().unwrap_or("")), last);
			// A NaN bound makes the loop test false, so nothing is added.
			while number <= end {
				pages.insert(number as u32);
				number += 1.0;
			}
		} else {
			let number = parse_int(part);
			if number >= 1.0 && number <= last {
				pages.insert(number as u32);
			}
		}
	}
	pages.into_iter().collect()
}

impl Pdf {
	/// Cheap validity check: opens the file and nothing else. Garbage files give pdf.js's error.
	pub async fn pdf_probe(&self, file: &Path) -> Result<(), String> {
		let file = file.to_owned();
		self.run(move |pdfium| open(pdfium, &file).map(|_| ())).await
	}

	/// Page count and the first page's width over height.
	pub async fn pdf_shape(&self, file: &Path) -> Result<PdfShape, String> {
		let file = file.to_owned();
		self.run(move |pdfium| {
			let doc = open(pdfium, &file)?;
			let first = page(&doc, 1)?;
			let (width, height) = page_size(&first);
			Ok(PdfShape { page_count: page_count(&doc), aspect: width / height })
		})
		.await
	}

	/// Every page's `(width, height)` in points, as pdf.js's viewport at scale 1 gives them
	/// (cheat-sheet-pdf.ts reads them to check a sheet).
	pub async fn pdf_page_sizes(&self, file: &Path) -> Result<Vec<(f64, f64)>, String> {
		let file = file.to_owned();
		self.run(move |pdfium| {
			let doc = open(pdfium, &file)?;
			(1..=page_count(&doc)).map(|number| Ok(page_size(&page(&doc, number)?))).collect()
		})
		.await
	}

	/// Find `query` (a regex, or plain text when `literal`) on every page, ignoring case, with
	/// `context_lines` (default 3) lines around each hit.
	pub async fn pdf_search(&self, file: &Path, query: &str, context_lines: Option<f64>, literal: bool) -> Result<Vec<PdfSearchHit>, String> {
		let pattern = if literal {
			Re::new(&re::escape(query), "i")
		} else {
			new_regexp(query, "i").map_err(|message| format!("Invalid regex: {message}"))?
		};
		let context = context_lines.unwrap_or(3.0);
		let file = file.to_owned();
		self.run(move |pdfium| {
			let doc = open(pdfium, &file)?;
			let mut hits = Vec::new();
			for number in 1..=page_count(&doc) {
				let text = page_text(&page(&doc, number)?)?;
				let lines: Vec<&str> = text.split('\n').collect();
				for (at, line) in lines.iter().enumerate() {
					if pattern.test(line) {
						hits.push(PdfSearchHit { page: number, line: at as u32 + 1, context: context_around(&lines, at, context) });
					}
				}
			}
			Ok(hits)
		})
		.await
	}
}

/// The lines from `context` before `at` to `context` after it, `slice` rules and all.
fn context_around(lines: &[&str], at: usize, context: f64) -> String {
	let start = clamp_low(at as f64 - context, 0.0);
	let end = clamp_high(at as f64 + context + 1.0, lines.len() as f64);
	let (from, to) = (slice_index(start, lines.len()), slice_index(end, lines.len()));
	let kept = if from < to { &lines[from..to] } else { &[][..] };
	kept.iter()
		.enumerate()
		.map(|(offset, line)| format!("{} {line}", if start + offset as f64 == at as f64 { ">>>" } else { "   " }))
		.collect::<Vec<_>>()
		.join("\n")
}

/// An `Array.prototype.slice` bound: whole part (NaN is 0), negative counts from the end, clamped.
fn slice_index(bound: f64, len: usize) -> usize {
	let bound = if bound.is_nan() { 0.0 } else { bound.trunc() };
	if bound < 0.0 { (len as f64 + bound).max(0.0) as usize } else { bound.min(len as f64) as usize }
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parse_int_reads_the_leading_number() {
		assert_eq!(parse_int(" 12abc"), 12.0);
		assert_eq!(parse_int("+3"), 3.0);
		assert_eq!(parse_int("-3"), -3.0);
		assert_eq!(parse_int("1.5"), 1.0);
		assert!(parse_int("").is_nan());
		assert!(parse_int("x1").is_nan());
		assert!(parse_int("-").is_nan());
		assert_eq!(parse_int(&"9".repeat(400)), f64::INFINITY);
	}

	#[test]
	fn page_spec_basics() {
		assert_eq!(parse_page_spec("all", 3), [1, 2, 3]);
		assert_eq!(parse_page_spec("1-5", 3), [1, 2, 3]);
		assert_eq!(parse_page_spec("1,3,7", 3), [1, 3]);
		assert_eq!(parse_page_spec(" 2 , 1 ", 3), [1, 2]);
		assert!(parse_page_spec("-2", 3).is_empty());
		assert!(parse_page_spec("1-", 3).is_empty());
	}

	#[test]
	fn context_marks_the_hit_and_clips_at_the_edges() {
		let lines = ["a", "b", "c", "d"];
		assert_eq!(context_around(&lines, 0, 1.0), ">>> a\n    b");
		assert_eq!(context_around(&lines, 3, 1.0), "    c\n>>> d");
		assert_eq!(context_around(&lines, 1, 0.0), ">>> b");
		assert_eq!(context_around(&lines, 1, -3.0), "");
		assert_eq!(context_around(&lines, 1, f64::NAN), "");
		assert_eq!(context_around(&lines, 1, 1.5), "    a\n>>> b\n    c");
		assert_eq!(context_around(&lines, 2, 1.5), "    a\n    b\n    c\n    d");
	}
}
