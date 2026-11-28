//! Each plugin's switch and setting values, kept in the `plugins` section of settings.json. A
//! plugin with no entry is on, as a tool with no switch is; a value missing or no longer valid for
//! the manifest reads as the setting's default.

use gs_base::locks::LockKey;
use gs_json::{Json, Obj};

use super::manifest::{TEXT_MAX, setting_of};
use crate::App;
use crate::app::settings_record::record_or_new;
use crate::outcome::{Outcome, refuse};

const SECTION: &str = "plugins";

/// The value if it fits the setting, else why not.
fn checked_value(setting: &Json, value: &Json) -> Result<Json, String> {
	let label = setting["label"].str_or_empty();
	let fits = match setting["kind"].as_str() {
		Some("toggle") => value.as_bool().is_some(),
		Some("choice") => value.as_str().is_some_and(|v| setting["options"].items().iter().any(|o| o.as_str() == Some(v))),
		Some("number") => value.as_f64().is_some_and(|n| n.is_finite() && setting["min"].as_f64().is_none_or(|m| n >= m) && setting["max"].as_f64().is_none_or(|m| n <= m)),
		Some("text") => value.as_str().is_some_and(|t| t.chars().count() <= TEXT_MAX),
		_ => false,
	};
	if fits { Ok(value.clone()) } else { Err(format!("{label} can't be set to that.")) }
}

/// Whether the plugin is on, and every setting's value.
pub(crate) fn resolve_state(manifest: &Json, entry: &Json) -> (bool, Json) {
	let enabled = entry["enabled"].as_bool().unwrap_or(true);
	let mut values = Obj::new();
	for setting in manifest["settings"].items() {
		let key = setting["key"].str_or_empty();
		let value = checked_value(setting, &entry["values"][key]).unwrap_or_else(|_| setting["default"].clone());
		values.insert(key, value);
	}
	(enabled, Json::Obj(values))
}

/// The plugin's saved entry (null when there is none).
pub(crate) fn saved_entry(app: &App, id: &str) -> Result<Json, String> {
	Ok(app.stores.settings.read_settings()?.map(|record| record[SECTION][id].clone()).unwrap_or(Json::Null))
}

/// Applies `{ enabled?, values? }`: values are checked against the manifest and merged into the
/// saved ones, so a control can send only its own.
pub fn set_state(app: &App, id: &str, manifest: &Json, body: &Json) -> Outcome<()> {
	let Some(body) = body.as_obj() else { return refuse(400, "Send { enabled, values }.") };
	let enabled = match body.get("enabled") {
		None => None,
		Some(Json::Bool(on)) => Some(*on),
		Some(_) => return refuse(400, "enabled must be true or false."),
	};
	let mut values = Obj::new();
	if let Some(given) = body.get("values") {
		let Some(given) = given.as_obj() else { return refuse(400, "values must be an object.") };
		for (key, value) in given.iter() {
			let Some(setting) = setting_of(manifest, key) else { return refuse(400, format!("This plugin has no setting \"{key}\".")) };
			match checked_value(setting, value) {
				Ok(value) => values.insert(key.as_str(), value),
				Err(problem) => return refuse(400, problem),
			};
		}
	}
	let _held = app.locks.lock(LockKey::AppFile("settings.json"));
	let mut record = record_or_new(app.stores.settings.read_settings()?);
	let mut section = record[SECTION].as_obj().cloned().unwrap_or_default();
	let mut entry = section.get(id).and_then(Json::as_obj).cloned().unwrap_or_default();
	if let Some(on) = enabled {
		entry.insert("enabled", on);
	}
	if !values.is_empty() {
		let mut saved = entry.get("values").and_then(Json::as_obj).cloned().unwrap_or_default();
		for (key, value) in values.iter() {
			saved.insert(key.as_str(), value.clone());
		}
		entry.insert("values", saved);
	}
	section.insert(id, entry);
	if let Some(fields) = record.as_obj_mut() {
		fields.insert(SECTION, section);
	}
	app.stores.settings.write_settings(&record)?;
	Ok(())
}

/// Drops a removed plugin's entry.
pub(crate) fn forget_state(app: &App, id: &str) -> Result<(), String> {
	let _held = app.locks.lock(LockKey::AppFile("settings.json"));
	let Some(mut record) = app.stores.settings.read_settings()? else { return Ok(()) };
	let Some(section) = record.get_mut(SECTION).and_then(Json::as_obj_mut) else { return Ok(()) };
	if section.remove(id).is_none() {
		return Ok(());
	}
	app.stores.settings.write_settings(&record)?;
	Ok(())
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::outcome::Stop;

	fn manifest() -> Json {
		json!({ "settings": [
			{ "key": "captions", "label": "Captions", "kind": "toggle", "default": true },
			{ "key": "style", "label": "Style", "kind": "choice", "options": ["Classic", "Modern"], "default": "Classic" },
			{ "key": "size", "label": "Size", "kind": "number", "min": 1, "max": 5, "default": 3 },
			{ "key": "signature", "label": "Signature", "kind": "text", "default": "" },
		] })
	}

	#[test]
	fn on_off_and_values_round_trip_through_settings() {
		let root = scratch_dir("plugin-state");
		let app = test_app(&root);
		let resolve = || resolve_state(&manifest(), &saved_entry(&app, "memes").unwrap());
		assert_eq!(resolve(), (true, json!({ "captions": true, "style": "Classic", "size": 3, "signature": "" })));
		set_state(&app, "memes", &manifest(), &json!({ "enabled": false, "values": { "style": "Modern", "size": 5 } })).unwrap();
		set_state(&app, "memes", &manifest(), &json!({ "values": { "signature": "sk" } })).unwrap();
		assert_eq!(resolve(), (false, json!({ "captions": true, "style": "Modern", "size": 5, "signature": "sk" })));
		crate::app::put_settings_section(&app, "general", &json!({ "teacherName": "Zed" })).unwrap();
		let saved = app.stores.settings.read_settings().unwrap().unwrap();
		assert_eq!(stringify(&saved["plugins"]), r#"{"memes":{"enabled":false,"values":{"style":"Modern","size":5,"signature":"sk"}}}"#);
		forget_state(&app, "memes").unwrap();
		assert!(resolve().0);
	}

	#[test]
	fn bad_values_are_refused_and_stale_ones_read_as_the_default() {
		let root = scratch_dir("plugin-state-bad");
		let app = test_app(&root);
		let refused = |body: Json| match set_state(&app, "memes", &manifest(), &body) {
			Err(Stop::Refuse(400, message)) => message,
			other => panic!("{other:?}"),
		};
		assert_eq!(refused(json!({ "enabled": "no" })), "enabled must be true or false.");
		assert_eq!(refused(json!({ "values": { "colour": 1 } })), "This plugin has no setting \"colour\".");
		assert_eq!(refused(json!({ "values": { "size": 9 } })), "Size can't be set to that.");
		assert_eq!(refused(json!({ "values": { "style": "Retro" } })), "Style can't be set to that.");
		assert_eq!(refused(json!({ "values": { "captions": 1 } })), "Captions can't be set to that.");
		assert_eq!(refused(json!([])), "Send { enabled, values }.");
		assert!(app.stores.settings.read_settings().unwrap().is_none());
		let stale = json!({ "values": { "size": 7, "style": "Gone" } });
		assert_eq!(resolve_state(&manifest(), &stale).1["size"], json!(3));
		assert_eq!(resolve_state(&manifest(), &stale).1["style"], json!("Classic"));
	}
}
