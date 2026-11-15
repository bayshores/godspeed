//! The installed plugins, one folder each in `<data>/plugins/<id>/`: listing them with their state,
//! reading one, finding a file to serve, and removing one.

use std::path::PathBuf;

use gs_base::locks::LockKey;
use gs_core::records::plugin_settings::is_plugin_id;
use gs_json::{Json, json};

use super::manifest::{is_inside_path, read_manifest};
use super::state::{forget_state, resolve_state, saved_entry};
use crate::App;
use crate::outcome::{Outcome, Stop, refuse};

pub fn plugins_root(app: &App) -> PathBuf {
	app.paths.data.join("plugins")
}

pub fn plugin_dir(app: &App, id: &str) -> PathBuf {
	plugins_root(app).join(id)
}

/// The app-file lock name that covers one plugin's folder.
pub fn plugin_lock(id: &str) -> String {
	format!("plugins/{id}")
}

const NO_SUCH_PLUGIN: &str = "No such plugin.";

/// The installed plugin's checked manifest; 404 when there is no such plugin or it doesn't load.
pub fn installed_manifest(app: &App, id: &str) -> Outcome<Json> {
	if !is_plugin_id(id) {
		return refuse(404, NO_SUCH_PLUGIN);
	}
	let manifest = read_manifest(&plugin_dir(app, id)).map_err(|_| Stop::Refuse(404, NO_SUCH_PLUGIN.to_owned()))?;
	if manifest["id"].as_str() != Some(id) {
		return refuse(404, NO_SUCH_PLUGIN);
	}
	Ok(manifest)
}

/// `{ id, folder, manifest, enabled, values }`.
pub fn plugin_view(app: &App, manifest: &Json) -> Result<Json, String> {
	let id = manifest["id"].str_or_empty();
	let (enabled, values) = resolve_state(manifest, &saved_entry(app, id)?);
	Ok(json!({ "id": id, "folder": plugin_dir(app, id).to_string_lossy(), "manifest": manifest, "enabled": enabled, "values": values }))
}

/// Every installed plugin by id; one that no longer loads is `{ id, folder, error }`, so it can
/// still be removed.
pub fn list_plugins(app: &App) -> Result<Json, String> {
	let Ok(entries) = std::fs::read_dir(plugins_root(app)) else { return Ok(json!([])) };
	let mut ids: Vec<String> = entries.filter_map(Result::ok).filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).filter_map(|e| e.file_name().to_str().map(str::to_owned)).filter(|id| is_plugin_id(id)).collect();
	ids.sort();
	let mut out = Vec::new();
	for id in ids {
		let dir = plugin_dir(app, &id);
		let checked = read_manifest(&dir).and_then(|m| if m["id"].as_str() == Some(id.as_str()) { Ok(m) } else { Err("manifest.json names another plugin.".to_owned()) });
		out.push(match checked {
			Ok(manifest) => plugin_view(app, &manifest)?,
			Err(error) => json!({ "id": id, "folder": dir.to_string_lossy(), "error": error }),
		});
	}
	Ok(Json::from(out))
}

/// The bytes of a file of a plugin that is on, with its manifest; None for anything else,
/// the data folder included.
pub async fn served_file(app: &App, id: &str, path: &str) -> Option<(Vec<u8>, Json)> {
	let manifest = installed_manifest(app, id).ok()?;
	if !is_inside_path(path) || !resolve_state(&manifest, &saved_entry(app, id).ok()?).0 {
		return None;
	}
	let file = plugin_dir(app, id).join(path);
	// Installs never write links; one put there by hand is not followed.
	if !tokio::fs::symlink_metadata(&file).await.ok()?.is_file() {
		return None;
	}
	Some((tokio::fs::read(&file).await.ok()?, manifest))
}

/// Deletes the plugin's folder, its stored JSON with it, and its settings.
pub fn remove_plugin(app: &App, id: &str) -> Outcome<()> {
	if !is_plugin_id(id) {
		return refuse(404, NO_SUCH_PLUGIN);
	}
	{
		let lock = plugin_lock(id);
		let _held = app.locks.lock(LockKey::AppFile(&lock));
		let dir = plugin_dir(app, id);
		if !dir.is_dir() {
			return refuse(404, NO_SUCH_PLUGIN);
		}
		std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
	}
	forget_state(app, id)?;
	Ok(())
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::plugins::state::set_state;
	use crate::plugins::test_plugin::install_test_plugin;

	#[tokio::test]
	async fn files_are_served_only_while_on_and_never_from_data() {
		let root = scratch_dir("plugin-served");
		let app = test_app(&root);
		let manifest = install_test_plugin(&app, &json!({}));
		std::fs::create_dir_all(plugin_dir(&app, "memes").join("data")).unwrap();
		gs_base::fsx::write_text_atomic(&plugin_dir(&app, "memes").join("data/score.json"), "1").unwrap();
		let (bytes, _) = served_file(&app, "memes", "index.html").await.unwrap();
		assert_eq!(bytes, b"<!doctype html>");
		for bad in ["data/score.json", "../memes/index.html", "manifest.json/..", "nope.html"] {
			assert!(served_file(&app, "memes", bad).await.is_none(), "{bad}");
		}
		set_state(&app, "memes", &manifest, &json!({ "enabled": false })).unwrap();
		assert!(served_file(&app, "memes", "index.html").await.is_none());
	}

	#[test]
	fn a_broken_plugin_is_listed_with_its_error_and_can_be_removed() {
		let root = scratch_dir("plugin-list");
		let app = test_app(&root);
		install_test_plugin(&app, &json!({}));
		std::fs::create_dir_all(plugins_root(&app).join("broken")).unwrap();
		std::fs::create_dir_all(plugins_root(&app).join(".staging-x")).unwrap();
		let list = list_plugins(&app).unwrap();
		assert_eq!(list.items().len(), 2);
		assert_eq!(list[0]["error"], json!("The folder has no manifest.json."));
		assert_eq!((list[1]["id"].as_str(), list[1]["enabled"].as_bool()), (Some("memes"), Some(true)));
		remove_plugin(&app, "broken").unwrap();
		remove_plugin(&app, "memes").unwrap();
		assert_eq!(list_plugins(&app).unwrap(), json!([]));
		assert_eq!(remove_plugin(&app, "memes"), Err(Stop::Refuse(404, NO_SUCH_PLUGIN.to_owned())));
	}
}
