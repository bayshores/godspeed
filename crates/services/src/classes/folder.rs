//! Linking, unlinking and scanning a class's folder on this computer (classes.ts). A scan adds new
//! files (with the kind of the series they join), rebuilds edited ones and drops deleted ones,
//! each once the change has held still for SETTLE_MS. A new file with the contents of a copied
//! file, or of a folder file that just went (renamed or moved), takes over that file's entry.

use std::collections::{HashMap, HashSet};
use std::io;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::Path;
use std::sync::Arc;

use gs_base::config::resolve;
use gs_base::events::EventKind;
use gs_base::{clock, fsx, time};
use gs_core::classes::lecture_transcript::transcript_for;
use gs_core::classes::linked_folder::folder_source;
use gs_core::classes::new_files::kinds_for_new_files;
use gs_files::fingerprint::fingerprint_file;
use gs_files::walk::{SkippedFiles, walk_linked_folder};
use gs_json::{Json, Obj, json};

use super::class_card::class_file_path;
use super::files::{drop_file, file_in, files_of, import_running, mutate_files, new_file_id, str_of};
use super::pipeline::enqueue_file;
use super::state::SeenFile;
use super::{ClassFailure, ClassOutcome, fail, no_class};
use crate::App;
use crate::app::agent_actions::record_folder_files;

/// How long a folder change must hold still before a scan acts on it: a file still being written
/// or downloaded (a synced Drive folder) keeps changing size, and reading half a PDF would mean
/// building it twice.
const SETTLE_MS: i64 = 30_000;

const FOLDER_NOT_RESPONDING: &str = "That folder isn't responding. If it's on Google Drive, make sure Drive is open and not paused, then try again.";

/// Errors of a folder that is there but not answering (a synced folder whose app is paused or
/// offline), unlike one that is gone.
fn not_responding(err: &io::Error) -> bool {
	matches!(fsx::error_code(err), Some("ETIMEDOUT" | "EIO" | "EAGAIN" | "ECANCELED"))
}

/// `${st.mtimeMs}:${st.size}`: a file's change signature.
pub(super) fn stat_sig(file: &Path) -> io::Result<String> {
	let meta = std::fs::metadata(file)?;
	let mtime_ms = meta.mtime() as f64 * 1000.0 + meta.mtime_nsec() as f64 / 1e6;
	Ok(format!("{}:{}", gs_json::js_number(mtime_ms), meta.len()))
}

pub fn link_folder(app: &Arc<App>, class_id: &str, folder: &str) -> ClassOutcome<Json> {
	let Some(record) = app.stores.classes.get_class(class_id) else { return no_class() };
	// The scan skips archived classes, so a link here would add nothing.
	if record["archived"].truthy() {
		return fail(409, "archived", "This class is archived. Unarchive it first, then link the folder.");
	}
	if !folder.starts_with('/') {
		return fail(400, "bad_path", "Give the folder's full (absolute) path");
	}
	match std::fs::metadata(folder) {
		Ok(meta) if !meta.is_dir() => return fail(400, "not_a_folder", format!("{folder} is not a folder")),
		Ok(_) => {}
		Err(err) if not_responding(&err) => return fail(503, "folder_not_responding", FOLDER_NOT_RESPONDING),
		Err(_) => return fail(404, "folder_not_found", format!("No folder at {folder}")),
	}
	// Linking another folder keeps the old folder's file entries: the scan drops the ones the new
	// folder lacks, and a file at the same path with the same contents keeps its facts.
	let resolved = resolve(Path::new(folder)).to_string_lossy().into_owned();
	app.stores.classes.update_class(class_id, &json!({ "linkedFolder": resolved })).map_err(ClassFailure::thrown)?;
	scan_linked_folder(app, class_id, true);
	app.stores.classes.get_class(class_id).ok_or_else(|| ClassFailure::thrown("the class went away"))
}

/// Unlink: the linked files leave the class, their facts with them.
pub fn unlink_folder(app: &Arc<App>, class_id: &str) -> ClassOutcome<Json> {
	let Some(record) = app.stores.classes.get_class(class_id) else { return no_class() };
	if !record["linkedFolder"].truthy() {
		return fail(400, "no_folder", "This class has no linked folder");
	}
	let linked: Vec<Json> = files_of(&record).iter().filter(|f| str_of(f, "origin") == "linked").cloned().collect();
	if linked.iter().any(|f| import_running(app, class_id, f)) {
		return fail(409, "extraction_running", "A linked file is being turned into facts. Try again when it finishes.");
	}
	for file in &linked {
		if let Some(current) = app.stores.classes.get_class(class_id) {
			drop_file(app, &current, file, false);
		}
	}
	app.classes.folder_scans.lock().remove(class_id);
	app.stores.classes.update_class(class_id, &json!({ "linkedFolder": null })).map_err(ClassFailure::thrown)
}

/// The linked folder as its last scan saw it: `{ problem, checkedAt, settling, skipped? }`.
pub fn folder_status_of(app: &App, class_id: &str) -> Json {
	app.classes.folder_scans.lock().get(class_id).cloned().unwrap_or_else(|| json!({ "problem": null, "checkedAt": null, "settling": 0 }))
}

fn skipped_json(skipped: &SkippedFiles) -> Json {
	json!({ "count": skipped.count, "examples": skipped.examples.clone(), "google": skipped.google })
}

/// Records a scan's finding. `read` (how many files are settling, and the files skipped) is given
/// when the scan read the folder through (it counts as checked); otherwise the last skipped files
/// are kept. The Files page re-reads when what it shows changes.
fn set_folder_status(app: &App, class_id: &str, problem: Option<&str>, read: Option<(usize, &SkippedFiles)>) {
	let prev = folder_status_of(app, class_id);
	let kept = match read {
		Some((_, skipped)) => skipped_json(skipped),
		None => prev["skipped"].clone(),
	};
	let mut next = Obj::new();
	next.insert("problem", problem.map_or(Json::Null, Json::from));
	next.insert("checkedAt", if read.is_some() { Json::from(time::iso_now()) } else { prev["checkedAt"].clone() });
	next.insert("settling", read.map_or(0, |(settling, _)| settling));
	if kept["count"].as_f64().is_some_and(|c| c > 0.0) {
		next.insert("skipped", kept);
	}
	let next = Json::Obj(next);
	let changed = prev["problem"] != next["problem"] || prev["settling"] != next["settling"] || prev["skipped"] != next["skipped"];
	app.classes.folder_scans.lock().insert(class_id.to_owned(), next);
	if changed {
		app.events.emit(EventKind::ClassesChanged, json!({}));
	}
}

/// One scan of a class's linked folder. `linking` (the folder was just picked) takes the folder as
/// it is at once and announces nothing. Synchronous except for the triage of new files and the
/// queued processing; a scan asked for while new files are triaged runs after the triage.
pub fn scan_linked_folder(app: &Arc<App>, class_id: &str, linking: bool) {
	let running = app.classes.triaging.lock().get(class_id).copied();
	if let Some(triage) = running {
		let (app, class_id) = (app.clone(), class_id.to_owned());
		tokio::spawn(async move {
			triage_done(&app, &class_id, triage).await;
			scan_linked_folder(&app, &class_id, linking);
		});
		return;
	}
	let Some(record) = app.stores.classes.get_class(class_id) else { return };
	let Some(root) = record["linkedFolder"].as_str().filter(|f| !f.is_empty() && !record["archived"].truthy()) else { return };
	let walked = std::fs::metadata(root).and_then(|meta| {
		if !meta.is_dir() {
			return Err(io::Error::other("not a folder"));
		}
		walk_linked_folder(Path::new(root), &app.classes.text_checks)
	});
	let walk = match walked {
		Ok(walk) => walk,
		Err(err) => {
			// Folder gone (moved, renamed, drive unplugged) or not answering (Google Drive paused or
			// offline): its files and facts stay, and the Files page says which.
			set_folder_status(app, class_id, Some(if not_responding(&err) { "not-responding" } else { "missing" }), None);
			return;
		}
	};
	let linked: Vec<&Json> = files_of(&record).iter().filter(|f| str_of(f, "origin") == "linked").collect();
	// A synced folder (Google Drive starting up, signed out) can look empty for a while: that is
	// never taken as every file deleted.
	if !linking && walk.files.is_empty() && !linked.is_empty() {
		set_folder_status(app, class_id, Some("empty"), None);
		return;
	}

	let now = clock::now_ms();
	let before = app.classes.seen_files.lock().get(class_id).cloned().unwrap_or_default();
	let mut seen: HashMap<String, SeenFile> = HashMap::new();
	let mut settled = |rel: &str, sig: Option<String>| -> bool {
		let since = match before.get(rel) {
			_ if linking => 0,
			Some(last) if last.sig == sig => last.since,
			_ => now,
		};
		seen.insert(rel.to_owned(), SeenFile { sig, since });
		now - since >= SETTLE_MS
	};

	let present: HashSet<&str> = walk.files.iter().map(String::as_str).collect();
	// Like `new Map(linked.map(f => [f.path, f]))`: first place, last file.
	let mut known: Vec<(&str, &Json)> = Vec::new();
	for file in &linked {
		let rel = str_of(file, "path");
		match known.iter_mut().find(|(k, _)| *k == rel) {
			Some(slot) => slot.1 = file,
			None => known.push((rel, file)),
		}
	}
	let known_file = |rel: &str| known.iter().find(|(k, _)| *k == rel).map(|(_, f)| *f);
	// Gone from the folder: facts go. Files in a subfolder that can't be read, files that couldn't
	// be checked, or past the file cap where the walk stopped, are not known to be gone, so they
	// stay.
	let in_unreadable = |rel: &str| walk.unreadable.iter().any(|dir| rel == dir || rel.starts_with(&format!("{dir}/")));
	let mut gone: Vec<Json> = Vec::new();
	for (rel, file) in &known {
		if present.contains(rel) || in_unreadable(rel) || import_running(app, class_id, file) {
			continue;
		}
		if walk.capped && Path::new(root).join(rel).exists() {
			continue;
		}
		if settled(rel, None) {
			gone.push((*file).clone());
		}
	}
	let mut added: Vec<Json> = Vec::new();
	let mut to_process: Vec<String> = Vec::new();
	let mut settling = 0;
	for rel in &walk.files {
		let Ok(sig) = stat_sig(&Path::new(root).join(rel)) else { continue };
		if !settled(rel, Some(sig.clone())) {
			if known_file(rel).is_none() {
				settling += 1;
			}
			continue;
		}
		if let Some(file) = known_file(rel) {
			if file["statSig"].as_str() != Some(sig.as_str()) && str_of(file, "status") != "extracting" {
				to_process.push(str_of(file, "id").to_owned());
			}
			continue;
		}
		let mut file = Obj::new();
		file.insert("id", new_file_id());
		file.insert("origin", "linked");
		file.insert("name", rel.rsplit('/').next().unwrap_or(rel));
		file.insert("path", rel.as_str());
		file.insert("kind", "study");
		file.insert("contentFp", "");
		file.insert("status", "pending");
		file.insert("addedAt", time::iso_now());
		if !linking {
			file.insert("foundByScan", true);
		}
		added.push(Json::Obj(file));
	}
	app.classes.seen_files.lock().insert(class_id.to_owned(), seen);
	set_folder_status(app, class_id, if walk.capped { Some("too-many-files") } else { None }, Some((settling, &walk.skipped)));
	for id in &to_process {
		enqueue_file(app, class_id, id);
	}
	if added.is_empty() {
		drop_gone(app, class_id, &gone, !linking);
		return;
	}
	let existing = app.stores.classes.get_class(class_id).map(|r| files_of(&r).to_vec()).unwrap_or_default();
	let kinds = kinds_for_new_files(&existing, &added);
	for file in &mut added {
		let kind = kinds.get(str_of(file, "id")).cloned().unwrap_or_else(|| "study".to_owned());
		if let Some(obj) = file.as_obj_mut() {
			obj.insert("kind", kind);
		}
	}
	let ids: Vec<String> = added.iter().map(|f| str_of(f, "id").to_owned()).collect();
	mutate_files(
		app,
		class_id,
		move |mut files| {
			files.extend(added);
			files
		},
		&[],
	);
	triage_new_files(app, class_id, ids, gone, !linking);
}

/// Waits until the triage numbered `triage` of this class has ended.
async fn triage_done(app: &App, class_id: &str, triage: u64) {
	loop {
		let notified = app.classes.settled.notified();
		tokio::pin!(notified);
		notified.as_mut().enable();
		if app.classes.triaging.lock().get(class_id) != Some(&triage) {
			return;
		}
		notified.await;
	}
}

/// New folder files, before they are read. One with the same contents as a copied file, or as a
/// folder file that just went (renamed or moved), becomes that file's entry, which keeps its id,
/// kind, facts and deadlines. The rest are announced (one notice, however many) and queued, and the
/// gone files nothing matched lose their facts. Runs off the file queue, which can wait a long
/// time for the agent.
fn triage_new_files(app: &Arc<App>, class_id: &str, added_ids: Vec<String>, gone: Vec<Json>, announce: bool) {
	let triage = {
		let mut count = app.classes.triage_count.lock();
		*count += 1;
		*count
	};
	app.classes.triaging.lock().insert(class_id.to_owned(), triage);
	let (app, class_id) = (app.clone(), class_id.to_owned());
	tokio::spawn(async move {
		let run = tokio::spawn(triage_files(app.clone(), class_id.clone(), added_ids, gone, announce));
		if let Err(err) = run.await {
			eprintln!("[classes] new files in {class_id}: {err}");
		}
		let mut triaging = app.classes.triaging.lock();
		if triaging.get(&class_id) == Some(&triage) {
			triaging.remove(&class_id);
		}
		drop(triaging);
		app.classes.settled.notify_waiters();
	});
}

/// The class record as get_class gives it, read again only after a class was written (every class
/// write announces classes-changed), so triaging hundreds of new files doesn't parse the whole
/// record twice per file.
struct RecordCache {
	changes: tokio::sync::mpsc::UnboundedReceiver<gs_base::events::Event>,
	record: Option<Json>,
}

impl RecordCache {
	fn new(app: &App) -> RecordCache {
		RecordCache { changes: app.events.subscribe(), record: None }
	}

	fn get(&mut self, app: &App, class_id: &str) -> Option<&Json> {
		let mut stale = self.record.is_none();
		while let Ok(event) = self.changes.try_recv() {
			stale |= event.kind == EventKind::ClassesChanged;
		}
		if stale {
			self.record = app.stores.classes.get_class(class_id);
		}
		self.record.as_ref()
	}
}

async fn triage_files(app: Arc<App>, class_id: String, added_ids: Vec<String>, gone: Vec<Json>, announce: bool) {
	let app = &app;
	let class_id = class_id.as_str();
	let mut unmatched: HashSet<String> = gone.iter().map(|f| str_of(f, "id").to_owned()).collect();
	let mut fresh: Vec<Json> = Vec::new();
	let mut cache = RecordCache::new(app);
	for id in &added_ids {
		let Some(record) = cache.get(app, class_id) else { continue };
		let Some(file) = file_in(record, id).cloned() else { continue };
		let Some(abs) = class_file_path(app, record, &file) else { continue };
		// A covered recording is never read (on Google Drive that would download the video).
		if transcript_for(&file, files_of(record)).is_some() {
			fresh.push(file);
			continue;
		}
		let Ok(sig) = stat_sig(Path::new(&abs)) else {
			fresh.push(file);
			continue;
		};
		// Unreadable (a Drive file that is online-only while offline): the queue marks it failed, with Retry.
		let Ok(fp) = fingerprint_file(Path::new(&abs)).await else {
			fresh.push(file);
			continue;
		};
		let matched = cache.get(app, class_id).and_then(|r| {
			files_of(r).iter().find(|f| str_of(f, "contentFp") == fp && (str_of(f, "origin") == "copied" || unmatched.contains(str_of(f, "id")))).cloned()
		});
		let Some(matched) = matched else {
			fresh.push(file);
			continue;
		};
		let matched_id = str_of(&matched, "id").to_owned();
		let was_copied = str_of(&matched, "origin") == "copied";
		unmatched.remove(&matched_id);
		mutate_files(
			app,
			class_id,
			|files| {
				files
					.into_iter()
					.filter(|f| f["id"].as_str() != Some(id.as_str()))
					.map(|mut f| {
						if f["id"].as_str() == Some(matched_id.as_str())
							&& let Some(obj) = f.as_obj_mut()
						{
							obj.insert("origin", "linked");
							obj.insert("name", file["name"].clone());
							obj.insert("path", file["path"].clone());
							obj.insert("statSig", sig.as_str());
							// A copy's kind was picked when it was added, so it stays picked.
							if was_copied {
								obj.insert("kindChosen", true);
							}
						}
						f
					})
					.collect()
			},
			&[],
		);
		if was_copied {
			remove_copy_dir(app, class_id, &matched_id);
		}
	}
	let still: Vec<Json> = gone
		.into_iter()
		.filter(|file| {
			unmatched.contains(str_of(file, "id"))
				&& app.stores.classes.get_class(class_id).is_some_and(|r| file_in(&r, str_of(file, "id")).is_some())
				&& !import_running(app, class_id, file)
		})
		.collect();
	drop_gone(app, class_id, &still, announce);
	let folder = app.stores.classes.get_class(class_id).and_then(|r| r["linkedFolder"].as_str().filter(|f| !f.is_empty()).map(str::to_owned));
	if let Some(folder) = folder.filter(|_| announce && !fresh.is_empty()) {
		let files: Vec<Json> = fresh.iter().map(|f| json!({ "id": f["id"], "name": f["name"], "kind": f["kind"] })).collect();
		app.events.emit(EventKind::FilesAdded, json!({ "classId": class_id, "files": files }));
		record_folder_files(app, class_id, fresh.len(), &folder_source(&folder));
	}
	for file in &fresh {
		enqueue_file(app, class_id, str_of(file, "id"));
	}
}

/// Files gone from the linked folder lose their facts. Unless a folder was just linked in its
/// place, they are listed and announced (one notice).
fn drop_gone(app: &Arc<App>, class_id: &str, gone: &[Json], announce: bool) {
	for file in gone {
		if let Some(record) = app.stores.classes.get_class(class_id) {
			drop_file(app, &record, file, announce);
		}
	}
	if announce && !gone.is_empty() {
		let files: Vec<Json> = gone.iter().map(|f| json!({ "id": f["id"], "name": f["name"] })).collect();
		app.events.emit(EventKind::FilesRemoved, json!({ "classId": class_id, "files": files }));
	}
}

/// Deletes a copied file's folder, read-only files included.
fn remove_copy_dir(app: &App, class_id: &str, file_id: &str) {
	let Ok(dir) = app.stores.classes.files_dir(class_id).map(|d| d.join(file_id)) else { return };
	if let Ok(entries) = std::fs::read_dir(&dir) {
		for entry in entries.flatten() {
			let _ = std::fs::set_permissions(entry.path(), std::fs::Permissions::from_mode(0o644));
		}
	}
	let _ = std::fs::remove_dir_all(&dir);
}
