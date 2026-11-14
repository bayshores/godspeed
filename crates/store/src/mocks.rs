//! `data/spaces/<id>/mocks/<mock id>.json` is one mock of a prep (core `preps::mock`), stamped
//! with its format. Written only by the mocks service; a space's delete takes the folder with it.

use std::path::PathBuf;

use gs_base::config::Paths;
use gs_base::fsx;
use gs_base::locks::{LockKey, Locks};
use gs_core::contracts::space::is_space_id;
use gs_core::mocks::mock::{MOCK_FORMAT_VERSION, ParsedMock, is_mock_id, parse_mock};
use gs_json::{Json, Obj, stringify_pretty};

/// Built once by `Stores::new`.
pub struct MockStore {
	spaces: PathBuf,
	locks: Locks,
}

impl MockStore {
	pub fn new(paths: &Paths, locks: &Locks) -> MockStore {
		MockStore { spaces: paths.spaces.clone(), locks: locks.clone() }
	}

	fn mocks_dir(&self, space_id: &str) -> Result<PathBuf, String> {
		if !is_space_id(space_id) {
			return Err(format!("Invalid space id: {space_id}"));
		}
		Ok(self.spaces.join(space_id).join("mocks"))
	}

	fn mock_file(&self, space_id: &str, mock_id: &str) -> Result<PathBuf, String> {
		if !is_mock_id(mock_id) {
			return Err(format!("Invalid mock id: {mock_id}"));
		}
		Ok(self.mocks_dir(space_id)?.join(format!("{mock_id}.json")))
	}

	/// The saved mock; None when there is none or a newer build saved it. A file that is not
	/// valid JSON is set aside.
	pub fn read_mock(&self, space_id: &str, mock_id: &str) -> Result<Option<Json>, String> {
		let file = self.mock_file(space_id, mock_id)?;
		let _guard = self.locks.lock(LockKey::Space(space_id));
		Ok(match fsx::read_json_or_set_aside(&file).and_then(|raw| parse_mock(&raw)) {
			Some(ParsedMock::Mock(mock)) => Some(mock),
			_ => None,
		})
	}

	/// Every mock of a prep, oldest first.
	pub fn list_mocks(&self, space_id: &str) -> Result<Vec<Json>, String> {
		let dir = self.mocks_dir(space_id)?;
		let _guard = self.locks.lock(LockKey::Space(space_id));
		let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(Vec::new()) };
		let mut names: Vec<String> = entries.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
		names.sort();
		let mut mocks = Vec::new();
		for name in names {
			let Some(id) = name.strip_suffix(".json").filter(|id| is_mock_id(id)) else { continue };
			if let Some(mock) = self.read_mock(space_id, id)? {
				mocks.push(mock);
			}
		}
		let n = |m: &Json| m["n"].as_f64().unwrap_or(f64::NAN);
		mocks.sort_by(|a, b| n(a).partial_cmp(&n(b)).unwrap_or(std::cmp::Ordering::Equal));
		Ok(mocks)
	}

	pub fn write_mock(&self, space_id: &str, mock: &Json) -> Result<(), String> {
		let file = self.mock_file(space_id, mock["id"].as_str().unwrap_or(""))?;
		let mut record = Obj::new();
		record.insert("version", MOCK_FORMAT_VERSION);
		for (key, value) in mock.as_obj().into_iter().flatten() {
			record.insert(key.as_str(), value.clone());
		}
		let _guard = self.locks.lock(LockKey::Space(space_id));
		fsx::write_text_atomic(&file, &stringify_pretty(&Json::Obj(record), "\t")).map_err(|err| fsx::node_error_message(&err, "open", &file))
	}

	pub fn remove_mock(&self, space_id: &str, mock_id: &str) -> Result<(), String> {
		let file = self.mock_file(space_id, mock_id)?;
		let _guard = self.locks.lock(LockKey::Space(space_id));
		fsx::remove_if_present(&file, "rm")
	}
}

#[cfg(test)]
mod tests {
	use gs_core::mocks::mock::new_mock;
	use gs_json::json;

	use super::*;

	const SPACE: &str = "cls_test_0a1b2c3d";

	fn store(tag: &str) -> (MockStore, PathBuf) {
		let root = std::env::temp_dir().join(format!("gs-mocks-{tag}-{}", gs_base::ids::uuid()));
		let paths = Paths::new(root.clone(), root.clone(), root.clone(), root);
		(MockStore::new(&paths, &Locks::new()), paths.spaces.clone())
	}

	#[test]
	fn saves_reads_lists_oldest_first_and_removes() {
		let (store, spaces) = store("list");
		let format = json!({ "questions": 4, "minutes": 70 });
		assert_eq!(store.list_mocks(SPACE).unwrap(), Vec::<Json>::new());
		let second = new_mock("mock_00000002", 2.0, &format, "2026-11-12T09:00:00.000Z");
		let first = new_mock("mock_00000001", 1.0, &format, "2026-11-11T09:00:00.000Z");
		store.write_mock(SPACE, &second).unwrap();
		store.write_mock(SPACE, &first).unwrap();
		let text = std::fs::read_to_string(spaces.join(SPACE).join("mocks/mock_00000001.json")).unwrap();
		assert_eq!(text, "{\n\t\"version\": 1,\n\t\"id\": \"mock_00000001\",\n\t\"n\": 1,\n\t\"format\": {\n\t\t\"questions\": 4,\n\t\t\"minutes\": 70\n\t},\n\t\"createdAt\": \"2026-11-11T09:00:00.000Z\",\n\t\"questions\": [],\n\t\"answers\": {}\n}");
		assert_eq!(store.read_mock(SPACE, "mock_00000001").unwrap(), Some(first));
		let ns = |s: &MockStore| s.list_mocks(SPACE).unwrap().iter().map(|m| m["n"].clone()).collect::<Vec<_>>();
		assert_eq!(ns(&store), [json!(1), json!(2)]);
		store.remove_mock(SPACE, "mock_00000001").unwrap();
		store.remove_mock(SPACE, "mock_00000001").unwrap();
		assert_eq!(store.read_mock(SPACE, "mock_00000001").unwrap(), None);
		assert_eq!(ns(&store), [json!(2)]);
		let newer = json!({ "version": 2, "id": "mock_00000003" });
		fsx::write_text_atomic(&spaces.join(SPACE).join("mocks/mock_00000003.json"), &gs_json::stringify(&newer)).unwrap();
		assert_eq!(store.read_mock(SPACE, "mock_00000003").unwrap(), None, "a newer build's mock");
		std::fs::remove_dir_all(spaces.parent().unwrap()).unwrap();
	}

	#[test]
	fn sets_a_broken_file_aside_and_refuses_bad_ids() {
		let (store, spaces) = store("broken");
		let file = spaces.join(SPACE).join("mocks/mock_0000000a.json");
		fsx::write_text_atomic(&file, "{ not json").unwrap();
		assert_eq!(store.read_mock(SPACE, "mock_0000000a").unwrap(), None);
		assert!(!file.exists(), "kept aside under another name");
		assert_eq!(store.read_mock(SPACE, "../space").unwrap_err(), "Invalid mock id: ../space");
		assert_eq!(store.list_mocks("../..").unwrap_err(), "Invalid space id: ../..");
		std::fs::remove_dir_all(spaces.parent().unwrap()).unwrap();
	}
}
