//! Shared by the integration tests: a `Pdf` on the shared pdfium library, or a skip.

use std::path::{Path, PathBuf};

pub use gs_pdf::test_support::shared_pdf as pdf;

pub fn fixture(name: &str) -> PathBuf {
	Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}
