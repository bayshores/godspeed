//! The godspeed folder's spaces/ (space-shortcuts.ts): shortcuts to every space file, so the
//! learner (and their agent) can find them next to CLAUDE.md. Where each one goes is
//! gs_core::spaces::space_shortcuts. A manifest in .godspeed/shortcuts.json lists what this made,
//! and a sync only ever removes those, so anything else in spaces/ is left alone. Copies in the
//! app's data folder are made read-only on macOS and Linux (deleting them still works, since that
//! depends on the folder, not the file). Windows makes a hard link where a symlink is refused.

use std::collections::HashMap;
use std::path::{MAIN_SEPARATOR, Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::Ordering;

use gs_base::events::EventKind;
use gs_base::{clock, fsx, text};
use gs_core::spaces::space_shortcuts::{README_NAME, readme_text, shortcut_layout};
use gs_json::{Json, Obj, json, parse, stringify_pretty};

use super::space_card::space_file_path;
use super::files::{files_of, str_of};
use crate::App;

/// How long after the last space change a sync waits (a burst of changes syncs once).
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

/// The spaces as shortcuts see them (records with only their files that are on disk), with each
/// file's real location.
fn current_spaces(app: &App) -> (Vec<Json>, HashMap<String, Target>) {
	let mut spaces = Vec::new();
	let mut targets = HashMap::new();
	for summary in app.stores.spaces.list_spaces() {
		let Some(record) = app.stores.spaces.get_space(str_of(&summary, "id")) else { continue };
		let files: Vec<Json> = files_of(&record)
			.iter()
			.filter(|f| {
				let Some(p) = space_file_path(app, &record, f).filter(|p| Path::new(p).exists()) else { return false };
				targets.insert(str_of(f, "id").to_owned(), Target { path: p, copied: str_of(f, "origin") == "copied" });
				true
			})
			.cloned()
			.collect();
		spaces.push(json!({ "id": record["id"], "name": record["name"], "closed": record["closed"], "files": files }));
	}
	(spaces, targets)
}

/// Finder leaves this in any folder it opens, so a folder holding only it counts as empty.
const FINDER_FILE: &str = ".DS_Store";

/// Nothing in the folder but Finder's file (and with `deep`, folders that hold nothing either).
fn holds_nothing(dir: &Path, deep: bool) -> std::io::Result<bool> {
	for entry in std::fs::read_dir(dir)? {
		let entry = entry?;
		let kind = entry.file_type()?;
		let empty = if entry.file_name() == FINDER_FILE { kind.is_file() } else { deep && kind.is_dir() && holds_nothing(&entry.path(), true)? };
		if !empty {
			return Ok(false);
		}
	}
	Ok(true)
}

/// Removes `dir` when holds_nothing passes: Finder's files, then each folder with rmdir, never a
/// recursive remove, so a file saved meanwhile keeps its folder (rmdir fails).
fn remove_if_empty(dir: &Path, deep: bool) -> std::io::Result<()> {
	fn remove(d: &Path, deep: bool) -> std::io::Result<()> {
		for entry in std::fs::read_dir(d)? {
			let entry = entry?;
			let kind = entry.file_type()?;
			if entry.file_name() == FINDER_FILE && kind.is_file() {
				std::fs::remove_file(entry.path())?;
			} else if deep && kind.is_dir() {
				remove(&entry.path(), deep)?;
			}
		}
		std::fs::remove_dir(d)
	}
	if holds_nothing(dir, deep)? { remove(dir, deep) } else { Ok(()) }
}

/// A real folder, not a link to one.
fn is_real_dir(p: &Path) -> bool {
	std::fs::symlink_metadata(p).is_ok_and(|st| st.is_dir())
}

/// Makes `<folder>/spaces` match the spaces now: adds missing shortcuts, replaces changed ones,
/// and removes the ones this made that are gone, then any folder it made that is left empty. A
/// link that cannot be made fails the sync on macOS and Linux, and on Windows is listed in the
/// README. `clear` empties it (the folder moved away).
fn sync_shortcuts(app: &App, folder: &Path, clear: bool) -> Result<(), String> {
	let root = folder.join("spaces");
	// No manifest yet: a folder the learner just picked, whose own classes/ stays.
	let synced_before = manifest_path(folder).exists();
	let (old_links, old_dirs) = read_manifest(folder);
	let (spaces, targets) = if clear { (Vec::new(), HashMap::new()) } else { current_spaces(app) };
	let mut want: Vec<(String, &Target)> = Vec::new();
	for s in shortcut_layout(&spaces) {
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
	// A folder the learner replaced with a link is theirs now.
	for dir in &old_dirs {
		if is_real_dir(Path::new(dir)) && !dirs.contains(dir) {
			dirs.push(dir.clone());
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

	// spaces/ was classes/ before the rename: its note goes with its shortcuts, so the folder this
	// made can be removed once it is empty.
	let old_root = folder.join("classes");
	if old_dirs.iter().any(|d| *d == old_root.to_string_lossy()) {
		let note = old_root.join(README_NAME);
		fsx::remove_if_present(&note, "rm")?;
	}

	let readme = root.join(README_NAME);
	if !want.is_empty() {
		fsx::write_text_atomic(&readme, &readme_text(&skipped)).map_err(|err| fsx::node_error_message(&err, "open", &readme))?;
	} else if readme.exists() {
		let _ = std::fs::remove_file(&readme);
	}
	// Deepest first, so a space folder empties before spaces/ itself.
	let mut by_depth = dirs.clone();
	by_depth.sort_by_key(|d| std::cmp::Reverse(text::len16(d)));
	for dir in by_depth {
		let prefix = format!("{dir}{MAIN_SEPARATOR}");
		if want.iter().any(|(p, _)| p.starts_with(&prefix)) {
			continue;
		}
		let _ = remove_if_empty(Path::new(&dir), false);
		dirs.retain(|d| *d != dir);
	}
	// An earlier sync dropped classes/ from the manifest when Finder's file kept it; it still goes
	// once nothing else is under it (or is left for the next sync).
	if synced_before && is_real_dir(&old_root) {
		let _ = remove_if_empty(&old_root, true);
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
	let _one_at_a_time = app.spaces.shortcut_sync.lock();
	if let Err(err) = sync_shortcuts(app, folder, clear) {
		eprintln!("[space-shortcuts] sync failed: {err}");
	}
}

/// Re-syncs about 2 s after spaces change (a burst of changes syncs once), once per process.
/// `folder` is read on each sync, so moving the folder needs no restart.
pub fn watch_shortcuts(app: &Arc<App>, folder: impl Fn(&App) -> Option<PathBuf> + Send + 'static) {
	if app.spaces.shortcut_watch.swap(true, Ordering::SeqCst) {
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
					Some(event) if event.kind == EventKind::SpacesChanged => due = Some(clock::now_ms() + SYNC_DELAY_MS),
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
		let running = app.spaces.shortcut_sync.lock();
		let (syncing, at) = (app.clone(), folder.clone());
		let sync = std::thread::spawn(move || sync_shortcuts_safely(&syncing, &at, false));
		std::thread::sleep(std::time::Duration::from_millis(100));
		assert!(!manifest_path(&folder).exists());
		drop(running);
		sync.join().unwrap();
		assert!(manifest_path(&folder).exists());
	}

	fn write_manifest(folder: &Path, dirs: &[&Path]) {
		let dirs: Vec<Json> = dirs.iter().map(|d| Json::from(d.to_string_lossy().into_owned())).collect();
		fsx::write_text_atomic(&manifest_path(folder), &stringify_pretty(&json!({ "links": [], "dirs": dirs }), "\t")).unwrap();
	}

	fn put(file: &Path, text: &str) {
		fsx::write_text_atomic(file, text).unwrap();
	}

	#[test]
	fn a_freshly_picked_folder_keeps_its_own_classes_folder() {
		let root = scratch_dir("shortcuts-fresh");
		let app = test_app(&root);
		let folder = root.join("godspeed");
		put(&folder.join("classes").join(".DS_Store"), "finder");
		std::fs::create_dir_all(folder.join("classes").join("empty")).unwrap();
		sync_shortcuts_safely(&app, &folder, false);
		assert!(folder.join("classes").join(".DS_Store").exists() && folder.join("classes").join("empty").exists());
		// A later sync finds only Finder's file and empty folders there, so it goes.
		sync_shortcuts_safely(&app, &folder, false);
		assert!(!folder.join("classes").exists());
	}

	#[test]
	fn the_old_classes_folder_this_made_goes_with_its_note() {
		let root = scratch_dir("shortcuts-old-root");
		let app = test_app(&root);
		let folder = root.join("godspeed");
		let (old, space) = (folder.join("classes"), folder.join("classes").join("Algebra"));
		put(&old.join(README_NAME), "shortcuts");
		put(&old.join(".DS_Store"), "finder");
		put(&space.join(".DS_Store"), "finder");
		write_manifest(&folder, &[&old, &space]);
		sync_shortcuts_safely(&app, &folder, false);
		assert!(!old.exists());
		let (_, dirs) = read_manifest(&folder);
		assert!(dirs.is_empty());
	}

	#[test]
	fn a_learner_file_keeps_the_old_classes_folder() {
		let root = scratch_dir("shortcuts-old-kept");
		let app = test_app(&root);
		let folder = root.join("godspeed");
		let old = folder.join("classes");
		put(&old.join(README_NAME), "shortcuts");
		put(&old.join("Algebra").join("mine.txt"), "the learner's own file");
		put(&old.join(".DS_Store"), "finder");
		write_manifest(&folder, &[&old]);
		sync_shortcuts_safely(&app, &folder, false);
		assert!(!old.join(README_NAME).exists());
		assert!(old.join("Algebra").join("mine.txt").exists() && old.join(".DS_Store").exists());
		sync_shortcuts_safely(&app, &folder, false);
		assert!(old.join("Algebra").join("mine.txt").exists());
	}

	#[test]
	#[cfg(unix)]
	fn a_folder_replaced_by_a_link_is_the_learners() {
		let root = scratch_dir("shortcuts-old-link");
		let app = test_app(&root);
		let folder = root.join("godspeed");
		let elsewhere = root.join("elsewhere");
		put(&elsewhere.join(".DS_Store"), "finder");
		std::fs::create_dir_all(&folder).unwrap();
		std::os::unix::fs::symlink(&elsewhere, folder.join("classes")).unwrap();
		write_manifest(&folder, &[&folder.join("classes")]);
		sync_shortcuts_safely(&app, &folder, false);
		assert!(std::fs::symlink_metadata(folder.join("classes")).unwrap().file_type().is_symlink());
		assert!(elsewhere.join(".DS_Store").exists());
		assert!(read_manifest(&folder).1.is_empty());
	}

	/// A godspeed folder as a build from before the rename left it: a closed space's shortcut
	/// under spaces/Archived/, which that build made and listed in its manifest.
	#[cfg(unix)]
	fn synced_under_archived(root: &Path) -> (Arc<App>, PathBuf) {
		let linked = root.join("linked");
		put(&linked.join("notes.md"), "x");
		let file = json!({ "id": "f_a00000000001", "origin": "linked", "name": "notes.md", "path": "notes.md", "kind": "study", "contentFp": "", "status": "done", "addedAt": "2026-01-05T10:00:00.000Z" });
		let space = json!({
			"id": "cls_a", "name": "Linear Algebra", "description": "", "createdAt": "2026-01-05T10:00:00.000Z", "updatedAt": "2026-01-05T10:00:00.000Z",
			"closed": true, "linkedFolder": linked.to_string_lossy(), "deadlines": [], "color": 1, "version": 11, "files": [file],
		});
		put(&root.join("data").join("spaces").join("cls_a").join("space.json"), &stringify_pretty(&space, "\t"));
		let app = test_app(root);
		let folder = root.join("godspeed");
		sync_shortcuts_safely(&app, &folder, false);
		let spaces = folder.join("spaces");
		std::fs::rename(spaces.join("Closed"), spaces.join("Archived")).unwrap();
		let manifest = fsx::read_text(&manifest_path(&folder)).unwrap().replace(&*spaces.join("Closed").to_string_lossy(), &spaces.join("Archived").to_string_lossy());
		put(&manifest_path(&folder), &manifest);
		assert!(manifest.contains("Archived") && !manifest.contains("Closed"));
		(app, folder)
	}

	/// Every path under `dir` (links not followed), with each link's target.
	#[cfg(unix)]
	fn tree(dir: &Path) -> Vec<String> {
		let mut out = Vec::new();
		for entry in std::fs::read_dir(dir).unwrap() {
			let path = entry.unwrap().path();
			let st = std::fs::symlink_metadata(&path).unwrap();
			let target = if st.file_type().is_symlink() { format!(" -> {}", std::fs::read_link(&path).unwrap().to_string_lossy()) } else { String::new() };
			out.push(format!("{}{target}", path.to_string_lossy()));
			if st.is_dir() {
				out.extend(tree(&path));
			}
		}
		out.sort();
		out
	}

	#[test]
	#[cfg(unix)]
	fn the_archived_folder_godspeed_made_moves_to_closed() {
		let root = scratch_dir("shortcuts-archived");
		let (app, folder) = synced_under_archived(&root);
		sync_shortcuts_safely(&app, &folder, false);
		let spaces = folder.join("spaces");
		assert!(!spaces.join("Archived").exists());
		let (links, dirs) = read_manifest(&folder);
		assert_eq!(links.len(), 1);
		assert!(path_of(&links[0]).starts_with(&spaces.join("Closed").join("Linear Algebra").to_string_lossy().into_owned()));
		assert_eq!(std::fs::read_to_string(path_of(&links[0])).unwrap(), "x");
		assert!(dirs.iter().all(|d| !d.contains("Archived")));
	}

	#[test]
	#[cfg(unix)]
	fn a_learner_file_keeps_the_archived_folder_and_only_it() {
		let root = scratch_dir("shortcuts-archived-mine");
		let (app, folder) = synced_under_archived(&root);
		let archived = folder.join("spaces").join("Archived");
		put(&archived.join("Linear Algebra").join("mine.txt"), "the learner's own file");
		sync_shortcuts_safely(&app, &folder, false);
		assert_eq!(tree(&archived), [archived.join("Linear Algebra").to_string_lossy().into_owned(), archived.join("Linear Algebra").join("mine.txt").to_string_lossy().into_owned()]);
		assert_eq!(std::fs::read_to_string(archived.join("Linear Algebra").join("mine.txt")).unwrap(), "the learner's own file");
		assert!(folder.join("spaces").join("Closed").join("Linear Algebra").exists());
	}

	#[test]
	#[cfg(unix)]
	fn a_link_the_learner_put_in_archived_is_not_followed_or_removed() {
		let root = scratch_dir("shortcuts-archived-link");
		let (app, folder) = synced_under_archived(&root);
		let elsewhere = root.join("elsewhere");
		put(&elsewhere.join(".DS_Store"), "finder");
		let link_at = folder.join("spaces").join("Archived").join("mine");
		std::os::unix::fs::symlink(&elsewhere, &link_at).unwrap();
		sync_shortcuts_safely(&app, &folder, false);
		assert!(std::fs::symlink_metadata(&link_at).unwrap().file_type().is_symlink());
		assert_eq!(std::fs::read_to_string(elsewhere.join(".DS_Store")).unwrap(), "finder");
	}

	#[test]
	#[cfg(unix)]
	fn a_second_sync_after_the_move_changes_nothing() {
		let root = scratch_dir("shortcuts-archived-twice");
		let (app, folder) = synced_under_archived(&root);
		put(&folder.join("spaces").join("Archived").join("mine.txt"), "the learner's own file");
		sync_shortcuts_safely(&app, &folder, false);
		let (first, manifest) = (tree(&folder), fsx::read_text(&manifest_path(&folder)).unwrap());
		sync_shortcuts_safely(&app, &folder, false);
		assert_eq!(tree(&folder), first);
		assert_eq!(fsx::read_text(&manifest_path(&folder)).unwrap(), manifest);
	}

	#[cfg(windows)]
	fn made_link(at: &Path, target: &Path) -> Json {
		link(&target.to_string_lossy(), &at.to_string_lossy()).unwrap().expect("a link can be made here")
	}

	#[test]
	#[cfg(windows)]
	fn a_sync_keeps_its_links_instead_of_making_them_again() {
		let root = scratch_dir("shortcuts-keep");
		let linked = root.join("linked");
		std::fs::create_dir_all(&linked).unwrap();
		fsx::write_text_atomic(&linked.join("notes.md"), "x").unwrap();
		let file = json!({ "id": "f_a00000000001", "origin": "linked", "name": "notes.md", "path": "notes.md", "kind": "study", "contentFp": "", "status": "done", "addedAt": "2026-01-05T10:00:00.000Z" });
		let space = json!({
			"id": "cls_a", "name": "Linear Algebra", "description": "", "createdAt": "2026-01-05T10:00:00.000Z", "updatedAt": "2026-01-05T10:00:00.000Z",
			"closed": false, "linkedFolder": linked.to_string_lossy(), "deadlines": [], "version": 7, "files": [file],
		});
		let at = root.join("data").join("spaces").join("cls_a").join("space.json");
		std::fs::create_dir_all(at.parent().unwrap()).unwrap();
		fsx::write_text_atomic(&at, &stringify_pretty(&space, "\t")).unwrap();
		let app = test_app(&root);
		let folder = root.join("godspeed");

		sync_shortcuts_safely(&app, &folder, false);
		let (links, _) = read_manifest(&folder);
		assert_eq!(links.len(), 1);
		let shortcut = PathBuf::from(path_of(&links[0]));
		assert_eq!(std::fs::read_to_string(&shortcut).unwrap(), "x");
		let made_at = std::fs::symlink_metadata(&shortcut).unwrap().created().unwrap();

		sync_shortcuts_safely(&app, &folder, false);
		assert_eq!(read_manifest(&folder).0, links);
		assert_eq!(std::fs::symlink_metadata(&shortcut).unwrap().created().unwrap(), made_at);

		sync_shortcuts_safely(&app, &folder, true);
		assert!(std::fs::symlink_metadata(&shortcut).is_err());
		assert!(read_manifest(&folder).0.is_empty());
	}

	#[test]
	#[cfg(windows)]
	fn a_target_over_260_characters_gets_a_hard_link_since_a_symlink_to_it_is_refused() {
		let root = scratch_dir("shortcuts-long");
		let deep = (0..6).fold(root.to_path_buf(), |dir, i| dir.join(format!("{i}{}", "d".repeat(50))));
		std::fs::create_dir_all(&deep).unwrap();
		let target = deep.join("notes.md");
		fsx::write_text_atomic(&target, "x").unwrap();
		assert!(target.to_string_lossy().len() > 260);
		let made = made_link(&root.join("short.md"), &target);
		assert!(made.get("ino").is_some());
		assert!(still_ours(&made));
		assert_eq!(up_to_date(&made), Ok(true));
	}

	#[test]
	#[cfg(windows)]
	fn a_hard_link_is_ours_until_its_target_is_replaced() {
		let root = scratch_dir("shortcuts-hard");
		let (target, at) = (root.join("target.md"), root.join("shortcut.md"));
		fsx::write_text_atomic(&target, "x").unwrap();
		std::fs::hard_link(&target, &at).unwrap();
		let ino = ino_of(&at).expect("a file has an index");
		assert_eq!(ino_of(&target), Some(ino));
		let made = json!({ "path": at.to_string_lossy(), "target": target.to_string_lossy(), "ino": ino });
		assert!(still_ours(&made));
		assert_eq!(up_to_date(&made), Ok(true));

		fsx::write_atomic(&target, b"y", None).unwrap();
		assert_eq!(up_to_date(&made), Ok(false));

		std::fs::remove_file(&at).unwrap();
		fsx::write_text_atomic(&at, "the learner's own file").unwrap();
		assert!(!still_ours(&made));
	}
}
