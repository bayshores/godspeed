//! The resize half of attachments.ts: fit inside a square, never enlarge.

use image::imageops::{self, FilterType};
use image::{DynamicImage, ImageBuffer, ImageFormat, LumaA, Pixel, Rgba};

/// The size sharp gives a picture fit inside `max_side` (never enlarged). sharp decodes a big
/// JPEG at 1/2, 1/4 or 1/8 scale and a big WebP at the exact scale first, and each step rounds,
/// so the result can be a pixel away from a direct resize.
pub fn fit_inside(width: u32, height: u32, max_side: u32, format: ImageFormat) -> (u32, u32) {
	let (mut w, mut h) = (f64::from(width), f64::from(height));
	let (hs, vs) = shrinks(w, h, max_side);
	let shrink = hs.min(vs);
	match format {
		ImageFormat::Jpeg => {
			let factor = jpeg_shrink_on_load(shrink);
			(w, h) = ((w / factor).floor(), (h / factor).floor());
		}
		ImageFormat::WebP if shrink > 1.0 => {
			let scale = 1.0 / shrink;
			(w, h) = ((w * scale).round_ties_even(), (h * scale).round_ties_even());
		}
		_ => {}
	}
	let (hs, vs) = shrinks(w, h, max_side);
	// libvips rounds halves up.
	let side = |n: f64, shrink: f64| (n * (1.0 / shrink) + 0.5).floor() as u32;
	(side(w, hs), side(h, vs))
}

/// sharp's shrink for fit "inside" without enlargement: one factor for both sides, but never
/// more than a side's own length.
fn shrinks(width: f64, height: f64, max_side: u32) -> (f64, f64) {
	let max = f64::from(max_side);
	let shrink = (width / max).max(height / max).max(1.0);
	(shrink.min(width), shrink.min(height))
}

/// The DCT scale sharp asks libjpeg for, one step lower where the shrink is a whole number.
fn jpeg_shrink_on_load(shrink: f64) -> f64 {
	let factor = [8.0, 4.0, 2.0].into_iter().find(|&f| shrink >= f).unwrap_or(1.0);
	if factor > 1.0 && shrink.trunc() == factor { factor / 2.0 } else { factor }
}

/// Resize an 8-bit picture with Lanczos. A picture with transparency is resized premultiplied, so a clear
/// pixel's colour does not bleed into its neighbours.
pub fn resize(image: DynamicImage, width: u32, height: u32) -> DynamicImage {
	match image {
		DynamicImage::ImageRgba8(b) => DynamicImage::ImageRgba8(down(&resized_premultiplied(&up::<Rgba<u16>>(&b), width, height))),
		DynamicImage::ImageLumaA8(b) => DynamicImage::ImageLumaA8(down(&resized_premultiplied(&up::<LumaA<u16>>(&b), width, height))),
		other => other.resize_exact(width, height, FilterType::Lanczos3),
	}
}

/// 8-bit samples as 16-bit (v * 257), so premultiplying loses little.
fn up<Q: Pixel<Subpixel = u16>>(buf: &ImageBuffer<impl Pixel<Subpixel = u8>, Vec<u8>>) -> ImageBuffer<Q, Vec<u16>> {
	let raw = buf.as_raw().iter().map(|&v| u16::from(v) * 257).collect();
	ImageBuffer::from_raw(buf.width(), buf.height(), raw).expect("same sample count")
}

fn down<Q: Pixel<Subpixel = u8>>(buf: &ImageBuffer<impl Pixel<Subpixel = u16>, Vec<u16>>) -> ImageBuffer<Q, Vec<u8>> {
	let raw = buf.as_raw().iter().map(|&v| ((u32::from(v) + 128) / 257) as u8).collect();
	ImageBuffer::from_raw(buf.width(), buf.height(), raw).expect("same sample count")
}

fn resized_premultiplied<P: Pixel<Subpixel = u16> + 'static>(buf: &ImageBuffer<P, Vec<u16>>, width: u32, height: u32) -> ImageBuffer<P, Vec<u16>> {
	let mut premultiplied = buf.clone();
	scale_colors(&mut premultiplied, |colour, alpha| (u32::from(colour) * u32::from(alpha) + 32767) / 65535);
	let mut out = imageops::resize(&premultiplied, width, height, FilterType::Lanczos3);
	scale_colors(&mut out, |colour, alpha| if alpha == 0 { 0 } else { (u32::from(colour) * 65535 + u32::from(alpha) / 2) / u32::from(alpha) });
	out
}

/// Replace each colour channel with `f(colour, alpha)` (kept within 16 bits); alpha is the last channel.
fn scale_colors<P: Pixel<Subpixel = u16>>(buf: &mut ImageBuffer<P, Vec<u16>>, f: impl Fn(u16, u16) -> u32) {
	let channels = usize::from(P::CHANNEL_COUNT);
	for px in buf.as_mut().chunks_exact_mut(channels) {
		let alpha = px[channels - 1];
		for colour in &mut px[..channels - 1] {
			*colour = f(*colour, alpha).min(65535) as u16;
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use image::Luma;

	#[test]
	fn fit_inside_matches_sharp() {
		// Measured with sharp().rotate().resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).
		let any_format = [
			((1568, 1568), (1568, 1568)),
			((7, 7), (7, 7)),
			((1569, 1), (1568, 1)),
			((3000, 1), (1568, 1)),
			((1, 3000), (1, 1568)),
			((17, 5000), (5, 1568)),
			((4000, 3000), (1568, 1176)),
			((3001, 2999), (1568, 1567)),
			((1569, 1000), (1568, 999)),
			((1600, 1599), (1568, 1567)),
			((2001, 1334), (1568, 1045)),
			((10000, 3), (1568, 1)),
			((3136, 7), (1568, 4)),
			((6273, 4183), (1568, 1046)),
			((16000, 9001), (1568, 882)),
		];
		for ((w, h), want) in any_format {
			for format in [ImageFormat::Png, ImageFormat::Gif, ImageFormat::Jpeg, ImageFormat::WebP] {
				assert_eq!(fit_inside(w, h, 1568, format), want, "{format:?} {w}x{h}");
			}
		}
		let by_format = [
			// A half rounds up, except through WebP's scaled decode, which rounds it to even.
			(ImageFormat::Png, (3136, 5), (1568, 3)),
			(ImageFormat::Png, (3136, 9), (1568, 5)),
			(ImageFormat::Png, (5, 3136), (3, 1568)),
			(ImageFormat::Jpeg, (3136, 9), (1568, 5)),
			(ImageFormat::WebP, (3136, 5), (1568, 2)),
			(ImageFormat::WebP, (3136, 9), (1568, 4)),
			(ImageFormat::WebP, (5, 3136), (2, 1568)),
			// The JPEG is read at a half or a quarter of its size first.
			(ImageFormat::Png, (5003, 3757), (1568, 1177)),
			(ImageFormat::Jpeg, (5003, 3757), (1568, 1177)),
			(ImageFormat::Jpeg, (4017, 5409), (1164, 1568)),
			(ImageFormat::Jpeg, (5729, 6961), (1290, 1568)),
			(ImageFormat::Jpeg, (14161, 409), (1568, 45)),
			(ImageFormat::Jpeg, (12961, 7881), (1568, 953)),
		];
		for (format, (w, h), want) in by_format {
			assert_eq!(fit_inside(w, h, 1568, format), want, "{format:?} {w}x{h}");
		}
	}

	#[test]
	fn clear_pixels_do_not_bleed_colour() {
		// Left half opaque white, right half fully clear black: the seam must not turn grey.
		let mut buf = ImageBuffer::from_pixel(8, 4, Rgba([0u8, 0, 0, 0]));
		for y in 0..4 {
			for x in 0..4 {
				buf.put_pixel(x, y, Rgba([255, 255, 255, 255]));
			}
		}
		let DynamicImage::ImageRgba8(small) = resize(DynamicImage::ImageRgba8(buf), 4, 2) else { panic!("still RGBA8") };
		for px in small.pixels().filter(|p| p[3] > 0) {
			assert!(px[0] >= 250, "{px:?}");
		}
	}

	#[test]
	fn grey_keeps_its_kind() {
		let grey = DynamicImage::ImageLuma8(ImageBuffer::from_pixel(8, 8, Luma([100u8])));
		assert!(matches!(resize(grey, 4, 4), DynamicImage::ImageLuma8(_)));
		let grey_alpha = DynamicImage::ImageLumaA8(ImageBuffer::from_pixel(8, 8, LumaA([100u8, 255])));
		let DynamicImage::ImageLumaA8(small) = resize(grey_alpha, 4, 4) else { panic!("still grey with alpha") };
		assert_eq!(small.get_pixel(1, 1).0, [100, 255]);
	}
}
