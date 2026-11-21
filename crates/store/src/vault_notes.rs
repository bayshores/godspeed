//! data/vault-notes.json: what godspeed knows about the notes it wrote in the learner's vault.
//!
//! ```text
//! folders:    { <space id>: "CSE 21" }                   the folder each space uses in the vault
//! notes:      { <topic id>: {
//!     spaceId, path (relative to the vault),
//!     keys, sections                                     what godspeed last wrote (note_record)
//!     kinds: [mistake kinds already written],
//!     state: active | yours | kept | removed,
//!     text, words                                        waiting to be written, when set
//! } }
//! keyUpdates: { <space id>: "2026-11-20" }               the last key-only update of a space
//! asks:       { <lesson id>: [topic id] }                "My words" asks still owed
//! ```
//!
//! Lock order: settings.json first, then this file; code holding this file never reads settings.
//! A file that is not valid JSON, or not an object, is kept aside and read as empty, so the next
//! save cannot replace it.

use gs_base::config::Paths;
use gs_base::fsx;
use gs_base::locks::Locks;
use gs_json::{Json, Obj};

use crate::app_file::AppFile;

const FILE: &str = "vault-notes.json";
const MAPS: [&str; 4] = ["folders", "notes", "keyUpdates", "asks"];

pub struct VaultNotesStore {
	file: AppFile,
	path: std::path::PathBuf,
}

/// The record with each map present as an object; a map of any other shape reads as empty.
fn with_maps(saved: &Json) -> Json {
	let mut out = Obj::new();
	for key in MAPS {
		out.insert(key, if saved[key].as_obj().is_some() { saved[key].clone() } else { Json::Obj(Obj::new()) });
	}
	Json::Obj(out)
}

impl VaultNotesStore {
	pub fn new(paths: &Paths, locks: &Locks) -> VaultNotesStore {
		VaultNotesStore { file: AppFile::new(paths, locks, FILE, 1), path: paths.data.join(FILE) }
	}

	/// The saved record: an object holding `folders`, `notes`, `keyUpdates` and `asks`.
	pub fn read(&self) -> Json {
		with_maps(&self.file.read())
	}

	/// Lets `change` edit the record under the file's lock and saves it.
	pub fn update<T>(&self, change: impl FnOnce(&mut Json) -> Result<T, String>) -> Result<T, String> {
		self.file.update(|saved| {
			if !saved.is_null() && saved.as_obj().is_none() {
				fsx::set_aside_corrupt(&self.path);
			}
			let mut record = with_maps(saved);
			let result = change(&mut record)?;
			Ok((Some(record), result))
		})
	}
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;

	fn store() -> (VaultNotesStore, std::path::PathBuf) {
		let root = std::env::temp_dir().join(format!("gs-vault-notes-{}", gs_base::ids::uuid()));
		let paths = Paths::new(root.join("data"), root.join("home"), root.join("tmp"), root.join("res"));
		std::fs::create_dir_all(&paths.data).unwrap();
		(VaultNotesStore::new(&paths, &Locks::new()), root.join("data"))
	}

	fn asides(data: &std::path::Path) -> Vec<String> {
		let mut names: Vec<String> = std::fs::read_dir(data).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.starts_with("vault-notes.json.corrupt-")).collect();
		names.sort();
		names
	}

	#[test]
	fn a_missing_file_reads_as_four_empty_maps_and_an_update_saves_with_the_version() {
		let (store, data) = store();
		assert_eq!(stringify(&store.read()), r#"{"folders":{},"notes":{},"keyUpdates":{},"asks":{}}"#);
		store
			.update(|r| {
				r.get_mut("folders").unwrap().set("spc_a", "CSE 21");
				Ok(())
			})
			.unwrap();
		assert_eq!(store.read()["folders"]["spc_a"].as_str(), Some("CSE 21"));
		let saved = gs_json::parse(&std::fs::read_to_string(data.join("vault-notes.json")).unwrap()).unwrap();
		assert_eq!(saved["version"].as_i64(), Some(1));
		let _ = std::fs::remove_dir_all(data.parent().unwrap());
	}

	#[test]
	fn a_damaged_file_is_kept_aside_and_never_overwritten() {
		let (store, data) = store();
		fsx::write_text_atomic(&data.join("vault-notes.json"), "{ not json").unwrap();
		assert_eq!(stringify(&store.read()), r#"{"folders":{},"notes":{},"keyUpdates":{},"asks":{}}"#);
		assert_eq!(asides(&data).len(), 1);
		assert_eq!(std::fs::read_to_string(data.join(&asides(&data)[0])).unwrap(), "{ not json");
		store
			.update(|r| {
				r.get_mut("notes").unwrap().set("tpc_1", json!({ "state": "active" }));
				Ok(())
			})
			.unwrap();
		assert_eq!(store.read()["notes"]["tpc_1"]["state"].as_str(), Some("active"));
		let _ = std::fs::remove_dir_all(data.parent().unwrap());
	}

	#[test]
	fn valid_json_that_is_not_an_object_is_also_kept_aside() {
		let (store, data) = store();
		fsx::write_text_atomic(&data.join("vault-notes.json"), "[1, 2]").unwrap();
		store.update(|_| Ok(())).unwrap();
		assert_eq!(std::fs::read_to_string(data.join(&asides(&data)[0])).unwrap(), "[1, 2]");
		assert_eq!(stringify(&store.read()), r#"{"folders":{},"notes":{},"keyUpdates":{},"asks":{}}"#);
		let _ = std::fs::remove_dir_all(data.parent().unwrap());
	}

	#[test]
	fn a_map_of_the_wrong_shape_reads_as_empty_and_other_maps_stay() {
		let (store, data) = store();
		fsx::write_text_atomic(&data.join("vault-notes.json"), r#"{"version":1,"folders":[1],"notes":{"tpc_1":{"state":"kept"}}}"#).unwrap();
		let record = store.read();
		assert_eq!(stringify(&record["folders"]), "{}");
		assert_eq!(record["notes"]["tpc_1"]["state"].as_str(), Some("kept"));
		let _ = std::fs::remove_dir_all(data.parent().unwrap());
	}

	#[test]
	fn a_failed_change_saves_nothing() {
		let (store, data) = store();
		assert!(store.update::<()>(|r| {
			r.get_mut("folders").unwrap().set("spc_a", "x");
			Err("no".to_owned())
		}).is_err());
		assert_eq!(stringify(&store.read()["folders"]), "{}");
		let _ = std::fs::remove_dir_all(data.parent().unwrap());
	}
}
