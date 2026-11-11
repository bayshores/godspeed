//! Taking the PDF an agent made for a cheat sheet: it must sit inside the sheet's working folder
//! (links resolved, so nothing outside can be read through it), be a real PDF within the size
//! cap, and have 1 to 4 pages of a sane size. Returns its bytes and page sizes, or why not.

use std::path::{Path, PathBuf};

use gs_agent::subagents::cheat_sheet_writer::TakenPdf;
use gs_base::fsx::{self, node_error_message};
use gs_core::study::cheat_sheet::pdf_problem;
use gs_json::{Json, json};

use crate::App;

/// The real path of `pdf_path` (relative to `folder`), when it is inside the folder.
fn inside(folder: &Path, pdf_path: &str) -> Result<PathBuf, String> {
	let none = || format!("There is no file at {pdf_path}.");
	let root = real_path(folder).ok_or_else(none)?;
	let file = real_path(&folder.join(pdf_path)).ok_or_else(none)?;
	if file == root || !file.starts_with(&root) {
		return Err(format!("Put the PDF inside the working folder, {}.", folder.to_string_lossy()));
	}
	Ok(file)
}

/// `fs.realpathSync`: links resolved, without Windows' long-path prefix.
fn real_path(path: &Path) -> Option<PathBuf> {
	std::fs::canonicalize(path).ok().map(fsx::without_long_prefix)
}

pub async fn take_sheet_pdf(app: &App, folder: &Path, pdf_path: &str) -> Result<TakenPdf, String> {
	let file = inside(folder, pdf_path)?;
	let stat = std::fs::metadata(&file).map_err(|e| node_error_message(&e, "stat", &file))?;
	if !stat.is_file() {
		return Err(format!("{pdf_path} is not a file."));
	}
	if let Some(too_big) = pdf_problem(stat.len(), None, None) {
		return Err(too_big);
	}
	let bytes = std::fs::read(&file).map_err(|e| node_error_message(&e, "open", &file))?;
	let size = bytes.len() as u64;
	let head: String = bytes.iter().take(5).map(|&b| char::from(b)).collect();
	if let Some(not_pdf) = pdf_problem(size, Some(&head), None) {
		return Err(not_pdf);
	}
	let sizes = app.pdf.pdf_page_sizes(&file).await.map_err(|e| format!("The PDF can't be read: {e}"))?;
	let pages: Vec<Json> = sizes.into_iter().map(|(width, height)| json!({ "widthPt": width, "heightPt": height })).collect();
	match pdf_problem(size, Some(&head), Some(&pages)) {
		Some(problem) => Err(problem),
		None => Ok(TakenPdf { bytes, pages, file: file.to_string_lossy().into_owned() }),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn only_files_inside_the_folder_count() {
		let root = std::env::temp_dir().join(format!("gs-sheet-pdf-{}", std::process::id()));
		let folder = root.join("sheet");
		std::fs::create_dir_all(&folder).unwrap();
		gs_base::fsx::write_atomic(&folder.join("a.pdf"), b"%PDF-1.4", None).unwrap();
		gs_base::fsx::write_atomic(&root.join("outside.pdf"), b"%PDF-1.4", None).unwrap();
		#[cfg(unix)]
		std::os::unix::fs::symlink(root.join("outside.pdf"), folder.join("link.pdf")).unwrap();

		let inside_path = inside(&folder, "a.pdf").unwrap();
		assert!(inside_path.ends_with(Path::new("sheet").join("a.pdf")));
		let wanted = format!("Put the PDF inside the working folder, {}.", folder.to_string_lossy());
		assert_eq!(inside(&folder, "../outside.pdf"), Err(wanted.clone()));
		#[cfg(unix)]
		assert_eq!(inside(&folder, "link.pdf"), Err(wanted.clone()));
		assert_eq!(inside(&folder, ""), Err(wanted));
		assert_eq!(inside(&folder, "missing.pdf"), Err("There is no file at missing.pdf.".to_owned()));
		std::fs::remove_dir_all(&root).unwrap();
	}
}
