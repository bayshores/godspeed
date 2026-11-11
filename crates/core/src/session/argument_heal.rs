//! Ported from src/shared/core/argument-heal.ts: the weak-model argument heal.
//!
//! Weak models send JSON-string-encoded values (`"mode": "\"recall\""`), and the schema error for
//! a literal never names the expected values, so they re-send the same payload in a loop. A
//! string where the schema expects a literal union, boolean, null, number or array is parsed
//! and kept when the parsed value fits. Well-formed arguments come back as they were; what
//! cannot be healed stays for validation to reject honestly.

use gs_json::{Json, parse};

/// The literal values a property accepts (none when it is not a literal union or a literal).
fn literals_of(prop: &Json) -> Vec<&Json> {
	if let Some(members) = prop["anyOf"].as_arr() {
		return members.iter().flat_map(literals_of).collect();
	}
	prop.get("const").into_iter().collect()
}

/// Whether the property accepts null, alone or as a union member.
fn accepts_null(prop: &Json) -> bool {
	prop["type"].as_str() == Some("null") || prop["anyOf"].as_arr().is_some_and(|ms| ms.iter().any(|m| m["type"].as_str() == Some("null")))
}

/// `includes` over literals: only scalars can match, since a parsed object is never a literal.
fn includes(literals: &[&Json], value: &Json) -> bool {
	matches!(value, Json::Null | Json::Bool(_) | Json::Num(_) | Json::Str(_)) && literals.contains(&value)
}

/// The parsed value when it fits what the property expects.
fn fixed_value(prop: &Json, raw: &str, parsed: Option<&Json>) -> Option<Json> {
	let literals = literals_of(prop);
	if !literals.is_empty() {
		if literals.iter().any(|l| l.as_str() == Some(raw)) {
			return None;
		}
		if let Some(p) = parsed.filter(|p| includes(&literals, p)) {
			return Some(p.clone());
		}
	}
	let parsed = parsed?;
	// Type.Null carries no const, so a union of literals and null must also accept "null".
	let fits = match (parsed, prop["type"].as_str()) {
		(Json::Null, _) => accepts_null(prop),
		(Json::Bool(_), Some("boolean")) => true,
		(Json::Num(_), Some("number" | "integer")) => true,
		(Json::Arr(_), Some("array")) => true,
		_ => false,
	};
	fits.then(|| parsed.clone())
}

/// Heals string-encoded values in `args` against the properties of `schema`.
pub fn heal_encoded_arguments(args: &Json, schema: &Json) -> Json {
	let (Some(object), Some(properties)) = (args.as_obj(), schema["properties"].as_obj()) else { return args.clone() };
	let mut healed = args.clone();
	for (key, prop) in properties.iter() {
		let Some(raw) = object.get(key).and_then(Json::as_str) else { continue };
		if let Some(fixed) = fixed_value(prop, raw, parse(raw).ok().as_ref())
			&& let Some(target) = healed.as_obj_mut()
		{
			target.insert(key.clone(), fixed);
		}
	}
	healed
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;

	fn schema() -> Json {
		json!({ "properties": {
			"mode": { "anyOf": [{ "type": "string", "const": "recall" }, { "type": "string", "const": "teach" }] },
			"nothing": { "anyOf": [{ "type": "string", "const": "x" }, { "type": "null" }] },
			"flag": { "type": "boolean" },
			"count": { "type": "integer" },
			"list": { "type": "array" },
			"name": { "type": "string" }
		} })
	}

	#[test]
	fn encoded_values_are_parsed_when_they_fit() {
		let args = json!({ "mode": "\"recall\"", "nothing": "null", "flag": "true", "count": "3", "list": "[1,2]", "name": "\"keep\"", "other": "1" });
		let healed = heal_encoded_arguments(&args, &schema());
		assert_eq!(stringify(&healed), r#"{"mode":"recall","nothing":null,"flag":true,"count":3,"list":[1,2],"name":"\"keep\"","other":"1"}"#);
	}

	#[test]
	fn good_and_unhealable_values_stay() {
		let args = json!({ "mode": "recall", "flag": "maybe", "count": "[1]", "list": "{}" });
		assert_eq!(heal_encoded_arguments(&args, &schema()), args);
		assert_eq!(heal_encoded_arguments(&json!([1]), &schema()), json!([1]));
		assert_eq!(heal_encoded_arguments(&args, &json!({})), args);
	}
}
