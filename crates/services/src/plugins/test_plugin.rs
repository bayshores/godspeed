//! A small plugin for this module's tests: its manifest, a zip builder and an installed copy.

use gs_json::{Json, stringify};

use super::install::install_from_folder;
use crate::App;

/// The "memes" lesson plugin's manifest, with `overrides` laid over it.
pub fn manifest_text(overrides: &Json) -> String {
	let mut manifest = gs_json::json!({
		"id": "memes",
		"name": "Memes",
		"version": "0.1.0",
		"description": "Turns the question into a meme.",
		"author": "808arc",
		"entry": "index.html",
		"lesson": { "label": "Memes" },
		"network": ["api.memegen.link"],
		"uses": ["agent"],
	});
	for (key, value) in overrides.as_obj().into_iter().flat_map(|o| o.iter()) {
		manifest.as_obj_mut().unwrap().insert(key.as_str(), value.clone());
	}
	stringify(&manifest)
}

/// A zip of stored (uncompressed) entries.
pub fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
	let (mut out, mut central) = (Vec::new(), Vec::new());
	let u16le = |v: usize| (v as u16).to_le_bytes();
	let u32le = |v: usize| (v as u32).to_le_bytes();
	for (name, data) in entries {
		let offset = out.len();
		out.extend_from_slice(&[0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		out.extend_from_slice(&u32le(data.len()));
		out.extend_from_slice(&u32le(data.len()));
		out.extend_from_slice(&u16le(name.len()));
		out.extend_from_slice(&[0, 0]);
		out.extend_from_slice(name.as_bytes());
		out.extend_from_slice(data);
		central.extend_from_slice(&[0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		central.extend_from_slice(&u32le(data.len()));
		central.extend_from_slice(&u32le(data.len()));
		central.extend_from_slice(&u16le(name.len()));
		central.extend_from_slice(&[0; 12]);
		central.extend_from_slice(&u32le(offset));
		central.extend_from_slice(name.as_bytes());
	}
	let at = out.len();
	out.extend_from_slice(&central);
	out.extend_from_slice(&[0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]);
	out.extend_from_slice(&u16le(entries.len()));
	out.extend_from_slice(&u16le(entries.len()));
	out.extend_from_slice(&u32le(central.len()));
	out.extend_from_slice(&u32le(at));
	out.extend_from_slice(&[0, 0]);
	out
}

/// Installs the "memes" plugin from a folder beside the app's data and returns its manifest.
pub fn install_test_plugin(app: &App, overrides: &Json) -> Json {
	let src = app.paths.data.parent().unwrap().join("memes-src");
	gs_base::fsx::write_text_atomic(&src.join("manifest.json"), &manifest_text(overrides)).unwrap();
	gs_base::fsx::write_text_atomic(&src.join("index.html"), "<!doctype html>").unwrap();
	install_from_folder(app, src.to_str().unwrap()).unwrap()["manifest"].clone()
}
