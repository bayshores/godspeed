//! Shared by the integration tests: a `Pdf` on the lab's pdfium, or a skip.
//!
//! The library comes from the folder in `GODSPEED_PDFIUM_DIR`; unset, from the lab's
//! `rewrite-lab/pdfium` beside the worktree. A test without a library prints why and passes.

#![allow(dead_code)]

use std::path::{Path, PathBuf};

use gs_pdf::Pdf;

pub fn root() -> PathBuf {
	Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

pub fn fixture(name: &str) -> PathBuf {
	Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

pub fn pdf() -> Option<Pdf> {
	let dir = std::env::var_os("GODSPEED_PDFIUM_DIR").map(PathBuf::from).unwrap_or_else(|| root().join("../../rewrite-lab/pdfium"));
	if !dir.join("libpdfium.dylib").exists() && !dir.join("libpdfium.so").exists() && !dir.join("pdfium.dll").exists() {
		eprintln!("skipped: no pdfium library in {} (set GODSPEED_PDFIUM_DIR to the folder holding it)", dir.display());
		return None;
	}
	Some(Pdf::new(&dir))
}
