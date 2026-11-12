//! The godspeed folder on disk (gs_core's agent_folder has the pure parts). Setting it up writes
//! the agent's instructions, its connection and its start scripts there, plus spaces/ with
//! shortcuts to the space files; the app refreshes them once per start, so an update reaches
//! them. Which folder is used, and whether the one-time "godspeed has its own folder now" notice
//! was seen, live in <data>/agent-folder.json.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::Ordering;

use gs_base::config::resolve;
use gs_base::fsx;
use gs_core::spaces::agent_folder::{FolderAgent, Platform, copy_command, short_folder, usable_folder};
use gs_core::spaces::space_shortcuts::space_dirs;
use gs_json::{Json, Obj, json, parse, stringify_pretty};

use super::disk::write_file_atomic;
use super::folder_files::write_folder;
use super::old_setup::{OldSetup, old_setup, remove_old_setup};
use crate::App;
use crate::spaces::space_shortcuts::{sync_shortcuts_safely, watch_shortcuts};

/// Why setting the folder up failed: `Folder` is a folder that can't be used, in words for the
/// learner; `Disk` is the app's own state file not saving.
#[derive(Debug, PartialEq)]
pub enum SetUpError {
	Folder(String),
	Disk(String),
}

#[derive(Default)]
struct FolderState {
	folder: Option<String>,
	notice_seen: bool,
}

impl FolderState {
	/// Keys keep the order of the file they replace and a new key goes last, so a file that only
	/// had the notice gets its folder after it.
	fn to_json(&self, notice_first: bool) -> Json {
		let mut out = Obj::new();
		if notice_first && self.notice_seen {
			out.insert("noticeSeen", true);
		}
		if let Some(folder) = &self.folder {
			out.insert("folder", folder.as_str());
		}
		if self.notice_seen {
			out.insert("noticeSeen", true);
		}
		Json::Obj(out)
	}
}

fn platform() -> Platform {
	if cfg!(target_os = "macos") {
		Platform::Darwin
	} else if cfg!(windows) {
		Platform::Win32
	} else {
		Platform::Linux
	}
}

fn state_file(app: &App) -> PathBuf {
	app.paths.data.join("agent-folder.json")
}

fn read_state(app: &App) -> FolderState {
	let Some(raw) = fsx::read_text(&state_file(app)).ok().and_then(|text| parse(&text).ok()) else { return FolderState::default() };
	FolderState {
		folder: raw["folder"].as_str().filter(|f| usable_folder(f)).map(str::to_owned),
		notice_seen: raw["noticeSeen"].as_bool() == Some(true),
	}
}

fn write_state(app: &App, state: &FolderState) -> Result<(), String> {
	let before = read_state(app);
	let notice_first = before.notice_seen && before.folder.is_none();
	write_file_atomic(&state_file(app), &format!("{}\n", stringify_pretty(&state.to_json(notice_first), "\t")))
}

fn agent_folder(app: &App) -> String {
	read_state(app).folder.unwrap_or_else(|| app.paths.default_agent_folder.to_string_lossy().into_owned())
}

/// Set up: its connector is there.
fn is_set_up(folder: &str) -> bool {
	Path::new(folder).join(".godspeed").join("connect.mjs").exists()
}

fn home_text(app: &App) -> String {
	app.paths.home.to_string_lossy().into_owned()
}

/// The folder with `..` and `.` settled, as the old server's `path.join` left it for the
/// shortcut files.
fn tidy(folder: &str) -> PathBuf {
	resolve(Path::new(folder))
}

/// Where cheat sheets' working folders go: the agent keeps each sheet's source there between
/// requests.
pub fn cheat_sheets_dir(app: &App) -> PathBuf {
	Path::new(&agent_folder(app)).join("cheat-sheets")
}

/// The space's folder of shortcuts in the godspeed folder, when it's there.
pub fn space_shortcut_dir(app: &App, space_id: &str) -> Option<String> {
	let folder = agent_folder(app);
	if !is_set_up(&folder) {
		return None;
	}
	let at = space_dirs(&app.stores.spaces.list_spaces()).remove(space_id)?;
	let dir = at.iter().fold(Path::new(&folder).join("spaces"), |dir, part| dir.join(part));
	dir.exists().then(|| dir.to_string_lossy().into_owned())
}

/// Where the folder is, whether it's set up, and the commands to copy. `oldSetup` is the old
/// setup still left once the folder is set up (the first-time notice covers people without one).
fn view_of(app: &App, folder: &str) -> Json {
	let home = home_text(app);
	let exists = is_set_up(folder);
	let command = |agent| copy_command(agent, folder, &home, platform());
	let old = if exists { old_setup(app) } else { OldSetup { plugin: false, codex: false } };
	json!({
		"folder": folder,
		"short": short_folder(folder, &home),
		"exists": exists,
		"commands": { "claude": command(FolderAgent::Claude), "codex": command(FolderAgent::Codex) },
		"oldSetup": old.to_json(),
	})
}

pub fn agent_folder_view(app: &App) -> Json {
	view_of(app, &agent_folder(app))
}

/// Make (or update) the folder, remember it, and try to clear out the old setup. A failed
/// cleanup only logs: the folder works, and Settings still offers Remove.
pub fn set_up_agent_folder(app: &Arc<App>, folder: Option<&str>) -> Result<Json, SetUpError> {
	let folder = folder.map_or_else(|| agent_folder(app), str::to_owned);
	if !usable_folder(&folder) {
		return Err(SetUpError::Folder("Pick a folder whose name has no quotes or $ signs in it.".to_owned()));
	}
	write_folder(&folder, platform()).map_err(|err| SetUpError::Folder(format!("Couldn't write to {folder}: {err}")))?;
	let before = read_state(app).folder;
	write_state(app, &FolderState { folder: Some(folder.clone()), notice_seen: true }).map_err(SetUpError::Disk)?;
	// A moved folder takes its shortcuts along.
	if let Some(before) = before.filter(|b| resolve(Path::new(b)) != resolve(Path::new(&folder))) {
		sync_shortcuts_safely(app, &tidy(&before), true);
	}
	sync_shortcuts_safely(app, &tidy(&folder), false);
	watch_space_shortcuts(app);
	if let Err(err) = remove_old_setup(app) {
		eprintln!("[agent-folder] removing the old setup failed: {err}");
	}
	Ok(view_of(app, &folder))
}

/// Once per app start: bring an existing folder's files up to this version.
pub fn refresh_agent_folder(app: &Arc<App>) {
	if app.misc.folder_refreshed.swap(true, Ordering::SeqCst) {
		return;
	}
	let folder = agent_folder(app);
	if !is_set_up(&folder) {
		return;
	}
	if let Err(err) = write_folder(&folder, platform()) {
		eprintln!("[agent-folder] refresh failed: {err}");
	}
	sync_shortcuts_safely(app, &tidy(&folder), false);
	watch_space_shortcuts(app);
}

/// Why a file or folder can't be added from `path`: it's inside the godspeed folder's spaces/,
/// which only holds shortcuts to files godspeed already has. None when it's fine.
pub fn shortcut_path_problem(app: &App, path: &str) -> Option<String> {
	let root = resolve(&Path::new(&agent_folder(app)).join("spaces"));
	let at = resolve(Path::new(path));
	(at == root || at.starts_with(&root)).then(|| {
		"That's in godspeed's spaces folder, which only holds shortcuts to files godspeed already has. Pick the original file or folder instead.".to_owned()
	})
}

/// Keep spaces/ in step with the spaces while a folder is set up.
fn watch_space_shortcuts(app: &Arc<App>) {
	watch_shortcuts(app, |app| {
		let folder = agent_folder(app);
		is_set_up(&folder).then(|| tidy(&folder))
	});
}

/// The agent someone set up the old way (the plugin, or the Codex config) uses, while they
/// haven't seen the "godspeed has its own folder now" notice; otherwise None.
pub fn folder_notice_agent(app: &App) -> Option<&'static str> {
	if read_state(app).notice_seen || is_set_up(&agent_folder(app)) {
		return None;
	}
	let old = old_setup(app);
	if old.plugin {
		Some("claude")
	} else if old.codex {
		Some("codex")
	} else {
		None
	}
}

pub fn dismiss_folder_notice(app: &App) -> Result<(), String> {
	write_state(app, &FolderState { folder: read_state(app).folder, notice_seen: true })
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn the_default_folder_is_godspeed_in_home_and_not_set_up() {
		let root = scratch_dir("folder-view");
		let app = test_app(&root);
		let view = agent_folder_view(&app);
		let folder = root.join("home").join("godspeed").to_string_lossy().into_owned();
		assert_eq!(view["folder"].as_str(), Some(folder.as_str()));
		assert_eq!(stringify(&view["oldSetup"]), r#"{"plugin":false,"codex":false}"#);
		if cfg!(windows) {
			assert_eq!(view["short"].as_str(), Some(folder.as_str()));
			assert!(view["commands"]["claude"].as_str().unwrap().starts_with(&format!("cd /d \"{folder}\" && claude ")));
		} else {
			assert_eq!(view["short"].as_str(), Some("~/godspeed"));
			assert_eq!(view["commands"]["claude"].as_str(), Some("cd ~/godspeed && claude --settings .godspeed/claude-settings.json \"Start teaching\""));
		}
	}

	#[test]
	fn the_state_file_keeps_only_what_is_usable() {
		let root = scratch_dir("folder-state");
		let app = test_app(&root);
		write_file_atomic(&state_file(&app), r#"{"folder":"relative/path","noticeSeen":"yes"}"#).unwrap();
		assert_eq!(stringify(&read_state(&app).to_json(false)), "{}");
		dismiss_folder_notice(&app).unwrap();
		assert_eq!(std::fs::read_to_string(state_file(&app)).unwrap(), "{\n\t\"noticeSeen\": true\n}\n");
		write_file_atomic(&state_file(&app), r#"{"folder":"/somewhere/else","noticeSeen":true}"#).unwrap();
		dismiss_folder_notice(&app).unwrap();
		assert_eq!(std::fs::read_to_string(state_file(&app)).unwrap(), "{\n\t\"folder\": \"/somewhere/else\",\n\t\"noticeSeen\": true\n}\n");
		assert_eq!(folder_notice_agent(&app), None);
	}

	#[test]
	fn a_folder_added_to_a_notice_only_file_goes_after_the_notice() {
		let root = scratch_dir("folder-order");
		let app = test_app(&root);
		dismiss_folder_notice(&app).unwrap();
		write_state(&app, &FolderState { folder: Some("/x/y".to_owned()), notice_seen: true }).unwrap();
		assert_eq!(std::fs::read_to_string(state_file(&app)).unwrap(), "{\n\t\"noticeSeen\": true,\n\t\"folder\": \"/x/y\"\n}\n");
	}

	#[test]
	fn an_unusable_folder_is_refused_before_anything_is_written() {
		let root = scratch_dir("folder-unusable");
		let app = test_app(&root);
		assert_eq!(set_up_agent_folder(&app, Some("/a/b'c")), Err(SetUpError::Folder("Pick a folder whose name has no quotes or $ signs in it.".to_owned())));
		assert!(!state_file(&app).exists());
	}

	#[test]
	fn the_spaces_folder_is_not_a_place_to_add_files_from() {
		let root = scratch_dir("folder-problem");
		let app = test_app(&root);
		let spaces = root.join("home/godspeed/spaces");
		assert!(shortcut_path_problem(&app, &spaces.to_string_lossy()).is_some());
		assert!(shortcut_path_problem(&app, &spaces.join("x/../y/z.pdf").to_string_lossy()).is_some());
		assert!(shortcut_path_problem(&app, &root.join("home/godspeed/spaces-other").to_string_lossy()).is_none());
		assert!(shortcut_path_problem(&app, &root.join("home/notes").to_string_lossy()).is_none());
	}
}
