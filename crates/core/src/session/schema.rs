//! Builders for the JSON Schema documents the tool inputs are declared with. Key order matches
//! what TypeBox emits (`type`, then the shape, then `description`), because the schemas are sent
//! to the model as written.

use gs_json::{Json, Obj, json};

/// A string property.
pub fn string(description: &str) -> Json {
	let mut out = Obj::new();
	out.insert("type", "string");
	out.insert("description", description);
	Json::Obj(out)
}

/// A boolean property.
pub fn boolean(description: &str) -> Json {
	let mut out = Obj::new();
	out.insert("type", "boolean");
	out.insert("description", description);
	Json::Obj(out)
}

/// A string with a minimum length and a description.
pub fn string_min(min_length: u32, description: &str) -> Json {
	json!({ "type": "string", "minLength": min_length, "description": description })
}

/// A whole number of at least `minimum`.
pub fn integer(minimum: i64, description: &str) -> Json {
	json!({ "type": "integer", "minimum": minimum, "description": description })
}

/// A list of strings with a description.
pub fn strings(description: &str) -> Json {
	json!({ "type": "array", "items": { "type": "string" }, "description": description })
}

/// A string or null.
pub fn string_or_null(description: &str) -> Json {
	json!({ "anyOf": [{ "type": "string" }, { "type": "null" }], "description": description })
}

/// An object whose `required` keys lead (left out when empty) and whose `properties` keep the
/// given order.
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

/// The tool that takes nothing.
pub fn no_arguments() -> Json {
	object(&[], Vec::new())
}

/// An array with a minimum length.
pub fn array(items: Json, min_items: u32, description: &str) -> Json {
	let mut out = Obj::new();
	out.insert("type", "array");
	out.insert("items", items);
	out.insert("minItems", f64::from(min_items));
	out.insert("description", description);
	Json::Obj(out)
}

/// A string that must equal one literal.
fn literal(value: &str) -> Json {
	let mut out = Obj::new();
	out.insert("type", "string");
	out.insert("const", value);
	Json::Obj(out)
}

/// One of several literals, with the description after the choices.
pub fn one_of_literals(values: &[&str], description: &str) -> Json {
	let mut out = Obj::new();
	out.insert("anyOf", values.iter().map(|v| literal(v)).collect::<Json>());
	out.insert("description", description);
	Json::Obj(out)
}

/// One of several literals, or null, with the description after the choices.
pub fn literals_or_null(values: &[&str], description: &str) -> Json {
	let mut any: Vec<Json> = values.iter().map(|v| literal(v)).collect();
	any.push(json!({ "type": "null" }));
	json!({ "anyOf": any, "description": description })
}

/// The object with a description added last.
pub fn described(mut schema: Json, description: &str) -> Json {
	if let Some(obj) = schema.as_obj_mut() {
		obj.insert("description", description);
	}
	schema
}
