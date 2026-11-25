//! The per-space file queue: one file at a time is read, turned into text and facts, and handed
//! to search indexing.

use std::path::Path;
use std::sync::Arc;

use gs_base::tasks::detach;
use gs_base::fsx;
use gs_core::contracts::space::{DOCUMENT_EXTENSIONS, FILE_NOT_FOUND, extension_of, is_recording_file, is_transcript_file};
use gs_core::spaces::file_state::{FileKind, FileStatus};
use gs_core::spaces::lecture_transcript::transcript_for;
use gs_core::spaces::tex_source::tex_output_for;
use gs_files::fingerprint::fingerprint_file;
use gs_files::text::file_to_text;
use gs_agent::extraction::extraction::NotesImportInput;
use gs_json::Json;
use gs_transcribe::run::{TranscribeError, transcribe_recording};

use super::indexing::index_for_search;
use crate::spaces::space_card::{space_file_path, transcript_path_of};
use crate::spaces::files::{drop_from_search, drop_source_facts, file_in, patch_file, source_id_for};
use crate::spaces::folder::stat_sig;
use crate::spaces::text_cache::{drop_file_texts, read_cached_text, write_cached_text};
use crate::App;
use crate::graph::extraction::extraction;
use crate::graph::topics::schedule_whole_topic_grouping;

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
			let run = gs_base::tasks::spawn("space-file", process_file(app.clone(), space_id.clone(), file_id.clone()));
			if let Err(err) = run.await {
				eprintln!("[spaces] processing {space_id}:{file_id} failed: {err}");
			}
		}
		let drained = app.spaces.queues.lock().get(&space_id).is_none_or(|q| q.waiting.is_empty());
		if drained && !app.spaces.cancelled.lock().contains(&space_id) {
			schedule_whole_topic_grouping(&app, &space_id);
		}
	}
	app.spaces.settled.notify_waiters();
}

fn graph_enabled(app: &App) -> bool {
	app.stores.settings.effective_settings().is_ok_and(|s| s["graph"]["enabled"].truthy())
}

pub(super) fn still_there(app: &App, space_id: &str, file_id: &str) -> bool {
	app.stores.spaces.get_space(space_id).is_some_and(|r| file_in(&r, file_id).is_some())
}

/// Why a file has no text: whisper or ffmpeg is missing (the file says how to install them), or
/// anything else.
pub(super) enum TextError {
	WhisperMissing(String),
	Failed(String),
}

/// Brings one file's facts up to date with its current content and kind:
///  - info: no facts (old ones removed); readable by the teacher
///  - a recording its lecture's transcript covers: no facts, never read
///  - a .tex whose PDF is in the space: no facts (the PDF has them)
///  - study, unchanged: nothing
///  - study, new or changed: old facts removed, the new text imported
async fn process_file(app: Arc<App>, space_id: String, file_id: String) {
	let (app, space_id, file_id) = (&app, space_id.as_str(), file_id.as_str());
	let Some(record) = app.stores.spaces.get_space(space_id) else { return };
	let Some(file) = file_in(&record, file_id).cloned() else { return };
	// First, before the file is even looked for: hashing a video on Google Drive would download
	// it, and a covered recording needs no file at all.
	if let Some(transcript) = transcript_for(&file, record["files"].items()) {
		take_facts_from(app, &record, &file, Some(transcript["id"].str_or_empty()));
		return;
	}
	if tex_output_for(&file, record["files"].items()).is_some() {
		take_facts_from(app, &record, &file, None);
		return;
	}
	let Some(abs) = space_file_path(app, &record, &file).filter(|p| Path::new(p).exists()) else {
		// Forget the signature so the folder scan picks the file up again once it is back (drive re-plugged).
		patch_file(app, space_id, file_id, &[("status", Some(FileStatus::Failed.into())), ("error", Some(FILE_NOT_FOUND.into())), ("statSig", None)]);
		return;
	};
	// Saved on failure too, so the folder scan stops re-queuing an unreadable file until it changes.
	let mut stat: Option<String> = None;
	if let Err(err) = read_and_import(app, space_id, &file, Path::new(&abs), &mut stat).await {
		// An unreadable file (or a failed graph write) shows as failed with a Retry, not stuck in progress.
		if !still_there(app, space_id, file_id) {
			return;
		}
		let mut patch = vec![("status", Some(FileStatus::Failed.into())), ("error", Some(Json::from(err)))];
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

	if FileKind::of(file) == Some(FileKind::Info) {
		if let Some(source_id) = file["sourceId"].as_str().filter(|s| !s.is_empty()) {
			drop_source_facts(app, space_id, source_id)?;
		}
		patch_file(app, space_id, file_id, &[("status", Some(FileStatus::Ready.into())), ("contentFp", fp_json), ("statSig", sig), ("sourceId", None), ("transcriptId", None), ("error", None)]);
		index_for_search(app, space_id, file, abs, &fp, None).await;
		return Ok(());
	}
	if file["contentFp"].str_or_empty() == fp && FileStatus::of(file) == Some(FileStatus::Ready) && file["sourceId"].truthy() {
		// Touched, not changed.
		if file["statSig"] != sig.clone().unwrap_or_default() {
			patch_file(app, space_id, file_id, &[("statSig", sig)]);
		}
		return Ok(());
	}
	if !graph_enabled(app) {
		patch_file(app, space_id, file_id, &[("status", Some(FileStatus::Pending.into())), ("statSig", sig), ("error", Some("The knowledge graph is turned off in Settings → Graph".into()))]);
		index_for_search(app, space_id, file, abs, &fp, None).await;
		return Ok(());
	}

	patch_file(app, space_id, file_id, &[("status", Some(FileStatus::Extracting.into())), ("statSig", sig), ("error", None)]);
	let text = match file_text(app, space_id, file, abs, &fp).await {
		Ok(text) => text,
		Err(TextError::WhisperMissing(message)) => {
			patch_file(app, space_id, file_id, &[("status", Some(FileStatus::NeedsWhisper.into())), ("contentFp", fp_json), ("error", Some(message.into()))]);
			return Ok(());
		}
		Err(TextError::Failed(message)) => {
			patch_file(app, space_id, file_id, &[("status", Some(FileStatus::Failed.into())), ("contentFp", fp_json), ("error", Some(message.into()))]);
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
				Some(now) if FileKind::of(&now) == Some(FileKind::Study) && !now["kindChosen"].truthy() => {
					patch_file(
						app,
						space_id,
						file_id,
						&[("kind", Some(FileKind::Info.into())), ("sortedAsInfo", Some(true.into())), ("status", Some(FileStatus::Ready.into())), ("contentFp", fp_json), ("sourceId", None), ("error", None)],
					);
				}
				// Picked as study material by hand during the read: read it again as that.
				Some(now) if FileKind::of(&now) == Some(FileKind::Study) => {
					patch_file(app, space_id, file_id, &[("status", Some(FileStatus::Pending.into())), ("error", None)]);
					enqueue_file(app, space_id, file_id);
				}
				// Switched to space info meanwhile: its own queued run settles it.
				_ => {}
			}
		}
		Ok(_) => {
			patch_file(app, space_id, file_id, &[("status", Some(FileStatus::Ready.into())), ("contentFp", fp_json), ("sourceId", Some(source_id.as_str().into())), ("error", None)]);
		}
		Err(err) => {
			if app.stores.spaces.get_space(space_id).is_some() {
				patch_file(app, space_id, file_id, &[("status", Some(FileStatus::Failed.into())), ("contentFp", fp_json), ("sourceId", Some(source_id.as_str().into())), ("error", Some(format!("{}: {}", err.outcome.as_str(), err.message).into()))]);
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

/// A file whose facts come from another (a recording from its lecture's transcript, a .tex from
/// its PDF): ready with no facts of its own (any from an earlier read go, so nothing is in the
/// graph twice). A recording's saved transcript stays in case it is needed again.
fn take_facts_from(app: &Arc<App>, record: &Json, file: &Json, transcript_id: Option<&str>) {
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
	patch_file(app, space_id, file_id, &[("status", Some(FileStatus::Ready.into())), ("contentFp", Some("".into())), ("statSig", sig.map(Json::from)), ("sourceId", None), ("transcriptId", transcript_id.map(Json::from)), ("error", None)]);
}

/// A file's text for the notes pipeline: a recording's or document's saved (or freshly made)
/// text, the file itself otherwise.
pub(super) async fn file_text(app: &Arc<App>, space_id: &str, file: &Json, abs: &Path, fp: &str) -> Result<String, TextError> {
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

#[cfg(test)]
mod tests {
	use gs_base::clock;
	use gs_json::json;
	use gs_runtime::fake::{FakeAgent, FakeStep};

	use super::*;
	use crate::app::agents::pick_stand_in;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::spaces::{add_copied_file, add_file_from_path, set_file_kind, write_agent_file};

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

	/// Where a reading is asked whether its file is logistics.
	const ASKS_IF_LOGISTICS: &str = "spaceInfo: true";

	/// The stand-in agent reads `files` files: logistics whenever it is asked whether the file is.
	fn reads_as_logistics(app: &Arc<App>, files: usize) -> FakeAgent {
		let agent = FakeAgent::default();
		let submit = |findings: Json| vec![FakeStep::Tool { name: "submit_findings".to_owned(), args: findings }];
		for _ in 0..files {
			agent.push(submit(json!({ "propositions": [], "chains": [], "reteaches": [] })));
			agent.push_for(ASKS_IF_LOGISTICS, submit(json!({ "propositions": [], "chains": [], "reteaches": [], "spaceInfo": true })));
		}
		pick_stand_in(app, agent.runtime());
		agent
	}

	/// The files among `names` whose reading asked whether they are logistics.
	fn asked_if_logistics(agent: &FakeAgent, names: &[&str]) -> Vec<String> {
		let sent = agent.sent();
		let sessions = sent.iter().filter(|m| m["type"].as_str() == Some("open") && m["systemPrompt"].str_or_empty().contains(ASKS_IF_LOGISTICS)).map(|m| m["session"].clone());
		let read = |session: Json| sent.iter().find(|m| m["type"].as_str() == Some("send") && m["session"] == session).map(|m| m["content"][0]["text"].str_or_empty().to_owned()).unwrap_or_default();
		sessions.map(|session| names.iter().find(|n| read(session.clone()).contains(**n)).expect("the file's name in the reading").to_string()).collect()
	}

	#[tokio::test]
	async fn a_file_the_learner_added_is_sorted_on_its_first_read_and_a_kind_set_on_purpose_is_not() {
		let root = scratch_dir("sorting");
		let app = test_app(&root);
		let agent = reads_as_logistics(&app, 5);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Biology" })).unwrap()["id"].as_str().unwrap().to_owned();
		let id = |file: Json| file["id"].as_str().unwrap().to_owned();
		let syllabus = id(add_copied_file(&app, &space_id, "Syllabus.md", b"Office hours move to Tuesday.").unwrap());
		let moved = id(add_copied_file(&app, &space_id, "Week 1.md", b"Cells divide.").unwrap());
		set_file_kind(&app, &space_id, &moved, FileKind::Study).unwrap();
		let written = id(write_agent_file(&app, &space_id, "Study guide.md", b"Mitosis has four phases.", FileKind::Study).unwrap().0);
		let reading = root.join("Reading.md");
		fsx::write_text_atomic(&reading, "Meiosis halves the chromosomes.").unwrap();
		let from_path = id(add_file_from_path(&app, &space_id, reading.to_str().unwrap(), FileKind::Study).unwrap());
		let transcript = id(add_copied_file(&app, &space_id, "Lecture 1.vtt", b"WEBVTT\n\n00:00.000 --> 00:02.000\nCells divide.\n").unwrap());

		let file = |file_id: &str| file_in(&app.stores.spaces.get_space(&space_id).unwrap(), file_id).unwrap().clone();
		for _ in 0..400 {
			if [&syllabus, &moved, &written, &from_path, &transcript].iter().all(|f| file(f)["status"] == json!("ready")) {
				break;
			}
			clock::sleep(10).await;
		}
		let names = ["Syllabus.md", "Week 1.md", "Study guide.md", "Reading.md", "Lecture 1.vtt"];
		assert_eq!(asked_if_logistics(&agent, &names), ["Syllabus.md"]);
		assert_eq!((&file(&syllabus)["kind"], &file(&syllabus)["sortedAsInfo"]), (&json!("info"), &json!(true)));
		for kept in [&moved, &written, &from_path, &transcript] {
			let kept = file(kept);
			assert_eq!((&kept["kind"], &kept["status"], kept.get("sortedAsInfo")), (&json!("study"), &json!("ready"), None), "{kept:?}");
		}
	}
}
