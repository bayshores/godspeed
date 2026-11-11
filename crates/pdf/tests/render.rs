//! Page images: one IDAT chunk, a size of ceil(points * dpi / 72), skipped pages, and a real picture.
//! The sizes against pdf.js are in golden.rs.

mod common;

use common::{fixture, pdf};

fn side(png: &[u8], from: usize) -> u32 {
	u32::from_be_bytes(png[from..from + 4].try_into().unwrap())
}

fn idat_chunks(png: &[u8]) -> usize {
	let (mut at, mut count) = (8, 0);
	while at < png.len() {
		if &png[at + 4..at + 8] == b"IDAT" {
			count += 1;
		}
		at += 12 + side(png, at) as usize;
	}
	count
}

#[tokio::test]
async fn pages_come_back_as_single_idat_pngs_in_the_order_asked() {
	let Some(pdf) = pdf() else { return };
	let pages = pdf.render_pdf_pages(&fixture("sample-3page.pdf"), &[3, 1], None).await.unwrap();
	assert_eq!(pages.iter().map(|p| p.page).collect::<Vec<_>>(), [3, 1]);
	for p in &pages {
		assert_eq!(&p.png[..8], b"\x89PNG\r\n\x1a\n");
		assert_eq!(idat_chunks(&p.png), 1);
	}
}

#[tokio::test]
async fn pages_outside_the_document_are_skipped() {
	let Some(pdf) = pdf() else { return };
	let pages = pdf.render_pdf_pages(&fixture("sample-3page.pdf"), &[0, 2, 99, -1], Some(72.0)).await.unwrap();
	assert_eq!(pages.iter().map(|p| p.page).collect::<Vec<_>>(), [2]);
}

#[tokio::test]
async fn twice_the_dpi_is_twice_the_size() {
	let Some(pdf) = pdf() else { return };
	let file = fixture("sample-3page.pdf");
	let small = &pdf.render_pdf_pages(&file, &[1], Some(72.0)).await.unwrap()[0];
	let large = &pdf.render_pdf_pages(&file, &[1], Some(144.0)).await.unwrap()[0];
	assert!(side(&large.png, 16).abs_diff(2 * side(&small.png, 16)) <= 2);
	assert!(side(&large.png, 20).abs_diff(2 * side(&small.png, 20)) <= 2);
}

#[tokio::test]
async fn a_page_with_text_is_not_a_blank_sheet() {
	let Some(pdf) = pdf() else { return };
	let page = &pdf.render_pdf_pages(&fixture("lines.pdf"), &[1], Some(72.0)).await.unwrap()[0];
	let image = image::load_from_memory(&page.png).unwrap().to_rgba8();
	assert_eq!(image.get_pixel(0, 0).0, [255, 255, 255, 255], "the paper is white");
	assert!(image.pixels().any(|p| p.0[0] < 128), "some pixel is inked");
}

#[tokio::test]
async fn a_file_that_is_not_a_pdf_says_so() {
	let Some(pdf) = pdf() else { return };
	let error = pdf.render_pdf_pages(&fixture("not-a-pdf.txt"), &[1], None).await.err().unwrap();
	assert_eq!(error, "Invalid PDF structure.");
}
