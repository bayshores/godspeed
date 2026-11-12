//! The pages behind the lesson's "agent at work" view: the file the teacher is reading, as text or
//! as rendered PDF pages. Only plain files under the learner's home are served (the same anchor
//! the read tool resolves against), never anything inside a dot folder.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use gs_agent::fs_tools::fs_shared::resolve_source_path;
use gs_base::config::resolve;
use gs_base::{fsx, text};
use gs_json::{Json, json};

use crate::App;

const TEXT_MAX_BYTES: u64 = 2 * 1024 * 1024;
const PAGE_DPI: f64 = 100.0;
const CACHE_LIMIT: usize = 48;

/// Why a file or page can't be shown.
#[derive(Debug, PartialEq)]
pub enum ReadingError {
	/// A status and the words for the window.
	Refused(u16, &'static str),
	/// Reading or rendering broke.
	Failed(String),
}

struct Servable {
	absolute: PathBuf,
	mtime_ms: f64,
	size: u64,
}

fn is_hidden_or_outside(home: &Path, absolute: &Path) -> bool {
	match absolute.strip_prefix(home) {
		Ok(inside) => inside.as_os_str().is_empty() || inside.components().any(|part| part.as_os_str().to_string_lossy().starts_with('.')),
		Err(_) => true,
	}
}

async fn servable(app: &App, raw_path: &str) -> Result<Servable, ReadingError> {
	let absolute = resolve(&resolve_source_path(Some(raw_path)));
	if is_hidden_or_outside(&resolve(&app.paths.home), &absolute) {
		return Err(ReadingError::Refused(403, "Not a file the teacher can show"));
	}
	let meta = tokio::fs::metadata(&absolute).await.ok().filter(std::fs::Metadata::is_file).ok_or(ReadingError::Refused(404, "No such file"))?;
	Ok(Servable { absolute, mtime_ms: mtime_ms(&meta), size: meta.len() })
}

/// `stat.mtimeMs`.
pub(crate) fn mtime_ms(meta: &std::fs::Metadata) -> f64 {
	meta.modified().ok().and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

pub(crate) fn is_pdf(file: &Path) -> bool {
	file.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
}

/// The whole document: `{ kind: "text", text }`, or a PDF's `{ kind: "pdf", pageCount, aspect }`.
pub async fn reading_document(app: &App, raw_path: &str) -> Result<Json, ReadingError> {
	let Servable { absolute, size, .. } = servable(app, raw_path).await?;
	if is_pdf(&absolute) {
		let shape = app.pdf.pdf_shape(&absolute).await.map_err(|_| ReadingError::Refused(415, "Unreadable PDF"))?;
		return Ok(json!({ "kind": "pdf", "pageCount": shape.page_count, "aspect": shape.aspect }));
	}
	if size > TEXT_MAX_BYTES {
		return Err(ReadingError::Refused(413, "File too large"));
	}
	let bytes = tokio::fs::read(&absolute).await.map_err(|err| ReadingError::Failed(fsx::node_error_message(&err, "open", &absolute)))?;
	let contents = text::from_utf8_lossy(&bytes);
	if contents.contains('\0') {
		return Err(ReadingError::Refused(415, "Not a text file"));
	}
	Ok(json!({ "kind": "text", "text": contents }))
}

/// One page of a PDF at `absolute` as a PNG, cached by file version.
pub(crate) async fn render_pdf_page(app: &App, absolute: &Path, mtime_ms: f64, page: i64) -> Result<Arc<Vec<u8>>, ReadingError> {
	let key = format!("{}:{mtime_ms}:{page}", absolute.display());
	if let Some((_, png)) = app.misc.pages.lock().iter().find(|(cached, _)| *cached == key) {
		return Ok(png.clone());
	}
	let rendered = app.pdf.render_pdf_pages(absolute, &[page], Some(PAGE_DPI)).await.map_err(ReadingError::Failed)?;
	let png = Arc::new(rendered.into_iter().next().ok_or(ReadingError::Refused(404, "No such page"))?.png);
	let mut cache = app.misc.pages.lock();
	cache.push_back((key, png.clone()));
	if cache.len() > CACHE_LIMIT {
		cache.pop_front();
	}
	Ok(png)
}

/// One PDF page of a file the teacher may show, as a PNG.
pub async fn reading_pdf_page(app: &App, raw_path: &str, page: i64) -> Result<Arc<Vec<u8>>, ReadingError> {
	let Servable { absolute, mtime_ms, .. } = servable(app, raw_path).await?;
	if !is_pdf(&absolute) {
		return Err(ReadingError::Refused(415, "Not a PDF"));
	}
	render_pdf_page(app, &absolute, mtime_ms, page).await
}

/// The digits as a number in `radix`, or None when there are none or one is not valid.
fn whole_in_base(digits: &str, radix: u32) -> Option<f64> {
	if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
		return None;
	}
	u64::from_str_radix(digits, radix).ok().map(|n| n as f64)
}

/// JavaScript's `Number(text)` when it is a whole number from 1 (a page), else None.
pub fn parse_page(raw: &str) -> Option<i64> {
	let trimmed = text::trim(raw);
	let number = match trimmed.get(..2).map(str::to_ascii_lowercase).as_deref() {
		Some("0x") => whole_in_base(&trimmed[2..], 16)?,
		Some("0o") => whole_in_base(&trimmed[2..], 8)?,
		Some("0b") => whole_in_base(&trimmed[2..], 2)?,
		_ if trimmed.chars().all(|c| c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '+' | '-')) => trimmed.parse::<f64>().ok()?,
		_ => return None,
	};
	(number.is_finite() && number.fract() == 0.0 && number >= 1.0).then_some(number as i64)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn a_page_is_a_whole_number_from_one_as_javascript_reads_it() {
		for (raw, page) in [("1", Some(1)), (" 12 ", Some(12)), ("3.0", Some(3)), ("1e1", Some(10)), ("0x10", Some(16)), ("0b11", Some(3)), ("0o7", Some(7)), ("+2", Some(2))] {
			assert_eq!(parse_page(raw), page, "{raw}");
		}
		for raw in ["", "0", "-1", "1.5", "abc", "NaN", "Infinity", "inf", "1e999", "0x", "0x+1", "1_000", "--1", "."] {
			assert_eq!(parse_page(raw), None, "{raw}");
		}
	}

	#[test]
	fn only_plain_files_under_home_may_be_shown() {
		let home = Path::new("/home/a");
		assert!(is_hidden_or_outside(home, Path::new("/home/a")));
		assert!(is_hidden_or_outside(home, Path::new("/home/b/x.txt")));
		assert!(is_hidden_or_outside(home, Path::new("/home/ab/x.txt")));
		assert!(is_hidden_or_outside(home, Path::new("/home/a/.ssh/key")));
		assert!(is_hidden_or_outside(home, Path::new("/home/a/notes/.hidden")));
		assert!(!is_hidden_or_outside(home, Path::new("/home/a/notes/x.txt")));
	}

	#[tokio::test]
	async fn text_comes_back_whole_and_the_refusals_have_their_words() {
		let root = scratch_dir("reading-text");
		let app = test_app(&root);
		let home = root.join("home");
		crate::app::disk::write_file_atomic(&home.join("notes/a.txt"), "hello\nworld").unwrap();
		crate::app::disk::write_file_atomic(&home.join("notes/zero.txt"), "a\0b").unwrap();
		crate::app::disk::write_file_atomic(&home.join(".hidden/a.txt"), "x").unwrap();
		let shown = reading_document(&app, &home.join("notes/a.txt").to_string_lossy()).await.unwrap();
		assert_eq!(gs_json::stringify(&shown), r#"{"kind":"text","text":"hello\nworld"}"#);
		let refused = |path: PathBuf| {
			let app = &app;
			async move { reading_document(app, &path.to_string_lossy()).await }
		};
		assert_eq!(refused(home.join("notes/zero.txt")).await, Err(ReadingError::Refused(415, "Not a text file")));
		assert_eq!(refused(home.join("notes/none.txt")).await, Err(ReadingError::Refused(404, "No such file")));
		assert_eq!(refused(home.join("notes")).await, Err(ReadingError::Refused(404, "No such file")));
		assert_eq!(refused(home.join(".hidden/a.txt")).await, Err(ReadingError::Refused(403, "Not a file the teacher can show")));
		assert_eq!(refused(root.join("data/settings.json")).await, Err(ReadingError::Refused(403, "Not a file the teacher can show")));
		assert_eq!(reading_pdf_page(&app, &home.join("notes/a.txt").to_string_lossy(), 1).await, Err(ReadingError::Refused(415, "Not a PDF")));
	}

	#[tokio::test]
	async fn a_text_file_over_two_megabytes_is_too_large() {
		let root = scratch_dir("reading-large");
		let app = test_app(&root);
		let big = root.join("home/big.txt");
		crate::app::disk::write_file_atomic(&big, &"x".repeat(TEXT_MAX_BYTES as usize + 1)).unwrap();
		assert_eq!(reading_document(&app, &big.to_string_lossy()).await, Err(ReadingError::Refused(413, "File too large")));
	}
}
