//! Quote boxes: one box per line over the quoted words, as fractions of the page image, on plain,
//! many-page, rotated and cropped pages. Each box is checked against the rendered page's ink.

mod common;

use common::{fixture, pdf};
use gs_pdf::text::QuoteBox;

/// Finds `quote` in the page text (the fixtures are ASCII, so bytes are UTF-16 units).
fn find(quote: &'static str) -> impl FnOnce(&str) -> Option<(usize, usize)> + Send + 'static {
	move |text| text.find(quote).map(|at| (at, at + quote.len()))
}

/// Dark pixels of page `n` inside `b`, and the image's size.
async fn ink_in(pdf: &gs_pdf::Pdf, name: &str, n: i64, b: QuoteBox) -> (usize, (u32, u32)) {
	let page = pdf.render_pdf_pages(&fixture(name), &[n], Some(100.0)).await.unwrap().remove(0);
	let image = image::load_from_memory(&page.png).unwrap().to_luma8();
	let (w, h) = (f64::from(image.width()), f64::from(image.height()));
	let (x0, x1) = ((b.x * w).floor() as u32, ((b.x + b.w) * w).ceil() as u32);
	let (y0, y1) = ((b.y * h).floor() as u32, ((b.y + b.h) * h).ceil() as u32);
	let dark = (y0..y1.min(image.height())).flat_map(|y| (x0..x1.min(image.width())).map(move |x| (x, y))).filter(|&(x, y)| image.get_pixel(x, y)[0] < 128).count();
	(dark, image.dimensions())
}

fn inside_page(b: QuoteBox) -> bool {
	b.w > 0.0 && b.h > 0.0 && b.x >= 0.0 && b.y >= 0.0 && b.x + b.w <= 1.0 + 1e-9 && b.y + b.h <= 1.0 + 1e-9
}

#[tokio::test]
async fn words_on_one_line_get_one_box_over_their_ink() {
	let Some(pdf) = pdf() else { return };
	for (name, n, quote) in [("two-lines.pdf", 1, "second line here"), ("sample-3page.pdf", 2, "force equals mass"), ("rotated.pdf", 1, "Wide page"), ("cropped.pdf", 1, "crop box")] {
		let boxes = pdf.quote_boxes(&fixture(name), n as u32, find(quote)).await.unwrap();
		assert_eq!(boxes.len(), 1, "{name}: {boxes:?}");
		assert!(inside_page(boxes[0]), "{name}: {boxes:?}");
		let (dark, _) = ink_in(&pdf, name, n, boxes[0]).await;
		assert!(dark > 20, "{name}: {dark} dark pixels in {boxes:?}");
	}
}

#[tokio::test]
async fn words_across_a_line_end_get_a_box_per_line_in_reading_order() {
	let Some(pdf) = pdf() else { return };
	let boxes = pdf.quote_boxes(&fixture("two-lines.pdf"), 1, find("the page\nsecond")).await.unwrap();
	assert_eq!(boxes.len(), 2, "{boxes:?}");
	assert!(boxes[0].y + boxes[0].h <= boxes[1].y + 1e-6, "{boxes:?}");
	let first_line = pdf.quote_boxes(&fixture("two-lines.pdf"), 1, find("First line")).await.unwrap();
	assert!(first_line[0].x < boxes[0].x, "the page sits right of First line: {first_line:?} {boxes:?}");
}

#[tokio::test]
async fn a_rotated_page_gives_boxes_in_the_rendered_shape() {
	let Some(pdf) = pdf() else { return };
	let (all, (w, h)) = ink_in(&pdf, "rotated.pdf", 1, QuoteBox { x: 0.0, y: 0.0, w: 1.0, h: 1.0 }).await;
	let b = pdf.quote_boxes(&fixture("rotated.pdf"), 1, find("Wide page")).await.unwrap()[0];
	// The words run along the rendered page's long side, and they are all the ink there is.
	assert_eq!(b.w * f64::from(w) > b.h * f64::from(h), w > h, "{b:?} on {w}x{h}");
	let (inside, _) = ink_in(&pdf, "rotated.pdf", 1, b).await;
	assert!(inside * 10 >= all * 9, "{inside} of {all} dark pixels in {b:?}");
}

#[tokio::test]
async fn nothing_found_or_no_page_gives_no_boxes() {
	let Some(pdf) = pdf() else { return };
	assert_eq!(pdf.quote_boxes(&fixture("two-lines.pdf"), 1, |_| None).await, Ok(vec![]));
	assert_eq!(pdf.quote_boxes(&fixture("image-only.pdf"), 1, find("anything")).await, Ok(vec![]));
	assert_eq!(pdf.quote_boxes(&fixture("two-lines.pdf"), 4, find("First")).await, Err("Invalid page request.".to_owned()));
}
