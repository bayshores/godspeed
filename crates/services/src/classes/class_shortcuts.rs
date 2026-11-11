//! The godspeed folder's classes/ (class-shortcuts.ts): shortcuts to every class file, so the
//! learner (and their agent) can find them next to CLAUDE.md. Where each one goes is
//! gs_core::classes::class_shortcuts. A manifest in .godspeed/shortcuts.json lists what this made,
//! and a sync only ever removes those, so anything else in classes/ is left alone. Copies in the
//! app's data folder are made read-only on macOS and Linux (deleting them still works, since that
//! depends on the folder, not the file). Windows makes a hard link where a symlink is refused.

use std::collections::HashMap;
use std::path::{MAIN_SEPARATOR, Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::Ordering;

use gs_base::events::EventKind;
use gs_base::{clock, fsx, text};
use gs_core::classes::class_shortcuts::{README_NAME, readme_text, shortcut_layout};
use gs_json::{Json, Obj, json, parse, stringify_pretty};

use super::class_card::class_file_path;
use super::files::{files_of, str_of};
use crate::App;

/// How long after the last class change a sync waits (a burst of changes syncs once).
const SYNC_DELAY_MS: i64 = 2000;

fn manifest_path(folder: &Path) -> PathBuf {
	folder.join(".godspeed").join("shortcuts.json")
}

/// The links (`{ path, target, ino? }`, kept as read) and folders the last sync made.
fn read_manifest(folder: &Path) -> (Vec<Json>, Vec<String>) {
	let Some(m) = fsx::read_text(&manifest_path(folder)).ok().and_then(|t| parse(&t).ok()) else { return (Vec::new(), Vec::new()) };
	let links = m["links"].as_arr().cloned().unwrap_or_default();
	let dirs = m["dirs"].as_arr().map(|d| d.iter().map(|v| v.as_str().unwrap_or("").to_owned()).collect()).unwrap_or_default();
	(links, dirs)
}

fn path_of(made: &Json) -> &str {
	made["path"].as_str().unwrap_or("")
}

/// Still the link this made (not something the learner put there since).
fn still_ours(made: &Json) -> bool {
	let Ok(st) = std::fs::symlink_metadata(path_of(made)) else { return false };
	if st.file_type().is_symlink() {
		return true;
	}
	made["ino"].as_f64().is_some_and(|ino| st.is_file() && ino_of(Path::new(path_of(made))) == Some(ino))
}

/// A hard link whose target was replaced (an edited linked file) is stale.
fn up_to_date(made: &Json) -> Result<bool, String> {
	let target = made["target"].as_str().unwrap_or("");
	match made["ino"].as_f64() {
		None => {
			let at = Path::new(path_of(made));
			let link = std::fs::read_link(at).map_err(|err| fsx::node_error_message(&err, "readlink", at))?;
			// Windows keeps the long-path prefix on targets over 260 characters.
			Ok(fsx::without_long_prefix(link).to_string_lossy() == target)
		}
		Some(ino) => Ok(ino_of(Path::new(target)) == Some(ino)),
	}
}

/// `fs.statSync(file).ino`, the number a hard link shares with its target.
#[cfg(unix)]
fn ino_of(file: &Path) -> Option<f64> {
	use std::os::unix::fs::MetadataExt;
	std::fs::metadata(file).ok().map(|st| st.ino() as f64)
}

#[cfg(windows)]
fn ino_of(file: &Path) -> Option<f64> {
	match file_id::get_low_res_file_id(file) {
		Ok(file_id::FileId::LowRes { file_index, .. }) => Some(file_index as f64),
		_ => None,
	}
}

/// Makes the shortcut: a symlink, which always works on macOS and Linux (an error fails the sync).
#[cfg(unix)]
fn link(target: &str, at: &str) -> Result<Option<Json>, String> {
	std::os::unix::fs::symlink(target, at).map_err(|err| format!("{err}, symlink '{target}' -> '{at}'"))?;
	Ok(Some(json!({ "path": at, "target": target })))
}

/// Makes the shortcut: a symlink, or a hard link where Windows refuses one (it needs a privilege
/// or developer mode). None when neither can be made.
#[cfg(windows)]
fn link(target: &str, at: &str) -> Result<Option<Json>, String> {
	if std::os::windows::fs::symlink_file(target, at).is_ok() {
		return Ok(Some(json!({ "path": at, "target": target })));
	}
	if std::fs::hard_link(target, at).is_err() {
		return Ok(None);
	}
	Ok(ino_of(Path::new(at)).map(|ino| json!({ "path": at, "target": target, "ino": ino })))
}

fn read_only(file: &str) -> Result<(), String> {
	#[cfg(unix)]
	{
		use std::os::unix::fs::PermissionsExt;
		let st = std::fs::metadata(file).map_err(|err| fsx::node_error_message(&err, "stat", Path::new(file)))?;
		let mode = st.permissions().mode();
		if mode & 0o222 != 0 {
			std::fs::set_permissions(file, std::fs::Permissions::from_mode(mode & !0o222)).map_err(|err| fsx::node_error_message(&err, "chmod", Path::new(file)))?;
		}
	}
	#[cfg(windows)]
	let _ = file;
	Ok(())
}

/// A file's real location, and whether it is the app's own copy.
struct Target {
	path: String,
	copied: bool,
}

/// The classes as shortcuts see them (records with only their files that are on disk), with each
/// file's real location.
fn current_classes(app: &App) -> (Vec<Json>, HashMap<String, Target>) {
	let mut classes = Vec::new();
	let mut targets = HashMap::new();
	for summary in app.stores.classes.list_classes() {
		let Some(record) = app.stores.classes.get_class(str_of(&summary, "id")) else { continue };
		let files: Vec<Json> = files_of(&record)
			.iter()
			.filter(|f| {
				let Some(p) = class_file_path(app, &record, f).filter(|p| Path::new(p).exists()) else { return false };
				targets.insert(str_of(f, "id").to_owned(), Target { path: p, copied: str_of(f, "origin") == "copied" });
				true
			})
			.cloned()
			.collect();
		classes.push(json!({ "id": record["id"], "name": record["name"], "archived": record["archived"], "files": files }));
	}
	(classes, targets)
}

/// Makes `<folder>/classes` match the classes now: adds missing shortcuts, replaces changed ones,
/// and removes the ones this made that are gone, then any folder it made that is left empty. A
/// link that cannot be made fails the sync on macOS and Linux, and on Windows is listed in the
/// README. `clear` empties it (the folder moved away).
fn sync_shortcuts(app: &App, folder: &Path, clear: bool) -> Result<(), String> {
	let root = folder.join("classes");
	let (old_links, old_dirs) = read_manifest(folder);
	let (classes, targets) = if clear { (Vec::new(), HashMap::new()) } else { current_classes(app) };
	let mut want: Vec<(String, &Target)> = Vec::new();
	for s in shortcut_layout(&classes) {
		let at = s.at.iter().fold(root.clone(), |p, part| p.join(part)).to_string_lossy().into_owned();
		if let Some(target) = targets.get(&s.file_id) {
			want.push((at, target));
		}
	}
	let wanted = |at: &str| want.iter().find(|(p, _)| p == at).map(|(_, t)| *t);

	let mut links: Vec<Json> = Vec::new();
	for made in old_links {
		if !still_ours(&made) {
			continue;
		}
		if wanted(path_of(&made)).is_some_and(|t| made["target"].as_str() == Some(t.path.as_str())) && up_to_date(&made)? {
			links.push(made);
		} else {
			let _ = std::fs::remove_file(path_of(&made));
		}
	}
	let kept: Vec<String> = links.iter().map(|l| path_of(l).to_owned()).collect();

	let mut skipped: Vec<String> = Vec::new();
	let mut dirs: Vec<String> = Vec::new();
	for dir in old_dirs {
		if Path::new(&dir).exists() && !dirs.contains(&dir) {
			dirs.push(dir);
		}
	}
	if !want.is_empty() {
		ensure_dir(&root, &mut dirs)?;
	}
	for (at, target) in &want {
		if target.copied {
			read_only(&target.path)?;
		}
		// Something the learner put at this spot stays.
		if kept.contains(at) || std::fs::symlink_metadata(at).is_ok() {
			continue;
		}
		let at_path = Path::new(at);
		if let Some(parent) = at_path.parent() {
			ensure_dir(parent, &mut dirs)?;
		}
		match link(&target.path, at)? {
			Some(made) => links.push(made),
			None => skipped.push(at_path.strip_prefix(&root).unwrap_or(at_path).to_string_lossy().into_owned()),
		}
	}

	let readme = root.join(README_NAME);
	if !want.is_empty() {
		fsx::write_text_atomic(&readme, &readme_text(&skipped)).map_err(|err| fsx::node_error_message(&err, "open", &readme))?;
	} else if readme.exists() {
		let _ = std::fs::remove_file(&readme);
	}
	// Deepest first, so a class folder empties before classes/ itself.
	let mut by_depth = dirs.clone();
	by_depth.sort_by_key(|d| std::cmp::Reverse(text::len16(d)));
	for dir in by_depth {
		let prefix = format!("{dir}{MAIN_SEPARATOR}");
		if want.iter().any(|(p, _)| p.starts_with(&prefix)) {
			continue;
		}
		if std::fs::read_dir(&dir).is_ok_and(|mut entries| entries.next().is_none()) {
			let _ = std::fs::remove_dir(&dir);
		}
		dirs.retain(|d| *d != dir);
	}
	let mut manifest = Obj::new();
	manifest.insert("links", links);
	manifest.insert("dirs", dirs);
	let file = manifest_path(folder);
	fsx::write_text_atomic(&file, &format!("{}\n", stringify_pretty(&Json::Obj(manifest), "\t"))).map_err(|err| fsx::node_error_message(&err, "open", &file))
}

/// Makes `dir` and any missing parents, noting each one made.
fn ensure_dir(dir: &Path, made: &mut Vec<String>) -> Result<(), String> {
	if dir.exists() {
		return Ok(());
	}
	if let Some(parent) = dir.parent() {
		ensure_dir(parent, made)?;
	}
	std::fs::create_dir(dir).map_err(|err| fsx::node_error_message(&err, "mkdir", dir))?;
	let dir = dir.to_string_lossy().into_owned();
	if !made.contains(&dir) {
		made.push(dir);
	}
	Ok(())
}

/// Syncs without ever failing: shortcuts are a convenience. One sync at a time: each reads and
/// rewrites the manifest, so two at once would lose the links the other made.
pub fn sync_shortcuts_safely(app: &App, folder: &Path, clear: bool) {
	let _one_at_a_time = app.classes.shortcut_sync.lock();
	if let Err(err) = sync_shortcuts(app, folder, clear) {
		eprintln!("[class-shortcuts] sync failed: {err}");
	}
}

/// Re-syncs about 2 s after classes change (a burst of changes syncs once), once per process.
/// `folder` is read on each sync, so moving the folder needs no restart.
pub fn watch_shortcuts(app: &Arc<App>, folder: impl Fn(&App) -> Option<PathBuf> + Send + 'static) {
	if app.classes.shortcut_watch.swap(true, Ordering::SeqCst) {
		return;
	}
	let mut events = app.events.subscribe();
	let app = app.clone();
	tokio::spawn(async move {
		let mut due: Option<i64> = None;
		loop {
			let timer = async {
				match due {
					Some(at) => clock::sleep_until(at).await,
					None => std::future::pending().await,
				}
			};
			tokio::select! {
				event = events.recv() => match event {
					Some(event) if event.kind == EventKind::ClassesChanged => due = Some(clock::now_ms() + SYNC_DELAY_MS),
					Some(_) => {}
					None => return,
				},
				() = timer => {
					due = None;
					if let Some(f) = folder(&app) {
						sync_shortcuts_safely(&app, &f, false);
					}
				}
			}
		}
	});
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn a_sync_waits_for_the_one_running() {
		let root = scratch_dir("shortcuts-one");
		let app = test_app(&root);
		let folder = root.join("godspeed");
		let running = app.classes.shortcut_sync.lock();
		let (syncing, at) = (app.clone(), folder.clone());
		let sync = std::thread::spawn(move || sync_shortcuts_safely(&syncing, &at, false));
		std::thread::sleep(std::time::Duration::from_millis(100));
		assert!(!manifest_path(&folder).exists());
		drop(running);
		sync.join().unwrap();
		assert!(manifest_path(&folder).exists());
	}
}
