//! Fits a rendered page to the app's theme. The page's white paper turns see-through, so the
//! sheet under it shows, and what is printed in black takes the theme's ink. A color keeps its
//! hue. A photo stays as printed, and so does a page whose own paper is not light (a dark slide).

use image::RgbaImage;

/// A rectangle of the page image in pixels, `x0 <= x < x1` and `y0 <= y < y1`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PixelBox {
	pub x0: u32,
	pub y0: u32,
	pub x1: u32,
	pub y1: u32,
}

impl PixelBox {
	fn holds(&self, x: u32, y: u32) -> bool {
		(self.x0..self.x1).contains(&x) && (self.y0..self.y1).contains(&y)
	}

	fn area(&self) -> f64 {
		f64::from(self.x1.saturating_sub(self.x0)) * f64::from(self.y1.saturating_sub(self.y0))
	}
}

/// A channel at or above this counts as paper.
const PAPER: f32 = 0.9;
/// The share of paper a page, or a picture on it, needs to be read as ink on paper.
const PAPER_SHARE: f64 = 0.5;
/// A picture this much of the page is the page itself: a scan.
const SCAN_SHARE: f64 = 0.6;
/// How far a dark color moves toward a light ink, so that it reads on a dark sheet.
const LIFT: f32 = 0.6;
/// A channel at or above this is the white a photo stands on.
const SURROUND: u8 = 232;
/// Pixels looked at when a page or a picture is judged, at most.
const SAMPLES: u32 = 40_000;

/// Recolors `image` (a page on white, fully opaque) for a theme whose text is `ink`. `pictures`
/// are the boxes of the images the page paints.
pub fn recolor(image: &mut RgbaImage, ink: [u8; 3], pictures: &[PixelBox]) {
	let whole = PixelBox { x0: 0, y0: 0, x1: image.width(), y1: image.height() };
	let (mut photos, mut scan_paper) = (Vec::new(), 1.0_f32);
	for picture in pictures.iter().map(|p| clamp(*p, whole)).filter(|p| p.area() > 0.0) {
		if paper_share(image, picture, &[]) < PAPER_SHARE {
			photos.push(picture);
		} else if picture.area() >= whole.area() * SCAN_SHARE {
			scan_paper = scan_paper.min(paper_level(image, picture));
		}
	}
	if paper_share(image, whole, &photos) < PAPER_SHARE {
		return;
	}
	let ink = ink.map(|c| f32::from(c) / 255.0);
	let dark_sheet = luma(ink) > 0.5;
	let width = image.width() as usize;
	let mut kept = vec![false; width * image.height() as usize];
	for photo in &photos {
		for y in photo.y0..photo.y1 {
			kept[y as usize * width + photo.x0 as usize..y as usize * width + photo.x1 as usize].fill(true);
		}
		clear_surround(image, *photo, &mut kept);
	}
	for (x, y, pixel) in image.enumerate_pixels_mut() {
		if kept[y as usize * width + x as usize] {
			continue;
		}
		let printed = [pixel[0], pixel[1], pixel[2]].map(|c| (f32::from(c) / 255.0 / scan_paper).min(1.0));
		let (color, cover) = themed(printed, ink, dark_sheet);
		pixel.0 = [to_byte(color[0]), to_byte(color[1]), to_byte(color[2]), to_byte(cover)];
	}
}

/// Gives back to the page the white a photo stands on (a round logo's corners): the paper that
/// reaches the photo's edge is no longer kept, and the photo's rim next to it is thinned by how
/// much paper it holds, so no white line is left around the photo.
fn clear_surround(image: &mut RgbaImage, photo: PixelBox, kept: &mut [bool]) {
	let width = image.width() as usize;
	let is_paper = |image: &RgbaImage, x: u32, y: u32| image.get_pixel(x, y).0[..3].iter().all(|&c| c >= SURROUND);
	let mut open: Vec<(u32, u32)> = Vec::new();
	let edge = (photo.x0..photo.x1).flat_map(|x| [(x, photo.y0), (x, photo.y1 - 1)]).chain((photo.y0..photo.y1).flat_map(|y| [(photo.x0, y), (photo.x1 - 1, y)]));
	for (x, y) in edge {
		if kept[y as usize * width + x as usize] && is_paper(image, x, y) {
			kept[y as usize * width + x as usize] = false;
			open.push((x, y));
		}
	}
	let mut rim = Vec::new();
	while let Some((x, y)) = open.pop() {
		for (nx, ny) in [(x.wrapping_sub(1), y), (x + 1, y), (x, y.wrapping_sub(1)), (x, y + 1)] {
			if !photo.holds(nx, ny) || !kept[ny as usize * width + nx as usize] {
				continue;
			}
			if is_paper(image, nx, ny) {
				kept[ny as usize * width + nx as usize] = false;
				open.push((nx, ny));
			} else {
				rim.push((nx, ny));
			}
		}
	}
	for (x, y) in rim {
		let pixel = image.get_pixel_mut(x, y);
		let printed = [pixel[0], pixel[1], pixel[2]].map(|c| f32::from(c) / 255.0);
		let paper = printed[0].min(printed[1]).min(printed[2]);
		if paper > 0.0 && pixel[3] == 255 {
			let laid = printed.map(|c| (c - paper) / (1.0 - paper));
			pixel.0 = [to_byte(laid[0]), to_byte(laid[1]), to_byte(laid[2]), to_byte(1.0 - paper)];
		}
	}
}

/// One printed pixel as a color and how much of the sheet it covers. The pixel is read as paper
/// showing through a color laid over it; that color is part black, which becomes ink, and part
/// pure hue, which stays (lifted toward the ink on a dark sheet).
fn themed(printed: [f32; 3], ink: [f32; 3], dark_sheet: bool) -> ([f32; 3], f32) {
	let paper = printed[0].min(printed[1]).min(printed[2]);
	let cover = 1.0 - paper;
	if cover <= 0.0 {
		return (ink, 0.0);
	}
	let laid = printed.map(|c| (c - paper) / cover);
	let strength = laid[0].max(laid[1]).max(laid[2]);
	if strength <= 0.0 {
		return (ink, cover);
	}
	let hue = laid.map(|c| c / strength);
	let lift = if dark_sheet { LIFT * (1.0 - luma(hue)) } else { 0.0 };
	let color = [0, 1, 2].map(|i| {
		let shown = hue[i] + (ink[i] - hue[i]) * lift;
		ink[i] * (1.0 - strength) + shown * strength
	});
	(color, cover)
}

fn luma(color: [f32; 3]) -> f32 {
	0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2]
}

fn to_byte(channel: f32) -> u8 {
	(channel.clamp(0.0, 1.0) * 255.0).round() as u8
}

fn clamp(b: PixelBox, to: PixelBox) -> PixelBox {
	PixelBox { x0: b.x0.min(to.x1), y0: b.y0.min(to.y1), x1: b.x1.min(to.x1), y1: b.y1.min(to.y1) }
}

/// Every `step`th pixel of `area` each way, about `SAMPLES` of them.
fn samples(image: &RgbaImage, area: PixelBox) -> impl Iterator<Item = (u32, u32, [f32; 3])> + '_ {
	let step = ((area.area() / f64::from(SAMPLES)).sqrt().ceil() as usize).max(1);
	(area.y0..area.y1).step_by(step).flat_map(move |y| {
		(area.x0..area.x1).step_by(step).map(move |x| {
			let p = image.get_pixel(x, y);
			(x, y, [p[0], p[1], p[2]].map(|c| f32::from(c) / 255.0))
		})
	})
}

/// The share of `area` that is paper, the pixels inside `but` left out.
fn paper_share(image: &RgbaImage, area: PixelBox, but: &[PixelBox]) -> f64 {
	let (mut paper, mut all) = (0_u32, 0_u32);
	for (x, y, color) in samples(image, area) {
		if but.iter().any(|b| b.holds(x, y)) {
			continue;
		}
		all += 1;
		paper += u32::from(color.iter().all(|&c| c >= PAPER));
	}
	if all == 0 { 0.0 } else { f64::from(paper) / f64::from(all) }
}

/// How light a scan's paper is: the lightness nine tenths of its pixels stay under. A scan's
/// paper is seldom pure white, and the grey would lie over the sheet as a haze.
fn paper_level(image: &RgbaImage, area: PixelBox) -> f32 {
	let mut lights: Vec<f32> = samples(image, area).map(|(_, _, color)| luma(color)).collect();
	if lights.is_empty() {
		return 1.0;
	}
	let at = (lights.len() * 9 / 10).min(lights.len() - 1);
	lights.select_nth_unstable_by(at, f32::total_cmp);
	lights[at].clamp(PAPER, 1.0)
}

#[cfg(test)]
mod tests {
	use super::*;
	use image::Rgba;

	const LIGHT_INK: [u8; 3] = [230, 228, 220];
	const DARK_INK: [u8; 3] = [51, 50, 44];

	/// A white page with `marks` painted on it.
	fn page(marks: &[(u32, u32, [u8; 3])]) -> RgbaImage {
		let mut image = RgbaImage::from_pixel(20, 20, Rgba([255; 4]));
		for &(x, y, [r, g, b]) in marks {
			image.put_pixel(x, y, Rgba([r, g, b, 255]));
		}
		image
	}

	#[test]
	fn paper_turns_see_through_and_black_turns_ink() {
		let mut image = page(&[(3, 3, [0, 0, 0]), (4, 3, [128, 128, 128])]);
		recolor(&mut image, LIGHT_INK, &[]);
		assert_eq!(image.get_pixel(0, 0)[3], 0, "paper");
		assert_eq!(image.get_pixel(3, 3).0, [230, 228, 220, 255], "black is the ink");
		let grey = image.get_pixel(4, 3).0;
		assert_eq!([grey[0], grey[1], grey[2]], LIGHT_INK, "a grey is thinner ink");
		assert!((126..=128).contains(&grey[3]), "{grey:?}");
	}

	#[test]
	fn a_color_keeps_its_hue_and_is_lifted_only_on_a_dark_sheet() {
		let mut on_dark = page(&[(3, 3, [0, 0, 255])]);
		recolor(&mut on_dark, LIGHT_INK, &[]);
		let [r, g, b, a] = on_dark.get_pixel(3, 3).0;
		assert!(r > 100 && g > 100 && b > r + 80 && b > g + 80 && a == 255, "a lighter blue: {r} {g} {b}");
		let mut on_light = page(&[(3, 3, [0, 0, 255])]);
		recolor(&mut on_light, DARK_INK, &[]);
		assert_eq!(on_light.get_pixel(3, 3).0, [0, 0, 255, 255]);
	}

	#[test]
	fn a_photo_stays_as_printed_and_a_drawing_on_white_does_not() {
		let photo = PixelBox { x0: 2, y0: 2, x1: 6, y1: 6 };
		let mut marks = Vec::new();
		for y in 2..6 {
			for x in 2..6 {
				marks.push((x, y, [90, 120, 60]));
			}
		}
		let mut image = page(&marks);
		recolor(&mut image, LIGHT_INK, &[photo]);
		assert_eq!(image.get_pixel(3, 3).0, [90, 120, 60, 255]);
		assert_eq!(image.get_pixel(10, 10)[3], 0, "the paper around it still clears");

		let drawing = PixelBox { x0: 8, y0: 8, x1: 18, y1: 18 };
		let mut image = page(&[(9, 9, [0, 0, 0])]);
		recolor(&mut image, LIGHT_INK, &[drawing]);
		assert_eq!(image.get_pixel(9, 9).0, [230, 228, 220, 255]);
	}

	#[test]
	fn a_page_that_is_not_light_stays_as_printed() {
		let mut image = RgbaImage::from_pixel(20, 20, Rgba([40, 90, 90, 255]));
		image.put_pixel(1, 1, Rgba([255; 4]));
		let before = image.clone();
		recolor(&mut image, LIGHT_INK, &[]);
		assert_eq!(image, before);
	}

	#[test]
	fn a_scans_grey_paper_clears_too() {
		let mut image = RgbaImage::from_pixel(20, 20, Rgba([238, 238, 238, 255]));
		image.put_pixel(5, 5, Rgba([20, 20, 20, 255]));
		let scan = PixelBox { x0: 0, y0: 0, x1: 20, y1: 20 };
		recolor(&mut image, LIGHT_INK, &[scan]);
		assert_eq!(image.get_pixel(0, 0)[3], 0);
		assert!(image.get_pixel(5, 5)[3] > 220);
	}
}
