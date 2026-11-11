//! The settings record changed the way the TS does it with object spreads, so a key already in
//! the record keeps its place and a new one goes last.

use gs_core::records::settings::CURRENT_SETTINGS_VERSION;
use gs_json::{Json, json};

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

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;

	#[test]
	fn a_field_goes_into_its_section_without_moving_anything() {
		let record = json!({ "version": 2, "general": { "teacherName": "Zed" }, "graph": {} });
		assert_eq!(stringify(&with_field(record, "general", "onboarded", true)), r#"{"version":2,"general":{"teacherName":"Zed","onboarded":true},"graph":{}}"#);
		assert_eq!(stringify(&with_field(record_or_new(None), "general", "lastSeenVersion", "1.2.3")), r#"{"version":2,"general":{"lastSeenVersion":"1.2.3"}}"#);
	}
}
