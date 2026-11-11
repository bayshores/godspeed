//! Builders for the JSON Schema documents the tool inputs are declared with. Key order matches
//! what TypeBox emits (`type`, then the shape, then `description`), because the schemas are sent
//! to the model as written.

use gs_json::{Json, Obj};

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

/// An object whose `required` keys lead and whose `properties` keep the given order.
pub fn object(required: &[&str], properties: Vec<(&str, Json)>) -> Json {
	let mut props = Obj::new();
	for (key, schema) in properties {
		props.insert(key, schema);
	}
	let mut out = Obj::new();
	out.insert("type", "object");
	out.insert("required", required.iter().map(|k| Json::Str((*k).to_owned())).collect::<Json>());
	out.insert("properties", props);
	Json::Obj(out)
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

/// The object with a description added last.
pub fn described(mut schema: Json, description: &str) -> Json {
	if let Some(obj) = schema.as_obj_mut() {
		obj.insert("description", description);
	}
	schema
}
