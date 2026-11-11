//! TypeBox's Check and Errors (schema/engine/*.mjs, locale en_US) for the JSON Schema the app's
//! tools declare: `type`, `properties`, `required`, `items`, `anyOf`, `const`, `minLength`,
//! `maxLength`, `minimum`, `maximum`, `minItems` and `maxItems`. Every keyword is evaluated (no
//! short cut), in TypeBox's order, and at most 8 errors are kept per error list.

use gs_json::{Json, js_number, lone::to_utf16};

use super::graphemes::{is_max_length, is_min_length};

/// One error as pi prints it: `<path>: <message>`.
pub struct Failure {
	pub path: String,
	pub message: String,
}

#[derive(Default)]
pub struct Errors {
	pub list: Vec<Failure>,
}

/// TypeBox's `maxErrors` setting.
const MAX_ERRORS: usize = 8;

impl Errors {
	fn full(&self) -> bool {
		self.list.len() >= MAX_ERRORS
	}

	/// `AddError`: keeps the error while there is room; always false, the failed check.
	fn add(&mut self, failure: Failure) -> bool {
		if !self.full() {
			self.list.push(failure);
		}
		false
	}
}

/// pi's `formatValidationPath`: the instance path with dots, or "root".
fn dotted(instance_path: &str) -> String {
	instance_path.strip_prefix('/').unwrap_or(instance_path).replace('/', ".")
}

fn failure(instance_path: &str, message: String) -> Failure {
	let path = dotted(instance_path);
	Failure { path: if path.is_empty() { "root".to_owned() } else { path }, message }
}

fn type_matches(name: &str, value: &Json) -> bool {
	match name {
		"object" => matches!(value, Json::Obj(_)),
		"array" => matches!(value, Json::Arr(_)),
		"boolean" => matches!(value, Json::Bool(_)),
		"integer" => matches!(value, Json::Num(n) if n.is_finite() && n.fract() == 0.0),
		"number" => matches!(value, Json::Num(n) if n.is_finite()),
		"null" => value.is_null(),
		"string" => matches!(value, Json::Str(_)),
		_ => true,
	}
}

fn check_type(schema_type: &Json, value: &Json, path: &str, errors: &mut Errors) -> bool {
	let (ok, message) = match schema_type {
		Json::Arr(names) => {
			let names: Vec<&str> = names.iter().filter_map(Json::as_str).collect();
			(names.iter().any(|n| type_matches(n, value)), format!("must be either {}", names.join(" or ")))
		}
		other => {
			let name = other.as_str().unwrap_or_default();
			(type_matches(name, value), format!("must be {name}"))
		}
	};
	ok || errors.add(failure(path, message))
}

fn limit(schema: &Json, key: &str) -> Option<f64> {
	schema[key].as_f64()
}

fn bound(ok: bool, path: &str, message: String, errors: &mut Errors) -> bool {
	ok || errors.add(failure(path, message))
}

/// `ErrorSchema`: true when `value` passes; failures go to `errors`.
pub fn walk(schema: &Json, value: &Json, path: &str, errors: &mut Errors) -> bool {
	if errors.full() {
		return false;
	}
	let mut ok = true;
	if let Some(t) = schema.get("type") {
		ok &= check_type(t, value, path, errors);
	}
	match value {
		Json::Obj(obj) => {
			if let Some(required) = schema["required"].as_arr() {
				let missing: Vec<&str> = required.iter().filter_map(Json::as_str).filter(|k| !obj.contains_key(k)).collect();
				if let Some(first) = missing.first() {
					let base = dotted(path);
					let shown = if base.is_empty() { (*first).to_owned() } else { format!("{base}.{first}") };
					ok &= errors.add(Failure { path: shown, message: format!("must have required properties {}", missing.join(", ")) });
				}
			}
			if let Some(properties) = schema["properties"].as_obj() {
				for (key, sub) in properties {
					if let Some(v) = obj.get(key) {
						ok &= walk(sub, v, &format!("{path}/{key}"), errors);
					}
				}
			}
		}
		Json::Arr(items) => {
			if let Some(item_schema) = schema.get("items").filter(|s| s.as_obj().is_some()) {
				for (i, item) in items.iter().enumerate() {
					ok &= walk(item_schema, item, &format!("{path}/{i}"), errors);
				}
			}
			let n = items.len() as f64;
			if let Some(max) = limit(schema, "maxItems") {
				ok &= bound(n <= max, path, format!("must not have more than {} items", js_number(max)), errors);
			}
			if let Some(min) = limit(schema, "minItems") {
				ok &= bound(n >= min, path, format!("must not have fewer than {} items", js_number(min)), errors);
			}
		}
		Json::Str(s) => {
			let units = to_utf16(s);
			if let Some(max) = limit(schema, "maxLength") {
				ok &= bound(is_max_length(&units, max as usize), path, format!("must not have more than {} characters", js_number(max)), errors);
			}
			if let Some(min) = limit(schema, "minLength") {
				ok &= bound(is_min_length(&units, min as usize), path, format!("must not have fewer than {} characters", js_number(min)), errors);
			}
		}
		Json::Num(n) => {
			if let Some(max) = limit(schema, "maximum") {
				ok &= bound(*n <= max, path, format!("must be <= {}", js_number(max)), errors);
			}
			if let Some(min) = limit(schema, "minimum") {
				ok &= bound(*n >= min, path, format!("must be >= {}", js_number(min)), errors);
			}
		}
		_ => {}
	}
	if let Some(constant) = schema.get("const") {
		ok &= bound(constant == value, path, "must be equal to constant".to_owned(), errors);
	}
	if let Some(members) = schema["anyOf"].as_arr() {
		ok &= any_of(members, value, path, errors);
	}
	ok
}

/// `ErrorAnyOf`: when no member passes, every member's errors, then the anyOf error.
fn any_of(members: &[Json], value: &Json, path: &str, errors: &mut Errors) -> bool {
	let mut failed = Vec::new();
	for member in members {
		let mut own = Errors::default();
		if walk(member, value, path, &mut own) {
			return true;
		}
		failed.push(own);
	}
	for failure in failed.into_iter().flat_map(|f| f.list) {
		errors.add(failure);
	}
	errors.add(failure(path, "must match a schema in anyOf".to_owned()))
}

/// `Check`: the value passes the schema.
pub fn check(schema: &Json, value: &Json) -> bool {
	walk(schema, value, "", &mut Errors::default())
}
