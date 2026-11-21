use std::io::Cursor;
use std::path::Path;

use gs_media::png::provider_safe_png;
use image::ImageEncoder;
use pdfium_render::prelude::{PdfMatrix, PdfPage, PdfPageObject, PdfPageObjectCommon, PdfPageObjectsCommon, PdfPageXObjectFormObject, PdfQuadPoints, PdfRenderConfig};

use crate::open::{open, open_resolved, page, page_count, page_size};
use crate::recolor::{PixelBox, recolor};
use crate::worker::Pdf;

/// 72 is 100% zoom; the pdf-reader skill suggests 100, 150 or 200.
const DEFAULT_DPI: f64 = 150.0;
/// @napi-rs/canvas gives a side under 1 pixel (a dpi of 0 or less) its default, 350 by 150.
const DEFAULT_SIDES: (f64, f64) = (350.0, 150.0);
/// Skia refuses a page image of more bytes than this, at 4 bytes a pixel.
const MAX_BYTES: f64 = i32::MAX as f64;

/// The most pixels a page is drawn at for a piece of it, each way.
const MAX_PIECE_SIDE: f64 = 3200.0;

/// Part of a page, as fractions of the page image from its top left.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageCrop {
	pub left: f64,
	pub top: f64,
	pub right: f64,
	pub bottom: f64,
}

impl PageCrop {
	pub const WHOLE: PageCrop = PageCrop { left: 0.0, top: 0.0, right: 1.0, bottom: 1.0 };
}

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

	/// The `crop` of page `number` as a PNG about `width` pixels wide. With an `ink`, the piece is
	/// recolored for a theme whose text has that color: its paper is see-through.
	pub async fn render_page_piece(&self, file: &Path, number: u32, crop: PageCrop, width: u32, ink: Option<[u8; 3]>) -> Result<Vec<u8>, String> {
		let file = file.to_owned();
		let sides = [crop.left, crop.top, crop.right, crop.bottom];
		if !sides.iter().all(|side| (0.0..=1.0).contains(side)) || crop.right <= crop.left || crop.bottom <= crop.top {
			return Err(format!("Page {number} has no such piece."));
		}
		let (mut rgba, pictures) = self
			.run(move |pdfium| {
				let doc = open(pdfium, &file)?;
				let page = page(&doc, number)?;
				let (points_w, points_h) = page_size(&page);
				if points_w < 1.0 || points_h < 1.0 {
					return Err(format!("Page {number} has no such piece."));
				}
				let scale = (f64::from(width.max(1)) / (crop.right - crop.left) / points_w).min(MAX_PIECE_SIDE / points_w.max(points_h));
				let config = PdfRenderConfig::new().set_target_size((points_w * scale).ceil().max(1.0) as i32, (points_h * scale).ceil().max(1.0) as i32);
				let bitmap = page.render_with_config(&config).map_err(|e| format!("Page {number} could not be rendered: {e}"))?;
				let rgba = bitmap.as_image().map_err(|e| format!("Page {number} could not be read back: {e}"))?.to_rgba8();
				Ok((rgba, if ink.is_some() { picture_boxes(&page, &config) } else { Vec::new() }))
			})
			.await?;
		// The pixel work stays off the one pdfium thread, which every other PDF job waits for.
		let finish = move || {
			if let Some(ink) = ink {
				recolor(&mut rgba, ink, &pictures);
			}
			let (page_w, page_h) = (f64::from(rgba.width()), f64::from(rgba.height()));
			let (x0, y0) = ((crop.left * page_w).floor() as u32, (crop.top * page_h).floor() as u32);
			let (x1, y1) = (((crop.right * page_w).ceil() as u32).min(rgba.width()), ((crop.bottom * page_h).ceil() as u32).min(rgba.height()));
			encode(&image::imageops::crop_imm(&rgba, x0, y0, x1.saturating_sub(x0).max(1), y1.saturating_sub(y0).max(1)).to_image())
		};
		gs_base::tasks::spawn_blocking("pdf", finish).await.map_err(|e| format!("Page {number} could not be drawn: {e}"))?
	}
}

/// The boxes of the images the page paints, forms looked into, in the pixels `config` draws.
fn picture_boxes(page: &PdfPage, config: &PdfRenderConfig) -> Vec<PixelBox> {
	let mut quads = Vec::new();
	for object in page.objects().iter() {
		pictures_in(&object, &[], &mut quads);
	}
	quads
		.into_iter()
		.filter_map(|quad| {
			let a = page.points_to_pixels(quad.left(), quad.top(), config).ok()?;
			let b = page.points_to_pixels(quad.right(), quad.bottom(), config).ok()?;
			let side = |v: i32| u32::try_from(v).unwrap_or(0);
			// One pixel wider each way: the image's own edge pixels are drawn half over the paper.
			Some(PixelBox { x0: side(a.0.min(b.0) - 1), y0: side(a.1.min(b.1) - 1), x1: side(a.0.max(b.0) + 1), y1: side(a.1.max(b.1) + 1) })
		})
		.collect()
}

/// `forms` are the matrices of the forms `object` sits in, the outermost first: an object in a
/// form gives its bounds in that form's own space.
fn pictures_in(object: &PdfPageObject, forms: &[PdfMatrix], out: &mut Vec<PdfQuadPoints>) {
	if let Some(form) = object.as_x_object_form_object() {
		pictures_in_form(form, forms, out);
	} else if object.as_image_object().is_some()
		&& let Ok(bounds) = object.bounds()
	{
		out.push(forms.iter().rev().fold(bounds, |quad, matrix| quad.transform(*matrix)));
	}
}

fn pictures_in_form(form: &PdfPageXObjectFormObject, forms: &[PdfMatrix], out: &mut Vec<PdfQuadPoints>) {
	let Ok(matrix) = form.matrix() else { return };
	let inside = [forms, &[matrix]].concat();
	for object in (0..form.len()).filter_map(|at| form.get(at).ok()) {
		pictures_in(&object, &inside, out);
	}
}

fn encode(rgba: &image::RgbaImage) -> Result<Vec<u8>, String> {
	let mut png = Vec::new();
	image::codecs::png::PngEncoder::new(Cursor::new(&mut png))
		.write_image(rgba.as_raw(), rgba.width(), rgba.height(), image::ExtendedColorType::Rgba8)
		.map_err(|e| format!("A page image could not be written: {e}"))?;
	Ok(provider_safe_png(&png))
}
