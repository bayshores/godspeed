//! A space's file list: adding, replacing, re-kinding, retrying and removing files (spaces.ts).
//! The list is a read-modify-write record, so every change runs under the space's lock.

use std::path::Path;
use std::sync::Arc;

use gs_base::config::is_absolute;
use gs_base::hash::sha256_text;
use gs_base::locks::LockKey;
use gs_base::{events::EventKind, fsx, ids, time};
use gs_core::spaces::lecture_transcript::recordings_to_recheck;
use gs_core::contracts::space::{safe_name, supported_space_file_extensions};
use gs_core::graph::graph_deletion::delete_source_traces;
use gs_files::text::{is_readable_space_file, looks_like_text};
use gs_json::{Json, Obj, json};

use super::space_card::space_file_path;
use super::pipeline::enqueue_file;
use super::text_cache::drop_file_texts;
use super::{SpaceOutcome, fail, no_space};
use crate::App;
use crate::graph::extraction_runs::extraction_statuses;
use crate::graph::graph::graph_store_for;

/// The extraction_running refusal for the outside agent: the file's reading is a work item
/// waiting for that same agent, so it only finishes once the agent answers it.
pub const AGENT_FILE_READING_REFUSAL: &str =
	"This file is still being turned into facts, and that work waits for you. Get that work item with wait_for_work (or the waiter), answer it, then try again.";

/// The notes-source id a space file's facts are born under: unique per space + file, so the same
/// filename in two spaces never collides.
pub fn source_id_for(space_id: &str, file_id: &str) -> String {
	format!("src_{}", &sha256_text(&format!("{space_id}:{file_id}"))[..12])
}

pub(super) fn files_of(record: &Json) -> &[Json] {
	record["files"].as_arr().map_or(&[], Vec::as_slice)
}

pub(super) fn file_in<'a>(record: &'a Json, file_id: &str) -> Option<&'a Json> {
	files_of(record).iter().find(|f| f["id"].as_str() == Some(file_id))
}

pub(super) fn str_of<'a>(v: &'a Json, key: &str) -> &'a str {
	v[key].as_str().unwrap_or("")
}

pub(super) fn new_file_id() -> String {
	ids::uuid_hex("f", 12)
}

/// Replaces the space's file list with `change(files)` and records `removed` in the Recent
/// changes. Recordings a transcript now covers (or no longer covers) go back to pending and are
/// queued. The record as saved; None for an unknown space.
pub(super) fn mutate_files(app: &Arc<App>, space_id: &str, change: impl FnOnce(Vec<Json>) -> Vec<Json>, removed: &[Json]) -> Option<Json> {
	let (next, recheck) = {
		let _guard = app.locks.lock(LockKey::Space(space_id));
		let record = app.stores.spaces.get_space(space_id)?;
		let mut files = change(files_of(&record).to_vec());
		let recheck = recordings_to_recheck(&files);
		for file in &mut files {
			if file["id"].as_str().is_some_and(|id| recheck.iter().any(|r| r == id))
				&& let Some(obj) = file.as_obj_mut()
			{
				obj.insert("status", "pending");
				obj.remove("transcriptId");
			}
		}
		match app.stores.spaces.save_files(space_id, files, removed) {
			Ok(next) => (next, recheck),
			Err(err) => {
				eprintln!("[spaces] could not save the files of {space_id}: {err}");
				return None;
			}
		}
	};
	app.events.emit(EventKind::SpacesChanged, json!({}));
	for id in &recheck {
		enqueue_file(app, space_id, id);
	}
	Some(next)
}

/// A file change: each key set, or removed where the value is None (`undefined` in the TS patch).
pub(super) type Patch<'a> = &'a [(&'a str, Option<Json>)];

/// Patches one file; the file as stored.
pub(super) fn patch_file(app: &Arc<App>, space_id: &str, file_id: &str, patch: Patch) -> Option<Json> {
	let next = mutate_files(
		app,
		space_id,
		|files| {
			files
				.into_iter()
				.map(|mut f| {
					if f["id"].as_str() == Some(file_id)
						&& let Some(obj) = f.as_obj_mut()
					{
						for (key, value) in patch {
							match value {
								Some(v) => obj.insert(*key, v.clone()),
								None => obj.remove(key),
							};
						}
					}
					f
				})
				.collect()
		},
		&[],
	)?;
	file_in(&next, file_id).cloned()
}

/// Why a file can't be copied into a space; None when it can.
pub fn copied_file_problem(name: &str, bytes: &[u8]) -> Option<String> {
	let clean = safe_name(name);
	if is_readable_space_file(&clean, || Some(looks_like_text(bytes))) == Some(true) {
		return None;
	}
	let supported: Vec<&str> = supported_space_file_extensions().collect();
	Some(format!("{clean}: unsupported file type. Supported: {}, and plain text with no extension. Google Docs need saving as PDF or Word first.", supported.join(" ")))
}

/// Copies a file into the space (the "Add files…" button, MCP add_space_file with a path).
pub fn add_copied_file(app: &Arc<App>, space_id: &str, name: &str, bytes: &[u8], kind: &str) -> SpaceOutcome<Json> {
	add_file(app, space_id, name, bytes, kind, false)
}

/// A file the agent writes from text (add_space_file with name and text, import_notes), marked
/// `written`: a later write by that name replaces only such a file and keeps its id, and the
/// learner's own file by that name is never written over. Ok holds the file and whether it was
/// replaced; Err is the words for the agent.
pub fn write_agent_file(app: &Arc<App>, space_id: &str, name: &str, bytes: &[u8], kind: &str) -> Result<(Json, bool), String> {
	let record = app.stores.spaces.get_space(space_id);
	let same = record.as_ref().and_then(|r| r["files"].as_arr()?.iter().find(|f| str_of(f, "name") == name).cloned());
	let written = match same {
		Some(file) if file["written"] == Json::Bool(true) => replace_copied_file(app, space_id, str_of(&file, "id"), bytes, kind).map(|f| (f, true)),
		Some(_) => return Err(format!("This space already has a file named {name} that you didn't write. Pick another name.")),
		None => add_file(app, space_id, name, bytes, kind, true).map(|f| (f, false)),
	};
	written.map_err(|failure| failure.error)
}

fn add_file(app: &Arc<App>, space_id: &str, name: &str, bytes: &[u8], kind: &str, written: bool) -> SpaceOutcome<Json> {
	// Held from the check to the list entry: a space deleted in between would leave the copy in a
	// folder nothing lists.
	let _held = app.locks.lock(LockKey::Space(space_id));
	if app.stores.spaces.get_space(space_id).is_none() {
		return no_space();
	}
	if let Some(problem) = copied_file_problem(name, bytes) {
		return fail(400, "unsupported_type", problem);
	}
	let clean = safe_name(name);
	let id = new_file_id();
	let rel = format!("{id}/{clean}");
	let Ok(dir) = app.stores.spaces.files_dir(space_id) else { return no_space() };
	let abs = dir.join(&rel);
	if let Err(err) = fsx::write_atomic(&abs, bytes, None) {
		return Err(super::SpaceFailure::thrown(fsx::node_error_message(&err, "open", &abs)));
	}
	let mut file = Obj::new();
	file.insert("id", id.as_str());
	file.insert("origin", "copied");
	file.insert("name", clean);
	file.insert("path", rel);
	file.insert("kind", kind);
	file.insert("contentFp", "");
	file.insert("status", "pending");
	file.insert("addedAt", time::iso_now());
	if written {
		file.insert("written", true);
	}
	let file = Json::Obj(file);
	let added = file.clone();
	mutate_files(app, space_id, move |mut files| {
		files.push(added);
		files
	}, &[]);
	enqueue_file(app, space_id, &id);
	Ok(file)
}

/// Writes new contents over a copied file, keeping its id so deadlines that cover it still do;
/// its facts are rebuilt.
pub fn replace_copied_file(app: &Arc<App>, space_id: &str, file_id: &str, bytes: &[u8], kind: &str) -> SpaceOutcome<Json> {
	// Held from the check to the list entry, as in `add_copied_file`.
	let _held = app.locks.lock(LockKey::Space(space_id));
	let record = app.stores.spaces.get_space(space_id);
	let file = record.as_ref().and_then(|r| file_in(r, file_id)).cloned();
	let (Some(record), Some(file)) = (record, file.filter(|f| str_of(f, "origin") == "copied")) else {
		return fail(404, "not_found", "No such copied space file");
	};
	if import_running(app, space_id, &file) {
		return fail(409, "extraction_running", AGENT_FILE_READING_REFUSAL);
	}
	if let Some(abs) = space_file_path(app, &record, &file)
		&& let Err(err) = fsx::write_atomic(Path::new(&abs), bytes, None)
	{
		return Err(super::SpaceFailure::thrown(fsx::node_error_message(&err, "open", Path::new(&abs))));
	}
	let patched = patch_file(app, space_id, file_id, &[("kind", Some(kind.into())), ("status", Some("pending".into())), ("contentFp", Some("".into())), ("error", None)]);
	enqueue_file(app, space_id, file_id);
	Ok(patched.unwrap_or(file))
}

/// Copies a file from an absolute path on this computer (MCP).
pub fn add_file_from_path(app: &Arc<App>, space_id: &str, abs_path: &str, kind: &str) -> SpaceOutcome<Json> {
	if !is_absolute(abs_path) {
		return fail(400, "bad_path", "Give the file's full (absolute) path");
	}
	let Ok(meta) = std::fs::metadata(abs_path) else {
		return fail(404, "file_not_found", format!("No file at {abs_path}"));
	};
	if !meta.is_file() {
		return fail(400, "not_a_file", format!("{abs_path} is not a file"));
	}
	let bytes = std::fs::read(abs_path).map_err(|err| super::SpaceFailure::thrown(fsx::node_error_message(&err, "open", Path::new(abs_path))))?;
	add_copied_file(app, space_id, &node_basename(abs_path), &bytes, kind)
}

/// `path.basename`: the last part, trailing separators ignored.
fn node_basename(p: &str) -> String {
	Path::new(p).file_name().map_or_else(String::new, |name| name.to_string_lossy().into_owned())
}

/// Switches a file between study material and space info by hand: godspeed never sorts it by
/// itself again. Study to info removes its facts; info to study builds them.
pub fn set_file_kind(app: &Arc<App>, space_id: &str, file_id: &str, kind: &str) -> SpaceOutcome<Json> {
	let Some(file) = app.stores.spaces.get_space(space_id).and_then(|r| file_in(&r, file_id).cloned()) else {
		return fail(404, "not_found", "No such space file");
	};
	let chosen = [("kindChosen", Some(Json::from(true))), ("sortedAsInfo", None)];
	if str_of(&file, "kind") == kind {
		return Ok(patch_file(app, space_id, file_id, &chosen).unwrap_or(file));
	}
	let patch = [
		chosen[0].clone(),
		chosen[1].clone(),
		("kind", Some(kind.into())),
		("status", Some("pending".into())),
		("contentFp", Some("".into())),
		("transcriptId", None),
		("error", None),
	];
	let patched = patch_file(app, space_id, file_id, &patch);
	enqueue_file(app, space_id, file_id);
	Ok(patched.unwrap_or(file))
}

/// Runs a failed (or any) file again.
pub fn retry_file(app: &Arc<App>, space_id: &str, file_id: &str) -> SpaceOutcome<()> {
	if app.stores.spaces.get_space(space_id).and_then(|r| file_in(&r, file_id).cloned()).is_none() {
		return fail(404, "not_found", "No such space file");
	}
	patch_file(app, space_id, file_id, &[("status", Some("pending".into())), ("contentFp", Some("".into())), ("error", None)]);
	enqueue_file(app, space_id, file_id);
	Ok(())
}

/// Removes a file and its facts. A copied file's copy is deleted; a linked file is refused (it
/// would come back on the next scan).
pub fn remove_file(app: &Arc<App>, space_id: &str, file_id: &str) -> SpaceOutcome<()> {
	let record = app.stores.spaces.get_space(space_id);
	let Some((record, file)) = record.and_then(|r| file_in(&r, file_id).cloned().map(|f| (r, f))) else {
		return fail(404, "not_found", "No such space file");
	};
	if str_of(&file, "origin") == "linked" {
		return fail(409, "linked_file", "This file is in your linked folder. Remove it from the folder (or switch it to space info) instead.");
	}
	if import_running(app, space_id, &file) {
		return fail(409, "extraction_running", "This file is being turned into facts. Try again when it finishes.");
	}
	drop_file(app, &record, &file, true);
	Ok(())
}

/// A file's import runs under `source_id_for`, which a first import has not saved on the file
/// yet.
pub(super) fn import_running(app: &Arc<App>, space_id: &str, file: &Json) -> bool {
	let source_id = source_id_for(space_id, str_of(file, "id"));
	extraction_statuses(app).iter().any(|run| run["chatId"].as_str() == Some(source_id.as_str()))
}

/// Facts by `source_id` leave the space graph (shared facts survive by the deletion law).
pub(super) fn drop_source_facts(app: &Arc<App>, space_id: &str, source_id: &str) -> Result<(), String> {
	let _guard = app.locks.lock(LockKey::Graph(Some(space_id)));
	delete_source_traces(graph_store_for(app, Some(space_id)).as_ref(), source_id).map(drop)
}

/// Takes a file out of the space's search index in the background.
pub(super) fn drop_from_search(app: &Arc<App>, space_id: &str, file_id: &str) {
	let (app, space_id, file_id) = (app.clone(), space_id.to_owned(), file_id.to_owned());
	tokio::spawn(async move {
		if let Err(err) = app.search.drop_space_file(&space_id, &file_id).await {
			eprintln!("[spaces] could not drop {file_id} from search: {err}");
		}
	});
}

/// The removal: facts, transcript, copy, list entry. Facts go by `source_id_for`, so an import
/// that never saved its id leaves nothing. `listed` puts it in the Recent changes (not when a
/// folder is unlinked).
pub(super) fn drop_file(app: &Arc<App>, record: &Json, file: &Json, listed: bool) {
	let space_id = str_of(record, "id");
	let file_id = str_of(file, "id");
	if let Err(err) = drop_source_facts(app, space_id, &source_id_for(space_id, file_id)) {
		eprintln!("[spaces] could not drop the facts of {file_id}: {err}");
	}
	drop_file_texts(app, space_id, file_id);
	drop_from_search(app, space_id, file_id);
	if str_of(file, "origin") == "copied"
		&& let Ok(dir) = app.stores.spaces.files_dir(space_id)
	{
		let _ = std::fs::remove_dir_all(dir.join(file_id));
	}
	let removed = if listed { vec![json!({ "id": file_id, "name": file["name"], "at": time::iso_now() })] } else { Vec::new() };
	mutate_files(app, space_id, |files| files.into_iter().filter(|f| f["id"].as_str() != Some(file_id)).collect(), &removed);
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn source_ids_hash_space_and_file() {
		assert_eq!(source_id_for("cls_a", "f_1"), format!("src_{}", &sha256_text("cls_a:f_1")[..12]));
		assert_eq!(source_id_for("cls_a", "f_1").len(), 16);
	}

	#[test]
	fn a_file_added_as_its_space_goes_leaves_no_copy() {
		let root = scratch_dir("add-copy");
		let app = test_app(&root);
		let space = app.stores.spaces.create_space(&json!({ "name": "Algebra" })).unwrap();
		let id = space["id"].as_str().unwrap().to_owned();
		// The delete holds the space while the add arrives.
		let held = app.locks.lock(LockKey::Space(&id));
		let (adding, space_id) = (app.clone(), id.clone());
		let add = std::thread::spawn(move || add_copied_file(&adding, &space_id, "week1.md", b"# Week 1\n", "study").map_err(|failure| failure.status));
		std::thread::sleep(std::time::Duration::from_millis(100));
		app.stores.spaces.delete_space(&id).unwrap();
		drop(held);
		assert_eq!(add.join().unwrap().map(drop), Err(404));
		assert!(!app.paths.spaces.join(&id).exists());
	}

	#[test]
	fn a_file_replaced_as_its_space_goes_leaves_no_copy() {
		let root = scratch_dir("replace-copy");
		let app = test_app(&root);
		let space = app.stores.spaces.create_space(&json!({ "name": "Algebra" })).unwrap();
		let id = space["id"].as_str().unwrap().to_owned();
		let file = json!({ "id": "f_week1", "origin": "copied", "name": "week1.md", "path": "f_week1/week1.md", "kind": "study", "contentFp": "", "status": "ready", "addedAt": "2030-01-01T00:00:00.000Z" });
		app.stores.spaces.save_files(&id, vec![file], &[]).unwrap();
		// The delete holds the space while the replace arrives.
		let held = app.locks.lock(LockKey::Space(&id));
		let (replacing, space_id) = (app.clone(), id.clone());
		let replace = std::thread::spawn(move || replace_copied_file(&replacing, &space_id, "f_week1", b"# Week 1, again\n", "study").map_err(|failure| failure.status));
		std::thread::sleep(std::time::Duration::from_millis(100));
		app.stores.spaces.delete_space(&id).unwrap();
		drop(held);
		assert_eq!(replace.join().unwrap().map(drop), Err(404));
		assert!(!app.paths.spaces.join(&id).exists());
	}

	#[test]
	fn basenames_like_node() {
		assert_eq!(node_basename("/a/b/c.txt"), "c.txt");
		assert_eq!(node_basename("/a/b/"), "b");
		assert_eq!(node_basename("/"), "");
	}
}
