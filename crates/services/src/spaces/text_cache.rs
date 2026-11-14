//! Saved document text and recording transcripts: the text of one version of a file, named by
//! its content fingerprint, so processing an unchanged file again skips re-reading the document
//! or re-transcribing the recording. Beside a PDF's text sit its kept pages, the pages the PDF
//! reader wrote out as Markdown with LaTeX for that version.

use std::collections::BTreeMap;
use std::path::PathBuf;

use gs_base::fsx;

use super::space_card::transcript_path_of;
use crate::App;

fn text_cache_dir(app: &App, space_id: &str) -> Option<PathBuf> {
	Some(app.stores.spaces.files_dir(space_id).ok()?.join("texts"))
}

/// ".v2": texts saved before PDF line breaks were kept are not reused.
fn text_cache_path(app: &App, space_id: &str, file_id: &str, fp: &str) -> Option<PathBuf> {
	Some(text_cache_dir(app, space_id)?.join(format!("{file_id}.{fp}.v2.txt")))
}

/// Kept pages are named `<file_id>.<fp>.p<N>.md`.
fn kept_page_prefix(file_id: &str, fp: &str) -> String {
	format!("{file_id}.{fp}.p")
}

pub(super) fn read_cached_text(app: &App, space_id: &str, file_id: &str, fp: &str) -> Option<String> {
	fsx::read_text(&text_cache_path(app, space_id, file_id, fp)?).ok()
}

/// This version's kept pages, by page number.
pub(super) fn read_kept_pages(app: &App, space_id: &str, file_id: &str, fp: &str) -> BTreeMap<u32, String> {
	let Some(entries) = text_cache_dir(app, space_id).and_then(|dir| std::fs::read_dir(dir).ok()) else { return BTreeMap::new() };
	let prefix = kept_page_prefix(file_id, fp);
	entries
		.flatten()
		.filter_map(|entry| {
			let name = entry.file_name().into_string().ok()?;
			let page = name.strip_prefix(&prefix)?.strip_suffix(".md")?.parse().ok()?;
			Some((page, fsx::read_text(&entry.path()).ok()?))
		})
		.collect()
}

pub(super) fn write_kept_page(app: &App, space_id: &str, file_id: &str, fp: &str, page: u32, markdown: &str) -> Result<(), String> {
	let dir = text_cache_dir(app, space_id).ok_or_else(|| format!("Invalid space id: {space_id}"))?;
	fsx::write_text_atomic(&dir.join(format!("{}{page}.md", kept_page_prefix(file_id, fp))), markdown).map_err(|err| err.to_string())
}

/// Removes every saved text and kept page of one file, except the kept pages of version `keep_fp`.
fn drop_cached_texts(app: &App, space_id: &str, file_id: &str, keep_fp: Option<&str>) {
	let Some(dir) = text_cache_dir(app, space_id) else { return };
	let Ok(entries) = std::fs::read_dir(&dir) else { return };
	let prefix = format!("{file_id}.");
	let kept = keep_fp.map(|fp| kept_page_prefix(file_id, fp));
	for entry in entries.flatten() {
		let name = entry.file_name().to_string_lossy().into_owned();
		if name.starts_with(&prefix) && !kept.as_ref().is_some_and(|kept| name.starts_with(kept.as_str())) {
			let _ = std::fs::remove_file(entry.path());
		}
	}
}

/// Saves one version's text, replacing older versions' texts and kept pages. Best effort: a failed
/// write only costs a re-read next time.
pub(super) fn write_cached_text(app: &App, space_id: &str, file_id: &str, fp: &str, text: &str) {
	drop_cached_texts(app, space_id, file_id, Some(fp));
	let Some(file) = text_cache_path(app, space_id, file_id, fp) else { return };
	if let Err(err) = fsx::write_text_atomic(&file, text) {
		eprintln!("[spaces] could not save text of {file_id}: {err}");
	}
}

/// A recording's transcript and a document's saved text.
pub(super) fn drop_file_texts(app: &App, space_id: &str, file_id: &str) {
	if let Some(transcript) = transcript_path_of(app, space_id, file_id) {
		let _ = std::fs::remove_file(transcript);
	}
	drop_cached_texts(app, space_id, file_id, None);
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn kept_pages_live_and_go_with_their_version() {
		let root = scratch_dir("kept-pages");
		let app = test_app(&root);
		let space = app.stores.spaces.create_space(&gs_json::json!({ "name": "Made-up Space" })).unwrap()["id"].as_str().unwrap().to_owned();
		let (file, other) = ("f_aaaaaaaaaaaa", "f_bbbbbbbbbbbb");
		write_cached_text(&app, &space, file, "fp1", "--- Page 1 ---\nOne");
		write_kept_page(&app, &space, file, "fp1", 2, "$$e^{i\\pi} = -1$$").unwrap();
		write_kept_page(&app, &space, file, "fp1", 12, "Twelve").unwrap();
		write_kept_page(&app, &space, other, "fp1", 2, "Not this file").unwrap();
		assert_eq!(read_kept_pages(&app, &space, file, "fp1"), BTreeMap::from([(2, "$$e^{i\\pi} = -1$$".to_owned()), (12, "Twelve".to_owned())]));
		assert!(read_kept_pages(&app, &space, file, "fp2").is_empty());
		// The same version read again keeps its pages; a new version drops them.
		write_cached_text(&app, &space, file, "fp1", "--- Page 1 ---\nOne");
		assert_eq!(read_kept_pages(&app, &space, file, "fp1").len(), 2);
		write_cached_text(&app, &space, file, "fp2", "--- Page 1 ---\nOne, changed");
		assert!(read_kept_pages(&app, &space, file, "fp1").is_empty());
		assert_eq!(read_cached_text(&app, &space, file, "fp2").as_deref(), Some("--- Page 1 ---\nOne, changed"));
		drop_file_texts(&app, &space, other);
		assert!(read_kept_pages(&app, &space, other, "fp1").is_empty());
	}
}
