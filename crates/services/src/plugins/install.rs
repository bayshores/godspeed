//! Installing a plugin: its files go into a staging folder (copied from a folder, or unpacked from
//! the zip of a listed tag), the manifest is checked there, and only then does the folder take the
//! plugin's place. Reinstalling keeps the plugin's stored JSON and settings.

use std::path::{Path, PathBuf};

use gs_base::locks::LockKey;
use gs_base::{fsx, ids};
use gs_files::zipfile::Zip;
use gs_json::{Json, json};

use super::installed::{SOURCE_FILE, plugin_dir, plugin_lock, plugin_view, plugins_root};
use super::list::{listed_entry, same_as_reviewed};
use super::manifest::{DATA_FOLDER, is_inside_path, read_manifest};
use crate::App;
use crate::outcome::{Outcome, Stop, refuse};

/// The most files and bytes one plugin may unpack to, and the largest zip godspeed downloads.
const MAX_FILES: usize = 1000;
const MAX_BYTES: u64 = 20 * 1024 * 1024;
const MAX_ZIP_BYTES: usize = 20 * 1024 * 1024;

const NOT_A_ZIP: &str = "That isn't a zip file.";

/// What one plugin has unpacked so far, against the caps.
#[derive(Default)]
struct Budget {
	files: usize,
	bytes: u64,
}

impl Budget {
	fn take(&mut self, size: u64) -> Result<(), String> {
		self.files += 1;
		self.bytes += size;
		if self.files > MAX_FILES {
			return Err(format!("A plugin can have at most {MAX_FILES} files."));
		}
		if self.bytes > MAX_BYTES {
			return Err("A plugin can be at most 20 MB.".to_owned());
		}
		Ok(())
	}
}

/// A staging folder that is deleted unless the install moved it into place.
struct Staging(PathBuf);

impl Drop for Staging {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.0);
	}
}

fn staging(app: &App) -> Result<Staging, String> {
	let dir = plugins_root(app).join(format!(".staging-{}", ids::uuid()));
	std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
	Ok(Staging(dir))
}

fn refused(problem: String) -> Stop {
	Stop::Refuse(400, problem)
}

fn write_file(dir: &Path, path: &str, bytes: &[u8]) -> Result<(), String> {
	fsx::write_atomic(&dir.join(path), bytes, None).map_err(|e| e.to_string())
}

/// Copies `src` into `dst`, sorted, leaving out hidden files and folders. A link is refused, so
/// nothing outside the folder comes along.
fn copy_folder(src: &Path, dst: &Path, prefix: &str, budget: &mut Budget) -> Result<(), String> {
	let mut entries: Vec<_> = std::fs::read_dir(src).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
	entries.sort_by_key(|e| e.file_name());
	for entry in entries {
		let Some(name) = entry.file_name().to_str().map(str::to_owned) else { return Err("A file name in the folder isn't text.".to_owned()) };
		if name.starts_with('.') {
			continue;
		}
		let path = format!("{prefix}{name}");
		if !is_inside_path(&path) {
			return Err(format!("The plugin can't have a file or folder named {path}."));
		}
		let kind = entry.file_type().map_err(|e| e.to_string())?;
		if kind.is_symlink() {
			return Err(format!("{path} is a link. Copy the file into the folder instead."));
		}
		if kind.is_dir() {
			copy_folder(&entry.path(), dst, &format!("{path}/"), budget)?;
		} else if kind.is_file() {
			budget.take(entry.metadata().map_err(|e| e.to_string())?.len())?;
			write_file(dst, &path, &std::fs::read(entry.path()).map_err(|e| e.to_string())?)?;
		}
	}
	Ok(())
}

/// The one folder every entry sits in, as GitHub's zips have it, or "".
fn common_folder<'a>(names: &[&'a str]) -> &'a str {
	let Some(first) = names.first().and_then(|n| n.split_once('/')).map(|(head, _)| head) else { return "" };
	if names.iter().all(|n| n.split_once('/').is_some_and(|(head, _)| head == first)) { first } else { "" }
}

/// Unpacks the zip's files into `dst`, without its one top folder. A name that would land outside
/// (`..`, a root, a drive, a backslash) refuses the whole zip; hidden files are left out.
fn unpack_zip(bytes: Vec<u8>, dst: &Path) -> Result<(), String> {
	let zip = Zip::open(bytes, NOT_A_ZIP)?;
	let names: Vec<&str> = zip.names().collect();
	let top = common_folder(&names);
	let mut budget = Budget::default();
	for name in &names {
		let inner = if top.is_empty() { *name } else { &name[top.len() + 1..] };
		let hidden = inner.split('/').any(|part| part.starts_with('.') && part != "." && part != "..");
		if inner.is_empty() || inner.ends_with('/') || hidden {
			continue;
		}
		if !is_inside_path(inner) {
			return Err(format!("The zip has a file that would land outside the plugin's folder: {name}"));
		}
		let data = zip.read(name)?.unwrap_or_default();
		budget.take(data.len() as u64)?;
		write_file(dst, inner, &data)?;
	}
	Ok(())
}

/// The staged plugin takes the place of the installed one, keeping its data folder.
fn finish(app: &App, staged: Staging) -> Outcome<Json> {
	let manifest = read_manifest(&staged.0).map_err(refused)?;
	let id = manifest["id"].str_or_empty();
	let lock = plugin_lock(id);
	let held = app.locks.lock(LockKey::AppFile(&lock));
	let dir = plugin_dir(app, id);
	let old = plugins_root(app).join(format!(".old-{}", ids::uuid()));
	let io = |e: std::io::Error| Stop::Throw(e.to_string());
	// On any failure the stored JSON goes back, since the staging folder is deleted.
	let give_back = || std::fs::rename(staged.0.join(DATA_FOLDER), dir.join(DATA_FOLDER));
	if dir.exists() {
		if dir.join(DATA_FOLDER).exists() {
			std::fs::rename(dir.join(DATA_FOLDER), staged.0.join(DATA_FOLDER)).map_err(io)?;
		}
		if let Err(err) = std::fs::rename(&dir, &old) {
			let _ = give_back();
			return Err(io(err));
		}
	}
	if let Err(err) = std::fs::rename(&staged.0, &dir) {
		let _ = std::fs::rename(&old, &dir);
		let _ = give_back();
		return Err(io(err));
	}
	let _ = std::fs::remove_dir_all(&old);
	drop(held);
	Ok(plugin_view(app, &manifest)?)
}

/// Installs a copy of the plugin in a local folder (for plugin authors).
pub fn install_from_folder(app: &App, folder: &str) -> Outcome<Json> {
	let src = Path::new(folder);
	if !src.is_absolute() || !src.is_dir() {
		return refuse(400, "Pick a folder that holds a plugin.");
	}
	// Checked before copying, so a wrong folder fails at once.
	read_manifest(src).map_err(refused)?;
	let staged = staging(app)?;
	copy_folder(src, &staged.0, "", &mut Budget::default()).map_err(refused)?;
	finish(app, staged)
}

/// Installs the listed plugin in a zip of its tag. Its manifest must have what the entry was
/// reviewed with, and the entry's repo and tag are kept beside the plugin.
fn install_listed_zip(app: &App, entry: &Json, bytes: Vec<u8>) -> Outcome<Json> {
	let staged = staging(app)?;
	unpack_zip(bytes, &staged.0).map_err(refused)?;
	let manifest = read_manifest(&staged.0).map_err(refused)?;
	same_as_reviewed(entry, &manifest).map_err(refused)?;
	fsx::write_json_atomic(&staged.0.join(SOURCE_FILE), &json!({ "repo": entry["repo"], "tag": entry["tag"] }))?;
	finish(app, staged)
}

/// Installs, or updates, the plugin godspeed's list names `id`, from the zip GitHub makes for the
/// listed tag.
pub async fn install_from_list(app: &App, id: &str) -> Outcome<Json> {
	let Some(entry) = listed_entry(app, id).await else { return refuse(404, "That plugin isn't on godspeed's list.") };
	let (owner, repo) = entry["repo"].str_or_empty().split_once('/').unwrap_or_default();
	let url = gs_web::zip_download::tag_zip_url(owner, repo, entry["tag"].str_or_empty());
	let bytes = gs_web::zip_download::download_zip(&url, MAX_ZIP_BYTES).await.map_err(|e| Stop::Refuse(502, format!("Couldn't download the plugin: {e}")))?;
	install_listed_zip(app, &entry, bytes)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::plugins::installed::list_plugins;
	use crate::plugins::list::keep_list;
	use crate::plugins::state::set_state;
	use crate::plugins::storage::{storage_get, storage_set};
	use crate::plugins::test_plugin::{manifest_text, zip_of};

	/// The list's entry for the test plugin at `tag`.
	fn entry(tag: &str) -> Json {
		json!({ "id": "memes", "repo": "808arc/meme-plugin", "tag": tag, "name": "Memes", "description": "Turns the question into a meme.", "lesson": { "label": "Memes" }, "network": ["api.memegen.link"], "uses": ["agent"] })
	}

	fn install_zip(app: &App, bytes: Vec<u8>) -> Outcome<Json> {
		install_listed_zip(app, &entry("v0.2.0"), bytes)
	}

	fn plugin_zip(overrides: &Json, page: &[u8]) -> Vec<u8> {
		zip_of(&[("manifest.json", manifest_text(overrides).as_bytes()), ("index.html", page)])
	}

	fn refusal(outcome: Outcome<Json>) -> String {
		match outcome {
			Err(Stop::Refuse(400, message)) => message,
			other => panic!("{other:?}"),
		}
	}

	#[test]
	fn a_github_zip_unpacks_without_its_top_folder_or_hidden_files() {
		let root = scratch_dir("plugin-zip");
		let app = test_app(&root);
		let manifest = manifest_text(&json!({}));
		let zip = zip_of(&[("meme-plugin-0.2.0/", b""), ("meme-plugin-0.2.0/manifest.json", manifest.as_bytes()), ("meme-plugin-0.2.0/index.html", b"<!doctype html>"), ("meme-plugin-0.2.0/.github/x.yml", b"x"), ("meme-plugin-0.2.0/js/app.js", b"go()")]);
		let view = install_zip(&app, zip).unwrap();
		assert_eq!(view["id"], json!("memes"));
		let dir = plugin_dir(&app, "memes");
		assert!(dir.join("js/app.js").is_file() && !dir.join(".github").exists());
		let left: Vec<_> = std::fs::read_dir(plugins_root(&app)).unwrap().map(|e| e.unwrap().file_name()).collect();
		assert_eq!(left, ["memes"]);
	}

	#[test]
	fn zip_slip_is_refused_and_nothing_is_kept() {
		let root = scratch_dir("plugin-zip-slip");
		let app = test_app(&root);
		let manifest = manifest_text(&json!({}));
		for evil in ["../evil.js", "/tmp/evil.js", "a/../../evil.js", "./evil.js", "C:/evil.js", "a\\..\\evil.js", "data/score.json"] {
			let zip = zip_of(&[("manifest.json", manifest.as_bytes()), ("index.html", b"<!doctype html>"), (evil, b"x")]);
			assert!(refusal(install_zip(&app, zip)).starts_with("The zip has a file that would land outside"), "{evil}");
		}
		assert!(!root.join("data/evil.js").exists() && !root.join("evil.js").exists());
		assert_eq!(std::fs::read_dir(plugins_root(&app)).unwrap().count(), 0);
		assert_eq!(refusal(install_zip(&app, b"not a zip".to_vec())), NOT_A_ZIP);
		let no_manifest = zip_of(&[("index.html", b"x")]);
		assert_eq!(refusal(install_zip(&app, no_manifest)), "The folder has no manifest.json.");
	}

	#[test]
	fn a_zip_that_unpacks_too_large_is_refused() {
		let root = scratch_dir("plugin-zip-big");
		let app = test_app(&root);
		let manifest = manifest_text(&json!({}));
		let big = vec![0u8; 11 * 1024 * 1024];
		let zip = zip_of(&[("manifest.json", manifest.as_bytes()), ("index.html", b"x"), ("a.bin", &big), ("b.bin", &big)]);
		assert_eq!(refusal(install_zip(&app, zip)), "A plugin can be at most 20 MB.");
	}

	#[test]
	fn a_folder_copy_leaves_out_hidden_files_refuses_links_and_keeps_data_on_reinstall() {
		let root = scratch_dir("plugin-folder");
		let app = test_app(&root);
		let src = root.join("src");
		gs_base::fsx::write_text_atomic(&src.join("manifest.json"), &manifest_text(&json!({}))).unwrap();
		gs_base::fsx::write_text_atomic(&src.join("index.html"), "v1").unwrap();
		gs_base::fsx::write_text_atomic(&src.join(".git/HEAD"), "x").unwrap();
		install_from_folder(&app, src.to_str().unwrap()).unwrap();
		storage_set(&app, "memes", "score", &json!(7)).unwrap();
		gs_base::fsx::write_text_atomic(&src.join("index.html"), "v2").unwrap();
		install_from_folder(&app, src.to_str().unwrap()).unwrap();
		let dir = plugin_dir(&app, "memes");
		assert_eq!(std::fs::read_to_string(dir.join("index.html")).unwrap(), "v2");
		assert!(!dir.join(".git").exists());
		assert_eq!(storage_get(&app, "memes", "score"), Ok(json!(7)));
		#[cfg(unix)]
		{
			std::os::unix::fs::symlink("/etc/hosts", src.join("hosts")).unwrap();
			assert_eq!(refusal(install_from_folder(&app, src.to_str().unwrap())), "hosts is a link. Copy the file into the folder instead.");
		}
		std::fs::create_dir_all(src.join("data")).unwrap();
		assert_eq!(refusal(install_from_folder(&app, src.to_str().unwrap())), "The plugin can't have a file or folder named data.");
		assert_eq!(refusal(install_from_folder(&app, "relative/path")), "Pick a folder that holds a plugin.");
	}

	#[test]
	fn a_tag_that_asks_for_more_than_the_list_checked_is_refused_and_nothing_is_kept() {
		let root = scratch_dir("plugin-reviewed");
		let app = test_app(&root);
		for over in [json!({ "uses": ["agent", "space"] }), json!({ "network": ["api.memegen.link", "evil.example.com"] }), json!({ "id": "other" })] {
			assert_eq!(refusal(install_zip(&app, plugin_zip(&over, b"x"))), "This tag of the plugin isn't what godspeed's list checked.", "{over:?}");
		}
		assert_eq!(std::fs::read_dir(plugins_root(&app)).unwrap().count(), 0);
		install_zip(&app, plugin_zip(&json!({}), b"v1")).unwrap();
		refusal(install_listed_zip(&app, &entry("v0.3.0"), plugin_zip(&json!({ "uses": ["agent", "space"] }), b"v2")));
		assert_eq!(std::fs::read_to_string(plugin_dir(&app, "memes").join("index.html")).unwrap(), "v1");
		assert_eq!(list_plugins(&app).unwrap()[0]["source"], json!({ "repo": "808arc/meme-plugin", "tag": "v0.2.0" }));
	}

	#[test]
	fn an_update_keeps_the_switch_the_values_and_the_stored_data() {
		let root = scratch_dir("plugin-update");
		let app = test_app(&root);
		let settings = json!({ "settings": [{ "key": "loud", "label": "Loud", "kind": "toggle", "default": false }] });
		let manifest = install_zip(&app, plugin_zip(&settings, b"v1")).unwrap()["manifest"].clone();
		set_state(&app, "memes", &manifest, &json!({ "enabled": false, "values": { "loud": true } })).unwrap();
		storage_set(&app, "memes", "score", &json!(7)).unwrap();
		let view = install_listed_zip(&app, &entry("v0.3.0"), plugin_zip(&settings, b"v2")).unwrap();
		assert_eq!(std::fs::read_to_string(plugin_dir(&app, "memes").join("index.html")).unwrap(), "v2");
		assert_eq!((view["enabled"].clone(), view["values"].clone(), view["source"]["tag"].clone()), (json!(false), json!({ "loud": true }), json!("v0.3.0")));
		assert_eq!(storage_get(&app, "memes", "score"), Ok(json!(7)));
	}

	#[test]
	fn a_folder_install_forgets_that_the_plugin_came_from_the_list() {
		let root = scratch_dir("plugin-source");
		let app = test_app(&root);
		install_zip(&app, plugin_zip(&json!({}), b"v1")).unwrap();
		let src = root.join("src");
		gs_base::fsx::write_text_atomic(&src.join("manifest.json"), &manifest_text(&json!({}))).unwrap();
		gs_base::fsx::write_text_atomic(&src.join("index.html"), "mine").unwrap();
		assert!(install_from_folder(&app, src.to_str().unwrap()).unwrap().get("source").is_none());
		assert!(!plugin_dir(&app, "memes").join(SOURCE_FILE).exists());
	}

	#[tokio::test]
	async fn only_a_plugin_on_the_list_can_be_installed_from_it() {
		let root = scratch_dir("plugin-not-listed");
		let app = test_app(&root);
		keep_list(&app, &format!(r#"{{ "version": 1, "plugins": [{}] }}"#, gs_json::stringify(&entry("v0.2.0"))));
		assert_eq!(install_from_list(&app, "other").await, Err(Stop::Refuse(404, "That plugin isn't on godspeed's list.".to_owned())));
	}
}
