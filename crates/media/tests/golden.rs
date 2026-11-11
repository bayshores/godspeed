//! Parity with Node: the cases in tests/golden/*.json come from the real TypeScript
//! (scripts/golden.ts runs the *.golden.ts beside them). Sharp's pixels are not reproduced
//! byte for byte, so the picture cases compare type, size and sampled pixels.

use gs_json::{Json, parse};
use gs_media::attach::normalize_image;
use gs_media::png::provider_safe_png;
use gs_media::svg::{RenderSvgOptions, render_svg, svg_viewport};
use image::GenericImageView;

mod base64;

fn cases(spec: &str) -> Vec<Json> {
	let path = format!("{}/tests/golden/{spec}.json", env!("CARGO_MANIFEST_DIR"));
	parse(&std::fs::read_to_string(path).unwrap()).unwrap().as_arr().unwrap().to_vec()
}

fn s(v: &Json) -> &str {
	v.as_str().unwrap()
}

#[test]
fn provider_safe_png_matches_node() {
	for c in cases("png") {
		let out = &c["output"];
		let got = provider_safe_png(&base64::decode(s(&out["input"])));
		assert_eq!(got, base64::decode(s(&out["output"])), "{}", s(&c["name"]));
	}
}

/// The pixel at (fx, fy) of the picture as RGBA, 8 bits.
fn pixel(img: &image::DynamicImage, fx: f64, fy: f64) -> [u8; 4] {
	let (w, h) = img.dimensions();
	img.get_pixel((f64::from(w) * fx).floor() as u32, (f64::from(h) * fy).floor() as u32).0
}

#[test]
fn normalize_image_matches_sharp() {
	for c in cases("attach") {
		let name = s(&c["name"]);
		let want = &c["output"];
		let got = normalize_image("pic", &base64::decode(s(&want["input"])));
		if want["error"].as_str().is_some() {
			assert_eq!(got.err().as_deref(), want["error"].as_str(), "{name}");
			continue;
		}
		let got = got.unwrap_or_else(|e| panic!("{name}: {e}"));
		assert_eq!(got.mime_type, s(&want["mimeType"]), "{name}: type");
		let img = image::load_from_memory(&got.bytes).unwrap();
		assert_eq!(img.dimensions(), (want["width"].as_i64().unwrap() as u32, want["height"].as_i64().unwrap() as u32), "{name}: size");
		assert_eq!(i64::from(img.color().channel_count()), want["channels"].as_i64().unwrap(), "{name}: channels");
		let tolerance = if got.mime_type == "image/jpeg" { 14 } else { 6 };
		for (k, sample) in want["samples"].as_arr().unwrap().iter().enumerate() {
			let px = pixel(&img, [0.25, 0.75][k % 2], [0.25, 0.75][k / 2]);
			let sample: Vec<i64> = sample.as_arr().unwrap().iter().map(|v| v.as_i64().unwrap()).collect();
			// A fully clear pixel has no colour to compare.
			let compared = if sample[3] == 0 { 3..4 } else { 0..4 };
			for i in compared {
				assert!((i64::from(px[i]) - sample[i]).abs() <= tolerance, "{name}: sample {k} channel {i}: got {px:?} want {sample:?}");
			}
		}
	}
}

fn options(v: &Json) -> RenderSvgOptions {
	RenderSvgOptions { width: v["width"].as_f64(), height: v["height"].as_f64() }
}

#[test]
fn svg_viewport_matches_node() {
	let cases = cases("svg");
	let cases = cases.iter().find(|c| c["name"].as_str() == Some("viewport")).unwrap()["output"].as_arr().unwrap();
	for c in cases {
		let got = svg_viewport(s(&c["svg"]), options(&c["opts"]));
		assert_eq!(got, (c["width"].as_f64().unwrap(), c["height"].as_f64().unwrap()), "{}", s(&c["name"]));
	}
}

fn idat_count(png: &[u8]) -> usize {
	let (mut at, mut count) = (8, 0);
	while at + 12 <= png.len() {
		count += usize::from(&png[at + 4..at + 8] == b"IDAT");
		at += 12 + u32::from_be_bytes(png[at..at + 4].try_into().unwrap()) as usize;
	}
	count
}

#[test]
fn render_svg_matches_resvg_js() {
	let cases = cases("svg");
	let figures = cases.iter().find(|c| c["name"].as_str() == Some("figures")).unwrap()["output"].as_arr().unwrap();
	for c in figures {
		let name = s(&c["name"]);
		let got = render_svg(s(&c["svg"]), options(&c["opts"]));
		if c["error"].as_str().is_some() {
			assert!(got.is_err(), "{name}: should not render");
			continue;
		}
		let got = got.unwrap_or_else(|e| panic!("{name}: {e}"));
		assert_eq!(idat_count(&got), 1, "{name}: one IDAT");
		let (got, want) = (image::load_from_memory(&got).unwrap().to_rgba8(), image::load_from_memory(&base64::decode(s(&c["png"]))).unwrap().to_rgba8());
		assert_eq!(got.dimensions(), (c["width"].as_i64().unwrap() as u32, c["height"].as_i64().unwrap() as u32), "{name}: size");
		// Which font a generic family lands on is the machine's choice, so text is only checked for ink.
		if name.starts_with("text") {
			assert!(got.pixels().any(|p| p.0 != [255, 255, 255, 255]), "{name}: no text drawn");
			continue;
		}
		// Another resvg release anti-aliases edges a little differently.
		let far = got.pixels().zip(want.pixels()).filter(|(a, b)| a.0.iter().zip(b.0).any(|(&x, y)| x.abs_diff(y) > 24)).count();
		assert!(far * 50 <= got.pixels().len(), "{name}: {far} of {} pixels differ", got.pixels().len());
	}
}
