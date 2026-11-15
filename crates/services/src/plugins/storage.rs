//! A plugin's own JSON, one file per key in `<data>/plugins/<id>/data/`. A key is a short name of
//! letters, digits, `_` and `-`, so it can only ever name a file in that folder.

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use gs_base::fsx;
use gs_base::locks::LockKey;
use gs_base::re::Re;
use gs_json::{Json, stringify};

use super::installed::{installed_manifest, plugin_dir, plugin_lock};
use super::manifest::{DATA_FOLDER, MANIFEST_FILE};
use crate::App;
use crate::outcome::{Outcome, refuse};

/// The most one stored value may take.
const VALUE_MAX_BYTES: usize = 1024 * 1024;

fn is_storage_key(key: &str) -> bool {
	static SHAPE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[A-Za-z0-9_-]{1,64}$", ""));
	SHAPE.test(key)
}

/// The key's file, or None for a key that isn't one.
fn key_file(plugin: &Path, key: &str) -> Option<PathBuf> {
	let folder = plugin.join(DATA_FOLDER);
	let file = folder.join(format!("{key}.json"));
	(is_storage_key(key) && file.parent() == Some(folder.as_path())).then_some(file)
}

fn file_for(app: &App, id: &str, key: &str) -> Outcome<PathBuf> {
	installed_manifest(app, id)?;
	match key_file(&plugin_dir(app, id), key) {
		Some(file) => Ok(file),
		None => refuse(400, "A key is 1 to 64 letters, digits, _ or -."),
	}
}

/// The value stored under the key, null when nothing is.
pub fn storage_get(app: &App, id: &str, key: &str) -> Outcome<Json> {
	let file = file_for(app, id, key)?;
	Ok(fsx::read_json_or_set_aside(&file).unwrap_or(Json::Null))
}

pub fn storage_set(app: &App, id: &str, key: &str, value: &Json) -> Outcome<()> {
	let file = file_for(app, id, key)?;
	if stringify(value).len() > VALUE_MAX_BYTES {
		return refuse(413, "A stored value can be at most 1 MB.");
	}
	// Held so an install or a remove of the plugin never swaps the folder mid-write; a plugin
	// removed meanwhile must not get its folder back.
	let lock = plugin_lock(id);
	let _held = app.locks.lock(LockKey::AppFile(&lock));
	if !plugin_dir(app, id).join(MANIFEST_FILE).is_file() {
		return refuse(404, "No such plugin.");
	}
	fsx::write_json_atomic(&file, value)?;
	Ok(())
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::outcome::Stop;
	use crate::plugins::test_plugin::install_test_plugin;

	#[test]
	fn keys_stay_inside_the_data_folder() {
		let plugin = Path::new("/d/plugins/memes");
		assert_eq!(key_file(plugin, "best-score_2"), Some(PathBuf::from("/d/plugins/memes/data/best-score_2.json")));
		for bad in ["", "..", "../x", "a/b", "a\\b", ".hidden", "a.b", "%2e%2e", "a\0", &"k".repeat(65)] {
			assert_eq!(key_file(plugin, bad), None, "{bad:?}");
		}
	}

	#[test]
	fn a_value_round_trips_and_bad_keys_and_plugins_are_refused() {
		let root = scratch_dir("plugin-storage");
		let app = test_app(&root);
		install_test_plugin(&app, &json!({}));
		assert_eq!(storage_get(&app, "memes", "score"), Ok(Json::Null));
		storage_set(&app, "memes", "score", &json!({ "best": 4 })).unwrap();
		assert_eq!(storage_get(&app, "memes", "score"), Ok(json!({ "best": 4 })));
		assert!(plugin_dir(&app, "memes").join("data/score.json").is_file());
		assert_eq!(storage_set(&app, "memes", "../manifest", &json!(1)), Err(Stop::Refuse(400, "A key is 1 to 64 letters, digits, _ or -.".to_owned())));
		assert_eq!(storage_get(&app, "nope", "score"), Err(Stop::Refuse(404, "No such plugin.".to_owned())));
		assert_eq!(storage_set(&app, "memes", "big", &json!("x".repeat(VALUE_MAX_BYTES))), Err(Stop::Refuse(413, "A stored value can be at most 1 MB.".to_owned())));
	}
}
