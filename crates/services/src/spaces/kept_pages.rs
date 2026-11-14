//! The PDF reader's kept pages, server side: which space PDF a reading job's path is, and keeping
//! one more page of it (stored by `text_cache`, put into search by `pipeline`).

use std::path::Path;
use std::sync::Arc;

use gs_agent::subagents::runner::KeptPages;
use gs_files::fingerprint::fingerprint_file;

use super::files::{file_in, files_of, str_of};
use super::pipeline::reindex_kept_pages;
use super::space_card::space_file_path;
use super::text_cache::{read_kept_pages, write_kept_page};
use crate::App;
use crate::app::reading_pages::is_pdf;

/// The ready space PDF at `path` (through any link to it) whose content is still the version it
/// was read as, with that version's kept pages.
pub async fn kept_pages_at(app: &App, path: &Path) -> Option<KeptPages> {
	let wanted = tokio::fs::canonicalize(path).await.ok()?;
	for record in app.stores.spaces.list_space_records() {
		for file in files_of(&record) {
			let fp = str_of(file, "contentFp");
			if str_of(file, "status") != "ready" || fp.is_empty() || !is_pdf(Path::new(str_of(file, "name"))) {
				continue;
			}
			let Some(abs) = space_file_path(app, &record, file) else { continue };
			if tokio::fs::canonicalize(&abs).await.ok().as_ref() != Some(&wanted) {
				continue;
			}
			if fingerprint_file(&wanted).await.ok().as_deref() != Some(fp) {
				return None;
			}
			let (space_id, file_id) = (str_of(&record, "id"), str_of(file, "id"));
			return Some(KeptPages { space_id: space_id.to_owned(), file_id: file_id.to_owned(), fp: fp.to_owned(), pages: read_kept_pages(app, space_id, file_id, fp) });
		}
	}
	None
}

/// Keeps one page of the file, unless the file changed since the job looked it up, and starts
/// putting it into search.
pub fn keep_page(app: &Arc<App>, file: &KeptPages, page: u32, markdown: &str) -> Result<(), String> {
	let record = app.stores.spaces.get_space(&file.space_id);
	if record.as_ref().and_then(|r| file_in(r, &file.file_id)).is_none_or(|f| str_of(f, "contentFp") != file.fp) {
		return Err("the file changed or was removed while it was read, so nothing was saved".to_owned());
	}
	write_kept_page(app, &file.space_id, &file.file_id, &file.fp, page, markdown)?;
	reindex_kept_pages(app, &file.space_id, &file.file_id);
	Ok(())
}
