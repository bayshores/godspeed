//! The vault part of settings.json (the notes folder and who writes "My words"). Only the vault
//! service changes it, one field at a time, so no settings screen save can overwrite the rest.

use std::sync::Arc;

use gs_base::locks::LockKey;
use gs_core::records::settings::sanitize_vault;
use gs_json::{Json, Obj};

use super::settings_record::record_or_new;
use crate::App;

/// Sets one field of the vault section (`path` or `words`); null removes it. A value the section
/// does not accept is refused, and nothing is saved.
pub fn set_vault_field(app: &Arc<App>, key: &str, value: Json) -> Result<(), String> {
	// The merge and the save share one hold, so no other settings save lands between them.
	let _held = app.locks.lock(LockKey::AppFile("settings.json"));
	let mut record = record_or_new(app.stores.settings.read_settings()?);
	let mut vault = record["vault"].as_obj().cloned().unwrap_or_default();
	match value {
		Json::Null => vault.remove(key),
		_ => vault.insert(key, value),
	};
	let vault = Json::Obj(vault);
	let clean = sanitize_vault(&vault);
	if clean != vault {
		return Err(format!("\"{key}\" does not hold a vault setting"));
	}
	if let Some(fields) = record.as_obj_mut() {
		fields.insert("vault", Json::Obj(clean.as_obj().cloned().unwrap_or_else(Obj::new)));
	}
	app.stores.settings.write_settings(&record)?;
	app.misc.settings_saved.notify_one();
	Ok(())
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn one_field_changes_and_the_rest_of_settings_stays() {
		let root = scratch_dir("vault-field");
		let app = test_app(&root);
		gs_base::fsx::write_text_atomic(&app.paths.settings_file, r#"{"version":3,"general":{"teacherName":"Zed"}}"#).unwrap();
		set_vault_field(&app, "path", json!("/Users/me/Notes")).unwrap();
		set_vault_field(&app, "words", json!("mine")).unwrap();
		let saved = app.stores.settings.read_settings().unwrap().unwrap();
		assert_eq!(saved["general"]["teacherName"].as_str(), Some("Zed"));
		assert_eq!(saved["vault"]["path"].as_str(), Some("/Users/me/Notes"));
		assert_eq!(saved["vault"]["words"].as_str(), Some("mine"));
		set_vault_field(&app, "path", Json::Null).unwrap();
		let saved = app.stores.settings.read_settings().unwrap().unwrap();
		assert!(saved["vault"]["path"].is_null());
		assert_eq!(saved["vault"]["words"].as_str(), Some("mine"));
	}

	#[test]
	fn a_bad_value_is_refused_and_nothing_is_saved() {
		let root = scratch_dir("vault-field-bad");
		let app = test_app(&root);
		assert!(set_vault_field(&app, "words", json!("nobody")).is_err());
		assert!(set_vault_field(&app, "colour", json!("red")).is_err());
		assert!(set_vault_field(&app, "path", json!(5)).is_err());
		assert!(app.stores.settings.read_settings().unwrap().is_none());
	}
}
