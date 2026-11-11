//! Tool argument checks with zod 4's texts, driven by the JSON Schema each tool lists (the
//! schemas zod emitted, kept in tools.json). The SDK joins the issues with ", " behind
//! "Input validation error: Invalid arguments for tool <name>: ". Like zod, a passing object
//! keeps only the keys its schema names.

use gs_base::text::trim;
use gs_json::{Json, Obj, js_number};

/// Number.MAX_SAFE_INTEGER: zod's `.int()` range.
const MAX_SAFE: f64 = 9_007_199_254_740_991.0;

/// The checked arguments, or the issues as the SDK words them.
pub fn check_arguments(tool: &str, schema: &Json, args: &Json) -> Result<Json, String> {
	let mut issues = Vec::new();
	let parsed = check(schema, Some(args), &mut Vec::new(), &mut issues);
	match parsed {
		Some(value) if issues.is_empty() => Ok(value),
		_ => Err(format!("Input validation error: Invalid arguments for tool {tool}: {}", issues.join(", "))),
	}
}

/// zod's name for what it received.
pub(super) fn received(value: Option<&Json>) -> &'static str {
	match value {
		None => "undefined",
		Some(Json::Null) => "null",
		Some(Json::Bool(_)) => "boolean",
		Some(Json::Num(_)) => "number",
		Some(Json::Str(_)) => "string",
		Some(Json::Arr(_)) => "array",
		Some(Json::Obj(_)) => "object",
	}
}

fn push(issues: &mut Vec<String>, path: &[String], message: String) {
	if path.is_empty() {
		issues.push(message);
	} else {
		issues.push(format!("{}: {message}", path.join(".")));
	}
}

fn wrong_type(issues: &mut Vec<String>, path: &[String], expected: &str, value: Option<&Json>) -> Option<Json> {
	push(issues, path, format!("Invalid input: expected {expected}, received {}", received(value)));
	None
}

fn types(schema: &Json) -> Vec<&str> {
	match &schema["type"] {
		Json::Str(t) => vec![t.as_str()],
		Json::Arr(ts) => ts.iter().filter_map(Json::as_str).collect(),
		_ => Vec::new(),
	}
}

/// One value against one schema: its parsed form, or None after pushing its issues.
fn check(schema: &Json, value: Option<&Json>, path: &mut Vec<String>, issues: &mut Vec<String>) -> Option<Json> {
	let types = types(schema);
	if types.contains(&"null") && matches!(value, Some(Json::Null)) {
		return value.cloned();
	}
	if let Some(options) = schema["enum"].as_arr() {
		if value.is_some_and(|v| options.contains(v)) {
			return value.cloned();
		}
		let quoted: Vec<String> = options.iter().map(|o| o.as_str().map_or_else(|| gs_json::stringify(o), |s| format!("\"{s}\""))).collect();
		let message = if quoted.len() == 1 { format!("Invalid input: expected {}", quoted[0]) } else { format!("Invalid option: expected one of {}", quoted.join("|")) };
		push(issues, path, message);
		return None;
	}
	match types.first().copied().unwrap_or_default() {
		"string" => check_string(schema, value, path, issues),
		"integer" | "number" => check_number(schema, value, types[0] == "integer", path, issues),
		"boolean" => match value {
			Some(Json::Bool(_)) => value.cloned(),
			_ => wrong_type(issues, path, "boolean", value),
		},
		"array" => check_array(schema, value, path, issues),
		"object" if schema.get("propertyNames").is_some() => match value {
			Some(Json::Obj(_)) => value.cloned(),
			_ => wrong_type(issues, path, "record", value),
		},
		"object" => check_object(schema, value, path, issues),
		_ => value.cloned(),
	}
}

/// JavaScript's `Number(v)` for the values a `length` field may hold.
fn to_number(v: &Json) -> f64 {
	match v {
		Json::Null => 0.0,
		Json::Bool(b) => f64::from(u8::from(*b)),
		Json::Num(n) => *n,
		Json::Str(s) if trim(s).is_empty() => 0.0,
		Json::Str(s) => trim(s).parse().unwrap_or(f64::NAN),
		Json::Arr(_) | Json::Obj(_) => f64::NAN,
	}
}

/// zod's length checks. They run on anything with a length, even after a wrong type: strings
/// count code points, arrays items, and an object with a `length` field that field.
fn check_length(min: Option<f64>, max: Option<f64>, value: Option<&Json>, path: &[String], issues: &mut Vec<String>) {
	let (length, origin, unit) = match value {
		Some(Json::Str(s)) => (s.chars().count() as f64, "string", Some("characters")),
		Some(Json::Arr(items)) => (items.len() as f64, "array", Some("items")),
		Some(Json::Obj(o)) if o.contains_key("length") => (to_number(&o.get("length").cloned().unwrap_or_default()), "unknown", None),
		_ => return,
	};
	let say = |relation: &str, bound: f64| match unit {
		Some(unit) => format!("expected {origin} to have {relation}{} {unit}", js_number(bound)),
		None => format!("expected {origin} to be {relation}{}", js_number(bound)),
	};
	// NaN fails both, as in JavaScript.
	if let Some(min) = min.filter(|m| !length.ge(m)) {
		push(issues, path, format!("Too small: {}", say(">=", min)));
	}
	if let Some(max) = max.filter(|m| !length.le(m)) {
		push(issues, path, format!("Too big: {}", say("<=", max)));
	}
}

fn check_string(schema: &Json, value: Option<&Json>, path: &[String], issues: &mut Vec<String>) -> Option<Json> {
	let before = issues.len();
	if !matches!(value, Some(Json::Str(_))) {
		wrong_type(issues, path, "string", value);
	}
	check_length(schema["minLength"].as_f64(), schema["maxLength"].as_f64(), value, path, issues);
	(issues.len() == before).then(|| value.cloned()).flatten()
}

fn check_number(schema: &Json, value: Option<&Json>, int: bool, path: &[String], issues: &mut Vec<String>) -> Option<Json> {
	let Some(Json::Num(n)) = value else { return wrong_type(issues, path, "number", value) };
	let before = issues.len();
	if int {
		if n.fract() != 0.0 {
			// zod stops at this one.
			push(issues, path, "Invalid input: expected int, received number".to_owned());
			return None;
		}
		if *n > MAX_SAFE {
			push(issues, path, format!("Too big: expected int to be <={}", js_number(MAX_SAFE)));
		} else if *n < -MAX_SAFE {
			push(issues, path, format!("Too small: expected int to be >={}", js_number(-MAX_SAFE)));
		}
	}
	if let Some(min) = schema["minimum"].as_f64().filter(|m| n < m) {
		push(issues, path, format!("Too small: expected number to be >={}", js_number(min)));
	}
	if let Some(max) = schema["maximum"].as_f64().filter(|m| n > m) {
		push(issues, path, format!("Too big: expected number to be <={}", js_number(max)));
	}
	(issues.len() == before).then(|| value.cloned()).flatten()
}

fn check_array(schema: &Json, value: Option<&Json>, path: &mut Vec<String>, issues: &mut Vec<String>) -> Option<Json> {
	let before = issues.len();
	let mut parsed = Vec::new();
	match value {
		Some(Json::Arr(items)) => {
			for (i, item) in items.iter().enumerate() {
				path.push(i.to_string());
				parsed.extend(check(&schema["items"], Some(item), path, issues));
				path.pop();
			}
		}
		_ => {
			wrong_type(issues, path, "array", value);
		}
	}
	check_length(schema["minItems"].as_f64(), schema["maxItems"].as_f64(), value, path, issues);
	(issues.len() == before).then_some(Json::Arr(parsed))
}

fn check_object(schema: &Json, value: Option<&Json>, path: &mut Vec<String>, issues: &mut Vec<String>) -> Option<Json> {
	let Some(Json::Obj(given)) = value else { return wrong_type(issues, path, "object", value) };
	let required: Vec<&str> = schema["required"].as_arr().map(|r| r.iter().filter_map(Json::as_str).collect()).unwrap_or_default();
	let before = issues.len();
	let mut parsed = Obj::new();
	for (key, field) in schema["properties"].as_obj().into_iter().flat_map(Obj::iter) {
		let Some(v) = given.get(key) else {
			if required.contains(&key.as_str()) {
				path.push(key.clone());
				check(field, None, path, issues);
				path.pop();
			}
			continue;
		};
		path.push(key.clone());
		if let Some(ok) = check(field, Some(v), path, issues) {
			parsed.insert(key.clone(), ok);
		}
		path.pop();
	}
	(issues.len() == before).then_some(Json::Obj(parsed))
}

#[cfg(test)]
mod tests {
	use gs_json::{json, parse};

	use super::*;

	fn schema() -> Json {
		parse(
			r#"{"type":"object","properties":{
				"text":{"type":"string","minLength":1,"maxLength":3},
				"limit":{"type":"integer","minimum":1,"maximum":20},
				"kind":{"type":"string","enum":["study","info"]},
				"time":{"type":["string","null"]},
				"calls":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"arguments":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{}}},"required":["name","arguments"]},"minItems":1}
			},"required":["text","kind"]}"#,
		)
		.unwrap()
	}

	fn issues(args: Json) -> String {
		check_arguments("t", &schema(), &args).unwrap_err().trim_start_matches("Input validation error: Invalid arguments for tool t: ").to_owned()
	}

	#[test]
	fn writes_zods_texts() {
		assert_eq!(issues(json!({ "kind": "info" })), "text: Invalid input: expected string, received undefined");
		assert_eq!(issues(json!({ "text": "", "kind": "info" })), "text: Too small: expected string to have >=1 characters");
		assert_eq!(issues(json!({ "text": "abcd", "kind": "notes" })), "text: Too big: expected string to have <=3 characters, kind: Invalid option: expected one of \"study\"|\"info\"");
		assert_eq!(issues(json!({ "text": "a", "kind": "info", "limit": 1.5 })), "limit: Invalid input: expected int, received number");
		assert_eq!(issues(json!({ "text": "a", "kind": "info", "limit": "3" })), "limit: Invalid input: expected number, received string");
		assert_eq!(issues(json!({ "text": "a", "kind": "info", "limit": 21 })), "limit: Too big: expected number to be <=20");
		assert_eq!(issues(json!({ "text": "a", "kind": "info", "time": 5 })), "time: Invalid input: expected string, received number");
		assert_eq!(issues(json!({ "text": "a", "kind": "info", "calls": [] })), "calls: Too small: expected array to have >=1 items");
		assert_eq!(issues(json!({ "text": "a", "kind": "info", "calls": [{ "arguments": {} }] })), "calls.0.name: Invalid input: expected string, received undefined");
		assert_eq!(issues(json!({ "text": "a", "kind": "info", "calls": [{ "name": "x", "arguments": [] }] })), "calls.0.arguments: Invalid input: expected record, received array");
		assert_eq!(issues(json!({ "text": "a", "kind": "info", "limit": 1e300 })), "limit: Too big: expected int to be <=9007199254740991, limit: Too big: expected number to be <=20");
	}

	#[test]
	fn passing_arguments_keep_only_known_keys() {
		let ok = check_arguments("t", &schema(), &json!({ "extra": 1, "kind": "study", "text": "ab", "time": null, "calls": [{ "name": "x", "arguments": { "a": 1 }, "more": 2 }] })).unwrap();
		assert_eq!(gs_json::stringify(&ok), r#"{"text":"ab","kind":"study","time":null,"calls":[{"name":"x","arguments":{"a":1}}]}"#);
	}
}
