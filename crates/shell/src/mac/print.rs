//! Printing a PDF: not available yet.

use std::path::Path;

use tauri::WebviewWindow;

#[expect(dead_code, reason = "the print command calls it")]
pub fn print_pdf(_window: &WebviewWindow, _path: &Path) -> Result<(), String> {
	Err("printing is not available".to_owned())
}
