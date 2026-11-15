//! godspeed's checked list of plugins (github.com/bayshores/godspeed-plugins). Each entry names a
//! GitHub repository, one tag, and a copy of the fields of the manifest at that tag that the Add
//! sheet shows and that were reviewed. A list that doesn't read is no list, never an error.

use std::sync::LazyLock;

use gs_base::re::Re;
use gs_json::{Json, json};

use super::manifest::check_listed;
use crate::App;

/// The one list format this godspeed reads.
const LIST_VERSION: i64 = 1;

/// The entries of the list in `text`, checked; empty for an unknown version or anything malformed.
pub fn parse_list(text: &str) -> Json {
	match checked_list(text) {
		Ok(entries) => entries,
		Err(problem) => {
			eprintln!("[plugins] the list isn't usable: {problem}");
			json!([])
		}
	}
}

fn checked_list(text: &str) -> Result<Json, String> {
	let raw = gs_json::parse(text).map_err(|_| "it isn't JSON".to_owned())?;
	if raw["version"].as_i64() != Some(LIST_VERSION) {
		return Err("its version is unknown".to_owned());
	}
	let Some(items) = raw["plugins"].as_arr() else { return Err("plugins must be a list".to_owned()) };
	let mut out: Vec<Json> = Vec::new();
	for (at, item) in items.iter().enumerate() {
		let entry = check_entry(item).map_err(|problem| format!("plugins[{at}]: {problem}"))?;
		if out.iter().any(|e| e["id"] == entry["id"]) {
			return Err(format!("plugins[{at}]: the id is listed twice"));
		}
		out.push(entry);
	}
	Ok(Json::from(out))
}

/// `{ id, repo, tag, name, description, lesson?, space?, network, uses }`.
fn check_entry(raw: &Json) -> Result<Json, String> {
	static OWNER: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$", ""));
	static NAME: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[A-Za-z0-9_][A-Za-z0-9._+-]{0,99}$", ""));
	let repo = raw["repo"].as_str().unwrap_or_default();
	if !repo.split_once('/').is_some_and(|(owner, name)| OWNER.test(owner) && NAME.test(name)) {
		return Err("repo must be owner/name".to_owned());
	}
	let Some(tag) = raw["tag"].as_str().filter(|t| NAME.test(t)) else { return Err("tag must be one tag, like v1.0.0".to_owned()) };
	let mut entry = check_listed(raw)?;
	entry.insert("repo", repo);
	entry.insert("tag", tag);
	Ok(Json::Obj(entry))
}

/// This run's list: fetched the first time it is asked for and kept. A failed fetch is not kept,
/// so the next ask tries again.
pub async fn listed_plugins(app: &App) -> Json {
	if let Some(list) = app.plugins.listed.lock().clone() {
		return list;
	}
	match gs_web::plugin_list::download_list().await {
		Ok(text) => keep_list(app, &text),
		Err(problem) => {
			eprintln!("[plugins] the list couldn't be read: {problem}");
			json!([])
		}
	}
}

/// Keeps the list in `text` as this run's list and returns its entries. A debug server reads it
/// from the file `LH_PLUGIN_LIST` names instead of GitHub.
pub fn keep_list(app: &App, text: &str) -> Json {
	let list = parse_list(text);
	*app.plugins.listed.lock() = Some(list.clone());
	list
}

/// The list's entry for the plugin `id`.
pub async fn listed_entry(app: &App, id: &str) -> Option<Json> {
	listed_plugins(app).await.items().iter().find(|e| e["id"].as_str() == Some(id)).cloned()
}

/// Ok when the downloaded manifest has the `id`, `uses` and `network` the entry was reviewed with,
/// so a tag can't carry more access than the list shows.
pub fn same_as_reviewed(entry: &Json, manifest: &Json) -> Result<(), String> {
	fn set(list: &Json) -> Vec<&str> {
		let mut items = list.strs();
		items.sort_unstable();
		items
	}
	let same = manifest["id"] == entry["id"] && set(&manifest["uses"]) == set(&entry["uses"]) && set(&manifest["network"]) == set(&entry["network"]);
	if same { Ok(()) } else { Err("This tag of the plugin isn't what godspeed's list checked.".to_owned()) }
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;

	const MEMES: &str = r#"{ "repo": "808arc/meme-plugin", "tag": "v0.2.0", "id": "memes", "name": "Memes", "description": "Turns the question into a meme.", "lesson": { "label": "Memes" }, "uses": ["agent"], "network": ["api.memegen.link"], "stars": 5 }"#;

	fn list_of(entries: &[&str]) -> String {
		format!(r#"{{ "version": 1, "plugins": [{}] }}"#, entries.join(","))
	}

	#[test]
	fn a_good_list_keeps_only_the_known_fields() {
		let list = parse_list(&list_of(&[MEMES]));
		assert_eq!(
			stringify(&list),
			r#"[{"id":"memes","name":"Memes","description":"Turns the question into a meme.","lesson":{"label":"Memes"},"network":["api.memegen.link"],"uses":["agent"],"repo":"808arc/meme-plugin","tag":"v0.2.0"}]"#
		);
		assert_eq!(parse_list(r#"{ "version": 1, "plugins": [] }"#), json!([]));
	}

	#[test]
	fn an_unknown_version_or_a_malformed_list_is_no_list() {
		let bad_entry = |field: &str, value: &str| MEMES.replacen(&format!(r#""{field}": "#), &format!(r#""{field}": {value}, "was": "#), 1);
		let cases = [
			"not json".to_owned(),
			r#"{ "version": 2, "plugins": [] }"#.replace("[]", &format!("[{MEMES}]")),
			r#"{ "plugins": [] }"#.to_owned(),
			r#"{ "version": 1, "plugins": {} }"#.to_owned(),
			list_of(&[MEMES, MEMES]),
			list_of(&[MEMES, "3"]),
			list_of(&[&bad_entry("repo", r#""808arc""#)]),
			list_of(&[&bad_entry("repo", r#""../x/y""#)]),
			list_of(&[&bad_entry("repo", r#""808arc/..""#)]),
			list_of(&[&bad_entry("tag", r#""v1/../../x""#)]),
			list_of(&[&bad_entry("tag", r#""v1?x""#)]),
			list_of(&[&bad_entry("tag", r#""""#)]),
			list_of(&[&bad_entry("id", r#""Memes""#)]),
			list_of(&[&bad_entry("name", r#""  ""#)]),
			list_of(&[&bad_entry("lesson", "null")]),
			list_of(&[&bad_entry("uses", r#"["files"]"#)]),
			list_of(&[&bad_entry("network", r#"["localhost"]"#)]),
		];
		for text in cases {
			assert_eq!(parse_list(&text), json!([]), "{text}");
		}
	}

	#[test]
	fn the_manifest_must_ask_for_what_was_reviewed() {
		let entry = parse_list(&list_of(&[MEMES]))[0].clone();
		let manifest = |over: Json| {
			let mut m = json!({ "id": "memes", "uses": ["agent"], "network": ["api.memegen.link"], "version": "9.9.9" });
			for (key, value) in over.as_obj().unwrap().iter() {
				m.as_obj_mut().unwrap().insert(key.as_str(), value.clone());
			}
			m
		};
		assert_eq!(same_as_reviewed(&entry, &manifest(json!({}))), Ok(()));
		for over in [json!({ "id": "memes-2" }), json!({ "uses": ["agent", "space"] }), json!({ "uses": [] }), json!({ "network": ["api.memegen.link", "evil.example.com"] }), json!({ "network": [] })] {
			assert!(same_as_reviewed(&entry, &manifest(over.clone())).is_err(), "{over:?}");
		}
	}
}
