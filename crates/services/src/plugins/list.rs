//! godspeed's checked list of plugins (github.com/bayshores/godspeed-plugins). Each entry names a
//! GitHub repository, one tag, and a copy of the fields of the manifest at that tag that the Add
//! sheet shows and that were reviewed. A list that doesn't read is no list, never an error.

use std::path::PathBuf;
use std::sync::LazyLock;

use gs_base::re::Re;
use gs_json::{Json, json};
use gs_web::plugin_list::{TOO_LARGE, download_list};

use super::manifest::check_listed;
use crate::App;

/// The one list format this godspeed reads.
const LIST_VERSION: i64 = 1;

/// The well-formed entries of the list in `text`, the first of each id; empty for text that isn't
/// JSON or a list of an unknown version. A bad entry is left out.
pub fn parse_list(text: &str) -> Json {
	let Ok(raw) = gs_json::parse(text) else { return no_list("it isn't JSON") };
	if raw["version"].as_i64() != Some(LIST_VERSION) {
		return no_list("its version is unknown");
	}
	let Some(items) = raw["plugins"].as_arr() else { return no_list("plugins must be a list") };
	let mut out: Vec<Json> = Vec::new();
	for (at, item) in items.iter().enumerate() {
		match check_entry(item) {
			Ok(entry) if out.iter().any(|e| e["id"] == entry["id"]) => eprintln!("[plugins] the list's plugins[{at}] is left out: its id is listed before"),
			Ok(entry) => out.push(entry),
			Err(problem) => eprintln!("[plugins] the list's plugins[{at}] is left out: {problem}"),
		}
	}
	Json::from(out)
}

fn no_list(problem: &str) -> Json {
	eprintln!("[plugins] the list isn't usable: {problem}");
	json!([])
}

/// `{ id, repo, tag, path?, name, description, lesson?, space?, network, uses }`; `path` is the one
/// folder of the repo the plugin is in, when it isn't at the top.
fn check_entry(raw: &Json) -> Result<Json, String> {
	static OWNER: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$", ""));
	static NAME: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[A-Za-z0-9_][A-Za-z0-9._+-]{0,99}$", ""));
	let repo = raw["repo"].as_str().unwrap_or_default();
	if !repo.split_once('/').is_some_and(|(owner, name)| OWNER.test(owner) && NAME.test(name)) {
		return Err("repo must be owner/name".to_owned());
	}
	let Some(tag) = raw["tag"].as_str().filter(|t| NAME.test(t)) else { return Err("tag must be one tag, like v1.0.0".to_owned()) };
	static FOLDER: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[a-z0-9-]{1,64}$", ""));
	let path = match &raw["path"] {
		Json::Null => None,
		path => Some(path.as_str().filter(|p| FOLDER.test(p)).ok_or("path must be one folder name of a-z, 0-9 and -")?),
	};
	let mut entry = check_listed(raw)?;
	entry.insert("repo", repo);
	entry.insert("tag", tag);
	if let Some(path) = path {
		entry.insert("path", path);
	}
	Ok(Json::Obj(entry))
}

/// Reads the list again, so a newly listed plugin or tag shows without a restart. When the read
/// fails, the last list this run read answers (empty before the first).
pub async fn listed_plugins(app: &App) -> Json {
	let file = app.plugins.list_file.lock().clone();
	let read = match file {
		Some(file) => tokio::fs::read_to_string(file).await.map_err(|e| e.to_string()),
		None => download_list().await,
	};
	let list = match read {
		Ok(text) => parse_list(&text),
		Err(problem) if problem == TOO_LARGE => no_list(&problem),
		Err(problem) => {
			eprintln!("[plugins] the list couldn't be read: {problem}");
			return last_list(app);
		}
	};
	*app.plugins.listed.lock() = Some(list.clone());
	list
}

fn last_list(app: &App) -> Json {
	app.plugins.listed.lock().clone().unwrap_or_else(|| json!([]))
}

/// Reads the list from `file` instead of GitHub: the file `LH_PLUGIN_LIST` names in a debug
/// server, and the tests' lists.
pub fn read_list_from(app: &App, file: PathBuf) {
	*app.plugins.list_file.lock() = Some(file);
}

/// The entry for the plugin `id` in the last list this run read, so an install takes what the
/// Add sheet or the Update key showed.
pub fn listed_entry(app: &App, id: &str) -> Option<Json> {
	last_list(app).items().iter().find(|e| e["id"].as_str() == Some(id)).cloned()
}

/// Ok when the downloaded manifest has the `id`, `uses`, `network`, `lesson` and `space` the entry
/// was reviewed with, so a tag can't carry more access than the list shows or show elsewhere.
pub fn same_as_reviewed(entry: &Json, manifest: &Json) -> Result<(), String> {
	fn set(list: &Json) -> Vec<&str> {
		let mut items = list.strs();
		items.sort_unstable();
		items
	}
	let same = manifest["id"] == entry["id"]
		&& set(&manifest["uses"]) == set(&entry["uses"])
		&& set(&manifest["network"]) == set(&entry["network"])
		&& manifest["lesson"] == entry["lesson"]
		&& manifest["space"] == entry["space"];
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
		let in_folder = MEMES.replace(r#""tag": "v0.2.0","#, r#""tag": "memes-v1", "path": "memes-2","#);
		assert_eq!(parse_list(&list_of(&[&in_folder]))[0]["path"], json!("memes-2"));
		assert_eq!(parse_list(&list_of(&[&MEMES.replace(r#""stars": 5"#, r#""path": null"#)]))[0].get("path"), None);
	}

	#[test]
	fn text_that_isn_t_a_version_1_list_is_no_list() {
		for text in ["not json".to_owned(), list_of(&[MEMES]).replace(r#""version": 1"#, r#""version": 2"#), format!(r#"{{ "plugins": [{MEMES}] }}"#), r#"{ "version": 1, "plugins": {} }"#.to_owned()] {
			assert_eq!(parse_list(&text), json!([]), "{text}");
		}
	}

	#[test]
	fn a_bad_entry_is_left_out_and_the_first_of_an_id_kept() {
		let bad_entry = |field: &str, value: &str| MEMES.replacen(&format!(r#""{field}": "#), &format!(r#""{field}": {value}, "was": "#), 1);
		let bad = [
			"3".to_owned(),
			bad_entry("repo", r#""808arc""#),
			bad_entry("repo", r#""../x/y""#),
			bad_entry("repo", r#""808arc/..""#),
			bad_entry("tag", r#""v1/../../x""#),
			bad_entry("tag", r#""v1?x""#),
			bad_entry("tag", r#""""#),
			bad_entry("id", r#""Memes""#),
			bad_entry("name", r#""  ""#),
			bad_entry("lesson", "null"),
			bad_entry("uses", r#"["files"]"#),
			bad_entry("network", r#"["localhost"]"#),
			bad_entry("repo", r#""808arc/meme-plugin", "path": "a/b""#),
			bad_entry("repo", r#""808arc/meme-plugin", "path": "..""#),
			bad_entry("repo", r#""808arc/meme-plugin", "path": ".memes""#),
			bad_entry("repo", r#""808arc/meme-plugin", "path": "Memes""#),
			bad_entry("repo", r#""808arc/meme-plugin", "path": "a\\b""#),
			bad_entry("repo", r#""808arc/meme-plugin", "path": """#),
			bad_entry("repo", r#""808arc/meme-plugin", "path": 3"#),
			bad_entry("repo", &format!(r#""808arc/meme-plugin", "path": "{}""#, "a".repeat(65))),
		];
		let later = MEMES.replace("v0.2.0", "v0.3.0");
		let quiz = MEMES.replace(r#""id": "memes""#, r#""id": "quiz""#);
		let mut entries: Vec<&str> = bad.iter().map(String::as_str).collect();
		entries.extend([MEMES, later.as_str(), quiz.as_str()]);
		let list = parse_list(&list_of(&entries));
		let kept: Vec<(&str, &str)> = list.items().iter().map(|e| (e["id"].str_or_empty(), e["tag"].str_or_empty())).collect();
		assert_eq!(kept, [("memes", "v0.2.0"), ("quiz", "v0.2.0")]);
	}

	#[tokio::test]
	async fn the_list_is_read_each_time_and_a_failed_read_keeps_the_last_one() {
		let root = crate::app::test_support::scratch_dir("plugin-list-read");
		let app = crate::app::test_support::test_app(&root);
		let file = root.join("plugins.json");
		read_list_from(&app, file.clone());
		assert_eq!(listed_plugins(&app).await, json!([]), "no file and nothing read before");
		gs_base::fsx::write_text_atomic(&file, &list_of(&[MEMES])).unwrap();
		assert_eq!(listed_plugins(&app).await[0]["tag"], json!("v0.2.0"));
		gs_base::fsx::write_text_atomic(&file, &list_of(&[&MEMES.replace("v0.2.0", "v0.3.0")])).unwrap();
		assert_eq!(listed_plugins(&app).await[0]["tag"], json!("v0.3.0"));
		std::fs::remove_file(&file).unwrap();
		assert_eq!(listed_plugins(&app).await[0]["tag"], json!("v0.3.0"));
		assert_eq!(listed_entry(&app, "memes").unwrap()["tag"], json!("v0.3.0"));
		gs_base::fsx::write_text_atomic(&file, "not json").unwrap();
		assert_eq!(listed_plugins(&app).await, json!([]));
		assert!(listed_entry(&app, "memes").is_none());
	}

	#[test]
	fn the_manifest_must_ask_for_what_was_reviewed() {
		let entry = parse_list(&list_of(&[MEMES]))[0].clone();
		let manifest = |over: Json| {
			let mut m = json!({ "id": "memes", "uses": ["agent"], "network": ["api.memegen.link"], "lesson": { "label": "Memes" }, "version": "9.9.9" });
			for (key, value) in over.as_obj().unwrap().iter() {
				m.as_obj_mut().unwrap().insert(key.as_str(), value.clone());
			}
			m
		};
		assert_eq!(same_as_reviewed(&entry, &manifest(json!({}))), Ok(()));
		for over in [json!({ "id": "memes-2" }), json!({ "uses": ["agent", "space"] }), json!({ "uses": [] }), json!({ "network": ["api.memegen.link", "evil.example.com"] }), json!({ "network": [] }), json!({ "space": { "label": "Memes" } }), json!({ "lesson": { "label": "Laughs" } }), json!({ "lesson": null })] {
			assert!(same_as_reviewed(&entry, &manifest(over.clone())).is_err(), "{over:?}");
		}
	}
}
