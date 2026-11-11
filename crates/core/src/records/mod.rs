//! Settings, teaching rules, agent notes/rules/seen records and the prompt segment grammar.

pub mod settings;
pub mod settings_resolution;
pub mod teaching_areas;
pub mod agent_notes;
pub mod agent_rules;
pub mod agent_seen;
pub mod prompt_segments;
pub mod changelog;

#[cfg(test)]
mod golden;

use gs_json::Json;

/// `Object.entries(value)` for an object or an array (index keys); nothing for other values.
pub fn entries(value: &Json) -> Vec<(String, &Json)> {
	match value {
		Json::Obj(obj) => obj.iter().map(|(k, v)| (k.clone(), v)).collect(),
		Json::Arr(items) => items.iter().enumerate().map(|(i, v)| (i.to_string(), v)).collect(),
		_ => Vec::new(),
	}
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn entries_read_objects_and_arrays_alike() {
		let obj = json!({ "b": 1, "a": 2 });
		let keys: Vec<String> = entries(&obj).into_iter().map(|(k, _)| k).collect();
		assert_eq!(keys, ["b", "a"]);
		let arr = json!(["x", "y"]);
		let pairs: Vec<(String, &str)> = entries(&arr).into_iter().map(|(k, v)| (k, v.as_str().unwrap())).collect();
		assert_eq!(pairs, [("0".to_owned(), "x"), ("1".to_owned(), "y")]);
		assert!(entries(&json!("text")).is_empty());
	}
}
