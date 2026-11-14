//! data/settings.json, the one user settings record.
//!
//! Every read sanitizes what is on disk and runs the lazy upgrades (the rename of
//! general.activeClass to activeSpace in version 3, and the retired prompt switches). Every write
//! sanitizes again, so the file can never hold a value that shifts a knob.

use gs_base::config::Paths;
use gs_base::fsx;
use gs_base::locks::{LockKey, Locks};
use gs_core::contracts::space::is_space_id;
use gs_core::records::settings::sanitize_user_settings;
use gs_core::records::settings_resolution::resolve_settings;
use gs_json::{Json, stringify_pretty};

use crate::prompt_overrides::PromptOverrides;

const FILE_LOCK: &str = "settings.json";

pub struct SettingsStore {
	paths: Paths,
	locks: Locks,
	overrides: PromptOverrides,
}

impl SettingsStore {
	pub fn new(paths: &Paths, locks: &Locks) -> SettingsStore {
		SettingsStore { paths: paths.clone(), locks: locks.clone(), overrides: PromptOverrides::new(paths) }
	}

	/// The saved record, or None on first boot or when the file was unusable (it is kept aside
	/// then). A record that needed an upgrade is saved before it is returned; Err when that save
	/// fails.
	pub fn read_settings(&self) -> Result<Option<Json>, String> {
		let _guard = self.locks.lock(LockKey::AppFile(FILE_LOCK));
		let file = &self.paths.settings_file;
		let Some(parsed) = fsx::read_json_or_set_aside(file) else { return Ok(None) };
		let Some(mut record) = sanitize_user_settings(&parsed) else {
			fsx::set_aside_corrupt(file);
			return Ok(None);
		};
		let renamed = upgrade_to_v3(&mut record, &parsed);
		if self.drop_prompt_switches(&parsed) || renamed {
			self.write_settings(&record)?;
		}
		Ok(Some(record))
	}

	/// Saves the record (sanitized) and returns what was written.
	pub fn write_settings(&self, raw: &Json) -> Result<Json, String> {
		let settings = sanitize_user_settings(raw).ok_or("settings record must be a JSON object")?;
		let _guard = self.locks.lock(LockKey::AppFile(FILE_LOCK));
		let file = &self.paths.settings_file;
		fsx::write_text_atomic(file, &stringify_pretty(&settings, "\t")).map_err(|err| fsx::node_error_message(&err, "open", file))?;
		Ok(settings)
	}

	/// Every knob concrete: the saved choices over the factory defaults.
	pub fn effective_settings(&self) -> Result<Json, String> {
		Ok(resolve_settings(self.read_settings()?.as_ref()))
	}

	/// Prompt parts used to have an on/off switch; a saved version is now always in use. One that
	/// was switched off is deleted so nothing turns on by surprise. True when the old switch map
	/// was there (the caller rewrites the record without it).
	fn drop_prompt_switches(&self, parsed: &Json) -> bool {
		let switches = &parsed["agent"]["prompts"];
		if !matches!(switches, Json::Obj(_) | Json::Arr(_)) {
			return false;
		}
		for segment in self.overrides.list_overrides() {
			if switches.get(&segment).and_then(Json::as_bool) != Some(true) {
				self.overrides.delete_override(&segment);
			}
		}
		true
	}
}

/// v2 to v3: the open space was saved as general.activeClass, a key the sanitizer drops, so it is
/// read from the raw file. True when the file needs saving.
fn upgrade_to_v3(record: &mut Json, parsed: &Json) -> bool {
	if record["version"].as_f64().is_some_and(|v| v >= 3.0) {
		return false;
	}
	let Some(obj) = record.as_obj_mut() else { return false };
	obj.insert("version", 3);
	let Some(old) = parsed["general"]["activeClass"].as_str().filter(|c| *c == "none" || is_space_id(c)) else { return false };
	let mut general = obj.get("general").and_then(Json::as_obj).cloned().unwrap_or_default();
	general.insert("activeSpace", old);
	obj.insert("general", general);
	true
}

#[cfg(test)]
mod tests {
	use gs_json::parse;

	use super::*;

	#[test]
	fn the_open_class_becomes_the_open_space() {
		let upgrade = |raw: &str| {
			let parsed = parse(raw).unwrap();
			let mut record = sanitize_user_settings(&parsed).unwrap();
			let save = upgrade_to_v3(&mut record, &parsed);
			(save, gs_json::stringify(&record))
		};
		assert_eq!(upgrade(r#"{"version":2,"general":{"activeClass":"cls_a1","sounds":false}}"#), (true, r#"{"version":3,"general":{"sounds":false,"activeSpace":"cls_a1"}}"#.to_owned()));
		assert_eq!(upgrade(r#"{"version":1,"general":{"activeClass":"none"}}"#), (true, r#"{"version":3,"general":{"activeSpace":"none"}}"#.to_owned()));
		assert_eq!(upgrade(r#"{"version":2}"#), (false, r#"{"version":3}"#.to_owned()));
		assert_eq!(upgrade(r#"{"version":2,"general":{"activeClass":"../x"}}"#), (false, r#"{"version":3,"general":{}}"#.to_owned()));
		assert_eq!(upgrade(r#"{"version":3,"general":{"activeClass":"cls_a1"}}"#), (false, r#"{"version":3,"general":{}}"#.to_owned()));
	}

	#[test]
	fn a_read_saves_the_moved_open_space_only() {
		let dir = std::env::temp_dir().join(format!("gs-settings-v3-{}", gs_base::ids::uuid()));
		let paths = Paths::new(dir.clone(), dir.clone(), dir.clone(), dir.clone());
		let store = SettingsStore::new(&paths, &Locks::new());
		fsx::write_text_atomic(&paths.settings_file, r#"{"version":2,"general":{"activeClass":"spc_b2"}}"#).unwrap();
		assert_eq!(store.read_settings().unwrap().unwrap()["general"]["activeSpace"], Json::from("spc_b2"));
		assert_eq!(std::fs::read_to_string(&paths.settings_file).unwrap(), "{\n\t\"version\": 3,\n\t\"general\": {\n\t\t\"activeSpace\": \"spc_b2\"\n\t}\n}");
		let plain = r#"{"version":2,"general":{"sounds":true}}"#;
		fsx::write_text_atomic(&paths.settings_file, plain).unwrap();
		assert_eq!(store.read_settings().unwrap().unwrap()["version"], Json::from(3));
		assert_eq!(std::fs::read_to_string(&paths.settings_file).unwrap(), plain);
	}
}
