//! data/settings.json, the one user settings record.
//!
//! Every read sanitizes what is on disk and runs the lazy upgrades (the v1 to v2 threshold move
//! and the retired prompt switches). Every write sanitizes again, so the file can never hold a
//! value that shifts a knob.

use gs_base::config::Paths;
use gs_base::fsx;
use gs_base::locks::{LockKey, Locks};
use gs_core::records::settings::sanitize_user_settings;
use gs_core::records::settings_resolution::resolve_settings;
use gs_json::{Json, stringify_pretty};

use crate::prompt_overrides::PromptOverrides;

const FILE_LOCK: &str = "settings.json";
/// The summarize threshold's old default, replaced by the new one on upgrade.
const OLD_THRESHOLD: f64 = 150_000.0;

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
		let upgraded = upgrade_to_v2(&mut record);
		if self.drop_prompt_switches(&parsed) || upgraded {
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

/// v1 to v2: the summarize threshold's default dropped from 150k to 40k tokens, so a record still
/// holding the old default takes the new one. True when the file needs saving; a bare version
/// bump waits for the next write, so plain reads stay reads.
fn upgrade_to_v2(record: &mut Json) -> bool {
	if record["version"].as_f64().is_some_and(|v| v >= 2.0) {
		return false;
	}
	if let Some(obj) = record.as_obj_mut() {
		obj.insert("version", 2);
	}
	if record["compaction"]["thresholdTokens"].as_f64() != Some(OLD_THRESHOLD) {
		return false;
	}
	record.get_mut("compaction").and_then(Json::as_obj_mut).is_some_and(|c| c.remove("thresholdTokens").is_some())
}

#[cfg(test)]
mod tests {
	use gs_json::parse;

	use super::*;

	#[test]
	fn old_threshold_is_dropped_and_version_bumped() {
		let mut record = parse(r#"{"version":1,"compaction":{"thresholdTokens":150000}}"#).unwrap();
		assert!(upgrade_to_v2(&mut record));
		assert_eq!(gs_json::stringify(&record), r#"{"version":2,"compaction":{}}"#);
		let mut custom = parse(r#"{"version":1,"compaction":{"thresholdTokens":90000}}"#).unwrap();
		assert!(!upgrade_to_v2(&mut custom));
		assert_eq!(gs_json::stringify(&custom), r#"{"version":2,"compaction":{"thresholdTokens":90000}}"#);
		let mut current = parse(r#"{"version":3}"#).unwrap();
		assert!(!upgrade_to_v2(&mut current));
	}
}
