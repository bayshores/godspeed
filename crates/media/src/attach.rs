use std::io::Cursor;

use gs_core::messages::attachments::{MAX_IMAGE_SIDE, keeps_png};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};

use crate::resize::{fit_inside, resize};
use crate::{jpeg, png};

const JPEG_QUALITY: u8 = 85;
/// sharp refuses pictures with more pixels than this.
const MAX_INPUT_PIXELS: u64 = 268_402_689;
const MAX_DECODE_BYTES: u64 = 3 * 1024 * 1024 * 1024;

/// A stored picture: PNG or JPEG bytes and the matching mime type.
#[derive(Debug)]
pub struct NormalizedImage {
	pub bytes: Vec<u8>,
	pub mime_type: &'static str,
}

/// An attached picture made upright (EXIF turn applied), at most 1568 pixels on the long side
/// (never enlarged), as PNG when it has transparency or is a small PNG screenshot and as JPEG
/// otherwise. A GIF keeps its first frame. An Err is the message to show: the file is not a
/// picture godspeed can read.
pub fn normalize_image(name: &str, bytes: &[u8]) -> Result<NormalizedImage, String> {
	decode_and_encode(bytes).ok_or_else(|| format!("Can't read {name}."))
}

fn decode_and_encode(bytes: &[u8]) -> Option<NormalizedImage> {
	let format = image::guess_format(bytes).ok()?;
	if format == ImageFormat::Jpeg && !jpeg::is_complete(bytes) {
		return None;
	}
	let source_png = format == ImageFormat::Png;
	let ended = if source_png { png::with_end_chunk(bytes) } else { None };
	let mut decoder = ImageReader::with_format(Cursor::new(ended.as_deref().unwrap_or(bytes)), format).into_decoder().ok()?;
	let (width, height) = decoder.dimensions();
	if too_many_pixels(width, height) {
		return None;
	}
	let mut limits = Limits::no_limits();
	limits.max_alloc = Some(MAX_DECODE_BYTES);
	decoder.set_limits(limits).ok()?;
	let has_alpha = decoder.color_type().has_alpha();
	let orientation = orientation_of(&mut decoder);

	let mut image = eight_bit(DynamicImage::from_decoder(decoder).ok()?);
	image.apply_orientation(orientation);
	let (width, height) = fit_inside(image.width(), image.height(), MAX_IMAGE_SIDE, format);
	if (width, height) != (image.width(), image.height()) {
		image = resize(image, width, height);
	}

	let transparent = has_alpha && !is_opaque(&image);
	if transparent || source_png {
		let png = encode_png(&image)?;
		if keeps_png(transparent, source_png, png.len() as u64) {
			return Some(NormalizedImage { bytes: png, mime_type: "image/png" });
		}
	}
	Some(NormalizedImage { bytes: encode_jpeg(&image)?, mime_type: "image/jpeg" })
}

fn too_many_pixels(width: u32, height: u32) -> bool {
	u64::from(width) * u64::from(height) > MAX_INPUT_PIXELS
}

/// The EXIF turn, none where the picture has no EXIF. A WebP's EXIF chunk may start with the
/// JPEG-style `Exif\0\0` marker, which the image crate does not skip.
fn orientation_of(decoder: &mut impl ImageDecoder) -> Orientation {
	let exif = decoder.exif_metadata().ok().flatten().unwrap_or_default();
	let tiff = exif.strip_prefix(b"Exif\0\0").unwrap_or(&exif);
	Orientation::from_exif_chunk(tiff).unwrap_or(Orientation::NoTransforms)
}

/// sharp writes 8 bits per sample, even from a 16-bit picture.
fn eight_bit(image: DynamicImage) -> DynamicImage {
	match image {
		DynamicImage::ImageLuma16(_) => DynamicImage::ImageLuma8(image.to_luma8()),
		DynamicImage::ImageLumaA16(_) => DynamicImage::ImageLumaA8(image.to_luma_alpha8()),
		DynamicImage::ImageRgb16(_) => DynamicImage::ImageRgb8(image.to_rgb8()),
		DynamicImage::ImageRgba16(_) => DynamicImage::ImageRgba8(image.to_rgba8()),
		other => other,
	}
}

/// No pixel is see-through (a picture without an alpha channel is opaque).
fn is_opaque(image: &DynamicImage) -> bool {
	match image {
		DynamicImage::ImageRgba8(b) => b.pixels().all(|p| p[3] == u8::MAX),
		DynamicImage::ImageLumaA8(b) => b.pixels().all(|p| p[1] == u8::MAX),
		_ => true,
	}
}

/// Level 6 without row filters, how sharp writes PNG, so the size test sees the same sizes.
fn encode_png(image: &DynamicImage) -> Option<Vec<u8>> {
	let mut out = Vec::new();
	image.write_with_encoder(PngEncoder::new_with_quality(&mut out, CompressionType::Level(6), FilterType::NoFilter)).ok()?;
	Some(out)
}

/// 8-bit grey or RGB; a see-through picture reaching here is opaque, so dropping alpha is exact.
fn encode_jpeg(image: &DynamicImage) -> Option<Vec<u8>> {
	let flat = if image.color().has_color() { DynamicImage::ImageRgb8(image.to_rgb8()) } else { DynamicImage::ImageLuma8(image.to_luma8()) };
	let mut out = Vec::new();
	flat.write_with_encoder(JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY)).ok()?;
	Some(out)
}

#[cfg(test)]
mod tests {
	use super::*;
	use image::{ImageBuffer, Luma, Rgb};

	/// A picture of incompressible-looking samples (a hash of the position).
	fn noise_png(side: u32) -> Vec<u8> {
		let img = ImageBuffer::from_fn(side, side, |x, y| {
			let h = x.wrapping_mul(0x9e37_79b1) ^ y.wrapping_mul(0x85eb_ca6b);
			let h = (h ^ h >> 15).wrapping_mul(0x2c1b_3c6d);
			Rgb([(h >> 8) as u8, (h >> 16) as u8, (h >> 24) as u8])
		});
		let mut out = Vec::new();
		DynamicImage::ImageRgb8(img).write_to(&mut Cursor::new(&mut out), ImageFormat::Png).unwrap();
		out
	}

	#[test]
	fn a_png_that_stays_big_after_resizing_becomes_a_jpeg() {
		assert_eq!(normalize_image("big.png", &noise_png(900)).unwrap().mime_type, "image/jpeg");
		assert_eq!(normalize_image("small.png", &noise_png(200)).unwrap().mime_type, "image/png");
	}

	#[test]
	fn the_error_names_the_file() {
		assert_eq!(normalize_image("notes (1).png", b"nope").unwrap_err(), "Can't read notes (1).png.");
	}

	#[test]
	fn more_pixels_than_sharp_allows_are_refused() {
		assert!(!too_many_pixels(16383, 16383));
		assert!(too_many_pixels(16383, 16384));
		assert!(too_many_pixels(u32::MAX, u32::MAX));
	}

	#[test]
	fn a_grey_picture_keeps_its_kind() {
		let grey = ImageBuffer::from_pixel(60, 40, Luma([90u8]));
		let mut png = Vec::new();
		DynamicImage::ImageLuma8(grey).write_to(&mut Cursor::new(&mut png), ImageFormat::Png).unwrap();
		let out = normalize_image("grey.png", &png).unwrap();
		assert_eq!(image::load_from_memory(&out.bytes).unwrap().color(), image::ColorType::L8);
	}
}
