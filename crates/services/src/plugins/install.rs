//! Installing a plugin: its files go into a staging folder (copied from a folder, or unpacked from
//! a zip), the manifest is checked there, and only then does the folder take the plugin's place.
//! Reinstalling keeps the plugin's stored JSON and settings.

use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};

use gs_base::locks::LockKey;
use gs_base::re::Re;
use gs_base::{fsx, ids};
use gs_files::zipfile::Zip;
use gs_json::Json;

use super::installed::{plugin_dir, plugin_lock, plugin_view, plugins_root};
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

/// Installs the plugin in a zip.
pub fn install_from_zip(app: &App, bytes: Vec<u8>) -> Outcome<Json> {
	let staged = staging(app)?;
	unpack_zip(bytes, &staged.0).map_err(refused)?;
	finish(app, staged)
}

/// Installs one tag of a GitHub repository, from the zip GitHub makes for it.
pub async fn install_from_github(app: &Arc<App>, owner: &str, repo: &str, tag: &str) -> Outcome<Json> {
	static OWNER: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$", ""));
	static NAME: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[A-Za-z0-9_][A-Za-z0-9._+-]{0,99}$", ""));
	if !OWNER.test(owner) || !NAME.test(repo) || !NAME.test(tag) {
		return refuse(400, "Give the plugin's GitHub owner, repository and tag.");
	}
	let url = gs_web::zip_download::tag_zip_url(owner, repo, tag);
	let bytes = gs_web::zip_download::download_zip(&url, MAX_ZIP_BYTES).await.map_err(|e| Stop::Refuse(502, format!("Couldn't download the plugin: {e}")))?;
	install_from_zip(app, bytes)
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::plugins::storage::{storage_get, storage_set};
	use crate::plugins::test_plugin::{manifest_text, zip_of};

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
		let view = install_from_zip(&app, zip).unwrap();
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
			assert!(refusal(install_from_zip(&app, zip)).starts_with("The zip has a file that would land outside"), "{evil}");
		}
		assert!(!root.join("data/evil.js").exists() && !root.join("evil.js").exists());
		assert_eq!(std::fs::read_dir(plugins_root(&app)).unwrap().count(), 0);
		assert_eq!(refusal(install_from_zip(&app, b"not a zip".to_vec())), NOT_A_ZIP);
		let no_manifest = zip_of(&[("index.html", b"x")]);
		assert_eq!(refusal(install_from_zip(&app, no_manifest)), "The folder has no manifest.json.");
	}

	#[test]
	fn a_zip_that_unpacks_too_large_is_refused() {
		let root = scratch_dir("plugin-zip-big");
		let app = test_app(&root);
		let manifest = manifest_text(&json!({}));
		let big = vec![0u8; 11 * 1024 * 1024];
		let zip = zip_of(&[("manifest.json", manifest.as_bytes()), ("index.html", b"x"), ("a.bin", &big), ("b.bin", &big)]);
		assert_eq!(refusal(install_from_zip(&app, zip)), "A plugin can be at most 20 MB.");
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

	#[tokio::test]
	async fn github_names_are_checked_before_any_download() {
		let root = scratch_dir("plugin-github");
		let app = test_app(&root);
		for (owner, repo, tag) in [("../x", "r", "v1"), ("o", "..", "v1"), ("o", "r", "v1/../../x"), ("o", "r", ""), ("o", "r", "v1?x")] {
			assert_eq!(install_from_github(&app, owner, repo, tag).await, Err(Stop::Refuse(400, "Give the plugin's GitHub owner, repository and tag.".to_owned())), "{owner} {repo} {tag}");
		}
	}
}
