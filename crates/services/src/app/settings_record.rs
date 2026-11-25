//! The settings record changed the way the TS does it with object spreads, so a key already in
//! the record keeps its place and a new one goes last.

use gs_core::records::settings::{CURRENT_SETTINGS_VERSION, DEFAULT_TEACHER_NAME};
use gs_json::{Json, json};

use crate::App;

/// The saved record, or the bare one a first write starts from.
pub fn record_or_new(record: Option<Json>) -> Json {
	record.unwrap_or_else(|| json!({ "version": CURRENT_SETTINGS_VERSION }))
}

/// `{ ...record, [section]: { ...record[section], [key]: value } }`.
pub fn with_field(mut record: Json, section: &str, key: &str, value: impl Into<Json>) -> Json {
	let mut fields = record[section].as_obj().cloned().unwrap_or_default();
	fields.insert(key, value);
	if let Some(obj) = record.as_obj_mut() {
		obj.insert(section, fields);
	}
	record
}

/// The teacher's name, as the learner set it: what the teacher and its background work are called.
/// Settings that cannot be read leave the usual name.
pub fn teacher_name(app: &App) -> String {
	let settings = app.stores.settings.effective_settings();
	settings.ok().and_then(|s| s["general"]["teacherName"].as_str().map(str::to_owned)).unwrap_or_else(|| DEFAULT_TEACHER_NAME.to_owned())
}

/// A `general` switch that is on unless the saved record says exactly `false`.
pub fn general_switch_on(app: &App, key: &str) -> bool {
	let record = app.stores.settings.read_settings().ok().flatten();
	record.is_none_or(|r| r["general"][key].as_bool() != Some(false))
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;

	#[test]
	fn a_field_goes_into_its_section_without_moving_anything() {
		let record = json!({ "version": 2, "general": { "teacherName": "Zed" }, "graph": {} });
		assert_eq!(stringify(&with_field(record, "general", "onboarded", true)), r#"{"version":2,"general":{"teacherName":"Zed","onboarded":true},"graph":{}}"#);
		assert_eq!(stringify(&with_field(record_or_new(None), "general", "lastSeenVersion", "1.2.3")), r#"{"version":3,"general":{"lastSeenVersion":"1.2.3"}}"#);
	}
}
