//! First-launch onboarding: who sees it. `/api/boot` asks on every page load; the answer lives in
//! settings.json as `general.onboarded`:
//! - true: done (finished, or an existing user who skipped it);
//! - false: in progress, shown until the learner finishes it;
//! - absent: decided here, once. Someone who already set up an outside agent (data/mcp-token
//!   exists) is an existing user and skips it; everyone else gets it.
//!
//! The token is made after that check (outside-agent access is always on), so the check sees the
//! state from before this version.

use gs_base::locks::LockKey;

use super::settings_record::{record_or_new, with_field};
use crate::App;

pub fn onboarding_needed(app: &App) -> Result<bool, String> {
	let _guard = app.locks.lock(LockKey::AppFile("settings.json"));
	let record = app.stores.settings.read_settings()?;
	let onboarded = match record.as_ref().and_then(|r| r["general"]["onboarded"].as_bool()) {
		Some(onboarded) => onboarded,
		None => {
			let onboarded = app.stores.mcp_token.read_mcp_token().is_some();
			app.stores.settings.write_settings(&with_field(record_or_new(record), "general", "onboarded", onboarded))?;
			onboarded
		}
	};
	app.stores.mcp_token.ensure_mcp_token()?;
	Ok(!onboarded)
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn a_first_launch_gets_onboarding_and_a_token() {
		let root = scratch_dir("onboarding-new");
		let app = test_app(&root);
		assert!(onboarding_needed(&app).unwrap());
		assert_eq!(app.stores.settings.read_settings().unwrap().unwrap()["general"]["onboarded"].as_bool(), Some(false));
		assert!(app.stores.mcp_token.read_mcp_token().is_some());
		assert!(onboarding_needed(&app).unwrap());
	}

	#[test]
	fn someone_with_a_token_is_an_existing_user() {
		let root = scratch_dir("onboarding-existing");
		let app = test_app(&root);
		app.stores.mcp_token.ensure_mcp_token().unwrap();
		assert!(!onboarding_needed(&app).unwrap());
		assert_eq!(stringify(&app.stores.settings.read_settings().unwrap().unwrap()["general"]), r#"{"onboarded":true}"#);
	}

	#[test]
	fn a_recorded_answer_stands() {
		let root = scratch_dir("onboarding-recorded");
		let app = test_app(&root);
		app.stores.settings.write_settings(&json!({ "version": 2, "general": { "onboarded": true } })).unwrap();
		assert!(!onboarding_needed(&app).unwrap());
	}
}
