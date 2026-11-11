//! `data/classes/<id>/cheat-sheets/<deadline id>.json` is one deadline's cheat sheet, and beside
//! it `<deadline id>-files/` holds the pictures and PDFs sent in its chat and
//! `<deadline id>-versions/v<n>.pdf` the sheets the agent made. A class's delete takes the whole
//! folder with it.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use gs_base::config::Paths;
use gs_base::fsx;
use gs_base::locks::{LockKey, Locks};
use gs_base::re::Re;
use gs_core::contracts::class::is_class_id;
use gs_core::study::cheat_sheet::{CHEAT_SHEET_FORMAT, ParsedSheet, parse_cheat_sheet};
use gs_json::{Json, Obj, stringify_pretty};

/// Built once by `Stores::new`; keep this constructor's signature.
pub struct CheatSheetStore {
	classes: PathBuf,
	locks: Locks,
}

impl CheatSheetStore {
	pub fn new(paths: &Paths, locks: &Locks) -> CheatSheetStore {
		CheatSheetStore { classes: paths.classes.clone(), locks: locks.clone() }
	}

	fn sheet_file(&self, class_id: &str, deadline_id: &str) -> Result<PathBuf, String> {
		static DEADLINE_ID: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[a-z]+_[A-Za-z0-9_]+$", ""));
		if !is_class_id(class_id) || !DEADLINE_ID.test(deadline_id) {
			return Err(format!("Invalid cheat sheet id: {class_id}/{deadline_id}"));
		}
		Ok(self.classes.join(class_id).join("cheat-sheets").join(format!("{deadline_id}.json")))
	}

	fn files_dir(&self, class_id: &str, deadline_id: &str) -> Result<PathBuf, String> {
		self.beside_sheet(class_id, deadline_id, "-files")
	}

	fn versions_dir(&self, class_id: &str, deadline_id: &str) -> Result<PathBuf, String> {
		self.beside_sheet(class_id, deadline_id, "-versions")
	}

	/// The sheet file's path with `suffix` in place of `.json`.
	fn beside_sheet(&self, class_id: &str, deadline_id: &str, suffix: &str) -> Result<PathBuf, String> {
		Ok(self.sheet_file(class_id, deadline_id)?.with_file_name(format!("{deadline_id}{suffix}")))
	}

	/// `n` must be a whole number from 1 up that JavaScript holds exactly.
	fn version_file(&self, class_id: &str, deadline_id: &str, n: f64) -> Result<PathBuf, String> {
		if n.fract() != 0.0 || n.abs() > 9_007_199_254_740_991.0 || n < 1.0 {
			return Err(format!("Invalid cheat sheet version: {}", gs_json::js_number(n)));
		}
		Ok(self.versions_dir(class_id, deadline_id)?.join(format!("v{n}.pdf")))
	}

	fn sheet_file_path(&self, class_id: &str, deadline_id: &str, file_name: &str) -> Result<PathBuf, String> {
		if file_name.contains('/') || file_name.starts_with('.') {
			return Err(format!("Invalid file name: {file_name}"));
		}
		Ok(self.files_dir(class_id, deadline_id)?.join(file_name))
	}

	/// The saved sheet; None when there is none, `Newer` when a newer build saved it. A file that
	/// is not valid JSON is set aside.
	pub fn read_cheat_sheet(&self, class_id: &str, deadline_id: &str) -> Result<Option<ParsedSheet>, String> {
		let file = self.sheet_file(class_id, deadline_id)?;
		let _guard = self.locks.lock(LockKey::Class(class_id));
		Ok(fsx::read_json_or_set_aside(&file).and_then(|raw| parse_cheat_sheet(&raw)))
	}

	/// Saves the sheet, stamped with the record format.
	pub fn write_cheat_sheet(&self, class_id: &str, sheet: &Json) -> Result<(), String> {
		let file = self.sheet_file(class_id, sheet["deadlineId"].as_str().unwrap_or(""))?;
		let mut record = Obj::new();
		record.insert("version", CHEAT_SHEET_FORMAT);
		for (key, value) in sheet.as_obj().into_iter().flatten() {
			record.insert(key.as_str(), value.clone());
		}
		let _guard = self.locks.lock(LockKey::Class(class_id));
		fsx::write_text_atomic(&file, &stringify_pretty(&Json::Obj(record), "\t")).map_err(|err| fsx::node_error_message(&err, "open", &file))
	}

	/// A picture or PDF sent with a message, kept for the chat and the agent; returns its path.
	pub fn save_cheat_sheet_file(&self, class_id: &str, deadline_id: &str, file_name: &str, data: &[u8]) -> Result<PathBuf, String> {
		let file = self.sheet_file_path(class_id, deadline_id, file_name)?;
		let _guard = self.locks.lock(LockKey::Class(class_id));
		fsx::write_atomic(&file, data, None).map_err(|err| fsx::node_error_message(&err, "open", &file))?;
		Ok(file)
	}

	/// A file sent with a message (its path and bytes), or None when it is gone.
	pub fn read_cheat_sheet_file(&self, class_id: &str, deadline_id: &str, file_name: &str) -> Option<(PathBuf, Vec<u8>)> {
		let file = self.sheet_file_path(class_id, deadline_id, file_name).ok()?;
		let bytes = std::fs::read(&file).ok()?;
		Some((file, bytes))
	}

	/// A version's PDF, kept as the agent made it.
	pub fn save_sheet_pdf(&self, class_id: &str, deadline_id: &str, n: f64, data: &[u8]) -> Result<(), String> {
		let file = self.version_file(class_id, deadline_id, n)?;
		let _guard = self.locks.lock(LockKey::Class(class_id));
		fsx::write_atomic(&file, data, None).map_err(|err| fsx::node_error_message(&err, "open", &file))
	}

	/// A version's PDF, or None when it is gone.
	pub fn read_sheet_pdf(&self, class_id: &str, deadline_id: &str, n: f64) -> Option<Vec<u8>> {
		std::fs::read(self.version_file(class_id, deadline_id, n).ok()?).ok()
	}

	pub fn remove_sheet_pdfs(&self, class_id: &str, deadline_id: &str, ns: &[f64]) -> Result<(), String> {
		let _guard = self.locks.lock(LockKey::Class(class_id));
		for n in ns {
			remove_file(&self.version_file(class_id, deadline_id, *n)?)?;
		}
		Ok(())
	}

	/// The sheet's record, its sent files and its versions.
	pub fn remove_cheat_sheet(&self, class_id: &str, deadline_id: &str) -> Result<(), String> {
		let _guard = self.locks.lock(LockKey::Class(class_id));
		remove_file(&self.sheet_file(class_id, deadline_id)?)?;
		remove_dir(&self.files_dir(class_id, deadline_id)?)?;
		remove_dir(&self.versions_dir(class_id, deadline_id)?)
	}
}

/// `fs.rmSync(path, { force: true })`.
fn remove_file(file: &Path) -> Result<(), String> {
	ignore_missing(std::fs::remove_file(file)).map_err(|err| fsx::node_error_message(&err, "rm", file))
}

/// `fs.rmSync(path, { recursive: true, force: true })`.
fn remove_dir(dir: &Path) -> Result<(), String> {
	ignore_missing(std::fs::remove_dir_all(dir)).map_err(|err| fsx::node_error_message(&err, "rm", dir))
}

fn ignore_missing(result: io::Result<()>) -> io::Result<()> {
	match result {
		Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
		other => other,
	}
}

#[cfg(test)]
mod tests {
	use gs_base::ids;
	use gs_json::{json, parse};

	use super::*;

	const CLASS: &str = "cls_cvq4t7in_101dfecb";

	struct Fixture {
		store: CheatSheetStore,
		root: PathBuf,
	}

	impl Fixture {
		fn new() -> Fixture {
			let root = std::env::temp_dir().join(format!("gs-cheat-sheets-{}", ids::uuid()));
			let paths = Paths::new(root.clone(), root.clone(), root.clone(), root.clone());
			Fixture { store: CheatSheetStore::new(&paths, &Locks::new()), root }
		}
	}

	impl Drop for Fixture {
		fn drop(&mut self) {
			let _ = std::fs::remove_dir_all(&self.root);
		}
	}

	fn sheet() -> Json {
		json!({
			"deadlineId": "ddl_abc123",
			"versions": [{ "n": 1, "prompt": "make it", "at": "2026-11-10T00:00:00.000Z", "pages": [{ "widthPt": 612, "heightPt": 792 }] }],
			"messages": [{ "id": "m1", "role": "you", "text": "make it", "at": "2026-11-10T00:00:00.000Z" }],
			"rules": [{ "text": "A4", "at": "2026-11-10T00:00:00.000Z" }],
			"folder": "CSE 21 Midterm",
			"updatedAt": "2026-11-10T00:00:00.000Z"
		})
	}

	#[test]
	fn a_sheet_is_written_stamped_and_read_back() {
		let fx = Fixture::new();
		assert_eq!(fx.store.read_cheat_sheet(CLASS, "ddl_abc123"), Ok(None));
		fx.store.write_cheat_sheet(CLASS, &sheet()).unwrap();
		let file = fx.root.join("classes").join(CLASS).join("cheat-sheets").join("ddl_abc123.json");
		let text = std::fs::read_to_string(&file).unwrap();
		assert!(text.starts_with("{\n\t\"version\": 4,\n\t\"deadlineId\": \"ddl_abc123\",\n\t\"versions\": [\n\t\t{\n\t\t\t\"n\": 1,"), "{text}");
		assert!(!text.ends_with('\n'));
		assert_eq!(parse(&text).unwrap()["folder"], Json::from("CSE 21 Midterm"));
		assert_eq!(fx.store.read_cheat_sheet(CLASS, "ddl_abc123"), Ok(Some(ParsedSheet::Sheet(sheet()))));
	}

	#[test]
	fn a_newer_record_reads_as_newer_and_a_broken_one_is_set_aside() {
		let fx = Fixture::new();
		let dir = fx.root.join("classes").join(CLASS).join("cheat-sheets");
		std::fs::create_dir_all(&dir).unwrap();
		fsx::write_text_atomic(&dir.join("ddl_new.json"), r#"{"deadlineId":"ddl_new","version":9}"#).unwrap();
		assert_eq!(fx.store.read_cheat_sheet(CLASS, "ddl_new"), Ok(Some(ParsedSheet::Newer)));
		fsx::write_text_atomic(&dir.join("ddl_bad.json"), "{ nope").unwrap();
		assert_eq!(fx.store.read_cheat_sheet(CLASS, "ddl_bad"), Ok(None));
		assert!(!dir.join("ddl_bad.json").exists());
		let aside = std::fs::read_dir(&dir).unwrap().filter_map(Result::ok).any(|e| e.file_name().to_string_lossy().starts_with("ddl_bad.json.corrupt-"));
		assert!(aside);
	}

	#[test]
	fn sent_files_and_version_pdfs_round_trip_and_go_with_the_sheet() {
		let fx = Fixture::new();
		fx.store.write_cheat_sheet(CLASS, &sheet()).unwrap();
		let saved = fx.store.save_cheat_sheet_file(CLASS, "ddl_abc123", "pic.png", b"png").unwrap();
		assert_eq!(saved, fx.root.join("classes").join(CLASS).join("cheat-sheets").join("ddl_abc123-files").join("pic.png"));
		assert_eq!(fx.store.read_cheat_sheet_file(CLASS, "ddl_abc123", "pic.png"), Some((saved, b"png".to_vec())));
		assert_eq!(fx.store.read_cheat_sheet_file(CLASS, "ddl_abc123", "gone.png"), None);
		fx.store.save_sheet_pdf(CLASS, "ddl_abc123", 1.0, b"%PDF-1").unwrap();
		fx.store.save_sheet_pdf(CLASS, "ddl_abc123", 2.0, b"%PDF-2").unwrap();
		assert_eq!(fx.store.read_sheet_pdf(CLASS, "ddl_abc123", 2.0), Some(b"%PDF-2".to_vec()));
		fx.store.remove_sheet_pdfs(CLASS, "ddl_abc123", &[1.0, 7.0]).unwrap();
		assert_eq!(fx.store.read_sheet_pdf(CLASS, "ddl_abc123", 1.0), None);
		assert_eq!(fx.store.read_sheet_pdf(CLASS, "ddl_abc123", 2.0), Some(b"%PDF-2".to_vec()));
		fx.store.remove_cheat_sheet(CLASS, "ddl_abc123").unwrap();
		let dir = fx.root.join("classes").join(CLASS).join("cheat-sheets");
		assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
		fx.store.remove_cheat_sheet(CLASS, "ddl_abc123").unwrap();
	}

	#[test]
	fn bad_ids_names_and_versions_are_refused_with_the_node_messages() {
		let fx = Fixture::new();
		assert_eq!(fx.store.read_cheat_sheet("nope", "ddl_1").unwrap_err(), "Invalid cheat sheet id: nope/ddl_1");
		assert_eq!(fx.store.read_cheat_sheet(CLASS, "../x").unwrap_err(), format!("Invalid cheat sheet id: {CLASS}/../x"));
		assert_eq!(fx.store.save_cheat_sheet_file(CLASS, "ddl_1", "../x", b"").unwrap_err(), "Invalid file name: ../x");
		assert_eq!(fx.store.save_cheat_sheet_file(CLASS, "ddl_1", ".hidden", b"").unwrap_err(), "Invalid file name: .hidden");
		assert_eq!(fx.store.save_sheet_pdf(CLASS, "ddl_1", 0.0, b"").unwrap_err(), "Invalid cheat sheet version: 0");
		assert_eq!(fx.store.save_sheet_pdf(CLASS, "ddl_1", 1.5, b"").unwrap_err(), "Invalid cheat sheet version: 1.5");
		assert_eq!(fx.store.read_sheet_pdf(CLASS, "ddl_1", f64::NAN), None);
	}
}
