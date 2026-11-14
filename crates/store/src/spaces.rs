//! ```text
//! <data>/spaces/<id>/space.json   the space record (class.json before the rename; read until
//!                                 the next write)
//! <data>/spaces/<id>/files/       copied space files (the app's own copies)
//! <data>/spaces/<id>/graph/       the space's own graph
//! ```
//!
//! A record is a `Json` object; reading checks it field by field (`gs_core::spaces::space_record`)
//! and every write stamps the current version.

use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Once;

use gs_base::config::Paths;
use gs_base::events::{EventKind, Events};
use gs_base::locks::{LockKey, Locks};
use gs_base::{clock, fsx, ids, locale, time};
use gs_core::spaces::space_deadlines::{changed_deadline, file_ids_of, new_deadline};
use gs_core::contracts::space::{CURRENT_SPACE_VERSION, SpaceDeadlineError, compare_deadlines, is_space_color, is_space_id, next_space_color};
use gs_core::spaces::space_record::{clean_name, newer_version, read_space_record, summarize};
use gs_core::spaces::space_work::{work_after_deadline, work_after_files};
use gs_core::records::teaching_areas::sanitize_rules;
use gs_json::{Json, Obj, json, parse, stringify_pretty};
use parking_lot::Mutex;

/// Why a space change was refused: a deadline that is wrong or missing, or anything else
/// (an unknown space, a disk error).
#[derive(Debug, Clone, PartialEq)]
pub enum SpaceError {
	Deadline(SpaceDeadlineError),
	Other(String),
}

impl fmt::Display for SpaceError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			SpaceError::Deadline(e) => f.write_str(&e.message),
			SpaceError::Other(message) => f.write_str(message),
		}
	}
}

impl From<SpaceDeadlineError> for SpaceError {
	fn from(e: SpaceDeadlineError) -> SpaceError {
		SpaceError::Deadline(e)
	}
}

impl From<String> for SpaceError {
	fn from(message: String) -> SpaceError {
		SpaceError::Other(message)
	}
}

/// Spaces were kept in data/classes before the rename. The folder moves in one step, or, when
/// data/spaces is already there (a move that failed, or a space made first), entry by entry. An
/// entry both folders have stays where it is, so nothing is overwritten.
fn adopt_old_folder(old: &Path, spaces: &Path) {
	if !old.exists() {
		return;
	}
	if !spaces.exists() {
		if let Err(err) = std::fs::rename(old, spaces) {
			eprintln!("[spaces] moving data/classes to data/spaces failed: {}", fsx::node_error_message(&err, "rename", old));
		}
		return;
	}
	let mut names: Vec<std::ffi::OsString> = match std::fs::read_dir(old) {
		Ok(entries) => entries.filter_map(|e| Some(e.ok()?.file_name())).collect(),
		Err(err) => {
			eprintln!("[spaces] moving data/classes to data/spaces failed: {}", fsx::node_error_message(&err, "scandir", old));
			return;
		}
	};
	names.sort();
	let mut stayed = 0;
	for name in names {
		let (from, to) = (old.join(&name), spaces.join(&name));
		let moved = if std::fs::symlink_metadata(&to).is_err() {
			std::fs::rename(&from, &to).is_ok()
		// Finder's file on both sides would keep data/classes for good.
		} else if name == ".DS_Store" && std::fs::symlink_metadata(&from).is_ok_and(|st| st.is_file()) {
			std::fs::remove_file(&from).is_ok()
		} else {
			false
		};
		if !moved {
			stayed += 1;
		}
	}
	if stayed > 0 {
		eprintln!("[spaces] {stayed} entries stayed in data/classes: data/spaces has the same names or they could not move");
	} else if let Err(err) = std::fs::remove_dir(old) {
		eprintln!("[spaces] moving data/classes to data/spaces failed: {}", fsx::node_error_message(&err, "rmdir", old));
	}
}

/// The record's round of work, or none.
fn set_work(record: &mut Obj, work: Option<Json>) {
	match work {
		Some(work) => {
			record.insert("lastWork", work);
		}
		None => {
			record.remove("lastWork");
		}
	}
}

pub struct SpaceStore {
	root: PathBuf,
	/// data/classes, moved over once, before the store first reads (`adopt_old_folder`).
	old_root: PathBuf,
	adopted: Once,
	events: Events,
	locks: Locks,
	/// Held while a color is picked and saved, so each pick sees the colors saved before it, as
	/// in Node's one thread. Taken last: nothing else is locked under it.
	coloring: Mutex<()>,
}

impl SpaceStore {
	pub fn new(paths: &Paths, events: &Events, locks: &Locks) -> SpaceStore {
		SpaceStore { root: paths.spaces.clone(), old_root: paths.data.join("classes"), adopted: Once::new(), events: events.clone(), locks: locks.clone(), coloring: Mutex::new(()) }
	}

	/// Moves data/classes over, once.
	pub fn adopt_old_folder(&self) {
		self.adopted.call_once(|| adopt_old_folder(&self.old_root, &self.root));
	}

	fn root(&self) -> &Path {
		self.adopt_old_folder();
		&self.root
	}

	fn space_dir(&self, id: &str) -> Result<PathBuf, String> {
		if !is_space_id(id) {
			return Err(format!("Invalid space id: {id}"));
		}
		Ok(self.root().join(id))
	}

	fn record_file(&self, id: &str) -> Result<PathBuf, String> {
		Ok(self.space_dir(id)?.join("space.json"))
	}

	/// The record under the name it had before spaces were called spaces.
	fn old_record_file(&self, id: &str) -> Result<PathBuf, String> {
		Ok(self.space_dir(id)?.join("class.json"))
	}

	fn read_record_text(&self, id: &str) -> Option<String> {
		let (file, old) = (self.record_file(id).ok()?, self.old_record_file(id).ok()?);
		fsx::read_text(&file).or_else(|_| fsx::read_text(&old)).ok()
	}

	/// The space's own folder for copied files.
	pub fn files_dir(&self, id: &str) -> Result<PathBuf, String> {
		Ok(self.space_dir(id)?.join("files"))
	}

	/// The space's own graph folder.
	pub fn graph_dir(&self, id: &str) -> Result<PathBuf, String> {
		Ok(self.space_dir(id)?.join("graph"))
	}

	fn changed(&self) {
		self.events.emit(EventKind::SpacesChanged, json!({}));
	}

	/// Every write stamps the current version and goes through a temp file and a rename, so a torn
	/// write never replaces the record.
	fn write_space(&self, record: &Json) -> Result<(), String> {
		let id = record["id"].as_str().unwrap_or("");
		let file = self.record_file(id)?;
		let mut stamped = record.as_obj().cloned().unwrap_or_default();
		stamped.insert("version", CURRENT_SPACE_VERSION);
		fsx::write_text_atomic(&file, &stringify_pretty(&Json::Obj(stamped), "\t")).map_err(|e| fsx::node_error_message(&e, "open", &file))?;
		let old = self.old_record_file(id)?;
		fsx::remove_if_present(&old, "rm")
	}

	/// The colors the other spaces wear, read straight from their records.
	fn colors_beside(&self, id: &str) -> Vec<i64> {
		let Ok(entries) = std::fs::read_dir(self.root()) else { return Vec::new() };
		entries
			.filter_map(|e| e.ok()?.file_name().into_string().ok())
			.filter(|name| name != id && is_space_id(name))
			.filter_map(|name| {
				let other = parse(&self.read_record_text(&name)?).ok()?;
				is_space_color(&other["color"]).then(|| other["color"].as_f64().unwrap_or(0.0) as i64)
			})
			.collect()
	}

	/// The record as stored, and whether it already had a color.
	fn read_space(&self, id: &str) -> Option<(Json, bool)> {
		let parsed = match parse(&self.read_record_text(id)?) {
			Ok(parsed) => parsed,
			Err(_) => {
				eprintln!("[space {id}] its record is not valid JSON; skipping the space");
				return None;
			}
		};
		// A newer record reads as absent, so a later write never rewrites what this build doesn't
		// understand.
		if let Some(version) = newer_version(&parsed) {
			eprintln!("[space {id}] record stamped with schema version {} > {CURRENT_SPACE_VERSION} — refusing to read it", gs_json::js_number(version));
			return None;
		}
		let record = read_space_record(&parsed, clock::now_ms(), || next_space_color(&self.colors_beside(id)))?;
		Some((record, is_space_color(&parsed["color"])))
	}

	/// The full record, or None (unknown id, corrupt, or written by a newer build).
	pub fn get_space(&self, id: &str) -> Option<Json> {
		let (record, colored) = self.read_space(id)?;
		if colored {
			return Some(record);
		}
		// A space from before colors keeps the one it is given here. Read again under the lock, so
		// a change saved meanwhile is not written over. The caller may hold a lesson's lock, which
		// comes after the space's: while another thread holds the space's, a later read saves it.
		let Some(_guard) = self.locks.try_lock(LockKey::Space(id)) else { return Some(record) };
		let _coloring = self.coloring.lock();
		let (mut record, colored) = self.read_space(id)?;
		if !colored {
			if let Err(err) = self.write_space(&record) {
				eprintln!("[space {id}] saving its new color failed: {err}");
			} else if let Some(obj) = record.as_obj_mut() {
				obj.insert("version", CURRENT_SPACE_VERSION);
			}
		}
		Some(record)
	}

	fn require_space(&self, id: &str) -> Result<Json, String> {
		self.get_space(id).ok_or_else(|| format!("Space not found: {id}"))
	}

	/// A new space from `init`: `name`, and optionally `description`, `signature` and `icon`. It
	/// takes the color the fewest other spaces wear.
	pub fn create_space(&self, init: &Json) -> Result<Json, String> {
		let now = time::iso_now();
		let id = ids::timed("spc");
		let mut record = Obj::new();
		record.insert("id", id.clone());
		record.insert("name", clean_name(init["name"].as_str().unwrap_or("")));
		record.insert("description", gs_base::text::trim(init["description"].as_str().unwrap_or("")));
		record.insert("createdAt", now.clone());
		record.insert("updatedAt", now);
		record.insert("closed", false);
		record.insert("files", Json::Arr(Vec::new()));
		for key in ["signature", "icon"] {
			if init[key].truthy() {
				record.insert(key, init[key].clone());
			}
		}
		let coloring = self.coloring.lock();
		record.insert("color", next_space_color(&self.colors_beside(&id)));
		let mut record = Json::Obj(record);
		self.write_space(&record)?;
		drop(coloring);
		self.changed();
		if let Some(obj) = record.as_obj_mut() {
			obj.insert("version", CURRENT_SPACE_VERSION);
		}
		Ok(record)
	}

	/// Every space's full record (closed ones included), most recently updated first.
	pub fn list_space_records(&self) -> Vec<Json> {
		let Ok(entries) = std::fs::read_dir(self.root()) else { return Vec::new() };
		let mut names: Vec<String> = entries.filter_map(|e| e.ok()?.file_name().into_string().ok()).filter(|n| is_space_id(n)).collect();
		names.sort();
		let mut records: Vec<Json> = names.iter().filter_map(|name| self.get_space(name)).collect();
		records.sort_by(|a, b| locale::compare(b["updatedAt"].as_str().unwrap_or(""), a["updatedAt"].as_str().unwrap_or("")));
		records
	}

	/// Every space (closed ones included), most recently updated first.
	pub fn list_spaces(&self) -> Vec<Json> {
		self.list_space_records().iter().map(summarize).collect()
	}

	/// Merges a patch (`name`, `description`, `closed`, `rules`, `linkedFolder`, `signature`,
	/// `icon`, `color`, `note`; `null` unlinks the folder and clears the signature) and bumps
	/// `updatedAt`.
	pub fn update_space(&self, id: &str, patch: &Json) -> Result<Json, String> {
		let _guard = self.locks.lock(LockKey::Space(id));
		let mut record = self.require_space(id)?;
		let obj = record.as_obj_mut().ok_or_else(|| format!("Space not found: {id}"))?;
		if let Some(name) = patch["name"].as_str() {
			obj.insert("name", clean_name(name));
		}
		if let Some(description) = patch["description"].as_str() {
			obj.insert("description", gs_base::text::trim(description));
		}
		if let Some(closed) = patch["closed"].as_bool() {
			obj.insert("closed", closed);
		}
		if let Some(raw) = patch.get("rules") {
			let rules = sanitize_rules(raw);
			if rules.is_empty() {
				obj.remove("rules");
			} else {
				obj.insert("rules", rules);
			}
		}
		for key in ["linkedFolder", "signature"] {
			match patch.get(key) {
				Some(Json::Null) => {
					obj.remove(key);
				}
				Some(value) => {
					obj.insert(key, value.clone());
				}
				None => {}
			}
		}
		for key in ["icon", "color", "note"] {
			if let Some(value) = patch.get(key) {
				obj.insert(key, value.clone());
			}
		}
		// A new note alone doesn't count as an edit: the space list is ordered by updatedAt and
		// shouldn't reshuffle after every lesson.
		if patch.as_obj().is_some_and(|p| p.keys().any(|k| k != "note")) {
			obj.insert("updatedAt", time::iso_now());
		}
		self.write_space(&record)?;
		self.changed();
		Ok(record)
	}

	/// Writes `change(record)` over the record, quietly: the one-time upgrade of an old prep.
	pub fn rewrite_space(&self, id: &str, change: impl FnOnce(&Json) -> Json) -> Result<Json, String> {
		let _guard = self.locks.lock(LockKey::Space(id));
		let record = change(&self.require_space(id)?);
		self.write_space(&record)?;
		Ok(record)
	}

	/// Replaces the whole file list (the file pipeline's write), adds `removed` to the removed
	/// files and moves the teacher's round of work along. Quiet: no `updatedAt` bump, no event.
	pub fn save_files(&self, id: &str, files: Vec<Json>, removed: &[Json]) -> Result<Json, String> {
		let _guard = self.locks.lock(LockKey::Space(id));
		let mut record = self.require_space(id)?;
		let before = record["files"].as_arr().cloned().unwrap_or_default();
		let work = work_after_files(record.get("lastWork"), &before, &files, &time::iso_now());
		let obj = record.as_obj_mut().ok_or_else(|| format!("Space not found: {id}"))?;
		set_work(obj, work);
		obj.insert("files", Json::Arr(files));
		if !removed.is_empty() {
			let mut all = obj.get("removedFiles").and_then(Json::as_arr).cloned().unwrap_or_default();
			all.extend_from_slice(removed);
			obj.insert("removedFiles", Json::Arr(all));
		}
		self.write_space(&record)?;
		Ok(record)
	}

	/// Forgets the last round of work once it has ended (Close). False when the space is unknown or
	/// a round is still open.
	pub fn close_work(&self, id: &str) -> Result<bool, String> {
		let _guard = self.locks.lock(LockKey::Space(id));
		let Some(mut record) = self.get_space(id) else { return Ok(false) };
		if !record["lastWork"]["endedAt"].truthy() {
			return Ok(false);
		}
		if let Some(obj) = record.as_obj_mut() {
			obj.remove("lastWork");
		}
		self.write_space(&record)?;
		self.changed();
		Ok(true)
	}

	/// Saves the deadlines sorted, soonest first.
	fn save_deadlines(&self, record: &mut Json, mut deadlines: Vec<Json>) -> Result<(), String> {
		deadlines.sort_by(compare_deadlines);
		if let Some(obj) = record.as_obj_mut() {
			obj.insert("deadlines", Json::Arr(deadlines));
			obj.insert("updatedAt", time::iso_now());
		}
		self.write_space(record)?;
		self.changed();
		Ok(())
	}

	/// Adds a deadline (not done yet). `init` has `kind`, `name`, `date`, and optionally `time`,
	/// `fileIds`, `leftOutIds`, `source`, `assignmentFileId` and `aboutFileId`. With `id` the
	/// space's waiting deadline (an old prep with no day) becomes it: it keeps that id, so the
	/// prep's mocks belong to it, and the waiting deadline's files unless `init` names others.
	pub fn add_deadline(&self, id: &str, init: &Json) -> Result<Json, SpaceError> {
		let _guard = self.locks.lock(LockKey::Space(id));
		let mut record = self.require_space(id)?;
		let waiting = record.get("waitingDeadline").filter(|w| init["id"].as_str().is_some_and(|i| w["id"].as_str() == Some(i))).cloned();
		let (init, deadline_id) = match &waiting {
			Some(waiting) => {
				let mut filled = init.as_obj().cloned().unwrap_or_default();
				for key in ["fileIds", "aboutFileId"] {
					if filled.get(key).is_none()
						&& let Some(value) = waiting.get(key)
					{
						filled.insert(key, value.clone());
					}
				}
				(Json::Obj(filled), waiting["id"].str_or_empty().to_owned())
			}
			None => (init.clone(), ids::uuid_hex("ddl", 12)),
		};
		let deadline = new_deadline(&file_ids_of(&record), &init, deadline_id)?;
		let work = work_after_deadline(record.get("lastWork"), deadline["id"].as_str().unwrap_or(""));
		if let Some(obj) = record.as_obj_mut() {
			set_work(obj, work);
			if waiting.is_some() {
				obj.remove("waitingDeadline");
			}
		}
		let mut deadlines = record["deadlines"].as_arr().cloned().unwrap_or_default();
		deadlines.push(deadline.clone());
		self.save_deadlines(&mut record, deadlines)?;
		Ok(deadline)
	}

	/// Changes one deadline; `time`, `source`, `assignmentFileId` and `aboutFileId` set to `null`
	/// are cleared,
	/// `done: true` stamps `doneAt` and `done: false` removes it.
	pub fn update_deadline(&self, id: &str, deadline_id: &str, patch: &Json) -> Result<Json, SpaceError> {
		let _guard = self.locks.lock(LockKey::Space(id));
		let mut record = self.require_space(id)?;
		let deadlines = record["deadlines"].as_arr().cloned().unwrap_or_default();
		let Some(prev) = deadlines.iter().find(|d| d["id"].as_str() == Some(deadline_id)) else {
			return Err(SpaceDeadlineError { code: "deadline_not_found", message: format!("No deadline \"{deadline_id}\" in this space") }.into());
		};
		let next = changed_deadline(&file_ids_of(&record), prev, patch, &time::iso_now())?;
		let replaced = deadlines.iter().map(|d| if d["id"].as_str() == Some(deadline_id) { next.clone() } else { d.clone() }).collect();
		self.save_deadlines(&mut record, replaced)?;
		Ok(next)
	}

	/// False when the space has no such deadline.
	pub fn remove_deadline(&self, id: &str, deadline_id: &str) -> Result<bool, String> {
		let _guard = self.locks.lock(LockKey::Space(id));
		let mut record = self.require_space(id)?;
		let deadlines = record["deadlines"].as_arr().cloned().unwrap_or_default();
		if !deadlines.iter().any(|d| d["id"].as_str() == Some(deadline_id)) {
			return Ok(false);
		}
		let kept = deadlines.into_iter().filter(|d| d["id"].as_str() != Some(deadline_id)).collect();
		self.save_deadlines(&mut record, kept)?;
		Ok(true)
	}

	/// Deletes the space folder entirely (record, copied files, graph). False when unknown.
	pub fn delete_space(&self, id: &str) -> Result<bool, String> {
		let dir = self.space_dir(id)?;
		let _guard = self.locks.lock(LockKey::Space(id));
		if !dir.exists() {
			return Ok(false);
		}
		std::fs::remove_dir_all(&dir).map_err(|e| fsx::node_error_message(&e, "rm", &dir))?;
		self.changed();
		Ok(true)
	}
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;

	fn store() -> (SpaceStore, Events, PathBuf) {
		let dir = std::env::temp_dir().join(format!("gs-store-spaces-{}", ids::uuid()));
		let paths = Paths::new(dir.clone(), dir.clone(), dir.clone(), dir.clone());
		let events = Events::new();
		(SpaceStore::new(&paths, &events, &Locks::new()), events, paths.spaces)
	}

	#[test]
	fn a_space_is_created_listed_changed_and_deleted() {
		let (store, events, root) = store();
		let mut rx = events.subscribe();
		let made = store.create_space(&json!({ "name": "  Math   101 ", "description": " Discrete " })).unwrap();
		let id = made["id"].as_str().unwrap().to_owned();
		assert_eq!(made["name"], Json::from("Math 101"));
		assert_eq!(made["version"], Json::from(11));
		assert!(rx.try_recv().is_ok());
		let on_disk = std::fs::read_to_string(root.join(&id).join("space.json")).unwrap();
		assert!(on_disk.starts_with("{\n\t\"id\": \"spc_") && on_disk.ends_with("\n}") && on_disk.contains("\"version\": 11"));

		let updated = store.update_space(&id, &json!({ "rules": ["Be brief"], "icon": "cpu", "linkedFolder": "/x" })).unwrap();
		assert_eq!(stringify(&updated["rules"]), r#"["Be brief"]"#);
		assert_eq!(store.list_spaces().len(), 1);
		assert_eq!(store.list_spaces()[0]["linkedFolder"], Json::from("/x"));
		let cleared = store.update_space(&id, &json!({ "linkedFolder": null, "rules": [] })).unwrap();
		assert!(cleared.get("linkedFolder").is_none() && cleared.get("rules").is_none());
		assert_eq!(store.update_space("cls_nope", &json!({})).unwrap_err(), "Space not found: cls_nope");

		assert!(store.delete_space(&id).unwrap());
		assert!(!store.delete_space(&id).unwrap());
		assert_eq!(store.delete_space("bad").unwrap_err(), "Invalid space id: bad");
		assert!(store.get_space(&id).is_none());
	}

	#[test]
	fn a_note_alone_leaves_the_update_time() {
		let (store, _, _) = store();
		let made = store.create_space(&json!({ "name": "A" })).unwrap();
		let id = made["id"].as_str().unwrap();
		clock::advance(5000);
		let noted = store.update_space(id, &json!({ "note": { "text": "hi", "at": "t" } })).unwrap();
		assert_eq!(noted["updatedAt"], made["updatedAt"]);
		let renamed = store.update_space(id, &json!({ "name": "B" })).unwrap();
		assert_ne!(renamed["updatedAt"], made["updatedAt"]);
	}

	#[test]
	fn deadlines_are_added_changed_sorted_and_removed() {
		let (store, _, _) = store();
		let id = store.create_space(&json!({ "name": "A" })).unwrap()["id"].as_str().unwrap().to_owned();
		let late = store.add_deadline(&id, &json!({ "kind": "exam", "name": "Final", "date": "2026-12-01" })).unwrap();
		let early = store.add_deadline(&id, &json!({ "kind": "quiz", "name": "Quiz", "date": "2026-11-01", "time": "09:00" })).unwrap();
		let names: Vec<_> = store.get_space(&id).unwrap()["deadlines"].as_arr().unwrap().iter().map(|d| d["name"].as_str().unwrap().to_owned()).collect();
		assert_eq!(names, ["Quiz", "Final"]);
		let ticked = store.update_deadline(&id, early["id"].as_str().unwrap(), &json!({ "done": true })).unwrap();
		assert_eq!(ticked["done"], Json::from(true));
		assert!(ticked["doneAt"].as_str().is_some());
		match store.update_deadline(&id, "ddl_nope", &json!({})).unwrap_err() {
			SpaceError::Deadline(e) => assert_eq!((e.code, e.message.as_str()), ("deadline_not_found", "No deadline \"ddl_nope\" in this space")),
			other => panic!("{other:?}"),
		}
		assert!(store.remove_deadline(&id, late["id"].as_str().unwrap()).unwrap());
		assert!(!store.remove_deadline(&id, late["id"].as_str().unwrap()).unwrap());
	}

	#[test]
	fn saving_files_is_quiet_and_removed_files_pile_up() {
		let (store, events, _) = store();
		let id = store.create_space(&json!({ "name": "A" })).unwrap()["id"].as_str().unwrap().to_owned();
		let mut rx = events.subscribe();
		let file = json!({ "id": "f1", "origin": "copied", "name": "a.pdf", "path": "p", "kind": "study", "contentFp": "x", "status": "ready", "addedAt": "t" });
		let gone = json!({ "id": "f0", "name": "old.pdf", "at": time::iso_now() });
		let saved = store.save_files(&id, vec![file], &[gone]).unwrap();
		assert!(rx.try_recv().is_err());
		assert_eq!(store.get_space(&id).unwrap()["files"], saved["files"]);
		assert_eq!(store.get_space(&id).unwrap()["removedFiles"].as_arr().unwrap().len(), 1);
		assert_eq!(store.files_dir(&id).unwrap().file_name().unwrap(), "files");
	}

	#[test]
	fn a_newer_or_broken_record_reads_as_absent() {
		let (store, _, root) = store();
		let id = store.create_space(&json!({ "name": "A" })).unwrap()["id"].as_str().unwrap().to_owned();
		let file = root.join(&id).join("space.json");
		let text = std::fs::read_to_string(&file).unwrap();
		fsx::write_text_atomic(&file, &text.replace("\"version\": 11", "\"version\": 12")).unwrap();
		assert!(store.get_space(&id).is_none());
		fsx::write_text_atomic(&file, "{ nope").unwrap();
		assert!(store.get_space(&id).is_none() && store.list_spaces().is_empty());
	}

	#[test]
	fn new_spaces_take_the_least_worn_color_and_a_color_can_change() {
		let (store, _, _) = store();
		let colors: Vec<Json> = (0..3).map(|i| store.create_space(&json!({ "name": format!("S{i}") })).unwrap()["color"].clone()).collect();
		assert_eq!(colors, [Json::from(1), Json::from(2), Json::from(3)]);
		let first = store.list_space_records().into_iter().find(|r| r["color"] == Json::from(1)).unwrap();
		let id = first["id"].as_str().unwrap();
		assert_eq!(store.update_space(id, &json!({ "color": 3 })).unwrap()["color"], Json::from(3));
		assert_eq!(store.create_space(&json!({ "name": "S3" })).unwrap()["color"], Json::from(1));
	}

	#[test]
	fn an_old_prep_survives_every_write_until_the_upgrade_drops_it() {
		let (store, _, root) = store();
		let id = store.create_space(&json!({ "name": "Larkspur onsite" })).unwrap()["id"].as_str().unwrap().to_owned();
		let file = root.join(&id).join("space.json");
		let saved = std::fs::read_to_string(&file).unwrap().replace("\t\"color\": 1,", "\t\"color\": 1,\n\t\"prep\": { \"goal\": \"Larkspur onsite\", \"date\": \"2026-11-24\" },");
		fsx::write_text_atomic(&file, &saved).unwrap();
		store.update_space(&id, &json!({ "name": "Larkspur" })).unwrap();
		store.add_deadline(&id, &json!({ "kind": "exam", "name": "Quiz", "date": "2026-11-20" })).unwrap();
		assert_eq!(store.get_space(&id).unwrap()["prep"], json!({ "goal": "Larkspur onsite", "date": "2026-11-24" }));
		assert!(store.list_spaces()[0].get("prep").is_none(), "the list never shows it");
		let done = store.rewrite_space(&id, |r| {
			let mut next = r.clone();
			next.as_obj_mut().unwrap().remove("prep");
			next
		}).unwrap();
		assert!(done.get("prep").is_none() && store.get_space(&id).unwrap().get("prep").is_none());
	}

	#[test]
	fn the_waiting_deadline_of_an_old_prep_becomes_the_deadline_added_with_its_id() {
		let (store, _, root) = store();
		let id = store.create_space(&json!({ "name": "Larkspur onsite" })).unwrap()["id"].as_str().unwrap().to_owned();
		let f = json!({ "id": "f_guide", "origin": "copied", "name": "Study guide.md", "path": "f_guide/Study guide.md", "kind": "study", "contentFp": "", "status": "pending", "addedAt": "t" });
		store.rewrite_space(&id, |r| {
			let mut next = r.clone();
			next.as_obj_mut().unwrap().insert("files", json!([f]));
			next.as_obj_mut().unwrap().insert("waitingDeadline", json!({ "id": "ddl_waiting", "name": "Larkspur onsite", "fileIds": ["f_guide"] }));
			next
		}).unwrap();
		assert!(std::fs::read_to_string(root.join(&id).join("space.json")).unwrap().contains("\"waitingDeadline\": {"));
		let other = store.add_deadline(&id, &json!({ "id": "ddl_other", "kind": "quiz", "name": "Quiz", "date": "2026-11-20" })).unwrap();
		assert_ne!(other["id"], json!("ddl_other"), "only the waiting deadline's id is taken");
		assert!(store.get_space(&id).unwrap()["waitingDeadline"].truthy());
		let added = store.add_deadline(&id, &json!({ "id": "ddl_waiting", "kind": "interview", "name": "Larkspur onsite", "date": "2026-11-24", "time": "14:00" })).unwrap();
		assert_eq!(stringify(&added), r#"{"id":"ddl_waiting","kind":"interview","name":"Larkspur onsite","date":"2026-11-24","time":"14:00","fileIds":["f_guide"],"done":false}"#);
		assert!(store.get_space(&id).unwrap().get("waitingDeadline").is_none(), "cleared in the same write");
	}

	#[test]
	fn a_record_without_a_color_is_given_one_and_saved_at_once() {
		let (store, events, root) = store();
		let mut rx = events.subscribe();
		let colored = old_record("cls_e1");
		fsx::write_text_atomic(&root.join("cls_e1").join("space.json"), &colored).unwrap();
		fsx::write_text_atomic(&root.join("cls_e2").join("class.json"), &old_record("cls_e2").replace("\t\"color\": 1,\n", "")).unwrap();
		let record = store.get_space("cls_e2").unwrap();
		assert_eq!((record["color"].clone(), record["version"].clone()), (Json::from(2), Json::from(11)));
		let saved = std::fs::read_to_string(root.join("cls_e2").join("space.json")).unwrap();
		assert!(saved.contains("\"closed\": true,\n\t\"files\": [],\n\t\"color\": 2,\n\t\"version\": 11\n}"));
		assert!(!root.join("cls_e2").join("class.json").exists());
		assert!(rx.try_recv().is_err(), "a read is quiet");
		// The colored one is only read.
		assert_eq!(std::fs::read_to_string(root.join("cls_e1").join("space.json")).unwrap(), colored);
	}

	#[test]
	fn a_color_is_saved_only_when_the_spaces_lock_is_free_and_two_picks_never_meet() {
		let dir = std::env::temp_dir().join(format!("gs-store-colors-{}", ids::uuid()));
		let paths = Paths::new(dir.clone(), dir.clone(), dir.clone(), dir.clone());
		let locks = Locks::new();
		let store = std::sync::Arc::new(SpaceStore::new(&paths, &Events::new(), &locks));
		let uncolored = |id: &str| fsx::write_text_atomic(&paths.spaces.join(id).join("space.json"), &old_record(id).replace("\t\"color\": 1,\n", "")).unwrap();
		uncolored("cls_a");
		// A space delete holds the space's lock and waits for a lesson's, which this reader may hold.
		let held = locks.clone();
		let (taken, release) = (std::sync::mpsc::channel(), std::sync::mpsc::channel::<()>());
		let holder = std::thread::spawn(move || {
			let _guard = held.lock(LockKey::Space("cls_a"));
			taken.0.send(()).unwrap();
			release.1.recv().unwrap();
		});
		taken.1.recv().unwrap();
		assert_eq!(store.get_space("cls_a").unwrap()["color"], Json::from(1), "read without waiting");
		assert!(!std::fs::read_to_string(paths.spaces.join("cls_a").join("space.json")).unwrap().contains("color"));
		release.0.send(()).unwrap();
		holder.join().unwrap();
		store.get_space("cls_a").unwrap();
		assert!(std::fs::read_to_string(paths.spaces.join("cls_a").join("space.json")).unwrap().contains("\"color\": 1"));

		let ids: Vec<String> = (0..7).map(|i| format!("cls_b{i}")).collect();
		for id in &ids {
			uncolored(id);
		}
		let start = std::sync::Arc::new(std::sync::Barrier::new(ids.len()));
		let readers: Vec<_> = ids
			.iter()
			.map(|id| {
				let (store, start, id) = (store.clone(), start.clone(), id.clone());
				std::thread::spawn(move || {
					start.wait();
					store.get_space(&id).unwrap()["color"].as_f64().unwrap() as i64
				})
			})
			.collect();
		let mut colors: Vec<i64> = readers.into_iter().map(|r| r.join().unwrap()).collect();
		colors.sort_unstable();
		assert_eq!(colors, [2, 3, 4, 5, 6, 7, 8], "spaces colored at the same time each take their own");
	}

	fn study(id: &str, status: &str) -> Json {
		json!({ "id": id, "origin": "copied", "name": id, "path": id, "kind": "study", "contentFp": "x", "status": status, "addedAt": "t" })
	}

	#[test]
	fn file_saves_and_new_deadlines_keep_the_round_of_work_and_close_forgets_an_ended_one() {
		let (store, events, _) = store();
		let id = store.create_space(&json!({ "name": "A" })).unwrap()["id"].as_str().unwrap().to_owned();
		store.save_files(&id, vec![study("f1", "pending")], &[]).unwrap();
		let deadline = store.add_deadline(&id, &json!({ "kind": "exam", "name": "Final", "date": "2026-12-01" })).unwrap();
		let open = store.get_space(&id).unwrap()["lastWork"].clone();
		assert_eq!(open["deadlineIds"], json!([deadline["id"].clone()]));
		let mut rx = events.subscribe();
		assert!(!store.close_work(&id).unwrap(), "a round still going stays");
		let ended = store.save_files(&id, vec![study("f1", "ready")], &[]).unwrap();
		assert_eq!(ended["lastWork"]["fileIds"], json!(["f1"]));
		assert!(ended["lastWork"]["endedAt"].as_str().is_some());
		assert!(rx.try_recv().is_err());
		assert!(store.close_work(&id).unwrap());
		assert!(rx.try_recv().is_ok());
		assert!(store.get_space(&id).unwrap().get("lastWork").is_none());
		assert!(!store.close_work(&id).unwrap() && !store.close_work("cls_nope").unwrap());
	}

	/// A record in the shape it had before the renames (class.json, `archived`), with a color so reading
	/// it writes nothing.
	fn old_record(id: &str) -> String {
		format!("{{\n\t\"id\": \"{id}\",\n\t\"name\": \"Old\",\n\t\"description\": \"\",\n\t\"createdAt\": \"2026-01-01T00:00:00.000Z\",\n\t\"updatedAt\": \"2026-01-01T00:00:00.000Z\",\n\t\"archived\": true,\n\t\"files\": [],\n\t\"color\": 1,\n\t\"version\": 7\n}}")
	}

	fn lab(name: &str) -> (PathBuf, SpaceStore) {
		let dir = std::env::temp_dir().join(format!("gs-store-{name}-{}", ids::uuid()));
		let paths = Paths::new(dir.clone(), dir.clone(), dir.clone(), dir.clone());
		let store = SpaceStore::new(&paths, &Events::new(), &Locks::new());
		(dir, store)
	}

	fn names(dir: &Path) -> Vec<String> {
		let mut names: Vec<String> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
		names.sort();
		names
	}

	#[test]
	fn an_old_data_folder_moves_whole_on_first_use() {
		let (data, store) = lab("old-folder");
		let old = data.join("classes");
		fsx::write_text_atomic(&old.join("cls_a1").join("class.json"), &old_record("cls_a1")).unwrap();
		fsx::write_text_atomic(&old.join("cls_a1").join("files").join("notes.md"), "x").unwrap();
		assert!(old.exists(), "nothing moves before the store is used");
		let space = store.get_space("cls_a1").unwrap();
		assert_eq!(space["name"], Json::from("Old"));
		assert!(!old.exists());
		assert_eq!(names(&data.join("spaces").join("cls_a1")), ["class.json", "files"]);
	}

	#[test]
	fn the_old_record_file_is_read_until_the_next_write() {
		let (data, store) = lab("old-record");
		let dir = data.join("spaces").join("cls_b1");
		fsx::write_text_atomic(&dir.join("class.json"), &old_record("cls_b1")).unwrap();
		assert_eq!(store.list_spaces().len(), 1);
		assert_eq!(names(&dir), ["class.json"]);
		store.update_space("cls_b1", &json!({ "name": "New" })).unwrap();
		assert_eq!(names(&dir), ["space.json"]);
		let saved = std::fs::read_to_string(dir.join("space.json")).unwrap();
		assert!(saved.contains("\"name\": \"New\"") && saved.ends_with("\"version\": 11\n}"));
		// space.json wins over a class.json left beside it.
		fsx::write_text_atomic(&dir.join("class.json"), &old_record("cls_b1")).unwrap();
		assert_eq!(store.get_space("cls_b1").unwrap()["name"], Json::from("New"));
	}

	#[test]
	fn a_half_moved_folder_moves_entry_by_entry_and_keeps_both_names() {
		let (data, store) = lab("half-moved");
		let (old, new) = (data.join("classes"), data.join("spaces"));
		fsx::write_text_atomic(&old.join("cls_c1").join("class.json"), &old_record("cls_c1")).unwrap();
		fsx::write_text_atomic(&old.join("cls_c2").join("class.json"), &old_record("cls_c2")).unwrap();
		fsx::write_text_atomic(&new.join("cls_c2").join("space.json"), &old_record("cls_c2").replace("Old", "Kept")).unwrap();
		fsx::write_text_atomic(&old.join(".DS_Store"), "finder").unwrap();
		fsx::write_text_atomic(&new.join(".DS_Store"), "finder").unwrap();
		assert_eq!(store.list_spaces().len(), 2);
		// The same-named entry stays in data/classes, so the folder does too; Finder's file goes.
		assert_eq!(names(&old), ["cls_c2"]);
		assert_eq!(names(&new), [".DS_Store", "cls_c1", "cls_c2"]);
		assert_eq!(store.get_space("cls_c2").unwrap()["name"], Json::from("Kept"));
	}

	#[test]
	fn a_half_moved_folder_goes_once_everything_moved() {
		let (data, store) = lab("half-moved-empty");
		let (old, new) = (data.join("classes"), data.join("spaces"));
		fsx::write_text_atomic(&old.join("cls_d1").join("class.json"), &old_record("cls_d1")).unwrap();
		fsx::write_text_atomic(&old.join(".DS_Store"), "finder").unwrap();
		fsx::write_text_atomic(&new.join(".DS_Store"), "finder").unwrap();
		std::fs::create_dir_all(new.join("spc_made_first")).unwrap();
		assert_eq!(store.get_space("cls_d1").unwrap()["id"], Json::from("cls_d1"));
		assert!(!old.exists());
		assert_eq!(names(&new), [".DS_Store", "cls_d1", "spc_made_first"]);
	}

	#[test]
	fn a_finder_folder_on_both_sides_stays_as_an_entry() {
		let (data, store) = lab("finder-dir");
		let (old, new) = (data.join("classes"), data.join("spaces"));
		std::fs::create_dir_all(old.join(".DS_Store")).unwrap();
		fsx::write_text_atomic(&new.join(".DS_Store"), "finder").unwrap();
		assert!(store.list_spaces().is_empty());
		assert_eq!(names(&old), [".DS_Store"]);
	}
}
