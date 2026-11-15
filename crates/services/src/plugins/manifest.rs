//! A plugin's `manifest.json`, checked before anything of the plugin is kept or shown. What comes
//! back is the manifest with only the fields godspeed knows, each in its checked form.

use std::path::Path;
use std::sync::LazyLock;

use gs_base::re::Re;
use gs_core::records::changelog::is_version;
use gs_core::records::plugin_settings::is_plugin_id;
use gs_core::records::teaching_areas::one_line;
use gs_json::{Json, Obj, json};

pub const MANIFEST_FILE: &str = "manifest.json";
/// The folder inside a plugin's folder that holds its stored JSON, so no plugin file may use it.
pub const DATA_FOLDER: &str = "data";

const MANIFEST_MAX_BYTES: u64 = 64 * 1024;
const NAME_MAX: usize = 40;
const DESCRIPTION_MAX: usize = 200;
const AUTHOR_MAX: usize = 80;
const LABEL_MAX: usize = 24;
const PATH_MAX: usize = 200;
const SETTINGS_MAX: usize = 20;
const OPTIONS_MAX: usize = 12;
const NETWORK_MAX: usize = 10;
/// The longest text setting value.
pub const TEXT_MAX: usize = 500;
/// What a plugin may ask for: the agent's work (`ask_agent`) and the open space's facts.
const USES: [&str; 2] = ["agent", "space"];

type Checked = Result<Json, String>;

fn problem(field: &str, rule: &str) -> String {
	format!("manifest.json: {field} {rule}")
}

/// A one-line string of 1 to `max` characters.
fn short_text(raw: &Json, field: &str, max: usize) -> Checked {
	let Some(text) = raw.as_str() else { return Err(problem(field, "must be text")) };
	let line = one_line(text, max);
	if line.is_empty() {
		return Err(problem(field, "is empty"));
	}
	Ok(Json::from(line))
}

/// A path inside the plugin's folder, written with `/`: no `..`, `.`, hidden or empty parts, no
/// drive or root, and not in the data folder.
pub fn is_inside_path(path: &str) -> bool {
	!path.is_empty()
		&& path.len() <= PATH_MAX
		&& !path.contains(['\\', ':', '\0'])
		&& !path.chars().any(char::is_control)
		&& path.split('/').all(|part| !part.is_empty() && !part.starts_with('.'))
		&& path.split('/').next() != Some(DATA_FOLDER)
}

/// A bare host name like `api.memegen.link`: lowercase, at least two labels, no IP address,
/// scheme, port, path or wildcard.
fn is_host_name(host: &str) -> bool {
	static LABEL: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", ""));
	let labels: Vec<&str> = host.split('.').collect();
	host.len() <= 253 && labels.len() >= 2 && labels.iter().all(|l| LABEL.test(l)) && !labels.last().is_some_and(|l| l.chars().all(|c| c.is_ascii_digit()))
}

/// `{ label }` for a place the plugin shows in, or None when the manifest leaves it out.
fn place(raw: &Json, field: &str) -> Result<Option<Json>, String> {
	match raw {
		Json::Null => Ok(None),
		Json::Obj(_) => Ok(Some(json!({ "label": short_text(&raw["label"], &format!("{field}.label"), LABEL_MAX)? }))),
		_ => Err(problem(field, "must be { label }")),
	}
}

fn string_list<'a>(raw: &'a Json, field: &str, max: usize) -> Result<Vec<&'a str>, String> {
	if raw.is_null() {
		return Ok(Vec::new());
	}
	let Some(items) = raw.as_arr() else { return Err(problem(field, "must be a list")) };
	if items.len() > max {
		return Err(problem(field, &format!("has more than {max} entries")));
	}
	let mut out: Vec<&str> = Vec::new();
	for item in items {
		let Some(text) = item.as_str() else { return Err(problem(field, "must hold only text")) };
		if !out.contains(&text) {
			out.push(text);
		}
	}
	Ok(out)
}

/// One setting: `{ key, label, kind, default, hint? }`, with `options` for a choice and `min` and
/// `max` for a number.
fn setting(raw: &Json, at: usize) -> Checked {
	static KEY: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[A-Za-z][A-Za-z0-9_]{0,39}$", ""));
	let field = |name: &str| format!("settings[{at}].{name}");
	let Some(key) = raw["key"].as_str().filter(|k| KEY.test(k)) else { return Err(problem(&field("key"), "must be a name like fontSize")) };
	let mut out = Obj::new();
	out.insert("key", key);
	out.insert("label", short_text(&raw["label"], &field("label"), NAME_MAX)?);
	let kind = raw["kind"].as_str().unwrap_or_default();
	out.insert("kind", kind);
	let default = &raw["default"];
	match kind {
		"toggle" => {
			let Some(on) = default.as_bool() else { return Err(problem(&field("default"), "must be true or false")) };
			out.insert("default", on);
		}
		"choice" => {
			let options = string_list(&raw["options"], &field("options"), OPTIONS_MAX)?;
			if options.len() < 2 || options.iter().any(|o| one_line(o, NAME_MAX) != *o || o.is_empty()) {
				return Err(problem(&field("options"), &format!("must be 2 to {OPTIONS_MAX} different one-line names")));
			}
			if !default.as_str().is_some_and(|d| options.contains(&d)) {
				return Err(problem(&field("default"), "must be one of the options"));
			}
			out.insert("options", options);
			out.insert("default", default.clone());
		}
		"number" => {
			let bound = |name: &str| -> Result<Option<f64>, String> {
				match &raw[name] {
					Json::Null => Ok(None),
					value => value.as_f64().filter(|n| n.is_finite()).map(Some).ok_or_else(|| problem(&field(name), "must be a number")),
				}
			};
			let (min, max) = (bound("min")?, bound("max")?);
			let Some(value) = default.as_f64().filter(|n| n.is_finite()) else { return Err(problem(&field("default"), "must be a number")) };
			if min.is_some_and(|m| value < m) || max.is_some_and(|m| value > m) {
				return Err(problem(&field("default"), "must be between min and max"));
			}
			out.insert("default", value);
			if let Some(min) = min {
				out.insert("min", min);
			}
			if let Some(max) = max {
				out.insert("max", max);
			}
		}
		"text" => {
			let text = match default {
				Json::Null => "",
				value => value.as_str().ok_or_else(|| problem(&field("default"), "must be text"))?,
			};
			if text.chars().count() > TEXT_MAX {
				return Err(problem(&field("default"), &format!("is longer than {TEXT_MAX} characters")));
			}
			out.insert("default", text);
		}
		_ => return Err(problem(&field("kind"), "must be toggle, choice, number or text")),
	}
	if !raw["hint"].is_null() {
		out.insert("hint", short_text(&raw["hint"], &field("hint"), DESCRIPTION_MAX)?);
	}
	Ok(Json::Obj(out))
}

fn settings(raw: &Json) -> Checked {
	if raw.is_null() {
		return Ok(json!([]));
	}
	let Some(items) = raw.as_arr() else { return Err(problem("settings", "must be a list")) };
	if items.len() > SETTINGS_MAX {
		return Err(problem("settings", &format!("has more than {SETTINGS_MAX} entries")));
	}
	let mut out: Vec<Json> = Vec::new();
	for (at, item) in items.iter().enumerate() {
		let checked = setting(item, at)?;
		if out.iter().any(|s| s["key"] == checked["key"]) {
			return Err(problem(&format!("settings[{at}].key"), "is used twice"));
		}
		out.push(checked);
	}
	Ok(Json::from(out))
}

/// The manifest as godspeed keeps it, or the first thing wrong with it.
pub fn check_manifest(raw: &Json) -> Checked {
	if raw.as_obj().is_none() {
		return Err("manifest.json must be a JSON object".to_owned());
	}
	let Some(id) = raw["id"].as_str().filter(|id| is_plugin_id(id)) else { return Err(problem("id", "must be lowercase letters, digits and dashes, like meme-cards")) };
	if !is_version(&raw["version"]) {
		return Err(problem("version", "must be like 1.0.0"));
	}
	let Some(entry) = raw["entry"].as_str().filter(|e| is_inside_path(e) && e.to_lowercase().ends_with(".html")) else { return Err(problem("entry", "must be an .html file inside the plugin's folder")) };
	let lesson = place(&raw["lesson"], "lesson")?;
	let space = place(&raw["space"], "space")?;
	if lesson.is_none() && space.is_none() {
		return Err("manifest.json needs lesson or space, so the plugin shows somewhere".to_owned());
	}
	let network = string_list(&raw["network"], "network", NETWORK_MAX)?;
	if let Some(bad) = network.iter().find(|h| !is_host_name(h)) {
		return Err(problem("network", &format!("must hold host names like api.example.com, not \"{bad}\"")));
	}
	let uses = string_list(&raw["uses"], "uses", USES.len())?;
	if let Some(bad) = uses.iter().find(|u| !USES.contains(u)) {
		return Err(problem("uses", &format!("can hold agent and space, not \"{bad}\"")));
	}
	let mut out = Obj::new();
	out.insert("id", id);
	out.insert("name", short_text(&raw["name"], "name", NAME_MAX)?);
	out.insert("version", raw["version"].clone());
	out.insert("description", short_text(&raw["description"], "description", DESCRIPTION_MAX)?);
	out.insert("author", short_text(&raw["author"], "author", AUTHOR_MAX)?);
	out.insert("entry", entry);
	out.set_or_remove("lesson", lesson);
	out.set_or_remove("space", space);
	out.insert("settings", settings(&raw["settings"])?);
	out.insert("network", network);
	out.insert("uses", uses);
	Ok(Json::Obj(out))
}

/// The checked manifest of the plugin in `dir`, whose entry must be a file there.
pub fn read_manifest(dir: &Path) -> Checked {
	let file = dir.join(MANIFEST_FILE);
	let size = std::fs::metadata(&file).map_err(|_| "The folder has no manifest.json.".to_owned())?.len();
	if size > MANIFEST_MAX_BYTES {
		return Err("manifest.json is over 64 KB.".to_owned());
	}
	let raw = gs_base::fsx::read_json(&file).ok_or("manifest.json isn't valid JSON.")?;
	let manifest = check_manifest(&raw)?;
	let entry = dir.join(manifest["entry"].str_or_empty());
	if !std::fs::symlink_metadata(&entry).is_ok_and(|m| m.is_file()) {
		return Err(format!("The entry {} isn't in the plugin's folder.", manifest["entry"].str_or_empty()));
	}
	Ok(manifest)
}

/// Whether the manifest's `uses` names `what`.
pub fn uses(manifest: &Json, what: &str) -> bool {
	manifest["uses"].items().iter().any(|u| u.as_str() == Some(what))
}

/// The manifest's setting with this key.
pub fn setting_of<'a>(manifest: &'a Json, key: &str) -> Option<&'a Json> {
	manifest["settings"].items().iter().find(|s| s["key"].as_str() == Some(key))
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;

	fn good() -> Json {
		json!({
			"id": "meme-cards",
			"name": "Meme cards",
			"version": "0.2.0",
			"description": "Turns the question into a meme.",
			"author": "808arc",
			"entry": "dist/index.html",
			"lesson": { "label": "Memes" },
			"settings": [
				{ "key": "captions", "label": "Captions", "kind": "toggle", "default": true },
				{ "key": "style", "label": "Style", "kind": "choice", "options": ["Classic", "Modern"], "default": "Classic" },
				{ "key": "size", "label": "Size", "kind": "number", "min": 1, "max": 5, "default": 3, "hint": "Bigger is louder." },
				{ "key": "signature", "label": "Signature", "kind": "text" },
			],
			"network": ["api.memegen.link", "api.memegen.link"],
			"uses": ["agent"],
			"icon": "old.png",
		})
	}

	fn with(field: &str, value: Json) -> Json {
		let mut raw = good();
		raw.as_obj_mut().unwrap().insert(field, value);
		raw
	}

	#[test]
	fn a_good_manifest_keeps_only_known_fields() {
		let manifest = check_manifest(&good()).unwrap();
		assert_eq!(
			stringify(&manifest),
			r#"{"id":"meme-cards","name":"Meme cards","version":"0.2.0","description":"Turns the question into a meme.","author":"808arc","entry":"dist/index.html","lesson":{"label":"Memes"},"settings":[{"key":"captions","label":"Captions","kind":"toggle","default":true},{"key":"style","label":"Style","kind":"choice","options":["Classic","Modern"],"default":"Classic"},{"key":"size","label":"Size","kind":"number","default":3,"min":1,"max":5,"hint":"Bigger is louder."},{"key":"signature","label":"Signature","kind":"text","default":""}],"network":["api.memegen.link"],"uses":["agent"]}"#
		);
		assert!(uses(&manifest, "agent") && !uses(&manifest, "space"));
		assert_eq!(setting_of(&manifest, "size").unwrap()["max"], json!(5));
		let bare = json!({ "id": "q", "name": "Q", "version": "1.0.0", "description": "d", "author": "a", "entry": "index.html", "space": { "label": "Quiz" } });
		assert_eq!(stringify(&check_manifest(&bare).unwrap()["settings"]), "[]");
	}

	#[test]
	fn each_bad_field_is_named() {
		let cases = [
			(with("id", json!("Meme Cards")), "manifest.json: id must be"),
			(with("id", json!("../x")), "manifest.json: id must be"),
			(with("version", json!("1")), "manifest.json: version"),
			(with("name", json!("  ")), "manifest.json: name is empty"),
			(with("author", json!(3)), "manifest.json: author must be text"),
			(with("entry", json!("../index.html")), "manifest.json: entry"),
			(with("entry", json!("/etc/index.html")), "manifest.json: entry"),
			(with("entry", json!("C:/x/index.html")), "manifest.json: entry"),
			(with("entry", json!("dist\\index.html")), "manifest.json: entry"),
			(with("entry", json!("data/index.html")), "manifest.json: entry"),
			(with("entry", json!(".hidden/index.html")), "manifest.json: entry"),
			(with("entry", json!("main.js")), "manifest.json: entry"),
			(with("lesson", json!("Memes")), "manifest.json: lesson must be"),
			(with("lesson", Json::Null), "needs lesson or space"),
			(with("network", json!(["https://api.memegen.link"])), "not \"https://api.memegen.link\""),
			(with("network", json!(["api.memegen.link:443"])), "network"),
			(with("network", json!(["*.memegen.link"])), "network"),
			(with("network", json!(["localhost"])), "network"),
			(with("network", json!(["127.0.0.1"])), "network"),
			(with("network", json!(["API.memegen.link"])), "network"),
			(with("uses", json!(["agent", "files"])), "not \"files\""),
			(with("uses", json!("agent")), "manifest.json: uses must be a list"),
			(with("settings", json!([{ "key": "a", "label": "A", "kind": "slider", "default": 1 }])), "settings[0].kind"),
			(with("settings", json!([{ "key": "a b", "label": "A", "kind": "toggle", "default": true }])), "settings[0].key"),
			(with("settings", json!([{ "key": "a", "label": "A", "kind": "toggle", "default": "yes" }])), "settings[0].default"),
			(with("settings", json!([{ "key": "a", "label": "A", "kind": "choice", "options": ["x"], "default": "x" }])), "settings[0].options"),
			(with("settings", json!([{ "key": "a", "label": "A", "kind": "choice", "options": ["x", "y"], "default": "z" }])), "settings[0].default"),
			(with("settings", json!([{ "key": "a", "label": "A", "kind": "number", "min": 2, "default": 1 }])), "settings[0].default"),
			(with("settings", json!([{ "key": "a", "label": "A", "kind": "text", "default": "x".repeat(501) }])), "settings[0].default"),
			(with("settings", json!([{ "key": "a", "label": "A", "kind": "toggle", "default": true }, { "key": "a", "label": "B", "kind": "toggle", "default": false }])), "settings[1].key is used twice"),
		];
		for (raw, want) in cases {
			let got = check_manifest(&raw).unwrap_err();
			assert!(got.contains(want), "{got} does not contain {want}");
		}
		assert!(check_manifest(&json!([])).is_err());
	}

	#[test]
	fn inside_paths() {
		assert!(is_inside_path("index.html") && is_inside_path("dist/a/b.js"));
		for bad in ["", "/a", "a//b", "a/../b", "./a", "a/.git/x", "data", "data/x.json", "a\\b", "c:x", "a\0b", "a\nb"] {
			assert!(!is_inside_path(bad), "{bad:?}");
		}
	}
}
