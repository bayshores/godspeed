//! Saved document text and recording transcripts: the text of one version of a file, named by
//! its content fingerprint, so processing an unchanged file again skips re-reading the document
//! or re-transcribing the recording.

use std::path::PathBuf;

use gs_base::fsx;

use super::class_card::transcript_path_of;
use crate::App;

fn text_cache_dir(app: &App, class_id: &str) -> Option<PathBuf> {
	Some(app.stores.classes.files_dir(class_id).ok()?.join("texts"))
}

/// ".v2": texts saved before PDF line breaks were kept are not reused.
fn text_cache_path(app: &App, class_id: &str, file_id: &str, fp: &str) -> Option<PathBuf> {
	Some(text_cache_dir(app, class_id)?.join(format!("{file_id}.{fp}.v2.txt")))
}

pub(super) fn read_cached_text(app: &App, class_id: &str, file_id: &str, fp: &str) -> Option<String> {
	fsx::read_text(&text_cache_path(app, class_id, file_id, fp)?).ok()
}

/// Removes every saved text of one file (all versions).
pub(super) fn drop_cached_texts(app: &App, class_id: &str, file_id: &str) {
	let Some(dir) = text_cache_dir(app, class_id) else { return };
	let Ok(entries) = std::fs::read_dir(&dir) else { return };
	let prefix = format!("{file_id}.");
	for entry in entries.flatten() {
		if entry.file_name().to_string_lossy().starts_with(&prefix) {
			let _ = std::fs::remove_file(entry.path());
		}
	}
}

/// Saves one version's text, replacing older versions'. Best effort: a failed write only costs a
/// re-read next time.
pub(super) fn write_cached_text(app: &App, class_id: &str, file_id: &str, fp: &str, text: &str) {
	drop_cached_texts(app, class_id, file_id);
	let Some(file) = text_cache_path(app, class_id, file_id, fp) else { return };
	if let Err(err) = fsx::write_text_atomic(&file, text) {
		eprintln!("[classes] could not save text of {file_id}: {err}");
	}
}

/// A recording's transcript and a document's saved text.
pub(super) fn drop_file_texts(app: &App, class_id: &str, file_id: &str) {
	if let Some(transcript) = transcript_path_of(app, class_id, file_id) {
		let _ = std::fs::remove_file(transcript);
	}
	drop_cached_texts(app, class_id, file_id);
}
