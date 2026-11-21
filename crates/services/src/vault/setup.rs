//! The vault setting and its state for Settings: the folder, who writes "My words", whether
//! Obsidian knows the folder, and whether the folder can be read now.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use gs_base::fsx;
use gs_core::records::settings::resolve_vault;
use gs_core::spaces::agent_folder::short_folder;
use gs_core::vault::obsidian::vault_paths;
use gs_json::{Json, json};

use super::{VaultError, maintain, notes_changed, rescan, with_reader};
use crate::App;
use crate::app::vault_settings::set_vault_field;

pub struct Setting {
	pub path: Option<String>,
	pub words: &'static str,
}

pub fn setting(app: &App) -> Result<Setting, String> {
	let record = app.stores.settings.read_settings()?;
	let (path, words) = resolve_vault(record.as_ref());
	Ok(Setting { path, words })
}

/// Where Obsidian keeps its list of vaults.
fn obsidian_list(home: &Path) -> PathBuf {
	if cfg!(target_os = "macos") {
		home.join("Library/Application Support/obsidian/obsidian.json")
	} else if cfg!(windows) {
		std::env::var_os("APPDATA").map_or_else(|| home.join("AppData/Roaming"), PathBuf::from).join("obsidian/obsidian.json")
	} else {
		home.join(".config/obsidian/obsidian.json")
	}
}

/// The vaults Obsidian lists, newest first. A missing or unreadable list is an empty one: the
/// learner can still type or pick a folder.
fn listed_vaults(home: &Path) -> Vec<String> {
	fsx::read_text(&obsidian_list(home)).ok().and_then(|text| vault_paths(&text).ok()).unwrap_or_default()
}

fn same_folder(a: &str, b: &str) -> bool {
	a.trim_end_matches(['/', '\\']) == b.trim_end_matches(['/', '\\'])
}

/// A folder as Settings names it: `{path, name, short, parent}`, `short` and `parent` with the
/// home folder as `~`.
fn folder_view(path: &str, home: &str) -> Json {
	let folder = Path::new(path.trim_end_matches(['/', '\\']));
	let name = folder.file_name().map_or_else(|| path.to_owned(), |name| name.to_string_lossy().into_owned());
	let parent = folder.parent().map_or_else(String::new, |parent| short_folder(&parent.to_string_lossy(), home));
	json!({ "path": path, "name": name, "short": short_folder(path, home), "parent": parent })
}

/// What Settings shows: `{folder, words, obsidian, vaults, notes, capped, state, waiting, message?}`.
/// `folder` is the picked folder (`folder_view`) or null; `vaults` are the ones Obsidian lists.
/// `state` is "none" without a folder, "ok", "missing" or "failed". `obsidian`: the folder is one
/// of the listed vaults or holds `.obsidian`. `waiting` is `{count, why}` while notes wait for a
/// folder that is missing or a disk that refused them, else null.
pub fn vault_status(app: &App) -> Result<Json, String> {
	let setting = setting(app)?;
	let home = app.paths.home.to_string_lossy().into_owned();
	let listed = listed_vaults(&app.paths.home);
	let vaults: Vec<Json> = listed.iter().map(|vault| folder_view(vault, &home)).collect();
	let Some(path) = setting.path else {
		return Ok(json!({ "folder": null, "words": setting.words, "obsidian": false, "vaults": vaults, "notes": 0, "capped": false, "state": "none", "waiting": null }));
	};
	let obsidian = listed.iter().any(|v| same_folder(v, &path)) || Path::new(&path).join(".obsidian").is_dir();
	let (state, message) = match rescan(app) {
		Ok(_) => ("ok", None),
		Err(err @ VaultError::Missing) => ("missing", Some(err.message())),
		Err(err) => ("failed", Some(err.message())),
	};
	let (notes, capped) = with_reader(app, |reader| (reader.len(), reader.capped)).unwrap_or((0, false));
	let mut out = json!({ "folder": folder_view(&path, &home), "words": setting.words, "obsidian": obsidian, "vaults": vaults, "notes": notes, "capped": capped, "state": state, "waiting": waiting_view(app, state == "missing", obsidian) });
	if let (Some(message), Some(fields)) = (message, out.as_obj_mut()) {
		fields.insert("message", message);
	}
	Ok(out)
}

fn waiting_view(app: &App, missing: bool, obsidian: bool) -> Json {
	let record = app.stores.vault_notes.read();
	let waiting: Vec<&Json> = record["notes"].as_obj().into_iter().flatten().map(|(_, note)| note).filter(|note| !note["pending"].is_null()).collect();
	let missing_line = if obsidian { "Can't find this vault." } else { "Can't find this folder." };
	let why = if missing { Some(missing_line) } else { waiting.iter().find_map(|note| note["failure"].as_str()) };
	match why {
		Some(why) if !waiting.is_empty() => json!({ "why": why, "names": waiting.iter().filter_map(|note| note["title"].as_str()).collect::<Vec<_>>() }),
		_ => Json::Null,
	}
}

/// Changes the vault setting one field at a time: `path` (a folder, or null to unlink) and
/// `words`. Answers the new state.
pub fn change_vault(app: &Arc<App>, body: &Json) -> Result<Json, String> {
	let fields = body.as_obj().ok_or("Send an object with path or words.")?;
	if fields.is_empty() || fields.keys().any(|key| key != "path" && key != "words") {
		return Err("Send path, words or both.".to_owned());
	}
	for (key, value) in fields.iter() {
		if let Some(folder) = value.as_str().filter(|_| key == "path")
			&& !Path::new(folder).is_dir()
		{
			return Err("That folder does not exist.".to_owned());
		}
		set_vault_field(app, key, value.clone())?;
	}
	if fields.get("path").is_some() {
		app.vault.reader.lock().take();
	}
	notes_changed(app);
	vault_status(app)
}

/// "Try again" after a missing or failed vault: rereads it and writes the notes that waited.
pub fn retry_vault(app: &App) -> Result<Json, String> {
	maintain::minute_check(app);
	vault_status(app)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn the_list_is_read_from_obsidians_own_file_and_a_bad_one_is_empty() {
		let root = scratch_dir("vault-list");
		let list = obsidian_list(&root.join("home"));
		std::fs::create_dir_all(list.parent().unwrap()).unwrap();
		assert!(listed_vaults(&root.join("home")).is_empty());
		fsx::write_text_atomic(&list, r#"{"vaults":{"a":{"path":"/Users/me/Notes","ts":2},"b":{"path":"/Users/me/Old","ts":1}}}"#).unwrap();
		assert_eq!(listed_vaults(&root.join("home")), ["/Users/me/Notes", "/Users/me/Old"]);
		fsx::write_text_atomic(&list, "not json").unwrap();
		assert!(listed_vaults(&root.join("home")).is_empty());
	}

	#[test]
	fn status_follows_the_setting_and_the_folder() {
		let root = scratch_dir("vault-status");
		let app = test_app(&root);
		assert_eq!(vault_status(&app).unwrap()["state"].as_str(), Some("none"));
		let vault = root.join("Notes");
		std::fs::create_dir_all(vault.join(".obsidian")).unwrap();
		fsx::write_text_atomic(&vault.join("A.md"), "alpha").unwrap();
		let status = change_vault(&app, &json!({ "path": vault.to_string_lossy() })).unwrap();
		assert_eq!((status["state"].as_str(), status["notes"].as_i64(), status["obsidian"].as_bool(), status["words"].as_str()), (Some("ok"), Some(1), Some(true), Some("teacher")));
		assert_eq!(status["folder"]["name"].as_str(), Some("Notes"));
		assert_eq!(status["folder"]["parent"].as_str(), Some(root.to_string_lossy().as_ref()), "a folder outside the home folder keeps its full parent");
		let status = change_vault(&app, &json!({ "words": "mine" })).unwrap();
		assert_eq!(status["words"].as_str(), Some("mine"));
		assert_eq!(status["folder"]["path"].as_str(), Some(vault.to_string_lossy().as_ref()), "one field at a time");
		std::fs::remove_dir_all(&vault).unwrap();
		let status = vault_status(&app).unwrap();
		assert_eq!(status["state"].as_str(), Some("missing"));
		assert!(status["message"].as_str().is_some());
		let status = change_vault(&app, &json!({ "path": null })).unwrap();
		assert_eq!((status["state"].as_str(), status["folder"].is_null()), (Some("none"), true));
	}

	#[test]
	fn a_folder_that_is_not_there_or_a_stray_field_is_refused() {
		let root = scratch_dir("vault-change-refused");
		let app = test_app(&root);
		assert_eq!(change_vault(&app, &json!({ "path": root.join("nope").to_string_lossy() })).unwrap_err(), "That folder does not exist.");
		assert!(change_vault(&app, &json!({ "color": "red" })).is_err());
		assert!(change_vault(&app, &json!({})).is_err());
		assert!(change_vault(&app, &json!({ "words": "nobody" })).is_err());
		assert_eq!(vault_status(&app).unwrap()["state"].as_str(), Some("none"));
	}
}
