//! Who sees "What's new". `/api/boot` asks on every page load; the answer lives in settings.json
//! as `general.lastSeenVersion`:
//! - older than this version: show the notes since it, then record this version so they show once;
//! - absent: a brand-new install records this version and shows nothing; an existing user
//!   (already onboarded) counts as coming from 0.4.0, the last version without these notes, so
//!   their first update shows them.

use gs_base::locks::LockKey;
use gs_core::records::changelog::{compare_versions, is_version};
use gs_json::Json;

use super::settings_record::{record_or_new, with_field};
use crate::App;

const BEFORE_WHATS_NEW: &str = "0.4.0";

/// The version the learner last saw notes for, when `current` has newer ones to show.
pub fn whats_new_since(app: &App, current: &str) -> Result<Option<String>, String> {
	if !is_version(&Json::from(current)) {
		return Ok(None);
	}
	let _guard = app.locks.lock(LockKey::AppFile("settings.json"));
	let record = app.stores.settings.read_settings()?;
	let general = record.as_ref().map_or(Json::Null, |r| r["general"].clone());
	let recorded = general["lastSeenVersion"].as_str().filter(|v| is_version(&Json::from(*v)));
	let since = recorded.unwrap_or(if general["onboarded"].as_bool() == Some(true) { BEFORE_WHATS_NEW } else { current }).to_owned();
	if recorded != Some(current) {
		app.stores.settings.write_settings(&with_field(record_or_new(record), "general", "lastSeenVersion", current))?;
	}
	Ok((compare_versions(&since, current) < 0.0).then_some(since))
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	fn saved_version(app: &App) -> Option<String> {
		app.stores.settings.read_settings().unwrap().and_then(|r| r["general"]["lastSeenVersion"].as_str().map(str::to_owned))
	}

	#[test]
	fn a_new_install_records_the_version_and_shows_nothing() {
		let root = scratch_dir("whats-new-new");
		let app = test_app(&root);
		assert_eq!(whats_new_since(&app, "0.5.0").unwrap(), None);
		assert_eq!(saved_version(&app).as_deref(), Some("0.5.0"));
	}

	#[test]
	fn an_existing_user_sees_notes_once() {
		let root = scratch_dir("whats-new-existing");
		let app = test_app(&root);
		app.stores.settings.write_settings(&json!({ "version": 2, "general": { "onboarded": true } })).unwrap();
		assert_eq!(whats_new_since(&app, "0.5.0").unwrap().as_deref(), Some("0.4.0"));
		assert_eq!(whats_new_since(&app, "0.5.0").unwrap(), None);
	}

	#[test]
	fn an_older_recorded_version_is_the_start_and_a_bad_current_shows_nothing() {
		let root = scratch_dir("whats-new-older");
		let app = test_app(&root);
		app.stores.settings.write_settings(&json!({ "version": 2, "general": { "lastSeenVersion": "0.4.5" } })).unwrap();
		assert_eq!(whats_new_since(&app, "dev").unwrap(), None);
		assert_eq!(whats_new_since(&app, "0.5.1").unwrap().as_deref(), Some("0.4.5"));
		assert_eq!(saved_version(&app).as_deref(), Some("0.5.1"));
	}
}
