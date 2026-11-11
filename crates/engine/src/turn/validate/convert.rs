//! TypeBox's `Value.Convert` (value/convert/*.mjs) and pi's `normalizeOptionalNulls`: the loose
//! fixes applied to a model's arguments before they are checked ("5" for an integer becomes 5).

use gs_json::{Json, js_number};

use super::check::check;
use super::to_number::{bigint_literal, string_to_number};

/// `Value.Convert(schema, args)` with its result thrown away, as pi calls it: only an object's
/// properties change, in place.
pub fn convert_in_place(schema: &Json, args: &mut Json) {
	if kind(schema) == Kind::Object {
		convert_properties(schema, args);
	}
}

#[derive(PartialEq)]
enum Kind {
	Union,
	Literal,
	Array,
	Boolean,
	Integer,
	Null,
	Number,
	Object,
	String,
	Other,
}

/// The TypeBox kind behind a schema, read from the JSON TypeBox emits for it.
fn kind(schema: &Json) -> Kind {
	if schema.get("anyOf").is_some() {
		return Kind::Union;
	}
	if schema.get("const").is_some() {
		return Kind::Literal;
	}
	match schema["type"].as_str() {
		Some("array") => Kind::Array,
		Some("boolean") => Kind::Boolean,
		Some("integer") => Kind::Integer,
		Some("null") => Kind::Null,
		Some("number") => Kind::Number,
		Some("object") => Kind::Object,
		Some("string") => Kind::String,
		_ => Kind::Other,
	}
}

fn convert_properties(schema: &Json, value: &mut Json) {
	let (Some(properties), Json::Obj(obj)) = (schema["properties"].as_obj(), value) else { return };
	for (key, sub) in properties {
		if let Some(slot) = obj.get_mut(key) {
			*slot = convert(sub, std::mem::take(slot));
		}
	}
}

/// `FromType`.
fn convert(schema: &Json, value: Json) -> Json {
	match kind(schema) {
		Kind::Union => {
			let members = schema["anyOf"].as_arr().map_or(&[][..], Vec::as_slice);
			if members.iter().any(|m| check(m, &value)) {
				return value;
			}
			members.iter().map(|m| convert(m, value.clone())).find(|c| check(schema, c)).unwrap_or(value)
		}
		Kind::Literal => {
			let constant = &schema["const"];
			if *constant == value {
				return value;
			}
			let tried = match constant {
				Json::Str(_) => try_string(&value),
				Json::Num(_) => try_number(&value).map(Json::Num),
				Json::Bool(_) => try_boolean(&value).map(Json::Bool),
				_ => None,
			};
			tried.filter(|t| t == constant).unwrap_or(value)
		}
		Kind::Array => {
			let items = match value {
				Json::Arr(items) => items,
				other => vec![other],
			};
			Json::Arr(items.into_iter().map(|v| convert(&schema["items"], v)).collect())
		}
		Kind::Boolean => try_boolean(&value).map_or(value, Json::Bool),
		Kind::Integer => try_number(&value).map_or(value, |n| Json::Num(n.trunc())),
		Kind::Number => try_number(&value).map_or(value, Json::Num),
		Kind::Null => if try_null(&value) { Json::Null } else { value },
		Kind::String => try_string(&value).unwrap_or(value),
		Kind::Object => {
			let mut value = value;
			convert_properties(schema, &mut value);
			value
		}
		Kind::Other => value,
	}
}

fn try_boolean(value: &Json) -> Option<bool> {
	match value {
		Json::Bool(b) => Some(*b),
		Json::Num(n) if *n == 0.0 => Some(false),
		Json::Num(n) if *n == 1.0 => Some(true),
		Json::Null => Some(false),
		Json::Str(s) => match (s.to_lowercase().as_str(), s.as_str()) {
			("false", _) | (_, "0") => Some(false),
			("true", _) | (_, "1") => Some(true),
			_ => None,
		},
		_ => None,
	}
}

fn try_number(value: &Json) -> Option<f64> {
	match value {
		Json::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
		Json::Num(n) => Some(*n),
		Json::Null => Some(0.0),
		Json::Str(s) => {
			let n = string_to_number(s);
			if n.is_finite() {
				return Some(n);
			}
			match s.to_lowercase().as_str() {
				"false" => Some(0.0),
				"true" => Some(1.0),
				_ => bigint_literal(s),
			}
		}
		_ => None,
	}
}

fn try_string(value: &Json) -> Option<Json> {
	match value {
		Json::Bool(b) => Some(Json::from(b.to_string())),
		Json::Num(n) => Some(Json::from(js_number(*n))),
		Json::Null => Some(Json::from("null")),
		Json::Str(_) => Some(value.clone()),
		_ => None,
	}
}

fn try_null(value: &Json) -> bool {
	match value {
		Json::Bool(b) => !b,
		Json::Num(n) => *n == 0.0,
		Json::Null => true,
		Json::Str(s) => matches!(s.to_lowercase().as_str(), "undefined" | "null") || s.is_empty() || s == "0",
		_ => false,
	}
}

/// pi's `normalizeOptionalNulls`: an optional property sent as null that may not be null is
/// dropped, at any depth.
pub fn normalize_optional_nulls(value: &mut Json, schema: &Json) {
	match value {
		Json::Arr(items) => match &schema["items"] {
			Json::Arr(schemas) => {
				for (item, sub) in items.iter_mut().zip(schemas) {
					normalize_optional_nulls(item, sub);
				}
			}
			Json::Null => {}
			sub => {
				for item in items {
					normalize_optional_nulls(item, sub);
				}
			}
		},
		Json::Obj(obj) => {
			let Some(properties) = schema["properties"].as_obj() else { return };
			let required = schema["required"].as_arr();
			for (key, sub) in properties {
				let Some(v) = obj.get_mut(key) else { continue };
				let is_required = required.is_some_and(|r| r.iter().any(|k| k.as_str() == Some(key)));
				if v.is_null() && !is_required && sub["$ref"].as_str().is_none() && !check(sub, &Json::Null) {
					obj.remove(key);
				} else {
					normalize_optional_nulls(v, sub);
				}
			}
		}
		_ => {}
	}
}
