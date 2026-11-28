//! First-launch onboarding: who sees it. `/api/boot` asks on every page load; the answer lives in
//! settings.json as `general.onboarded`:
//! - true: done (finished, or an existing user who skipped it);
//! - false: in progress, shown until the learner finishes it;
//! - absent: decided here, once. Someone an older godspeed let in through its outside door has
//!   its access token (data/mcp-token), so is an existing user and skips it; everyone else gets it.
//!
//! The token opens nothing any more, so once that is decided it is deleted.

use gs_base::fsx;
use gs_base::locks::LockKey;

use super::settings_record::{record_or_new, with_field};
use crate::App;

/// The outside door's access token an older godspeed made.
const OLD_TOKEN: &str = "mcp-token";

pub(crate) fn onboarding_needed(app: &App) -> Result<bool, String> {
	let _guard = app.locks.lock(LockKey::AppFile("settings.json"));
	let record = app.stores.settings.read_settings()?;
	let token = app.paths.data.join(OLD_TOKEN);
	let onboarded = match record.as_ref().and_then(|r| r["general"]["onboarded"].as_bool()) {
		Some(onboarded) => onboarded,
		None => {
			let onboarded = token.exists();
			app.stores.settings.write_settings(&with_field(record_or_new(record), "general", "onboarded", onboarded))?;
			onboarded
		}
	};
	// A token that will not go opens nothing; onboarding is decided all the same.
	if let Err(err) = fsx::remove_if_present(&token, "rm") {
		eprintln!("[onboarding] removing the old access token failed: {err}");
	}
	Ok(!onboarded)
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;
	use crate::app::disk::write_file_atomic;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn a_first_launch_gets_onboarding() {
		let root = scratch_dir("onboarding-new");
		let app = test_app(&root);
		assert!(onboarding_needed(&app).unwrap());
		assert_eq!(app.stores.settings.read_settings().unwrap().unwrap()["general"]["onboarded"].as_bool(), Some(false));
		assert!(onboarding_needed(&app).unwrap());
		assert!(!app.paths.data.join(OLD_TOKEN).exists(), "no token is made");
	}

	#[test]
	fn someone_with_the_old_token_is_an_existing_user_and_the_token_goes() {
		let root = scratch_dir("onboarding-existing");
		let app = test_app(&root);
		write_file_atomic(&app.paths.data.join(OLD_TOKEN), "a".repeat(64).as_str()).unwrap();
		assert!(!onboarding_needed(&app).unwrap());
		assert_eq!(stringify(&app.stores.settings.read_settings().unwrap().unwrap()["general"]), r#"{"onboarded":true}"#);
		assert!(!app.paths.data.join(OLD_TOKEN).exists());
		assert!(!onboarding_needed(&app).unwrap(), "the answer stands without the token");
	}

	#[test]
	fn a_recorded_answer_stands_and_a_left_token_goes() {
		let root = scratch_dir("onboarding-recorded");
		let app = test_app(&root);
		app.stores.settings.write_settings(&json!({ "version": 2, "general": { "onboarded": true } })).unwrap();
		write_file_atomic(&app.paths.data.join(OLD_TOKEN), "a".repeat(64).as_str()).unwrap();
		assert!(!onboarding_needed(&app).unwrap());
		assert!(!app.paths.data.join(OLD_TOKEN).exists());
	}
}
