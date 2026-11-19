//! One small app file under the data folder that holds a version stamp: the path, the read that
//! sets a broken file aside, and the stamped write under the file's lock.

use std::path::PathBuf;

use gs_base::config::Paths;
use gs_base::fsx;
use gs_base::locks::{LockKey, Locks};
use gs_json::{Json, Obj};

pub struct AppFile {
	file: PathBuf,
	name: &'static str,
	version: i64,
	locks: Locks,
}

impl AppFile {
	/// `name` is the file's name in the data folder and its lock's name.
	pub fn new(paths: &Paths, locks: &Locks, name: &'static str, version: i64) -> AppFile {
		AppFile { file: paths.data.join(name), name, version, locks: locks.clone() }
	}

	/// The saved record; null when the file is missing or unusable (a broken one is set aside).
	pub fn read(&self) -> Json {
		fsx::read_json_or_set_aside(&self.file).unwrap_or(Json::Null)
	}

	/// Saves `fields` after the version stamp, under the file's lock.
	pub fn write(&self, fields: Json) -> Result<(), String> {
		let _guard = self.locks.lock(LockKey::AppFile(self.name));
		self.write_held(fields)
	}

	/// Reads, lets `change` decide, and saves what it returns (nothing for None) under the file's
	/// lock. `change` gets the saved record and gives the fields to save and a result.
	pub fn update<T>(&self, change: impl FnOnce(&Json) -> Result<(Option<Json>, T), String>) -> Result<T, String> {
		let _guard = self.locks.lock(LockKey::AppFile(self.name));
		let (fields, result) = change(&self.read())?;
		if let Some(fields) = fields {
			self.write_held(fields)?;
		}
		Ok(result)
	}

	fn write_held(&self, fields: Json) -> Result<(), String> {
		let mut record = Obj::new();
		record.insert("version", self.version);
		for (key, value) in fields.as_obj().into_iter().flatten() {
			if key != "version" {
				record.insert(key.as_str(), value.clone());
			}
		}
		fsx::write_json_atomic(&self.file, &Json::Obj(record))
	}
}

/// Writes a record that carries its own stamp: as it is when it already has `version`, otherwise
/// with the stamp set (in its place if it has one, at the end if not).
pub fn write_stamped(file: &std::path::Path, record: &Json, version: i64) -> Result<(), String> {
	if record.as_obj().is_some() && record["version"].as_f64() == Some(version as f64) {
		return fsx::write_json_atomic(file, record);
	}
	let mut stamped = record.as_obj().cloned().unwrap_or_default();
	stamped.insert("version", version);
	fsx::write_json_atomic(file, &Json::Obj(stamped))
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn file_in(root: &std::path::Path) -> AppFile {
		let paths = Paths::new(root.join("data"), root.join("home"), root.join("tmp"), root.join("res"));
		AppFile::new(&paths, &Locks::new(), "things.json", 2)
	}

	#[test]
	fn a_write_puts_the_version_first_and_an_update_reads_changes_and_saves() {
		let root = std::env::temp_dir().join(format!("gs-app-file-{}", gs_base::ids::uuid()));
		let file = file_in(&root);
		assert!(file.read().is_null());
		file.write(json!({ "items": [1] })).unwrap();
		let count = file.update(|saved| Ok((Some(json!({ "items": [1, 2], "version": 9 })), saved["items"].items().len()))).unwrap();
		assert_eq!(count, 1);
		assert_eq!(std::fs::read_to_string(root.join("data/things.json")).unwrap(), "{\n\t\"version\": 2,\n\t\"items\": [\n\t\t1,\n\t\t2\n\t]\n}");
		file.update(|_| Ok((None, ()))).unwrap();
		assert_eq!(file.read()["items"].items().len(), 2);
		assert_eq!(file.update::<()>(|_| Err("no".to_owned())), Err("no".to_owned()));
		let _ = std::fs::remove_dir_all(&root);
	}

	#[test]
	fn a_stamped_write_keeps_the_place_of_an_old_stamp_and_adds_a_missing_one_last() {
		let root = std::env::temp_dir().join(format!("gs-write-stamped-{}", gs_base::ids::uuid()));
		let file = root.join("a.json");
		write_stamped(&file, &json!({ "id": "x", "version": 1, "n": 2 }), 3).unwrap();
		assert_eq!(gs_json::stringify(&gs_base::fsx::read_json(&file).unwrap()), r#"{"id":"x","version":3,"n":2}"#);
		write_stamped(&file, &json!({ "id": "x" }), 3).unwrap();
		assert_eq!(gs_json::stringify(&gs_base::fsx::read_json(&file).unwrap()), r#"{"id":"x","version":3}"#);
		let _ = std::fs::remove_dir_all(&root);
	}
}
