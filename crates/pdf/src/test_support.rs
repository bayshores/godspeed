//! The pdfium library for tests that read real PDFs, shared by the crates that have them.

use std::path::{Path, PathBuf};

use crate::Pdf;

/// A copy kept outside the repo, for machines that have not set `LH_PDFIUM_PATH`.
const LOCAL_COPY: &str = "/Users/seane/Code/learnharness/.claude/rewrite-lab/pdfium/libpdfium.dylib";

/// The folder holding the library at `LH_PDFIUM_PATH`, else the local copy. None, with a printed
/// line, when there is no library, so the test skips.
pub fn pdfium_dir() -> Option<PathBuf> {
	let library = std::env::var_os("LH_PDFIUM_PATH").map_or_else(|| Path::new(LOCAL_COPY).to_path_buf(), PathBuf::from);
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
