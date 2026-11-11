//! Ported from src/backend/server/settings-body.ts: the PUT body parsers, one per settings
//! section. Replace-whole: the body is the complete section, unknown body keys are dropped and
//! every known field is strict (a bad type is an error message for the 400, never a clamp).

use gs_base::text;
use gs_core::contracts::class::is_class_id;
use gs_core::records::changelog::is_version;
use gs_core::records::settings::{COMPACTION_THRESHOLD_FLOOR, EXTRACTION_CHUNK_TOKENS_FLOOR, is_hex_color, sanitize_teacher_name};
use gs_core::records::teaching_areas::{TEACHING_AREAS, sanitize_area_rules};
use gs_core::session::tool_switches::WRITABLE_TOOL_KEYS;
use gs_json::{Json, Obj};

/// PUT /api/settings/{section} takes these, in this order.
pub const SETTINGS_SECTIONS: [&str; 5] = ["general", "agent", "appearance", "graph", "compaction"];

/// The parsed section, or the 400's message.
pub type Parsed = Result<Json, String>;

/// The section's parser, or None for a section that does not exist.
pub fn parse_section(section: &str, body: &Json) -> Option<Parsed> {
	Some(match section {
		"general" => parse_general(body),
		"agent" => parse_agent(body),
		"appearance" => parse_appearance(body),
		"graph" => parse_graph(body),
		"compaction" => parse_compaction(body),
		_ => return None,
	})
}

/// The body as an object; null, arrays and scalars are not records.
fn as_record(body: &Json) -> Result<&Obj, String> {
	body.as_obj().ok_or_else(|| "Invalid JSON body".to_owned())
}

fn type_error(field: &str, kind: &str) -> String {
	format!("{field} must be {kind}")
}

/// A boolean field: absent is fine, present must be a boolean.
fn boolean(raw: &Obj, key: &str) -> Result<Option<bool>, String> {
	match raw.get(key) {
		None => Ok(None),
		Some(Json::Bool(b)) => Ok(Some(*b)),
		Some(_) => Err(type_error(key, "a boolean")),
	}
}

fn parse_general(body: &Json) -> Parsed {
	let raw = as_record(body)?;
	let mut out = Obj::new();
	if let Some(v) = boolean(raw, "autoUpdate")? {
		out.insert("autoUpdate", v);
	}
	if let Some(v) = raw.get("activeClass") {
		match v.as_str() {
			Some(id) if id == "none" || is_class_id(id) => out.insert("activeClass", id),
			_ => return Err("activeClass must be a class id or \"none\"".to_owned()),
		};
	}
	if let Some(v) = boolean(raw, "onboarded")? {
		out.insert("onboarded", v);
	}
	if let Some(v) = raw.get("lastSeenVersion") {
		if !is_version(v) {
			return Err("lastSeenVersion must be a version like \"0.4.1\"".to_owned());
		}
		out.insert("lastSeenVersion", v.clone());
	}
	if let Some(v) = raw.get("teacherName") {
		let Some(name) = v.as_str() else { return Err(type_error("teacherName", "a string")) };
		// "" (or only spaces) clears it back to the default name.
		let name = sanitize_teacher_name(name);
		if !name.is_empty() {
			out.insert("teacherName", name);
		}
	}
	if let Some(v) = boolean(raw, "sounds")? {
		out.insert("sounds", v);
	}
	Ok(Json::Obj(out))
}

/// A boolean map (tool switches): every value must be boolean.
fn parse_boolean_map(value: Option<&Json>, field: &str) -> Result<Option<Obj>, String> {
	let Some(value) = value else { return Ok(None) };
	let Some(raw) = value.as_obj() else { return Err(type_error(field, "an object")) };
	let mut out = Obj::new();
	for (key, entry) in raw.iter() {
		let Json::Bool(b) = entry else { return Err(format!("{field}.{key} must be a boolean")) };
		out.insert(key.as_str(), *b);
	}
	Ok(Some(out))
}

fn parse_agent(body: &Json) -> Parsed {
	let raw = as_record(body)?;
	let mut out = Obj::new();
	if let Some(tools) = parse_boolean_map(raw.get("tools"), "tools")? {
		// A bogus key that was saved would drift once the bridge honors it, so it is refused here.
		if let Some(key) = tools.keys().find(|k| !WRITABLE_TOOL_KEYS.contains(&k.as_str())) {
			return Err(format!("unknown tool \"{key}\" (supported: {})", WRITABLE_TOOL_KEYS.join(", ")));
		}
		out.insert("tools", Json::Obj(tools));
	}
	if let Some(rules) = raw.get("rules") {
		let Some(rules_obj) = rules.as_obj() else { return Err(type_error("rules", "an object")) };
		let areas: Vec<&str> = TEACHING_AREAS.iter().map(|a| a.id).collect();
		for (key, list) in rules_obj.iter() {
			if !areas.contains(&key.as_str()) {
				return Err(format!("unknown area \"{key}\" (supported: {})", areas.join(", ")));
			}
			if !list.as_arr().is_some_and(|items| items.iter().all(|r| r.as_str().is_some())) {
				return Err(format!("rules.{key} must be a list of strings"));
			}
		}
		out.insert("rules", sanitize_area_rules(rules));
	}
	if let Some(graph_tools) = raw.get("graphTools") {
		let Some(graph_tools) = graph_tools.as_obj() else { return Err(type_error("graphTools", "an object")) };
		let mut kept = Obj::new();
		match graph_tools.get("enabled") {
			None => {}
			Some(Json::Bool(b)) => {
				kept.insert("enabled", *b);
			}
			Some(_) => return Err("graphTools.enabled must be a boolean".to_owned()),
		}
		out.insert("graphTools", Json::Obj(kept));
	}
	Ok(Json::Obj(out))
}

/// A hex-or-null color field: null means the default.
fn parse_hex_or_null(value: &Json, field: &str) -> Result<Json, String> {
	match value {
		Json::Null => Ok(Json::Null),
		Json::Str(s) if is_hex_color(s) => Ok(value.clone()),
		_ => Err(format!("{field} must be a #hex color or null")),
	}
}

/// A whole number between `min` and `max`.
fn integer_between(value: &Json, min: f64, max: f64) -> Option<Json> {
	let n = value.as_f64()?;
	(n.fract() == 0.0 && (min..=max).contains(&n)).then(|| value.clone())
}

fn parse_appearance(body: &Json) -> Parsed {
	let raw = as_record(body)?;
	let mut out = Obj::new();
	if let Some(v) = raw.get("background") {
		out.insert("background", parse_hex_or_null(v, "background")?);
	}
	if let Some(v) = raw.get("fontFamily") {
		let usable = match v {
			Json::Null => true,
			Json::Str(s) => !text::trim(s).is_empty(),
			_ => false,
		};
		if !usable {
			return Err("fontFamily must be a non-empty string or null".to_owned());
		}
		out.insert("fontFamily", v.clone());
	}
	if let Some(v) = raw.get("proseFontSize") {
		let Some(size) = integer_between(v, 12.0, 24.0) else { return Err("proseFontSize must be an integer between 12 and 24".to_owned()) };
		out.insert("proseFontSize", size);
	}
	if let Some(v) = raw.get("mdRendering") {
		let Some(md) = v.as_obj() else { return Err(type_error("mdRendering", "an object")) };
		let mut rendering = Obj::new();
		if let Some(w) = md.get("headingWeight") {
			let Some(weight) = integer_between(w, 100.0, 900.0) else { return Err("mdRendering.headingWeight must be an integer between 100 and 900".to_owned()) };
			rendering.insert("headingWeight", weight);
		}
		for key in ["boldColor", "italicColor"] {
			if let Some(c) = md.get(key) {
				rendering.insert(key, parse_hex_or_null(c, &format!("mdRendering.{key}"))?);
			}
		}
		if !rendering.is_empty() {
			out.insert("mdRendering", Json::Obj(rendering));
		}
	}
	Ok(Json::Obj(out))
}

/// A finite number floored, at least `floor`; `too_small` is the message when it is not.
fn floored_number(raw: &Obj, key: &str, floor: f64, too_small: &str) -> Result<Option<Json>, String> {
	let Some(value) = raw.get(key) else { return Ok(None) };
	let Some(n) = value.as_f64().filter(|n| n.is_finite()) else { return Err(type_error(key, "a number")) };
	let floored = n.floor();
	if floored < floor {
		return Err(format!("{key} must be at least {floor} ({too_small})"));
	}
	Ok(Some(Json::Num(floored)))
}

fn parse_graph(body: &Json) -> Parsed {
	let raw = as_record(body)?;
	let mut out = Obj::new();
	if let Some(v) = boolean(raw, "enabled")? {
		out.insert("enabled", v);
	}
	if let Some(n) = floored_number(raw, "extractionChunkTokens", EXTRACTION_CHUNK_TOKENS_FLOOR, "smaller batches waste the per-run graph overhead")? {
		out.insert("extractionChunkTokens", n);
	}
	Ok(Json::Obj(out))
}

fn parse_compaction(body: &Json) -> Parsed {
	let raw = as_record(body)?;
	let mut out = Obj::new();
	let reason = "compaction keeps a ~20k-token recent tail, so smaller budgets would churn it";
	if let Some(n) = floored_number(raw, "thresholdTokens", COMPACTION_THRESHOLD_FLOOR, reason)? {
		out.insert("thresholdTokens", n);
	}
	Ok(Json::Obj(out))
}

#[cfg(test)]
mod tests {
	use super::*;
	use gs_json::{json, parse, stringify};

	fn run(section: &str, body: &str) -> Result<String, String> {
		parse_section(section, &parse(body).unwrap()).unwrap().map(|v| stringify(&v))
	}

	#[test]
	fn general_keeps_known_keys_in_parser_order() {
		assert_eq!(run("general", r#"{"sounds":false,"teacherName":"  Zed\n ","x":1,"autoUpdate":true}"#).unwrap(), r#"{"autoUpdate":true,"teacherName":"Zed","sounds":false}"#);
		assert_eq!(run("general", r#"{"teacherName":"  "}"#).unwrap(), "{}");
		assert_eq!(run("general", r#"{"activeClass":"zzz"}"#).unwrap_err(), "activeClass must be a class id or \"none\"");
		assert_eq!(run("general", r#"{"lastSeenVersion":"1.2"}"#).unwrap_err(), "lastSeenVersion must be a version like \"0.4.1\"");
		assert_eq!(run("general", "[]").unwrap_err(), "Invalid JSON body");
		assert_eq!(run("general", "null").unwrap_err(), "Invalid JSON body");
		assert_eq!(run("general", r#"{"onboarded":null}"#).unwrap_err(), "onboarded must be a boolean");
	}

	#[test]
	fn agent_checks_tools_rules_and_graph_tools() {
		assert_eq!(run("agent", r#"{"tools":{"pdf":false}}"#).unwrap(), r#"{"tools":{"pdf":false}}"#);
		assert_eq!(run("agent", r#"{"tools":{"x":true}}"#).unwrap_err(), "unknown tool \"x\" (supported: research, demo, visual, pdf, explain)");
		assert_eq!(run("agent", r#"{"tools":{"pdf":1}}"#).unwrap_err(), "tools.pdf must be a boolean");
		assert_eq!(run("agent", r#"{"rules":{"nope":[]}}"#).unwrap_err(), "unknown area \"nope\" (supported: voice, teaching, questions, facts, demos, files)");
		assert_eq!(run("agent", r#"{"rules":{"voice":[1]}}"#).unwrap_err(), "rules.voice must be a list of strings");
		assert_eq!(run("agent", r#"{"rules":{"voice":[" a ","a"]}}"#).unwrap(), r#"{"rules":{"voice":["a"]}}"#);
		assert_eq!(run("agent", r#"{"graphTools":{"enabled":false,"z":1}}"#).unwrap(), r#"{"graphTools":{"enabled":false}}"#);
		assert_eq!(run("agent", r#"{"graphTools":{}}"#).unwrap(), r#"{"graphTools":{}}"#);
		assert_eq!(run("agent", r#"{"graphTools":{"enabled":"y"}}"#).unwrap_err(), "graphTools.enabled must be a boolean");
	}

	#[test]
	fn appearance_is_strict_and_drops_empty_rendering() {
		let ok = run("appearance", r##"{"proseFontSize":15,"background":"#FFF","mdRendering":{"boldColor":null,"headingWeight":700}}"##).unwrap();
		assert_eq!(ok, r##"{"background":"#FFF","proseFontSize":15,"mdRendering":{"headingWeight":700,"boldColor":null}}"##);
		assert_eq!(run("appearance", r#"{"mdRendering":{}}"#).unwrap(), "{}");
		assert_eq!(run("appearance", r#"{"proseFontSize":11.5}"#).unwrap_err(), "proseFontSize must be an integer between 12 and 24");
		assert_eq!(run("appearance", r#"{"fontFamily":" "}"#).unwrap_err(), "fontFamily must be a non-empty string or null");
		assert_eq!(run("appearance", r#"{"background":"red"}"#).unwrap_err(), "background must be a #hex color or null");
		assert_eq!(run("appearance", r#"{"mdRendering":{"italicColor":"x"}}"#).unwrap_err(), "mdRendering.italicColor must be a #hex color or null");
	}

	#[test]
	fn numbers_are_floored_and_floored_again_at_the_minimum() {
		assert_eq!(run("graph", r#"{"extractionChunkTokens":700.9}"#).unwrap(), r#"{"extractionChunkTokens":700}"#);
		assert_eq!(run("graph", r#"{"extractionChunkTokens":10}"#).unwrap_err(), "extractionChunkTokens must be at least 500 (smaller batches waste the per-run graph overhead)");
		assert_eq!(run("graph", r#"{"extractionChunkTokens":"x"}"#).unwrap_err(), "extractionChunkTokens must be a number");
		assert_eq!(run("compaction", r#"{"thresholdTokens":40000.7}"#).unwrap(), r#"{"thresholdTokens":40000}"#);
		assert!(run("compaction", r#"{"thresholdTokens":5}"#).unwrap_err().starts_with("thresholdTokens must be at least 32000 ("));
		assert!(parse_section("other", &json!({})).is_none());
	}
}
