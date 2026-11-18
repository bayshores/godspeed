//! THE FILE PIPELINE (spaces.ts): file → text (gs_files, gs_transcribe) → the notes import into
//! the space's own graph. Study files become facts; space info never does. Both go into the
//! space's search index. Work is serialized per space (one queue each): the file list is a
//! read-modify-write record, and one space's imports shouldn't flood the shared extraction slots.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use gs_base::hash::sha256_text;
use gs_base::tasks::detach;
use gs_base::{clock, fsx};
use gs_core::spaces::kept_pages::with_kept_pages;
use gs_core::spaces::lecture_transcript::transcript_for;
use gs_core::contracts::space::{DOCUMENT_EXTENSIONS, FILE_NOT_FOUND, extension_of, is_recording_file, is_transcript_file};
use gs_files::fingerprint::fingerprint_file;
use gs_files::text::file_to_text;
use gs_agent::extraction::extraction::NotesImportInput;
use gs_json::Json;
use gs_transcribe::run::{TranscribeError, transcribe_recording};

use super::space_card::{space_file_path, transcript_path_of};
use super::files::{drop_from_search, drop_source_facts, file_in, patch_file, source_id_for};
use super::folder::{scan_linked_folder, stat_sig};
use super::text_cache::{drop_file_texts, read_cached_text, read_kept_pages, write_cached_text};
use crate::App;
use crate::graph::extraction::extraction;
use crate::graph::topics::schedule_topic_grouping;

/// How long after launch the catch-up of unfinished files waits.
const STARTUP_SCAN_DELAY_MS: i64 = 10_000;
const SCAN_PERIOD_MS: i64 = 60_000;

/// Queues one file for processing (once while it waits).
pub fn enqueue_file(app: &Arc<App>, space_id: &str, file_id: &str) {
	if !app.spaces.queued.lock().insert(format!("{space_id}:{file_id}")) {
		return;
	}
	let mut queues = app.spaces.queues.lock();
	let queue = queues.entry(space_id.to_owned()).or_default();
	queue.waiting.push_back(file_id.to_owned());
	if !queue.running {
		queue.running = true;
		detach("spaces", run_queue(app.clone(), space_id.to_owned()));
	}
}

/// Frees a space's queue when `run_queue` panics, so its files are not left marked as running for
/// good. A normal exit does nothing: it already took the queue out, and a new one may have started.
struct QueueGuard {
	app: Arc<App>,
	space_id: String,
}

impl Drop for QueueGuard {
	fn drop(&mut self) {
		if !std::thread::panicking() {
			return;
		}
		self.app.spaces.queues.lock().remove(&self.space_id);
		let prefix = format!("{}:", self.space_id);
		self.app.spaces.queued.lock().retain(|key| !key.starts_with(&prefix));
		self.app.spaces.settled.notify_waiters();
	}
}

/// Works through one space's queue until it is empty. Each time it drains, topics are grouped
/// once for the whole batch of files.
async fn run_queue(app: Arc<App>, space_id: String) {
	let _guard = QueueGuard { app: app.clone(), space_id: space_id.clone() };
	loop {
		let next = {
			let mut queues = app.spaces.queues.lock();
			let next = queues.get_mut(&space_id).and_then(|q| q.waiting.pop_front());
			if next.is_none() {
				queues.remove(&space_id);
			}
			next
		};
		let Some(file_id) = next else { break };
		app.spaces.queued.lock().remove(&format!("{space_id}:{file_id}"));
		if !app.spaces.cancelled.lock().contains(&space_id) {
			let run = tokio::spawn(process_file(app.clone(), space_id.clone(), file_id.clone()));
			if let Err(err) = run.await {
				eprintln!("[spaces] processing {space_id}:{file_id} failed: {err}");
			}
		}
		let drained = app.spaces.queues.lock().get(&space_id).is_none_or(|q| q.waiting.is_empty());
		if drained && !app.spaces.cancelled.lock().contains(&space_id) {
			schedule_topic_grouping(&app, &space_id);
		}
	}
	app.spaces.settled.notify_waiters();
}

fn graph_enabled(app: &App) -> bool {
	app.stores.settings.effective_settings().is_ok_and(|s| s["graph"]["enabled"].truthy())
}

fn still_there(app: &App, space_id: &str, file_id: &str) -> bool {
	app.stores.spaces.get_space(space_id).is_some_and(|r| file_in(&r, file_id).is_some())
}

/// Why a file has no text: whisper or ffmpeg is missing (the file says how to install them), or
/// anything else.
enum TextError {
	WhisperMissing(String),
	Failed(String),
}

/// Brings one file's facts up to date with its current content and kind:
///  - info: no facts (old ones removed); readable by the teacher
///  - a recording its lecture's transcript covers: no facts, never read
///  - study, unchanged: nothing
///  - study, new or changed: old facts removed, the new text imported
async fn process_file(app: Arc<App>, space_id: String, file_id: String) {
	let (app, space_id, file_id) = (&app, space_id.as_str(), file_id.as_str());
	let Some(record) = app.stores.spaces.get_space(space_id) else { return };
	let Some(file) = file_in(&record, file_id).cloned() else { return };
	// First, before the file is even looked for: hashing a video on Google Drive would download
	// it, and a covered recording needs no file at all.
	if let Some(transcript) = transcript_for(&file, record["files"].items()) {
		use_transcript(app, &record, &file, transcript["id"].str_or_empty());
		return;
	}
	let Some(abs) = space_file_path(app, &record, &file).filter(|p| Path::new(p).exists()) else {
		// Forget the signature so the folder scan picks the file up again once it is back (drive re-plugged).
		patch_file(app, space_id, file_id, &[("status", Some("failed".into())), ("error", Some(FILE_NOT_FOUND.into())), ("statSig", None)]);
		return;
	};
	// Saved on failure too, so the folder scan stops re-queuing an unreadable file until it changes.
	let mut stat: Option<String> = None;
	if let Err(err) = read_and_import(app, space_id, &file, Path::new(&abs), &mut stat).await {
		// An unreadable file (or a failed graph write) shows as failed with a Retry, not stuck in progress.
		if !still_there(app, space_id, file_id) {
			return;
		}
		let mut patch = vec![("status", Some(Json::from("failed"))), ("error", Some(Json::from(err)))];
		if let Some(sig) = stat {
			patch.push(("statSig", Some(Json::from(sig))));
		}
		patch_file(app, space_id, file_id, &patch);
	}
}

/// `process_file` past the checks; Err is what the TS's outer catch saw.
async fn read_and_import(app: &Arc<App>, space_id: &str, file: &Json, abs: &Path, stat: &mut Option<String>) -> Result<(), String> {
	let file_id = file["id"].str_or_empty();
	let sig = stat_sig(abs).map_err(|err| fsx::node_error_message(&err, "stat", abs))?;
	*stat = Some(sig.clone());
	let fp = fingerprint_file(abs).await?;
	let sig = Some(Json::from(sig));
	let fp_json = Some(Json::from(fp.as_str()));

	if file["kind"].str_or_empty() == "info" {
		if let Some(source_id) = file["sourceId"].as_str().filter(|s| !s.is_empty()) {
			drop_source_facts(app, space_id, source_id)?;
		}
		patch_file(app, space_id, file_id, &[("status", Some("ready".into())), ("contentFp", fp_json), ("statSig", sig), ("sourceId", None), ("transcriptId", None), ("error", None)]);
		index_for_search(app, space_id, file, abs, &fp, None).await;
		return Ok(());
	}
	if file["contentFp"].str_or_empty() == fp && file["status"].str_or_empty() == "ready" && file["sourceId"].truthy() {
		// Touched, not changed.
		if file["statSig"] != sig.clone().unwrap_or_default() {
			patch_file(app, space_id, file_id, &[("statSig", sig)]);
		}
		return Ok(());
	}
	if !graph_enabled(app) {
		patch_file(app, space_id, file_id, &[("status", Some("pending".into())), ("statSig", sig), ("error", Some("The knowledge graph is turned off in Settings → Graph".into()))]);
		index_for_search(app, space_id, file, abs, &fp, None).await;
		return Ok(());
	}

	patch_file(app, space_id, file_id, &[("status", Some("extracting".into())), ("statSig", sig), ("error", None)]);
	let text = match file_text(app, space_id, file, abs, &fp).await {
		Ok(text) => text,
		Err(TextError::WhisperMissing(message)) => {
			patch_file(app, space_id, file_id, &[("status", Some("needs-whisper".into())), ("contentFp", fp_json), ("error", Some(message.into()))]);
			return Ok(());
		}
		Err(TextError::Failed(message)) => {
			patch_file(app, space_id, file_id, &[("status", Some("failed".into())), ("contentFp", fp_json), ("error", Some(message.into()))]);
			return Ok(());
		}
	};
	// Removed, or its space deleted, while the text was read: undo what the read wrote back.
	if !still_there(app, space_id, file_id) {
		if app.spaces.cancelled.lock().contains(space_id) {
			let _ = app.stores.spaces.delete_space(space_id);
		} else {
			drop_file_texts(app, space_id, file_id);
		}
		return Ok(());
	}
	index_for_search(app, space_id, file, abs, &fp, Some(&text)).await;

	// REBUILD: the old version's facts go first; shared facts survive by the deletion law.
	let source_id = source_id_for(space_id, file_id);
	if !still_there(app, space_id, file_id) {
		return Ok(());
	}
	drop_source_facts(app, space_id, &source_id)?;
	let import = NotesImportInput { file_path: file["name"].str_or_empty().to_owned(), text, scope: Some(space_id.to_owned()), source_id: Some(source_id.clone()), may_be_space_info: sorts_on_read(file) };
	match extraction(app).import_notes(import).await {
		Ok(result) if result["spaceInfo"].truthy() => {
			drop_source_facts(app, space_id, &source_id)?;
			let now = app.stores.spaces.get_space(space_id).and_then(|r| file_in(&r, file_id).cloned());
			match now {
				// Logistics: space info, which the teacher reads but never quizzes.
				Some(now) if now["kind"].str_or_empty() == "study" && !now["kindChosen"].truthy() => {
					patch_file(
						app,
						space_id,
						file_id,
						&[("kind", Some("info".into())), ("sortedAsInfo", Some(true.into())), ("status", Some("ready".into())), ("contentFp", fp_json), ("sourceId", None), ("error", None)],
					);
				}
				// Picked as study material by hand during the read: read it again as that.
				Some(now) if now["kind"].str_or_empty() == "study" => {
					patch_file(app, space_id, file_id, &[("status", Some("pending".into())), ("error", None)]);
					enqueue_file(app, space_id, file_id);
				}
				// Switched to space info meanwhile: its own queued run settles it.
				_ => {}
			}
		}
		Ok(_) => {
			patch_file(app, space_id, file_id, &[("status", Some("ready".into())), ("contentFp", fp_json), ("sourceId", Some(source_id.as_str().into())), ("error", None)]);
		}
		Err(err) => {
			if app.stores.spaces.get_space(space_id).is_some() {
				patch_file(app, space_id, file_id, &[("status", Some("failed".into())), ("contentFp", fp_json), ("sourceId", Some(source_id.as_str().into())), ("error", Some(format!("{}: {}", err.outcome.as_str(), err.message).into()))]);
			}
		}
	}
	// Removed while it was imported: the facts it merged go too.
	if app.stores.spaces.get_space(space_id).is_some() && !still_there(app, space_id, file_id) {
		drop_source_facts(app, space_id, &source_id)?;
	}
	Ok(())
}

/// Whether this read may sort a study file into space info: only its first read, never a kind set on
/// purpose (`kindChosen`), and never a lecture's transcript or recording (whose sort would undo
/// other files' work). Linked and hand-added files alike.
fn sorts_on_read(file: &Json) -> bool {
	let name = file["name"].str_or_empty();
	!file["kindChosen"].truthy() && !file["contentFp"].truthy() && !is_transcript_file(name) && !is_recording_file(name)
}

/// A recording covered by its lecture's transcript: ready with no facts of its own (any from an
/// earlier transcription go, so nothing is in the graph twice). Its saved transcript stays in case
/// it is needed again.
fn use_transcript(app: &Arc<App>, record: &Json, file: &Json, transcript_id: &str) {
	let space_id = record["id"].str_or_empty();
	let file_id = file["id"].str_or_empty();
	if let Some(source_id) = file["sourceId"].as_str().filter(|s| !s.is_empty())
		&& let Err(err) = drop_source_facts(app, space_id, source_id)
	{
		eprintln!("[spaces] could not drop the facts of {file_id}: {err}");
	}
	if file["contentFp"].truthy() {
		drop_from_search(app, space_id, file_id);
	}
	// Gone since the check: the scan handles it.
	let sig = space_file_path(app, record, file).and_then(|p| stat_sig(Path::new(&p)).ok());
	patch_file(app, space_id, file_id, &[("status", Some("ready".into())), ("contentFp", Some("".into())), ("statSig", sig.map(Json::from)), ("sourceId", None), ("transcriptId", Some(transcript_id.into())), ("error", None)]);
}

/// A file's text for the notes pipeline: a recording's or document's saved (or freshly made)
/// text, the file itself otherwise.
async fn file_text(app: &Arc<App>, space_id: &str, file: &Json, abs: &Path, fp: &str) -> Result<String, TextError> {
	let (name, file_id) = (file["name"].str_or_empty(), file["id"].str_or_empty());
	let recording = is_recording_file(name);
	let read = || async { file_to_text(&app.pdf, abs).await.map_err(|err| TextError::Failed(err.to_string())) };
	if !recording && !DOCUMENT_EXTENSIONS.contains(&extension_of(name).as_str()) {
		return read().await;
	}
	if let Some(cached) = read_cached_text(app, space_id, file_id, fp) {
		return Ok(cached);
	}
	let text = if recording {
		let out = transcript_path_of(app, space_id, file_id).ok_or_else(|| TextError::Failed(format!("Invalid space id: {space_id}")))?;
		transcribe_recording(&app.spaces.speech_model, &app.paths, abs, &out).await.map_err(|err| match err {
			TranscribeError::WhisperMissing(missing) => TextError::WhisperMissing(missing.to_string()),
			TranscribeError::Failed(message) => TextError::Failed(message),
		})?
	} else {
		read().await?
	};
	// Removed, or its space deleted, during the read: saving would bring its folder back.
	if still_there(app, space_id, file_id) {
		write_cached_text(app, space_id, file_id, fp, &text);
	}
	Ok(text)
}

/// Puts this version of a file (study or info) in the space's search index. `text` is the
/// pipeline's text when it was already read. Captions are indexed from the raw file (search keeps
/// their times); a recording only once its transcript exists (never transcribed for search alone).
/// Best effort: a failure is logged and the file goes on.
async fn index_for_search(app: &Arc<App>, space_id: &str, file: &Json, abs: &Path, fp: &str, text: Option<&str>) {
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
pub(super) fn reindex_kept_pages(app: &Arc<App>, space_id: &str, file_id: &str) {
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
async fn index_unindexed_files(app: &Arc<App>) {
	for summary in app.stores.spaces.list_spaces() {
		if summary["closed"].truthy() {
			continue;
		}
		let Some(record) = app.stores.spaces.get_space(summary["id"].str_or_empty()) else { continue };
		for file in record["files"].items() {
			let status = file["status"].str_or_empty();
			if (status != "ready" && status != "failed") || !file["contentFp"].truthy() {
				continue;
			}
			if let Some(abs) = space_file_path(app, &record, file).filter(|p| Path::new(p).exists()) {
				index_for_search(app, record["id"].str_or_empty(), file, Path::new(&abs), file["contentFp"].str_or_empty(), None).await;
			}
		}
	}
}

/// Queues every file left waiting or unfinished (app start, the graph turned back on).
pub fn queue_waiting_files(app: &Arc<App>) {
	for record in app.stores.spaces.list_space_records() {
		if record["closed"].truthy() {
			continue;
		}
		for file in record["files"].items() {
			if matches!(file["status"].str_or_empty(), "pending" | "extracting") {
				enqueue_file(app, record["id"].str_or_empty(), file["id"].str_or_empty());
			}
		}
	}
}

/// Starts the 60-second linked-folder scan, once per process. Ten seconds after the start (so it
/// never competes with the window's first load) every space is checked once: waiting files
/// queued, linked folders rescanned, unindexed files indexed.
pub fn start_space_scanner(app: &Arc<App>) {
	if app.spaces.scanner_started.swap(true, std::sync::atomic::Ordering::SeqCst) {
		return;
	}
	let timer = app.clone();
	detach("spaces", async move {
		let mut due = clock::now_ms() + SCAN_PERIOD_MS;
		loop {
			clock::sleep_until(due).await;
			due = clock::now_ms() + SCAN_PERIOD_MS;
			for summary in timer.stores.spaces.list_spaces() {
				if !summary["closed"].truthy() && summary["linkedFolder"].truthy() {
					scan_linked_folder(&timer, summary["id"].str_or_empty(), false);
				}
			}
		}
	});
	let startup = app.clone();
	detach("spaces", async move {
		clock::sleep(STARTUP_SCAN_DELAY_MS).await;
		queue_waiting_files(&startup);
		for record in startup.stores.spaces.list_space_records() {
			if !record["closed"].truthy() {
				scan_linked_folder(&startup, record["id"].str_or_empty(), false);
			}
		}
		index_unindexed_files(&startup).await;
	});
}

#[cfg(test)]
mod tests {
	use gs_engine::bridge::{AgentReply, ReplyCall, WaitOptions};
	use gs_json::{json, stringify};
	use gs_search::index::PassageRef;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::spaces::space_search::space_search;
	use crate::spaces::files::replace_copied_file;
	use crate::spaces::{add_copied_file, add_file_from_path, keep_page, kept_pages_at, set_file_kind, write_agent_file};

	#[test]
	fn a_queue_that_panics_is_freed_and_one_that_ends_normally_is_left_alone() {
		let root = scratch_dir("queue-guard");
		let app = test_app(&root);
		let queue_of = |space_id: &str, file_id: &str| {
			app.spaces.queues.lock().entry(space_id.to_owned()).or_default().running = true;
			app.spaces.queued.lock().insert(format!("{space_id}:{file_id}"));
		};
		queue_of("s1", "f1");
		queue_of("s2", "f2");
		drop(QueueGuard { app: app.clone(), space_id: "s1".to_owned() });
		assert!(app.spaces.queues.lock().contains_key("s1"), "a normal end leaves the queue to its owner");
		let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
			let _guard = QueueGuard { app: app.clone(), space_id: "s1".to_owned() };
			panic!("the queue broke");
		}));
		assert!(panicked.is_err());
		assert!(!app.spaces.queues.lock().contains_key("s1"));
		assert_eq!(app.spaces.queued.lock().iter().collect::<Vec<_>>(), ["s2:f2"]);
		assert!(app.spaces.queues.lock().contains_key("s2"));
	}

	#[test]
	fn only_a_first_read_of_a_kind_nobody_set_sorts() {
		let file = |extra: Json| {
			let mut file = json!({ "id": "f1", "origin": "copied", "name": "Syllabus.md", "kind": "study", "contentFp": "" });
			for (key, value) in extra.as_obj().unwrap().iter() {
				file.as_obj_mut().unwrap().insert(key.as_str(), value.clone());
			}
			file
		};
		assert!(sorts_on_read(&file(json!({}))));
		assert!(sorts_on_read(&file(json!({ "origin": "linked" }))));
		assert!(!sorts_on_read(&file(json!({ "kindChosen": true }))));
		assert!(!sorts_on_read(&file(json!({ "contentFp": "abc" }))), "read before");
		assert!(!sorts_on_read(&file(json!({ "name": "Lecture 1.vtt" }))));
		assert!(!sorts_on_read(&file(json!({ "name": "Lecture 1.mp3" }))));
	}

	/// The stand-in agent reads the next file: logistics whenever it is asked whether the file is.
	/// Gives the file's name and whether it was asked.
	async fn read_as_logistics(app: &App, names: &[&str]) -> (String, bool) {
		let view = app.bridge.wait_for_work(10_000, WaitOptions { full: true, helper: true, ..WaitOptions::default() }).await.expect("a file to read");
		let asked = view.instructions.as_deref().expect("the reading's instructions").contains("spaceInfo: true");
		let sent = stringify(&Json::Arr(view.messages.clone()));
		let name = names.iter().find(|n| sent.contains(**n)).expect("the file's name in the reading");
		let mut findings = json!({ "propositions": [], "chains": [], "reteaches": [] });
		if asked {
			findings.as_obj_mut().unwrap().insert("spaceInfo", true);
		}
		app.bridge.respond_to_work(&view.work_id, AgentReply { text: None, tool_calls: vec![ReplyCall { name: "submit_findings".into(), arguments: findings }] }, 0).unwrap();
		((*name).to_owned(), asked)
	}

	#[tokio::test]
	async fn a_file_the_learner_added_is_sorted_on_its_first_read_and_a_kind_set_on_purpose_is_not() {
		let root = scratch_dir("sorting");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Biology" })).unwrap()["id"].as_str().unwrap().to_owned();
		let id = |file: Json| file["id"].as_str().unwrap().to_owned();
		let syllabus = id(add_copied_file(&app, &space_id, "Syllabus.md", b"Office hours move to Tuesday.").unwrap());
		let moved = id(add_copied_file(&app, &space_id, "Week 1.md", b"Cells divide.").unwrap());
		set_file_kind(&app, &space_id, &moved, "study").unwrap();
		let written = id(write_agent_file(&app, &space_id, "Study guide.md", b"Mitosis has four phases.", "study").unwrap().0);
		let reading = root.join("Reading.md");
		fsx::write_text_atomic(&reading, "Meiosis halves the chromosomes.").unwrap();
		let from_path = id(add_file_from_path(&app, &space_id, reading.to_str().unwrap(), "study").unwrap());
		let transcript = id(add_copied_file(&app, &space_id, "Lecture 1.vtt", b"WEBVTT\n\n00:00.000 --> 00:02.000\nCells divide.\n").unwrap());

		let names = ["Syllabus.md", "Week 1.md", "Study guide.md", "Reading.md", "Lecture 1.vtt"];
		let mut asked = Vec::new();
		for _ in names {
			let (name, sorts) = read_as_logistics(&app, &names).await;
			if sorts {
				asked.push(name);
			}
		}
		assert_eq!(asked, ["Syllabus.md"]);
		let file = |file_id: &str| file_in(&app.stores.spaces.get_space(&space_id).unwrap(), file_id).unwrap().clone();
		for _ in 0..400 {
			if [&syllabus, &moved, &written, &from_path, &transcript].iter().all(|f| file(f)["status"] == json!("ready")) {
				break;
			}
			clock::sleep(10).await;
		}
		assert_eq!((&file(&syllabus)["kind"], &file(&syllabus)["sortedAsInfo"]), (&json!("info"), &json!(true)));
		for kept in [&moved, &written, &from_path, &transcript] {
			let kept = file(kept);
			assert_eq!((&kept["kind"], &kept["status"], kept.get("sortedAsInfo")), (&json!("study"), &json!("ready"), None), "{kept:?}");
		}
	}

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
		let file_id = write_agent_file(&app, &space_id, "Sample Book.epub", &book, "info").unwrap().0["id"].as_str().unwrap().to_owned();
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
		let file_id = write_agent_file(&app, &space_id, "Lecture 1.pdf", &pdf, "info").unwrap().0["id"].as_str().unwrap().to_owned();
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
		replace_copied_file(&app, &space_id, &file_id, &changed, "info").unwrap();
		write_cached_text(&app, &space_id, &file_id, &new_fp, "--- Page 1 ---\nOne.\n--- Page 2 ---\nForce, changed.\n--- Page 3 ---\nThree.");
		wait_indexed(&app, &space_id, &file_id, &new_fp).await;
		assert_eq!(page_two()["text"].as_str(), Some("Force, changed."));
		assert!(kept_pages_at(&app, Path::new(&abs)).await.unwrap().pages.is_empty());
		assert!(read_kept_pages(&app, &space_id, &file_id, &fp).is_empty());
		assert_eq!(keep_page(&app, &kept, 2, "Old."), Err("the file changed or was removed while it was read, so nothing was saved".to_owned()));
	}
}
