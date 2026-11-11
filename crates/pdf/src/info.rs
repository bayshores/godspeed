//! Ported from pdfInfo in src/backend/agent/subagents/pdf-ops.ts.

use std::path::Path;

use gs_base::num::math_round;
use gs_base::text::len16;
use gs_json::{Json, json};
use pdfium_render::prelude::{PdfPageObject, PdfPageObjectsCommon, PdfPageXObjectFormObject};

use crate::open::{open, page, page_count};
use crate::text::page_text;
use crate::worker::Pdf;

/// The triage signals for one page.
#[derive(Debug, Clone, PartialEq)]
pub struct PdfPageInfo {
	pub page: u32,
	pub text_length: usize,
	pub image_count: u32,
	/// Fraction of math-flavoured characters, the render-this-page signal.
	pub math_density: f64,
}

impl PdfPageInfo {
	/// The page as the pdf_info tool returns it.
	pub fn to_json(&self) -> Json {
		json!({ "page": self.page, "text_length": self.text_length, "image_count": self.image_count, "math_density": self.math_density })
	}
}

#[derive(Debug, Clone, PartialEq)]
pub struct PdfInfo {
	pub path: String,
	pub page_count: u32,
	/// Mean characters per page, the size class the reading strategy branches on.
	pub mean_text_length: u64,
	pub pages: Vec<PdfPageInfo>,
}

impl Pdf {
	/// Page count plus the per-page triage signals. Always the first call on a PDF.
	pub async fn pdf_info(&self, file: &Path) -> Result<PdfInfo, String> {
		let file = file.to_owned();
		self.run(move |pdfium| {
			let doc = open(pdfium, &file)?;
			let page_count = page_count(&doc);
			let mut pages = Vec::new();
			let mut total_text = 0;
			for number in 1..=page_count {
				let page = page(&doc, number)?;
				let text = page_text(&page)?;
				let text_length = len16(&text);
				total_text += text_length;
				pages.push(PdfPageInfo {
					page: number,
					text_length,
					image_count: images_in(page.objects().iter()),
					math_density: math_round(math_density(&text) * 10000.0) / 10000.0,
				});
			}
			let mean = math_round(total_text as f64 / f64::from(page_count.max(1)));
			Ok(PdfInfo { path: file.to_string_lossy().into_owned(), page_count, mean_text_length: mean as u64, pages })
		})
		.await
	}
}

/// Images painted by these objects, forms looked into.
fn images_in<'a>(objects: impl Iterator<Item = PdfPageObject<'a>>) -> u32 {
	objects
		.map(|object| match object.as_x_object_form_object() {
			Some(form) => images_in_form(form),
			None => u32::from(object.as_image_object().is_some()),
		})
		.sum()
}

fn images_in_form(form: &PdfPageXObjectFormObject) -> u32 {
	(0..form.len())
		.filter_map(|at| form.get(at).ok())
		.map(|object| match object.as_x_object_form_object() {
			Some(inner) => images_in_form(inner),
			None => u32::from(object.as_image_object().is_some()),
		})
		.sum()
}

/// Math-flavoured characters over the text's UTF-16 length, with the pdf-reader skill's ranges.
fn math_density(text: &str) -> f64 {
	let math = text.chars().filter(|&c| is_math(c)).count();
	math as f64 / len16(text).max(1) as f64
}

fn is_math(c: char) -> bool {
	matches!(u32::from(c),
		0x2200..=0x22ff | 0x2100..=0x214f | 0x2190..=0x21ff | 0x27c0..=0x27ef | 0x2980..=0x29ff | 0x2a00..=0x2aff | 0x0370..=0x03ff | 0x1d400..=0x1d7ff)
		|| "∫∑∏√∂∇∞≈≠≤≥±×÷∈∉⊂⊃∪∩∧∨¬∀∃∅".contains(c)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn math_density_counts_math_characters_over_utf16_length() {
		assert_eq!(math_density(""), 0.0);
		assert_eq!(math_density("abc"), 0.0);
		assert_eq!(math_density("\u{3b1}b"), 0.5);
		// An astral math letter is one character but two UTF-16 units.
		assert_eq!(math_density("\u{1d400}"), 0.5);
		assert_eq!(math_density("\u{b1}\u{ac}x\u{2260}"), 0.75);
	}
}
