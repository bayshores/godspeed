//! Search indexing for a processed file: its text and kept pages go into the space's search index.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use gs_base::hash::sha256_text;
use gs_base::{fsx, tasks::detach};
use gs_core::contracts::space::{extension_of, is_recording_file, is_transcript_file};
use gs_core::spaces::kept_pages::with_kept_pages;
use gs_core::spaces::file_state::FileStatus;
use gs_json::Json;

use super::queue::{TextError, file_text, still_there};
use crate::spaces::files::file_in;
use crate::spaces::space_card::{space_file_path, transcript_path_of};
use crate::spaces::text_cache::read_kept_pages;
use crate::App;

/// Puts this version of a file (study or info) in the space's search index. `text` is the
/// pipeline's text when it was already read. Captions are indexed from the raw file (search keeps
/// their times); a recording only once its transcript exists (never transcribed for search alone).
/// Best effort: a failure is logged and the file goes on.
pub(super) async fn index_for_search(app: &Arc<App>, space_id: &str, file: &Json, abs: &Path, fp: &str, text: Option<&str>) {
	let (name, file_id) = (file["name"].str_or_empty(), file["id"].str_or_empty());
	let kept = if extension_of(name) == ".pdf" { read_kept_pages(app, space_id, file_id, fp) } else { BTreeMap::new() };
	let indexed_fp = indexed_fp(fp, &kept);
	if app.search.is_file_indexed(space_id, file_id, &indexed_fp) {
		return;
	}
	let source = if is_transcript_file(name) {
		fsx::read_text(abs).map_err(|err| fsx::node_error_message(&err, "open", abs))
	} else if let Some(text) = text {
		Ok(text.to_owned())
	} else if is_recording_file(name) {
		let Some(transcript) = transcript_path_of(app, space_id, file_id).filter(|t| t.exists()) else { return };
		fsx::read_text(&transcript).map_err(|err| fsx::node_error_message(&err, "open", &transcript))
	} else {
		file_text(app, space_id, file, abs, fp).await.map_err(|err| match err {
			TextError::WhisperMissing(message) | TextError::Failed(message) => message,
		})
	};
	let indexed = match source {
		Ok(source) => {
			let still_listed = || {
				let guard = app.locks.lock(gs_base::locks::LockKey::Space(space_id));
				still_there(app, space_id, file_id).then_some(guard)
			};
			app.search.index_space_file(space_id, file_id, name, &indexed_fp, &with_kept_pages(&source, &kept), still_listed).await
		}
		Err(err) => Err(err),
	};
	if let Err(err) = indexed {
		eprintln!("[spaces] could not index {name} for search: {err}");
	}
}

/// The version the index records: the file's fingerprint, and with kept pages also a hash of them,
/// so a newly kept page brings one new index and an unchanged set none.
fn indexed_fp(fp: &str, kept: &BTreeMap<u32, String>) -> String {
	if kept.is_empty() {
		return fp.to_owned();
	}
	let pages: String = kept.iter().map(|(page, markdown)| format!("{page}\n{}\n", sha256_text(markdown))).collect();
	format!("{fp}+{}", &sha256_text(&pages)[..16])
}

/// Puts a file's newly kept page into search, in the background. These re-indexes run one at a
/// time, each reading the kept pages when its turn comes, so the last one to run has every page.
pub(in crate::spaces) fn reindex_kept_pages(app: &Arc<App>, space_id: &str, file_id: &str) {
	static ONE_AT_A_TIME: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
	let Some(record) = app.stores.spaces.get_space(space_id) else { return };
	let Some(file) = file_in(&record, file_id).cloned() else { return };
	let Some(abs) = space_file_path(app, &record, &file) else { return };
	let (app, space_id) = (app.clone(), space_id.to_owned());
	detach("spaces", async move {
		let _turn = ONE_AT_A_TIME.lock().await;
		index_for_search(&app, &space_id, &file, Path::new(&abs), file["contentFp"].str_or_empty(), None).await;
	});
}

/// Indexes every processed file the search index lacks (spaces from before search, a failed
/// index), one file at a time in the background.
pub(super) async fn index_unindexed_files(app: &Arc<App>) {
	for summary in app.stores.spaces.list_spaces() {
		if summary["closed"].truthy() {
			continue;
		}
		let Some(record) = app.stores.spaces.get_space(summary["id"].str_or_empty()) else { continue };
		for file in record["files"].items() {
			if !matches!(FileStatus::of(file), Some(FileStatus::Ready | FileStatus::Failed)) || !file["contentFp"].truthy() {
				continue;
			}
			if let Some(abs) = space_file_path(app, &record, file).filter(|p| Path::new(p).exists()) {
				index_for_search(app, record["id"].str_or_empty(), file, Path::new(&abs), file["contentFp"].str_or_empty(), None).await;
			}
		}
	}
}

#[cfg(test)]
mod tests {
	use gs_base::clock;
	use gs_core::spaces::file_state::FileKind;
	use gs_search::index::PassageRef;

	use super::*;
	use crate::app::test_support::scratch_dir;
	use crate::spaces::files::replace_copied_file;
	use crate::spaces::space_search::space_search;
	use crate::spaces::text_cache::{read_cached_text, write_cached_text};
	use crate::spaces::{keep_page, kept_pages_at, write_agent_file};

	/// The folder the search model loads from: the repo root, which holds `models/`.
	#[cfg(not(any(target_os = "linux", all(target_os = "macos", target_arch = "x86_64"))))]
	fn resources(_root: &Path, repo: &Path) -> std::path::PathBuf {
		repo.to_owned()
	}

	/// Linux and Intel Macs also load ONNX Runtime from beside the model, so there the folder
	/// links to `models/` and to the copy `node scripts/fetch-onnxruntime.mjs` puts in `.stage/`.
	#[cfg(any(target_os = "linux", all(target_os = "macos", target_arch = "x86_64")))]
	fn resources(root: &Path, repo: &Path) -> std::path::PathBuf {
		use std::os::unix::fs::symlink;
		#[cfg(target_os = "linux")]
		let library = root.join("res/libonnxruntime.so");
		#[cfg(target_os = "macos")]
		let library = root.join("Frameworks/libonnxruntime.dylib");
		std::fs::create_dir_all(root.join("res")).unwrap();
		std::fs::create_dir_all(library.parent().unwrap()).unwrap();
		symlink(repo.join("models"), root.join("res/models")).unwrap();
		symlink(repo.join(".stage").join(library.file_name().unwrap()), &library).unwrap();
		root.join("res")
	}

	#[tokio::test]
	async fn a_book_is_read_once_and_searched_by_section() {
		let root = scratch_dir("epub");
		let repo = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
		let app = App::new(gs_base::config::Paths::new(root.join("data"), root.join("home"), root.join("tmp"), resources(&root, repo)), None);
		let space_id = app.stores.spaces.create_space(&gs_json::json!({ "name": "Discrete math" })).unwrap()["id"].as_str().unwrap().to_owned();
		let book = std::fs::read(repo.join("tests/fixtures/sample-book.epub")).unwrap();
		let file_id = write_agent_file(&app, &space_id, "Sample Book.epub", &book, FileKind::Info).unwrap().0["id"].as_str().unwrap().to_owned();
		let mut fp = String::new();
		for _ in 0..600 {
			let record = app.stores.spaces.get_space(&space_id).unwrap();
			let file = file_in(&record, &file_id).unwrap();
			fp = file["contentFp"].str_or_empty().to_owned();
			if !fp.is_empty() && app.search.is_file_indexed(&space_id, &file_id, &fp) {
				break;
			}
			clock::sleep(50).await;
		}
		assert_eq!(app.search.file_extents(&space_id).get(&file_id), Some(&Json::from("2 sections")));
		let saved = read_cached_text(&app, &space_id, &file_id, &fp).unwrap();
		assert_eq!(
			saved,
			"--- Section 1 ---\nSets\nA set is a collection of distinct objects, called its elements.\nThe empty set has no elements & is written \u{2205}.\n\n--- Section 2 ---\nLogic\nA proposition is a statement that is either true or false.\nConjunction: p and q\nDisjunction: p or q"
		);
		let second = app.search.passages_at(&space_id, &PassageRef::Place { file_id: file_id.clone(), range: "section 2".into() });
		assert_eq!((second.len(), second[0]["range"].as_str(), second[0]["text"].as_str().map(|t| t.starts_with("Logic\nA proposition"))), (1, Some("section 2"), Some(true)));
	}

	async fn wait_indexed(app: &App, space_id: &str, file_id: &str, fp: &str) {
		for _ in 0..600 {
			if app.search.is_file_indexed(space_id, file_id, fp) {
				return;
			}
			clock::sleep(50).await;
		}
		panic!("{file_id} was not indexed as {fp}");
	}

	#[tokio::test]
	async fn a_kept_page_is_searched_from_one_index_and_goes_when_the_file_changes() {
		let root = scratch_dir("kept-pages");
		let repo = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
		let app = App::new(gs_base::config::Paths::new(root.join("data"), root.join("home"), root.join("tmp"), resources(&root, repo)), None);
		let space_id = app.stores.spaces.create_space(&gs_json::json!({ "name": "Physics" })).unwrap()["id"].as_str().unwrap().to_owned();
		let pdf = std::fs::read(repo.join("tests/fixtures/sample-3page.pdf")).unwrap();
		let fp = gs_base::hash::sha256_hex(&pdf)[..16].to_owned();
		let file_id = write_agent_file(&app, &space_id, "Lecture 1.pdf", &pdf, FileKind::Info).unwrap().0["id"].as_str().unwrap().to_owned();
		// The PDF's text, saved before the queue first runs, so no PDF library is needed here.
		write_cached_text(&app, &space_id, &file_id, &fp, "--- Page 1 ---\nOne.\n--- Page 2 ---\nForce is F \u{25a0} ma.\n--- Page 3 ---\nThree.");
		wait_indexed(&app, &space_id, &file_id, &fp).await;
		let page_two = || app.search.passages_at(&space_id, &PassageRef::Place { file_id: file_id.clone(), range: "p. 2".into() }).remove(0);
		let before = page_two();
		let record = app.stores.spaces.get_space(&space_id).unwrap();
		let abs = space_file_path(&app, &record, file_in(&record, &file_id).unwrap()).unwrap();
		// A lesson reading a page whose formula lost a glyph has it looked at first; the cheat sheet
		// writer, and a lesson whose pdf tool the learner switched off, get no line.
		let read = |range: &str, lesson: bool| (space_search(&app, &space_id, lesson).read_passage)(PassageRef::Place { file_id: file_id.clone(), range: range.into() });
		let note = format!("\n\nFormulas on p. 2 of Lecture 1.pdf may read broken here. Before you teach from them, have the page looked at with `pdf` (path: {abs}).");
		assert!(read("p. 2", true).ends_with(&note));
		assert!(!read("p. 2", false).contains("Formulas on") && !read("p. 1", true).contains("Formulas on"));

		let kept = kept_pages_at(&app, Path::new(&abs)).await.unwrap();
		assert!(kept.pages.is_empty());
		// A same-named copy somewhere else is another file.
		let copy = root.join("elsewhere").join(Path::new(&abs).file_name().unwrap());
		std::fs::create_dir_all(copy.parent().unwrap()).unwrap();
		std::fs::copy(&abs, &copy).unwrap();
		assert!(kept_pages_at(&app, &copy).await.is_none());
		keep_page(&app, &kept, 2, "Force is $F = ma$.").unwrap();
		let kept_fp = indexed_fp(&fp, &read_kept_pages(&app, &space_id, &file_id, &fp));
		wait_indexed(&app, &space_id, &file_id, &kept_fp).await;
		let after = page_two();
		assert_eq!((&after["id"], after["text"].as_str()), (&before["id"], Some("Force is $F = ma$.")));
		assert!(!read("p. 2", true).contains("Formulas on"), "a kept page");
		assert_eq!(kept_pages_at(&app, Path::new(&abs)).await.unwrap().pages.into_iter().collect::<Vec<_>>(), [(2, "Force is $F = ma$.".to_owned())]);
		// The next scan finds that index and leaves the table alone.
		let table = app.paths.data.join("spaces").join(&space_id).join("search/passages.json");
		let written = std::fs::metadata(&table).unwrap().modified().unwrap();
		index_unindexed_files(&app).await;
		assert_eq!(std::fs::metadata(&table).unwrap().modified().unwrap(), written);

		// A new version has no kept pages, and a keep for the old one is refused.
		let changed = [pdf.as_slice(), b"\n% changed\n"].concat();
		let new_fp = gs_base::hash::sha256_hex(&changed)[..16].to_owned();
		replace_copied_file(&app, &space_id, &file_id, &changed, FileKind::Info).unwrap();
		write_cached_text(&app, &space_id, &file_id, &new_fp, "--- Page 1 ---\nOne.\n--- Page 2 ---\nForce, changed.\n--- Page 3 ---\nThree.");
		wait_indexed(&app, &space_id, &file_id, &new_fp).await;
		assert_eq!(page_two()["text"].as_str(), Some("Force, changed."));
		assert!(kept_pages_at(&app, Path::new(&abs)).await.unwrap().pages.is_empty());
		assert!(read_kept_pages(&app, &space_id, &file_id, &fp).is_empty());
		assert_eq!(keep_page(&app, &kept, 2, "Old."), Err("the file changed or was removed while it was read, so nothing was saved".to_owned()));
	}
}
