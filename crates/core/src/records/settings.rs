//! The settings record's defaults and its sanitizer.
//!
//! The record stores explicit choices only (absent keys resolve to the factory defaults), unknown
//! keys ride along untouched, and nothing read from disk or the network is trusted raw.

use std::sync::LazyLock;

use gs_base::{num, re::Re};
use gs_json::{Json, Obj, json};

use super::changelog::is_version;
use super::teaching_areas::{one_line, sanitize_area_rules};
use crate::contracts::class::is_class_id;

pub const CURRENT_SETTINGS_VERSION: i64 = 2;
pub const DEFAULT_TEACHER_NAME: &str = "Teacher";
pub const OUTSIDE_AGENT_PROVIDER: &str = "agent";
pub const OUTSIDE_AGENT_MODEL_ID: &str = "outside-agent";
pub const OUTSIDE_AGENT_CONTEXT_WINDOW: i64 = 200_000;
/// The longest teacher name kept.
pub const TEACHER_NAME_MAX: usize = 40;
/// The chunk budget's validated floor; the sanitizer clamps up to it.
pub const EXTRACTION_CHUNK_TOKENS_FLOOR: f64 = 500.0;
/// The compaction trigger's floor.
pub const COMPACTION_THRESHOLD_FLOOR: f64 = 32_000.0;

const PROSE_FONT_MIN: f64 = 12.0;
const PROSE_FONT_MAX: f64 = 24.0;

/// Names `key in {}` is true for in JavaScript: an unknown key like these never rides along.
const OBJECT_PROTOTYPE_KEYS: [&str; 12] = [
	"constructor",
	"hasOwnProperty",
	"isPrototypeOf",
	"propertyIsEnumerable",
	"toLocaleString",
	"toString",
	"valueOf",
	"__proto__",
	"__defineGetter__",
	"__defineSetter__",
	"__lookupGetter__",
	"__lookupSetter__",
];

/// FACTORY_SETTINGS: every knob's default (absent keys in settings.json resolve to these).
pub fn factory_settings() -> Json {
	json!({
		"version": CURRENT_SETTINGS_VERSION,
		"general": { "autoUpdate": true, "activeClass": "none", "teacherName": DEFAULT_TEACHER_NAME, "sounds": true },
		"appearance": {
			"background": null,
			"fontFamily": null,
			"proseFontSize": 15,
			"mdRendering": { "headingWeight": 900, "boldColor": null, "italicColor": null },
		},
		"graph": { "enabled": true, "extractionChunkTokens": 4096 },
		"compaction": { "thresholdTokens": 40000 },
	})
}

/// A teacher name made safe to show. "" = use the default.
pub fn sanitize_teacher_name(raw: &str) -> String {
	one_line(raw, TEACHER_NAME_MAX)
}

/// #rgb / #rrggbb (case-insensitive): the only color format accepted.
pub fn is_hex_color(value: &str) -> bool {
	static THREE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^#[0-9a-fA-F]{3}$", ""));
	static SIX: LazyLock<Re> = LazyLock::new(|| Re::new(r"^#[0-9a-fA-F]{6}$", ""));
	THREE.test(value) || SIX.test(value)
}

fn clamp(v: f64, min: f64, max: f64) -> f64 {
	v.max(min).min(max)
}

/// A finite number, or None.
fn finite(v: &Json) -> Option<f64> {
	v.as_f64().filter(|n| n.is_finite())
}

/// Null and a valid hex color pass through; anything else becomes null.
fn hex_or_null(value: &Json) -> Json {
	match value.as_str() {
		Some(color) if is_hex_color(color) => Json::from(color),
		_ => Json::Null,
	}
}

fn sanitize_general(raw: &Json) -> Json {
	let mut out = Obj::new();
	if let Some(auto_update) = raw["autoUpdate"].as_bool() {
		out.insert("autoUpdate", auto_update);
	}
	if let Some(class) = raw["activeClass"].as_str().filter(|c| *c == "none" || is_class_id(c)) {
		out.insert("activeClass", class);
	}
	if let Some(onboarded) = raw["onboarded"].as_bool() {
		out.insert("onboarded", onboarded);
	}
	if is_version(&raw["lastSeenVersion"]) {
		out.insert("lastSeenVersion", raw["lastSeenVersion"].clone());
	}
	if let Some(name) = raw["teacherName"].as_str().map(sanitize_teacher_name).filter(|n| !n.is_empty()) {
		out.insert("teacherName", name);
	}
	if let Some(sounds) = raw["sounds"].as_bool() {
		out.insert("sounds", sounds);
	}
	Json::Obj(out)
}

/// The boolean entries of an object, or None when there are none. A `__proto__` entry is lost,
/// as in JS, where assigning it sets the prototype instead of a key.
fn sanitize_boolean_map(raw: &Json) -> Option<Json> {
	let map: Obj = raw.as_obj()?.iter().filter(|(k, v)| v.as_bool().is_some() && *k != "__proto__").map(|(k, v)| (k.clone(), v.clone())).collect();
	(!map.is_empty()).then_some(Json::Obj(map))
}

fn sanitize_agent(raw: &Json) -> Json {
	let mut out = Obj::new();
	if let Some(tools) = sanitize_boolean_map(&raw["tools"]) {
		out.insert("tools", tools);
	}
	let rules = sanitize_area_rules(&raw["rules"]);
	if rules.as_obj().is_some_and(|r| !r.is_empty()) {
		out.insert("rules", rules);
	}
	// Lenient read side: a bad shape drops the key and the default (on) resumes.
	if raw["graphTools"].as_obj().is_some() {
		match raw["graphTools"].get("enabled") {
			None => {
				out.insert("graphTools", Json::Obj(Obj::new()));
			}
			Some(Json::Bool(enabled)) => {
				out.insert("graphTools", json!({ "enabled": *enabled }));
			}
			Some(_) => {}
		}
	}
	Json::Obj(out)
}

fn sanitize_md_rendering(raw: &Json) -> Json {
	let mut out = Obj::new();
	if raw.as_obj().is_none() {
		return Json::Obj(out);
	}
	if let Some(weight) = finite(&raw["headingWeight"]) {
		out.insert("headingWeight", clamp(num::math_round(weight), 100.0, 900.0));
	}
	for key in ["boldColor", "italicColor"] {
		if let Some(color) = raw.get(key) {
			out.insert(key, hex_or_null(color));
		}
	}
	Json::Obj(out)
}

fn sanitize_appearance(raw: &Json) -> Json {
	let mut out = Obj::new();
	if let Some(background) = raw.get("background") {
		let color = hex_or_null(background);
		// Paper and White were removed (the app is dark only): they read as Black.
		let retired = color.as_str().is_some_and(|c| ["#f4f1ea", "#ffffff"].contains(&c.to_lowercase().as_str()));
		out.insert("background", if retired { Json::Null } else { color });
	}
	if let Some(font) = raw.get("fontFamily") {
		let named = font.as_str().filter(|f| !gs_base::text::trim(f).is_empty());
		out.insert("fontFamily", named.map_or(Json::Null, Json::from));
	}
	if let Some(size) = finite(&raw["proseFontSize"]) {
		out.insert("proseFontSize", clamp(num::math_round(size), PROSE_FONT_MIN, PROSE_FONT_MAX));
	}
	if let Some(md) = raw.get("mdRendering") {
		out.insert("mdRendering", sanitize_md_rendering(md));
	}
	Json::Obj(out)
}

/// A positive finite number floored to an integer no lower than `floor`.
fn floored(raw: &Json, floor: f64) -> Option<f64> {
	finite(raw).filter(|n| *n > 0.0).map(|n| n.floor().max(floor))
}

fn sanitize_graph(raw: &Json) -> Json {
	let mut out = Obj::new();
	if let Some(enabled) = raw["enabled"].as_bool() {
		out.insert("enabled", enabled);
	}
	if let Some(tokens) = floored(&raw["extractionChunkTokens"], EXTRACTION_CHUNK_TOKENS_FLOOR) {
		out.insert("extractionChunkTokens", tokens);
	}
	Json::Obj(out)
}

fn sanitize_compaction(raw: &Json) -> Json {
	let mut out = Obj::new();
	if let Some(tokens) = floored(&raw["thresholdTokens"], COMPACTION_THRESHOLD_FLOOR) {
		out.insert("thresholdTokens", tokens);
	}
	Json::Obj(out)
}

/// One section's cleaner.
type Section = fn(&Json) -> Json;

/// Arbitrary JSON (disk file, network body) as a valid settings record: known fields validated
/// (invalid ones drop or clamp), unknown keys kept as they are. None when it is not an object.
pub fn sanitize_user_settings(raw: &Json) -> Option<Json> {
	let record = raw.as_obj()?;
	let mut out = Obj::new();
	let version = raw["version"].as_f64().filter(|v| v.is_finite() && v.fract() == 0.0 && *v >= 1.0);
	out.insert("version", version.unwrap_or(CURRENT_SETTINGS_VERSION as f64));
	let sections: [(&str, Section); 5] = [("general", sanitize_general), ("agent", sanitize_agent), ("appearance", sanitize_appearance), ("graph", sanitize_graph), ("compaction", sanitize_compaction)];
	for (key, sanitize) in sections {
		if raw[key].as_obj().is_some() {
			out.insert(key, sanitize(&raw[key]));
		}
	}
	// `chat` and `models` are removed sections: a fossil copy must never come back through a read.
	for (key, value) in record {
		if key != "chat" && key != "models" && !out.contains_key(key) && !OBJECT_PROTOTYPE_KEYS.contains(&key.as_str()) {
			out.insert(key.clone(), value.clone());
		}
	}
	Some(Json::Obj(out))
}

#[cfg(test)]
mod tests {
	use gs_json::{parse, stringify};

	use super::*;

	fn clean(raw: &str) -> String {
		stringify(&sanitize_user_settings(&parse(raw).unwrap()).unwrap())
	}

	#[test]
	fn clamps_drops_and_keeps_unknown_keys() {
		let messy = r##"{"version":7,"general":{"teacherName":5,"sounds":"x","activeClass":"zzz","autoUpdate":true,"keep":1},"chat":{},"future":{"a":[1]},"appearance":{"background":"#FFFFFF","proseFontSize":99.6,"fontFamily":"  ","mdRendering":{"headingWeight":5000.4,"boldColor":"zzz","italicColor":null}},"graph":{"extractionChunkTokens":10,"enabled":"y"},"compaction":{"thresholdTokens":-5},"agent":{"tools":{"a":true,"b":"x"},"graphTools":{"enabled":"x"},"rules":{"voice":[" a ","a",3],"nope":["x"]}}}"##;
		assert_eq!(
			clean(messy),
			r#"{"version":7,"general":{"autoUpdate":true},"agent":{"tools":{"a":true},"rules":{"voice":["a"]}},"appearance":{"background":null,"fontFamily":null,"proseFontSize":24,"mdRendering":{"headingWeight":900,"boldColor":null,"italicColor":null}},"graph":{"extractionChunkTokens":500},"compaction":{},"future":{"a":[1]}}"#
		);
	}

	#[test]
	fn version_and_shapes() {
		assert_eq!(clean("{}"), r#"{"version":2}"#);
		assert_eq!(clean(r#"{"version":0}"#), r#"{"version":2}"#);
		assert_eq!(clean(r#"{"version":1.5}"#), r#"{"version":2}"#);
		assert_eq!(clean(r#"{"version":"2","general":[],"constructor":1,"x":2}"#), r#"{"version":2,"general":[],"x":2}"#);
		assert!(sanitize_user_settings(&parse("[1]").unwrap()).is_none());
		assert!(sanitize_user_settings(&Json::Null).is_none());
		assert_eq!(clean(r#"{"agent":{"graphTools":{}}}"#), r#"{"version":2,"agent":{"graphTools":{}}}"#);
		assert_eq!(clean(r#"{"agent":{"graphTools":{"enabled":false}}}"#), r#"{"version":2,"agent":{"graphTools":{"enabled":false}}}"#);
	}

	#[test]
	fn colors_and_names() {
		assert!(is_hex_color("#abc") && is_hex_color("#A1b2C3") && !is_hex_color("#abcd") && !is_hex_color("abc"));
		assert_eq!(sanitize_teacher_name("  Zed\n the  great "), "Zed the great");
	}
}
