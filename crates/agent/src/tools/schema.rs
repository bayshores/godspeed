//! The few JSON Schema pieces the lesson and file tools declare, in the key order TypeBox emits: the
//! outside agent reads these as written.

use gs_json::{Json, Obj, json};

/// An object type: `required` leads (left out when empty), then the properties in the given order.
pub fn object(required: &[&str], properties: Vec<(&str, Json)>) -> Json {
	let mut props = Obj::new();
	for (key, schema) in properties {
		props.insert(key, schema);
	}
	let mut out = Obj::new();
	out.insert("type", "object");
	if !required.is_empty() {
		out.insert("required", required.iter().map(|k| Json::from(*k)).collect::<Vec<_>>());
	}
	out.insert("properties", props);
	Json::Obj(out)
}

pub fn string(description: &str) -> Json {
	json!({ "type": "string", "description": description })
}

pub fn boolean(description: &str) -> Json {
	json!({ "type": "boolean", "description": description })
}

/// A string with a minimum length and a description.
pub fn string_min(min_length: u32, description: &str) -> Json {
	json!({ "type": "string", "minLength": min_length, "description": description })
}

/// A whole number of at least `minimum`.
pub fn integer(minimum: i64, description: &str) -> Json {
	json!({ "type": "integer", "minimum": minimum, "description": description })
}

/// One of several literal strings.
pub fn literals(values: &[&str], description: &str) -> Json {
	json!({ "anyOf": values.iter().map(|v| json!({ "type": "string", "const": *v })).collect::<Vec<_>>(), "description": description })
}

/// One of several literal strings, or null.
pub fn literals_or_null(values: &[&str], description: &str) -> Json {
	let mut any: Vec<Json> = values.iter().map(|v| json!({ "type": "string", "const": *v })).collect();
	any.push(json!({ "type": "null" }));
	json!({ "anyOf": any, "description": description })
}

/// A list of strings with a description.
pub fn strings(description: &str) -> Json {
	json!({ "type": "array", "items": { "type": "string" }, "description": description })
}

/// A string or null.
pub fn string_or_null(description: &str) -> Json {
	json!({ "anyOf": [{ "type": "string" }, { "type": "null" }], "description": description })
}

/// The tool that takes nothing.
pub fn no_arguments() -> Json {
	object(&[], Vec::new())
}
