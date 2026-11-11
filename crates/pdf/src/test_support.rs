//! The pdfium library for tests that read real PDFs, shared by the crates that have them.

use std::path::{Path, PathBuf};

use crate::Pdf;

/// What `node scripts/fetch-pdfium.mjs` downloads, for machines that have not set `LH_PDFIUM_PATH`.
const STAGED_COPY: &str = if cfg!(windows) { "pdfium.dll" } else if cfg!(target_os = "macos") { "libpdfium.dylib" } else { "libpdfium.so" };

/// The folder holding the library at `LH_PDFIUM_PATH`, else the one in the repo's `.stage/`. None,
/// with a printed line, when there is no library, so the test skips.
pub fn pdfium_dir() -> Option<PathBuf> {
	let library = std::env::var_os("LH_PDFIUM_PATH").map_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.stage").join(STAGED_COPY), PathBuf::from);
	if library.is_file() {
		return library.parent().map(Path::to_path_buf);
	}
	eprintln!("skipped: pdfium was not found at {} (set LH_PDFIUM_PATH to the library file)", library.display());
	None
}

/// A `Pdf` on the library from `pdfium_dir`, or None when there is none.
pub fn shared_pdf() -> Option<Pdf> {
	pdfium_dir().map(|dir| Pdf::new(&dir))
}
