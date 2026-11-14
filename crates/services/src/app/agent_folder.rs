//! The godspeed folder on disk (gs_core's agent_folder has the pure parts). Setting it up writes
//! the agent's instructions, its connection and its start scripts there, plus spaces/ with
//! shortcuts to the space files; the app refreshes them once per start, so an update reaches
//! them. Which folder is used, the learner's own start commands, and whether the one-time
//! "godspeed has its own folder now" notice was seen, live in <data>/agent-folder.json.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::Ordering;

use gs_base::config::resolve;
use gs_base::fsx;
use gs_base::locks::LockKey;
use gs_core::spaces::agent_folder::{FolderAgent, Platform, StartCommands, StartTarget, copy_command, saved_start_commands, short_folder, usable_folder, usable_start_command};
use gs_core::spaces::space_shortcuts::space_dirs;
use gs_json::{Json, Obj, json, parse, stringify_pretty};

use super::disk::write_file_atomic;
use super::folder_files::write_folder;
use super::old_setup::{OldSetup, old_setup, remove_old_setup};
use crate::App;
use crate::spaces::space_shortcuts::{sync_shortcuts_safely, watch_shortcuts};

/// Every start script the folder holds.
pub const START_TARGETS: [StartTarget; 4] = [StartTarget::Claude, StartTarget::ClaudeHelper, StartTarget::Codex, StartTarget::CodexHelper];

const STATE: LockKey<'static> = LockKey::AppFile("agent-folder.json");

/// Why a change to the folder failed: `Folder` is in words for the learner (a folder that can't
/// be used, a command the scripts can't hold); `Disk` is the app's own state file not saving.
#[derive(Debug, PartialEq)]
pub enum SetUpError {
	Folder(String),
	Disk(String),
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

/// The usable parts of the state file, in this order: `folder`, `noticeSeen`, `startCommands`.
/// Writes spread it and set keys on top, so the file keeps that order with new keys last.
fn read_state(app: &App) -> Obj {
	let mut state = Obj::new();
	let Some(raw) = fsx::read_text(&state_file(app)).ok().and_then(|text| parse(&text).ok()) else { return state };
	if let Some(folder) = raw["folder"].as_str().filter(|f| usable_folder(f)) {
		state.insert("folder", folder);
	}
	if raw["noticeSeen"] == Json::Bool(true) {
		state.insert("noticeSeen", true);
	}
	let commands = saved_start_commands(&raw["startCommands"]);
	if !commands.is_empty() {
		state.insert("startCommands", commands.to_json());
	}
	state
}

fn write_state(app: &App, state: Obj) -> Result<(), String> {
	write_file_atomic(&state_file(app), &format!("{}\n", stringify_pretty(&Json::Obj(state), "\t")))
}

fn folder_of(state: &Obj) -> Option<String> {
	state.get("folder").and_then(Json::as_str).map(str::to_owned)
}

fn start_commands(app: &App) -> StartCommands {
	saved_start_commands(&read_state(app).get("startCommands").cloned().unwrap_or(Json::Null))
}

fn agent_folder(app: &App) -> String {
	folder_of(&read_state(app)).unwrap_or_else(|| app.paths.default_agent_folder.to_string_lossy().into_owned())
}

/// Set up: its connector is there.
fn is_set_up(folder: &str) -> bool {
	Path::new(folder).join(".godspeed").join("connect.mjs").exists()
}

/// The folder in use, when it is set up: the shell runs agents' terminals only there.
pub fn set_up_folder(app: &App) -> Option<String> {
	let folder = agent_folder(app);
	is_set_up(&folder).then_some(folder)
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
	let start_commands = start_commands(app);
	let command = |agent| copy_command(agent, folder, &home, platform(), &start_commands);
	let old = if exists { old_setup(app) } else { OldSetup { plugin: false, codex: false } };
	json!({
		"folder": folder,
		"short": short_folder(folder, &home),
		"exists": exists,
		"commands": { "claude": command(FolderAgent::Claude), "codex": command(FolderAgent::Codex) },
		"startCommands": start_commands.to_json(),
		"oldSetup": old.to_json(),
	})
}

pub fn agent_folder_view(app: &App) -> Json {
	view_of(app, &agent_folder(app))
}

/// write_folder with the saved start commands, and a failure in words for the learner.
fn write_folder_or_explain(app: &App, folder: &str) -> Result<(), SetUpError> {
	write_folder(folder, platform(), &start_commands(app)).map_err(|err| SetUpError::Folder(format!("Couldn't write to {folder}: {err}")))
}

/// Save `folder` as the one in use (the notice is seen then too); the folder used before, if any.
fn remember_folder(app: &App, folder: &str) -> Result<Option<String>, String> {
	let _held = app.locks.lock(STATE);
	let mut state = read_state(app);
	let before = folder_of(&state);
	state.insert("folder", folder);
	state.insert("noticeSeen", true);
	write_state(app, state)?;
	Ok(before)
}

/// Make (or update) the folder, remember it, and try to clear out the old setup. A failed
/// cleanup only logs: the folder works, and Settings still offers Remove.
pub fn set_up_agent_folder(app: &Arc<App>, folder: Option<&str>) -> Result<Json, SetUpError> {
	let folder = folder.map_or_else(|| agent_folder(app), str::to_owned);
	if !usable_folder(&folder) {
		return Err(SetUpError::Folder("Pick a folder whose name has no quotes or $ signs in it.".to_owned()));
	}
	write_folder_or_explain(app, &folder)?;
	let before = remember_folder(app, &folder).map_err(SetUpError::Disk)?;
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

/// Start an agent with the learner's own command (empty: the usual one again), and put it in the
/// start scripts of a folder that's set up.
pub fn set_start_command(app: &App, agent: FolderAgent, command: &str) -> Result<Json, SetUpError> {
	let own = gs_base::text::trim(command);
	if !usable_start_command(own) {
		return Err(SetUpError::Folder("Keep the command on one line, 300 characters at most.".to_owned()));
	}
	{
		let _held = app.locks.lock(STATE);
		let mut state = read_state(app);
		let mut commands = match state.get("startCommands") {
			Some(Json::Obj(saved)) => saved.clone(),
			_ => Obj::new(),
		};
		if own.is_empty() {
			commands.remove(agent.name());
		} else {
			commands.insert(agent.name(), own);
		}
		state.insert("startCommands", Json::Obj(commands));
		write_state(app, state).map_err(SetUpError::Disk)?;
	}
	let folder = agent_folder(app);
	if is_set_up(&folder) {
		write_folder_or_explain(app, &folder)?;
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
	if let Err(err) = write_folder(&folder, platform(), &start_commands(app)) {
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
	if read_state(app).contains_key("noticeSeen") || is_set_up(&agent_folder(app)) {
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
	let _held = app.locks.lock(STATE);
	let mut state = read_state(app);
	state.insert("noticeSeen", true);
	write_state(app, state)
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
		write_file_atomic(&state_file(&app), r#"{"folder":"relative/path","noticeSeen":"yes","startCommands":{"claude":"a\nb","codex":""}}"#).unwrap();
		assert!(read_state(&app).is_empty());
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
		assert_eq!(remember_folder(&app, "/x/y"), Ok(None));
		assert_eq!(std::fs::read_to_string(state_file(&app)).unwrap(), "{\n\t\"noticeSeen\": true,\n\t\"folder\": \"/x/y\"\n}\n");
		assert_eq!(remember_folder(&app, "/x/z"), Ok(Some("/x/y".to_owned())));
	}

	#[test]
	fn the_learners_own_start_command_goes_into_the_scripts_and_an_empty_one_brings_the_usual_back() {
		let root = scratch_dir("folder-start-command");
		let app = test_app(&root);
		let script = |app: &App| {
			let folder = agent_folder(app);
			std::fs::read_to_string(gs_core::spaces::agent_folder::start_script_path(&folder, StartTarget::Claude, platform())).unwrap()
		};
		let view = set_start_command(&app, FolderAgent::Claude, "  standardcompute launch claude --  ").unwrap();
		assert_eq!(stringify(&view["startCommands"]), r#"{"claude":"standardcompute launch claude --"}"#);
		assert_eq!(view["exists"], Json::Bool(false), "saving the command doesn't make the folder");
		assert!(!root.join("home/godspeed").exists());
		// Made without the old-setup cleanup, which would reach the real agent configs when
		// CLAUDE_CONFIG_DIR or CODEX_HOME is set.
		write_folder_or_explain(&app, &agent_folder(&app)).unwrap();
		assert!(agent_folder_view(&app)["commands"]["claude"].as_str().unwrap().contains("&& standardcompute launch claude -- --settings "));
		assert!(script(&app).contains("\nstandardcompute launch claude -- --settings "));

		let view = set_start_command(&app, FolderAgent::Codex, "standardcompute launch codex --").unwrap();
		if !cfg!(windows) {
			assert!(view["commands"]["codex"].as_str().unwrap().contains("&& standardcompute launch codex -- -c "));
		}
		assert_eq!(stringify(&agent_folder_view(&app)["startCommands"]), r#"{"claude":"standardcompute launch claude --","codex":"standardcompute launch codex --"}"#);

		let view = set_start_command(&app, FolderAgent::Claude, "").unwrap();
		assert_eq!(stringify(&view["startCommands"]), r#"{"codex":"standardcompute launch codex --"}"#);
		assert!(script(&app).contains(if cfg!(windows) { "\r\nclaude --settings " } else { "\nexec claude --settings " }));
		assert_eq!(set_start_command(&app, FolderAgent::Claude, "claude\nrm -rf ~"), Err(SetUpError::Folder("Keep the command on one line, 300 characters at most.".to_owned())));
		assert_eq!(set_start_command(&app, FolderAgent::Claude, &"x".repeat(301)), Err(SetUpError::Folder("Keep the command on one line, 300 characters at most.".to_owned())));
	}

	#[test]
	fn the_state_file_keeps_its_key_order_and_an_emptied_command_list() {
		let root = scratch_dir("folder-start-command-file");
		let app = test_app(&root);
		write_file_atomic(&state_file(&app), r#"{"startCommands":{"codex":"c"},"noticeSeen":true,"extra":1}"#).unwrap();
		set_start_command(&app, FolderAgent::Claude, "a").unwrap();
		assert_eq!(std::fs::read_to_string(state_file(&app)).unwrap(), "{\n\t\"noticeSeen\": true,\n\t\"startCommands\": {\n\t\t\"codex\": \"c\",\n\t\t\"claude\": \"a\"\n\t}\n}\n");
		set_start_command(&app, FolderAgent::Codex, " ").unwrap();
		set_start_command(&app, FolderAgent::Claude, "").unwrap();
		assert_eq!(std::fs::read_to_string(state_file(&app)).unwrap(), "{\n\t\"noticeSeen\": true,\n\t\"startCommands\": {}\n}\n");
		dismiss_folder_notice(&app).unwrap();
		assert_eq!(std::fs::read_to_string(state_file(&app)).unwrap(), "{\n\t\"noticeSeen\": true\n}\n");
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
