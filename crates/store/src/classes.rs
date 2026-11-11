//! Ported from src/backend/store/classes.ts.
//!
//! ```text
//! <data>/classes/<id>/class.json   the class record
//! <data>/classes/<id>/files/       copied class files (the app's own copies)
//! <data>/classes/<id>/graph/       the class's own graph
//! ```
//!
//! A record is a `Json` object; reading checks it field by field (`gs_core::classes::class_record`)
//! and every write stamps the current version.

use std::fmt;
use std::path::PathBuf;

use gs_base::config::Paths;
use gs_base::events::{EventKind, Events};
use gs_base::locks::{LockKey, Locks};
use gs_base::{clock, fsx, ids, locale, time};
use gs_core::classes::class_deadlines::{changed_deadline, file_ids_of, new_deadline};
use gs_core::classes::class_record::{clean_name, newer_version, read_class_record, summarize};
use gs_core::contracts::class::{CURRENT_CLASS_VERSION, ClassDeadlineError, compare_deadlines, is_class_id};
use gs_core::records::teaching_areas::sanitize_rules;
use gs_json::{Json, Obj, json, parse, stringify_pretty};

/// Why a class change was refused: a deadline that is wrong or missing, or anything else
/// (an unknown class, a disk error).
#[derive(Debug, Clone, PartialEq)]
pub enum ClassError {
	Deadline(ClassDeadlineError),
	Other(String),
}

impl fmt::Display for ClassError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			ClassError::Deadline(e) => f.write_str(&e.message),
			ClassError::Other(message) => f.write_str(message),
		}
	}
}

impl From<ClassDeadlineError> for ClassError {
	fn from(e: ClassDeadlineError) -> ClassError {
		ClassError::Deadline(e)
	}
}

impl From<String> for ClassError {
	fn from(message: String) -> ClassError {
		ClassError::Other(message)
	}
}

pub struct ClassStore {
	root: PathBuf,
	events: Events,
	locks: Locks,
}

impl ClassStore {
	pub fn new(paths: &Paths, events: &Events, locks: &Locks) -> ClassStore {
		ClassStore { root: paths.classes.clone(), events: events.clone(), locks: locks.clone() }
	}

	fn class_dir(&self, id: &str) -> Result<PathBuf, String> {
		if !is_class_id(id) {
			return Err(format!("Invalid class id: {id}"));
		}
		Ok(self.root.join(id))
	}

	fn record_file(&self, id: &str) -> Result<PathBuf, String> {
		Ok(self.class_dir(id)?.join("class.json"))
	}

	/// The class's own folder for copied files.
	pub fn files_dir(&self, id: &str) -> Result<PathBuf, String> {
		Ok(self.class_dir(id)?.join("files"))
	}

	/// The class's own graph folder.
	pub fn graph_dir(&self, id: &str) -> Result<PathBuf, String> {
		Ok(self.class_dir(id)?.join("graph"))
	}

	fn changed(&self) {
		self.events.emit(EventKind::ClassesChanged, json!({}));
	}

	/// Every write stamps the current version and goes through a temp file and a rename, so a torn
	/// write never replaces the record.
	fn write_class(&self, record: &Json) -> Result<(), String> {
		let file = self.record_file(record["id"].as_str().unwrap_or(""))?;
		let mut stamped = record.as_obj().cloned().unwrap_or_default();
		stamped.insert("version", CURRENT_CLASS_VERSION);
		fsx::write_text_atomic(&file, &stringify_pretty(&Json::Obj(stamped), "\t")).map_err(|e| fsx::node_error_message(&e, "open", &file))
	}

	/// The full record, or None (unknown id, corrupt, or written by a newer build).
	pub fn get_class(&self, id: &str) -> Option<Json> {
		let file = self.record_file(id).ok()?;
		let parsed = match parse(&fsx::read_text(&file).ok()?) {
			Ok(parsed) => parsed,
			Err(_) => {
				eprintln!("[class {id}] class.json is not valid JSON; skipping the class");
				return None;
			}
		};
		// A newer record reads as absent, so a later write never rewrites what this build doesn't
		// understand.
		if let Some(version) = newer_version(&parsed) {
			eprintln!("[class {id}] record stamped with schema version {} > {CURRENT_CLASS_VERSION} — refusing to read it", gs_json::js_number(version));
			return None;
		}
		read_class_record(&parsed, clock::now_ms())
	}

	fn require_class(&self, id: &str) -> Result<Json, String> {
		self.get_class(id).ok_or_else(|| format!("Class not found: {id}"))
	}

	/// A new class from `init`: `name`, and optionally `description`, `signature` and `icon`.
	pub fn create_class(&self, init: &Json) -> Result<Json, String> {
		let now = time::iso_now();
		let mut record = Obj::new();
		record.insert("id", ids::timed("cls"));
		record.insert("name", clean_name(init["name"].as_str().unwrap_or("")));
		record.insert("description", gs_base::text::trim(init["description"].as_str().unwrap_or("")));
		record.insert("createdAt", now.clone());
		record.insert("updatedAt", now);
		record.insert("archived", false);
		record.insert("files", Json::Arr(Vec::new()));
		for key in ["signature", "icon"] {
			if init[key].truthy() {
				record.insert(key, init[key].clone());
			}
		}
		let mut record = Json::Obj(record);
		self.write_class(&record)?;
		self.changed();
		if let Some(obj) = record.as_obj_mut() {
			obj.insert("version", CURRENT_CLASS_VERSION);
		}
		Ok(record)
	}

	/// Every class's full record (archived included), most recently updated first.
	pub fn list_class_records(&self) -> Vec<Json> {
		let Ok(entries) = std::fs::read_dir(&self.root) else { return Vec::new() };
		let mut names: Vec<String> = entries.filter_map(|e| e.ok()?.file_name().into_string().ok()).filter(|n| is_class_id(n)).collect();
		names.sort();
		let mut records: Vec<Json> = names.iter().filter_map(|name| self.get_class(name)).collect();
		records.sort_by(|a, b| locale::compare(b["updatedAt"].as_str().unwrap_or(""), a["updatedAt"].as_str().unwrap_or("")));
		records
	}

	/// Every class (archived included), most recently updated first.
	pub fn list_classes(&self) -> Vec<Json> {
		self.list_class_records().iter().map(summarize).collect()
	}

	/// Merges a patch (`name`, `description`, `archived`, `rules`, `linkedFolder`, `signature`,
	/// `icon`, `note`; `null` unlinks the folder and clears the signature) and bumps `updatedAt`.
	pub fn update_class(&self, id: &str, patch: &Json) -> Result<Json, String> {
		let _guard = self.locks.lock(LockKey::Class(id));
		let mut record = self.require_class(id)?;
		let obj = record.as_obj_mut().ok_or_else(|| format!("Class not found: {id}"))?;
		if let Some(name) = patch["name"].as_str() {
			obj.insert("name", clean_name(name));
		}
		if let Some(description) = patch["description"].as_str() {
			obj.insert("description", gs_base::text::trim(description));
		}
		if let Some(archived) = patch["archived"].as_bool() {
			obj.insert("archived", archived);
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
		for key in ["icon", "note"] {
			if let Some(value) = patch.get(key) {
				obj.insert(key, value.clone());
			}
		}
		// A new note alone doesn't count as an edit: the class list is ordered by updatedAt and
		// shouldn't reshuffle after every lesson.
		if patch.as_obj().is_some_and(|p| p.keys().any(|k| k != "note")) {
			obj.insert("updatedAt", time::iso_now());
		}
		self.write_class(&record)?;
		self.changed();
		Ok(record)
	}

	/// Replaces the whole file list (the file pipeline's write) and adds `removed` to the removed
	/// files. Quiet: no `updatedAt` bump, no event.
	pub fn save_files(&self, id: &str, files: Vec<Json>, removed: &[Json]) -> Result<Json, String> {
		let _guard = self.locks.lock(LockKey::Class(id));
		let mut record = self.require_class(id)?;
		let obj = record.as_obj_mut().ok_or_else(|| format!("Class not found: {id}"))?;
		obj.insert("files", Json::Arr(files));
		if !removed.is_empty() {
			let mut all = obj.get("removedFiles").and_then(Json::as_arr).cloned().unwrap_or_default();
			all.extend_from_slice(removed);
			obj.insert("removedFiles", Json::Arr(all));
		}
		self.write_class(&record)?;
		Ok(record)
	}

	/// Saves the deadlines sorted, soonest first.
	fn save_deadlines(&self, record: &mut Json, mut deadlines: Vec<Json>) -> Result<(), String> {
		deadlines.sort_by(compare_deadlines);
		if let Some(obj) = record.as_obj_mut() {
			obj.insert("deadlines", Json::Arr(deadlines));
			obj.insert("updatedAt", time::iso_now());
		}
		self.write_class(record)?;
		self.changed();
		Ok(())
	}

	/// Adds a deadline (not done yet). `init` has `kind`, `name`, `date`, and optionally `time`,
	/// `fileIds`, `leftOutIds`, `source` and `assignmentFileId`.
	pub fn add_deadline(&self, id: &str, init: &Json) -> Result<Json, ClassError> {
		let _guard = self.locks.lock(LockKey::Class(id));
		let mut record = self.require_class(id)?;
		let deadline = new_deadline(&file_ids_of(&record), init, ids::uuid_hex("ddl", 12))?;
		let mut deadlines = record["deadlines"].as_arr().cloned().unwrap_or_default();
		deadlines.push(deadline.clone());
		self.save_deadlines(&mut record, deadlines)?;
		Ok(deadline)
	}

	/// Changes one deadline; `time`, `source` and `assignmentFileId` set to `null` are cleared,
	/// `done: true` stamps `doneAt` and `done: false` removes it.
	pub fn update_deadline(&self, id: &str, deadline_id: &str, patch: &Json) -> Result<Json, ClassError> {
		let _guard = self.locks.lock(LockKey::Class(id));
		let mut record = self.require_class(id)?;
		let deadlines = record["deadlines"].as_arr().cloned().unwrap_or_default();
		let Some(prev) = deadlines.iter().find(|d| d["id"].as_str() == Some(deadline_id)) else {
			return Err(ClassDeadlineError { code: "deadline_not_found", message: format!("No deadline \"{deadline_id}\" in this class") }.into());
		};
		let next = changed_deadline(&file_ids_of(&record), prev, patch, &time::iso_now())?;
		let replaced = deadlines.iter().map(|d| if d["id"].as_str() == Some(deadline_id) { next.clone() } else { d.clone() }).collect();
		self.save_deadlines(&mut record, replaced)?;
		Ok(next)
	}

	/// False when the class has no such deadline.
	pub fn remove_deadline(&self, id: &str, deadline_id: &str) -> Result<bool, String> {
		let _guard = self.locks.lock(LockKey::Class(id));
		let mut record = self.require_class(id)?;
		let deadlines = record["deadlines"].as_arr().cloned().unwrap_or_default();
		if !deadlines.iter().any(|d| d["id"].as_str() == Some(deadline_id)) {
			return Ok(false);
		}
		let kept = deadlines.into_iter().filter(|d| d["id"].as_str() != Some(deadline_id)).collect();
		self.save_deadlines(&mut record, kept)?;
		Ok(true)
	}

	/// Deletes the class folder entirely (record, copied files, graph). False when unknown.
	pub fn delete_class(&self, id: &str) -> Result<bool, String> {
		let dir = self.class_dir(id)?;
		let _guard = self.locks.lock(LockKey::Class(id));
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

	fn store() -> (ClassStore, Events, PathBuf) {
		let dir = std::env::temp_dir().join(format!("gs-store-classes-{}", ids::uuid()));
		let paths = Paths::new(dir.clone(), dir.clone(), dir.clone(), dir.clone());
		let events = Events::new();
		(ClassStore::new(&paths, &events, &Locks::new()), events, paths.classes)
	}

	#[test]
	fn a_class_is_created_listed_changed_and_deleted() {
		let (store, events, root) = store();
		let mut rx = events.subscribe();
		let made = store.create_class(&json!({ "name": "  CSE   21 ", "description": " Discrete " })).unwrap();
		let id = made["id"].as_str().unwrap().to_owned();
		assert_eq!(made["name"], Json::from("CSE 21"));
		assert_eq!(made["version"], Json::from(7));
		assert!(rx.try_recv().is_ok());
		let on_disk = std::fs::read_to_string(root.join(&id).join("class.json")).unwrap();
		assert!(on_disk.starts_with("{\n\t\"id\": \"cls_") && on_disk.ends_with("\n}") && on_disk.contains("\"version\": 7"));

		let updated = store.update_class(&id, &json!({ "rules": ["Be brief"], "icon": "cpu", "linkedFolder": "/x" })).unwrap();
		assert_eq!(stringify(&updated["rules"]), r#"["Be brief"]"#);
		assert_eq!(store.list_classes().len(), 1);
		assert_eq!(store.list_classes()[0]["linkedFolder"], Json::from("/x"));
		let cleared = store.update_class(&id, &json!({ "linkedFolder": null, "rules": [] })).unwrap();
		assert!(cleared.get("linkedFolder").is_none() && cleared.get("rules").is_none());
		assert_eq!(store.update_class("cls_nope", &json!({})).unwrap_err(), "Class not found: cls_nope");

		assert!(store.delete_class(&id).unwrap());
		assert!(!store.delete_class(&id).unwrap());
		assert_eq!(store.delete_class("bad").unwrap_err(), "Invalid class id: bad");
		assert!(store.get_class(&id).is_none());
	}

	#[test]
	fn a_note_alone_leaves_the_update_time() {
		let (store, _, _) = store();
		let made = store.create_class(&json!({ "name": "A" })).unwrap();
		let id = made["id"].as_str().unwrap();
		clock::advance(5000);
		let noted = store.update_class(id, &json!({ "note": { "text": "hi", "at": "t" } })).unwrap();
		assert_eq!(noted["updatedAt"], made["updatedAt"]);
		let renamed = store.update_class(id, &json!({ "name": "B" })).unwrap();
		assert_ne!(renamed["updatedAt"], made["updatedAt"]);
	}

	#[test]
	fn deadlines_are_added_changed_sorted_and_removed() {
		let (store, _, _) = store();
		let id = store.create_class(&json!({ "name": "A" })).unwrap()["id"].as_str().unwrap().to_owned();
		let late = store.add_deadline(&id, &json!({ "kind": "exam", "name": "Final", "date": "2026-12-01" })).unwrap();
		let early = store.add_deadline(&id, &json!({ "kind": "quiz", "name": "Quiz", "date": "2026-11-01", "time": "09:00" })).unwrap();
		let names: Vec<_> = store.get_class(&id).unwrap()["deadlines"].as_arr().unwrap().iter().map(|d| d["name"].as_str().unwrap().to_owned()).collect();
		assert_eq!(names, ["Quiz", "Final"]);
		let ticked = store.update_deadline(&id, early["id"].as_str().unwrap(), &json!({ "done": true })).unwrap();
		assert_eq!(ticked["done"], Json::from(true));
		assert!(ticked["doneAt"].as_str().is_some());
		match store.update_deadline(&id, "ddl_nope", &json!({})).unwrap_err() {
			ClassError::Deadline(e) => assert_eq!((e.code, e.message.as_str()), ("deadline_not_found", "No deadline \"ddl_nope\" in this class")),
			other => panic!("{other:?}"),
		}
		assert!(store.remove_deadline(&id, late["id"].as_str().unwrap()).unwrap());
		assert!(!store.remove_deadline(&id, late["id"].as_str().unwrap()).unwrap());
	}

	#[test]
	fn saving_files_is_quiet_and_removed_files_pile_up() {
		let (store, events, _) = store();
		let id = store.create_class(&json!({ "name": "A" })).unwrap()["id"].as_str().unwrap().to_owned();
		let mut rx = events.subscribe();
		let file = json!({ "id": "f1", "origin": "copied", "name": "a.pdf", "path": "p", "kind": "study", "contentFp": "x", "status": "ready", "addedAt": "t" });
		let gone = json!({ "id": "f0", "name": "old.pdf", "at": time::iso_now() });
		let saved = store.save_files(&id, vec![file], &[gone]).unwrap();
		assert!(rx.try_recv().is_err());
		assert_eq!(store.get_class(&id).unwrap()["files"], saved["files"]);
		assert_eq!(store.get_class(&id).unwrap()["removedFiles"].as_arr().unwrap().len(), 1);
		assert_eq!(store.files_dir(&id).unwrap().file_name().unwrap(), "files");
	}

	#[test]
	fn a_newer_or_broken_record_reads_as_absent() {
		let (store, _, root) = store();
		let id = store.create_class(&json!({ "name": "A" })).unwrap()["id"].as_str().unwrap().to_owned();
		let file = root.join(&id).join("class.json");
		let text = std::fs::read_to_string(&file).unwrap();
		fsx::write_text_atomic(&file, &text.replace("\"version\": 7", "\"version\": 8")).unwrap();
		assert!(store.get_class(&id).is_none());
		fsx::write_text_atomic(&file, "{ nope").unwrap();
		assert!(store.get_class(&id).is_none() && store.list_classes().is_empty());
	}
}
