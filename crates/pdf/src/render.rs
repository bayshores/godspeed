//! Ported from renderPdfPages in src/backend/agent/subagents/headless.ts, readingPdfPage in src/backend/server/reading-pages.ts.

use std::io::Cursor;
use std::path::Path;

use image::ImageEncoder;
use pdfium_render::prelude::PdfRenderConfig;

use crate::open::{open_resolved, page, page_count, page_size};
use crate::png::provider_safe_png;
use crate::worker::Pdf;

/// 72 is 100% zoom; the pdf-reader skill suggests 100, 150 or 200.
const DEFAULT_DPI: f64 = 150.0;
/// @napi-rs/canvas gives a side under 1 pixel (a dpi of 0 or less) its default, 350 by 150.
const DEFAULT_SIDES: (f64, f64) = (350.0, 150.0);
/// Skia refuses a page image of more bytes than this, at 4 bytes a pixel.
const MAX_BYTES: f64 = i32::MAX as f64;

/// One page as a single-IDAT PNG.
pub struct RenderedPdfPage {
	pub page: u32,
	pub png: Vec<u8>,
}

impl Pdf {
	/// Renders `pages` (counted from 1; numbers outside the document are skipped) at `dpi`
	/// (default 150) on a white background, `ceil(points * dpi / 72)` pixels each way.
	pub async fn render_pdf_pages(&self, file: &Path, pages: &[i64], dpi: Option<f64>) -> Result<Vec<RenderedPdfPage>, String> {
		let (file, pages) = (file.to_owned(), pages.to_vec());
		let scale = dpi.unwrap_or(DEFAULT_DPI) / 72.0;
		self.run(move |pdfium| {
			let doc = open_resolved(pdfium, &file)?;
			let count = i64::from(page_count(&doc));
			let mut out = Vec::new();
			for number in pages.into_iter().filter(|n| (1..=count).contains(n)) {
				let number = number as u32;
				let page = page(&doc, number)?;
				let (width, height) = page_size(&page);
				let (width, height) = ((width * scale).ceil(), (height * scale).ceil());
				let drawn = width >= 1.0 && height >= 1.0;
				let width = if width >= 1.0 { width } else { DEFAULT_SIDES.0 };
				let height = if height >= 1.0 { height } else { DEFAULT_SIDES.1 };
				if width * height * 4.0 > MAX_BYTES {
					return Err("Create skia surface failed".to_owned());
				}
				let rgba = if drawn {
					let config = PdfRenderConfig::new().set_target_size(width as i32, height as i32);
					let bitmap = page.render_with_config(&config).map_err(|e| format!("Page {number} could not be rendered: {e}"))?;
					bitmap.as_image().map_err(|e| format!("Page {number} could not be read back: {e}"))?.to_rgba8()
				} else {
					// pdf.js paints only the white paper on a canvas the page does not fit.
					image::RgbaImage::from_pixel(width as u32, height as u32, image::Rgba([255; 4]))
				};
				out.push(RenderedPdfPage { page: number, png: encode(&rgba)? });
			}
			Ok(out)
		})
		.await
	}
}

fn encode(rgba: &image::RgbaImage) -> Result<Vec<u8>, String> {
	let mut png = Vec::new();
	image::codecs::png::PngEncoder::new(Cursor::new(&mut png))
		.write_image(rgba.as_raw(), rgba.width(), rgba.height(), image::ExtendedColorType::Rgba8)
		.map_err(|e| format!("A page image could not be written: {e}"))?;
	Ok(provider_safe_png(png))
}
