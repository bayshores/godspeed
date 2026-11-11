//! THE FILE PIPELINE (classes.ts): file → text (gs_files, gs_transcribe) → the notes import into
//! the class's own graph. Study files become facts; course info never does. Both go into the
//! class's search index. Work is serialized per class (one queue each): the file list is a
//! read-modify-write record, and one class's imports shouldn't flood the shared extraction slots.

use std::path::Path;
use std::sync::Arc;

use gs_base::{clock, fsx};
use gs_core::classes::lecture_transcript::transcript_for;
use gs_core::contracts::class::{DOCUMENT_EXTENSIONS, FILE_NOT_FOUND, extension_of, is_recording_file, is_transcript_file};
use gs_files::fingerprint::fingerprint_file;
use gs_files::text::file_to_text;
use gs_agent::extraction::extraction::NotesImportInput;
use gs_json::Json;
use gs_transcribe::run::{TranscribeError, transcribe_recording};

use super::class_card::{class_file_path, transcript_path_of};
use super::files::{drop_from_search, drop_source_facts, file_in, files_of, patch_file, source_id_for, str_of};
use super::folder::{scan_linked_folder, stat_sig};
use super::text_cache::{drop_file_texts, read_cached_text, write_cached_text};
use crate::App;
use crate::graph::extraction::extraction;
use crate::graph::topics::schedule_topic_grouping;

/// How long after launch the catch-up of unfinished files waits.
const STARTUP_SCAN_DELAY_MS: i64 = 10_000;
const SCAN_PERIOD_MS: i64 = 60_000;

/// Queues one file for processing (once while it waits).
pub fn enqueue_file(app: &Arc<App>, class_id: &str, file_id: &str) {
	if !app.classes.queued.lock().insert(format!("{class_id}:{file_id}")) {
		return;
	}
	let mut queues = app.classes.queues.lock();
	let queue = queues.entry(class_id.to_owned()).or_default();
	queue.waiting.push_back(file_id.to_owned());
	if !queue.running {
		queue.running = true;
		tokio::spawn(run_queue(app.clone(), class_id.to_owned()));
	}
}

/// Works through one class's queue until it is empty. Each time it drains, topics are grouped
/// once for the whole batch of files.
async fn run_queue(app: Arc<App>, class_id: String) {
	loop {
		let next = {
			let mut queues = app.classes.queues.lock();
			let next = queues.get_mut(&class_id).and_then(|q| q.waiting.pop_front());
			if next.is_none() {
				queues.remove(&class_id);
			}
			next
		};
		let Some(file_id) = next else { break };
		app.classes.queued.lock().remove(&format!("{class_id}:{file_id}"));
		if !app.classes.cancelled.lock().contains(&class_id) {
			let run = tokio::spawn(process_file(app.clone(), class_id.clone(), file_id.clone()));
			if let Err(err) = run.await {
				eprintln!("[classes] processing {class_id}:{file_id} failed: {err}");
			}
		}
		let drained = app.classes.queues.lock().get(&class_id).is_none_or(|q| q.waiting.is_empty());
		if drained && !app.classes.cancelled.lock().contains(&class_id) {
			schedule_topic_grouping(&app, &class_id);
		}
	}
	app.classes.settled.notify_waiters();
}

fn graph_enabled(app: &App) -> bool {
	app.stores.settings.effective_settings().is_ok_and(|s| s["graph"]["enabled"].truthy())
}

fn still_there(app: &App, class_id: &str, file_id: &str) -> bool {
	app.stores.classes.get_class(class_id).is_some_and(|r| file_in(&r, file_id).is_some())
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
async fn process_file(app: Arc<App>, class_id: String, file_id: String) {
	let (app, class_id, file_id) = (&app, class_id.as_str(), file_id.as_str());
	let Some(record) = app.stores.classes.get_class(class_id) else { return };
	let Some(file) = file_in(&record, file_id).cloned() else { return };
	// First, before the file is even looked for: hashing a video on Google Drive would download
	// it, and a covered recording needs no file at all.
	if let Some(transcript) = transcript_for(&file, files_of(&record)) {
		use_transcript(app, &record, &file, str_of(transcript, "id"));
		return;
	}
	let Some(abs) = class_file_path(app, &record, &file).filter(|p| Path::new(p).exists()) else {
		// Forget the signature so the folder scan picks the file up again once it is back (drive re-plugged).
		patch_file(app, class_id, file_id, &[("status", Some("failed".into())), ("error", Some(FILE_NOT_FOUND.into())), ("statSig", None)]);
		return;
	};
	// Saved on failure too, so the folder scan stops re-queuing an unreadable file until it changes.
	let mut stat: Option<String> = None;
	if let Err(err) = read_and_import(app, class_id, &file, Path::new(&abs), &mut stat).await {
		// An unreadable file (or a failed graph write) shows as failed with a Retry, not stuck in progress.
		if !still_there(app, class_id, file_id) {
			return;
		}
		let mut patch = vec![("status", Some(Json::from("failed"))), ("error", Some(Json::from(err)))];
		if let Some(sig) = stat {
			patch.push(("statSig", Some(Json::from(sig))));
		}
		patch_file(app, class_id, file_id, &patch);
	}
}

/// `process_file` past the checks; Err is what the TS's outer catch saw.
async fn read_and_import(app: &Arc<App>, class_id: &str, file: &Json, abs: &Path, stat: &mut Option<String>) -> Result<(), String> {
	let file_id = str_of(file, "id");
	let sig = stat_sig(abs).map_err(|err| fsx::node_error_message(&err, "stat", abs))?;
	*stat = Some(sig.clone());
	let fp = fingerprint_file(abs).await?;
	let sig = Some(Json::from(sig));
	let fp_json = Some(Json::from(fp.as_str()));

	if str_of(file, "kind") == "info" {
		if let Some(source_id) = file["sourceId"].as_str().filter(|s| !s.is_empty()) {
			drop_source_facts(app, class_id, source_id)?;
		}
		patch_file(app, class_id, file_id, &[("status", Some("ready".into())), ("contentFp", fp_json), ("statSig", sig), ("sourceId", None), ("transcriptId", None), ("error", None)]);
		index_for_search(app, class_id, file, abs, &fp, None).await;
		return Ok(());
	}
	if str_of(file, "contentFp") == fp && str_of(file, "status") == "ready" && file["sourceId"].truthy() {
		// Touched, not changed.
		if file["statSig"] != sig.clone().unwrap_or_default() {
			patch_file(app, class_id, file_id, &[("statSig", sig)]);
		}
		return Ok(());
	}
	if !graph_enabled(app) {
		patch_file(app, class_id, file_id, &[("status", Some("pending".into())), ("statSig", sig), ("error", Some("The knowledge graph is turned off in Settings → Graph".into()))]);
		index_for_search(app, class_id, file, abs, &fp, None).await;
		return Ok(());
	}

	patch_file(app, class_id, file_id, &[("status", Some("extracting".into())), ("statSig", sig), ("error", None)]);
	let text = match file_text(app, class_id, file, abs, &fp).await {
		Ok(text) => text,
		Err(TextError::WhisperMissing(message)) => {
			patch_file(app, class_id, file_id, &[("status", Some("needs-whisper".into())), ("contentFp", fp_json), ("error", Some(message.into()))]);
			return Ok(());
		}
		Err(TextError::Failed(message)) => {
			patch_file(app, class_id, file_id, &[("status", Some("failed".into())), ("contentFp", fp_json), ("error", Some(message.into()))]);
			return Ok(());
		}
	};
	// Removed, or its class deleted, while the text was read: undo what the read wrote back.
	if !still_there(app, class_id, file_id) {
		if app.classes.cancelled.lock().contains(class_id) {
			let _ = app.stores.classes.delete_class(class_id);
		} else {
			drop_file_texts(app, class_id, file_id);
		}
		return Ok(());
	}
	index_for_search(app, class_id, file, abs, &fp, Some(&text)).await;

	// REBUILD: the old version's facts go first; shared facts survive by the deletion law.
	let source_id = source_id_for(class_id, file_id);
	if !still_there(app, class_id, file_id) {
		return Ok(());
	}
	drop_source_facts(app, class_id, &source_id)?;
	// Only a linked file's first read sorts it, and never a lecture's transcript or recording
	// (whose sort would undo other files' work).
	let name = str_of(file, "name");
	let may_be_course_info = str_of(file, "origin") == "linked" && !file["kindChosen"].truthy() && !file["contentFp"].truthy() && !is_transcript_file(name) && !is_recording_file(name);
	let import = NotesImportInput { file_path: name.to_owned(), text, scope: Some(class_id.to_owned()), source_id: Some(source_id.clone()), may_be_course_info };
	match extraction(app).import_notes(import).await {
		Ok(result) if result["courseInfo"].truthy() => {
			drop_source_facts(app, class_id, &source_id)?;
			let now = app.stores.classes.get_class(class_id).and_then(|r| file_in(&r, file_id).cloned());
			match now {
				// Course logistics: course info, which the teacher reads but never quizzes.
				Some(now) if str_of(&now, "kind") == "study" && !now["kindChosen"].truthy() => {
					patch_file(
						app,
						class_id,
						file_id,
						&[("kind", Some("info".into())), ("sortedAsInfo", Some(true.into())), ("status", Some("ready".into())), ("contentFp", fp_json), ("sourceId", None), ("error", None)],
					);
				}
				// Picked as study material by hand during the read: read it again as that.
				Some(now) if str_of(&now, "kind") == "study" => {
					patch_file(app, class_id, file_id, &[("status", Some("pending".into())), ("error", None)]);
					enqueue_file(app, class_id, file_id);
				}
				// Switched to course info meanwhile: its own queued run settles it.
				_ => {}
			}
		}
		Ok(_) => {
			patch_file(app, class_id, file_id, &[("status", Some("ready".into())), ("contentFp", fp_json), ("sourceId", Some(source_id.as_str().into())), ("error", None)]);
		}
		Err(err) => {
			if app.stores.classes.get_class(class_id).is_some() {
				patch_file(app, class_id, file_id, &[("status", Some("failed".into())), ("contentFp", fp_json), ("sourceId", Some(source_id.as_str().into())), ("error", Some(format!("{}: {}", err.outcome.as_str(), err.message).into()))]);
			}
		}
	}
	// Removed while it was imported: the facts it merged go too.
	if app.stores.classes.get_class(class_id).is_some() && !still_there(app, class_id, file_id) {
		drop_source_facts(app, class_id, &source_id)?;
	}
	Ok(())
}

/// A recording covered by its lecture's transcript: ready with no facts of its own (any from an
/// earlier transcription go, so nothing is in the graph twice). Its saved transcript stays in case
/// it is needed again.
fn use_transcript(app: &Arc<App>, record: &Json, file: &Json, transcript_id: &str) {
	let class_id = str_of(record, "id");
	let file_id = str_of(file, "id");
	if let Some(source_id) = file["sourceId"].as_str().filter(|s| !s.is_empty())
		&& let Err(err) = drop_source_facts(app, class_id, source_id)
	{
		eprintln!("[classes] could not drop the facts of {file_id}: {err}");
	}
	if file["contentFp"].truthy() {
		drop_from_search(app, class_id, file_id);
	}
	// Gone since the check: the scan handles it.
	let sig = class_file_path(app, record, file).and_then(|p| stat_sig(Path::new(&p)).ok());
	patch_file(app, class_id, file_id, &[("status", Some("ready".into())), ("contentFp", Some("".into())), ("statSig", sig.map(Json::from)), ("sourceId", None), ("transcriptId", Some(transcript_id.into())), ("error", None)]);
}

/// A file's text for the notes pipeline: a recording's or document's saved (or freshly made)
/// text, the file itself otherwise.
async fn file_text(app: &Arc<App>, class_id: &str, file: &Json, abs: &Path, fp: &str) -> Result<String, TextError> {
	let (name, file_id) = (str_of(file, "name"), str_of(file, "id"));
	let recording = is_recording_file(name);
	let read = || async { file_to_text(&app.pdf, abs).await.map_err(|err| TextError::Failed(err.to_string())) };
	if !recording && !DOCUMENT_EXTENSIONS.contains(&extension_of(name).as_str()) {
		return read().await;
	}
	if let Some(cached) = read_cached_text(app, class_id, file_id, fp) {
		return Ok(cached);
	}
	let text = if recording {
		let out = transcript_path_of(app, class_id, file_id).ok_or_else(|| TextError::Failed(format!("Invalid class id: {class_id}")))?;
		transcribe_recording(&app.classes.speech_model, &app.paths, abs, &out).await.map_err(|err| match err {
			TranscribeError::WhisperMissing(missing) => TextError::WhisperMissing(missing.to_string()),
			TranscribeError::Failed(message) => TextError::Failed(message),
		})?
	} else {
		read().await?
	};
	// Removed, or its class deleted, during the read: saving would bring its folder back.
	if still_there(app, class_id, file_id) {
		write_cached_text(app, class_id, file_id, fp, &text);
	}
	Ok(text)
}

/// Puts this version of a file (study or info) in the class's search index. `text` is the
/// pipeline's text when it was already read. Captions are indexed from the raw file (search keeps
/// their times); a recording only once its transcript exists (never transcribed for search alone).
/// Best effort: a failure is logged and the file goes on.
async fn index_for_search(app: &Arc<App>, class_id: &str, file: &Json, abs: &Path, fp: &str, text: Option<&str>) {
	let (name, file_id) = (str_of(file, "name"), str_of(file, "id"));
	if app.search.is_file_indexed(class_id, file_id, fp) {
		return;
	}
	let source = if is_transcript_file(name) {
		fsx::read_text(abs).map_err(|err| fsx::node_error_message(&err, "open", abs))
	} else if let Some(text) = text {
		Ok(text.to_owned())
	} else if is_recording_file(name) {
		let Some(transcript) = transcript_path_of(app, class_id, file_id).filter(|t| t.exists()) else { return };
		fsx::read_text(&transcript).map_err(|err| fsx::node_error_message(&err, "open", &transcript))
	} else {
		file_text(app, class_id, file, abs, fp).await.map_err(|err| match err {
			TextError::WhisperMissing(message) | TextError::Failed(message) => message,
		})
	};
	let indexed = match source {
		Ok(source) => {
			let still_listed = || {
				let guard = app.locks.lock(gs_base::locks::LockKey::Class(class_id));
				still_there(app, class_id, file_id).then_some(guard)
			};
			app.search.index_class_file(class_id, file_id, name, fp, &source, still_listed).await
		}
		Err(err) => Err(err),
	};
	if let Err(err) = indexed {
		eprintln!("[classes] could not index {name} for search: {err}");
	}
}

/// Indexes every processed file the search index lacks (classes from before search, a failed
/// index), one file at a time in the background.
async fn index_unindexed_files(app: &Arc<App>) {
	for summary in app.stores.classes.list_classes() {
		if summary["archived"].truthy() {
			continue;
		}
		let Some(record) = app.stores.classes.get_class(str_of(&summary, "id")) else { continue };
		for file in files_of(&record) {
			let status = str_of(file, "status");
			if (status != "ready" && status != "failed") || !file["contentFp"].truthy() {
				continue;
			}
			if let Some(abs) = class_file_path(app, &record, file).filter(|p| Path::new(p).exists()) {
				index_for_search(app, str_of(&record, "id"), file, Path::new(&abs), str_of(file, "contentFp"), None).await;
			}
		}
	}
}

/// Queues every file left waiting or unfinished (app start, the graph turned back on).
pub fn queue_waiting_files(app: &Arc<App>) {
	for record in app.stores.classes.list_class_records() {
		if record["archived"].truthy() {
			continue;
		}
		for file in files_of(&record) {
			if matches!(str_of(file, "status"), "pending" | "extracting") {
				enqueue_file(app, str_of(&record, "id"), str_of(file, "id"));
			}
		}
	}
}

/// Starts the 60-second linked-folder scan, once per process. Ten seconds after the start (so it
/// never competes with the window's first load) every class is checked once: waiting files
/// queued, linked folders rescanned, unindexed files indexed.
pub fn start_class_scanner(app: &Arc<App>) {
	if app.classes.scanner_started.swap(true, std::sync::atomic::Ordering::SeqCst) {
		return;
	}
	let timer = app.clone();
	tokio::spawn(async move {
		let mut due = clock::now_ms() + SCAN_PERIOD_MS;
		loop {
			clock::sleep_until(due).await;
			due = clock::now_ms() + SCAN_PERIOD_MS;
			for summary in timer.stores.classes.list_classes() {
				if !summary["archived"].truthy() && summary["linkedFolder"].truthy() {
					scan_linked_folder(&timer, str_of(&summary, "id"), false);
				}
			}
		}
	});
	let startup = app.clone();
	tokio::spawn(async move {
		clock::sleep(STARTUP_SCAN_DELAY_MS).await;
		queue_waiting_files(&startup);
		for record in startup.stores.classes.list_class_records() {
			if !record["archived"].truthy() {
				scan_linked_folder(&startup, str_of(&record, "id"), false);
			}
		}
		index_unindexed_files(&startup).await;
	});
}
