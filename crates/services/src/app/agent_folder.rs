//! The godspeed folder on disk, where the agent works (gs_core's agent_folder has the pure parts).
//! Setting it up writes the space-setup steps the teacher reads there, plus spaces/ with shortcuts
//! to the space files; the app refreshes them once per start, so an update reaches them. Which folder is used, the learner's own start commands, whether the one-time
//! "godspeed has its own folder now" notice was seen, whether the old Talk chat was exported
//! there, which agent runs the lessons, and the model each agent's new lessons start on live in
//! <data>/agent-folder.json.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::Ordering;

use gs_base::config::resolve;
use gs_base::fsx;
use gs_base::locks::LockKey;
use gs_core::spaces::agent_folder::{FolderAgent, StartCommands, saved_start_commands, short_folder, usable_folder, usable_start_command};
use gs_core::spaces::space_shortcuts::space_dirs;
use gs_json::{Json, Obj, json, stringify_pretty};

use super::agent_health::check_health;
use super::disk::write_file_atomic;
use super::folder_files::{SETUP_STEPS, write_folder};
use super::old_setup::{OldSetup, old_setup, remove_old_setup};
use super::old_talk::export_talk;
use crate::App;
use crate::spaces::space_shortcuts::{sync_shortcuts_safely, watch_shortcuts};
use crate::turns::lesson_session::close_other_agents_sessions;

const STATE: LockKey<'static> = LockKey::AppFile("agent-folder.json");

/// Why a change to the folder failed: `Folder` is in words for the learner (a folder that can't
/// be used, a command too long); `Disk` is the app's own state file not saving.
#[derive(Debug, PartialEq)]
pub enum SetUpError {
	Folder(String),
	Disk(String),
}

fn state_file(app: &App) -> PathBuf {
	app.paths.data.join("agent-folder.json")
}

/// The usable parts of the state file, in this order: `folder`, `noticeSeen`, `startCommands`,
/// `talkExported`, `agent`, `model`.
/// Writes spread it and set keys on top, so the file keeps that order with new keys last.
fn read_state(app: &App) -> Obj {
	let mut state = Obj::new();
	let Some(raw) = fsx::read_json_or_set_aside(&state_file(app)) else { return state };
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
	if raw["talkExported"] == Json::Bool(true) {
		state.insert("talkExported", true);
	}
	if let Some(agent) = raw["agent"].as_str().and_then(FolderAgent::from_name) {
		state.insert("agent", agent.name());
	}
	let models = saved_models(&raw["model"]);
	if !models.is_empty() {
		state.insert("model", Json::Obj(models));
	}
	state
}

/// The longest model name kept; the agents' own are far shorter.
const MODEL_MAX: usize = 200;

/// A model's name as the agents give them: one line, not empty, not overlong.
pub(crate) fn usable_model(model: &str) -> bool {
	!model.is_empty() && model.len() <= MODEL_MAX && !model.contains(['\n', '\r'])
}

/// The saved model of each agent that has one, by agent name.
fn saved_models(raw: &Json) -> Obj {
	let mut models = Obj::new();
	for agent in FolderAgent::ALL {
		if let Some(model) = raw[agent.name()].as_str().filter(|model| usable_model(model)) {
			models.insert(agent.name(), model);
		}
	}
	models
}

fn write_state(app: &App, state: Obj) -> Result<(), String> {
	write_file_atomic(&state_file(app), &format!("{}\n", stringify_pretty(&Json::Obj(state), "\t")))
}

fn folder_of(state: &Obj) -> Option<String> {
	state.get("folder").and_then(Json::as_str).map(str::to_owned)
}

fn start_commands_in(state: &Obj) -> StartCommands {
	saved_start_commands(state.get("startCommands").unwrap_or(&Json::Null))
}

/// The learner's own start command for `agent`, if they set one.
pub(crate) fn start_command(app: &App, agent: FolderAgent) -> Option<String> {
	start_commands_in(&read_state(app)).get(agent).map(str::to_owned)
}

/// The agent the learner picked to run the lessons, if they picked one.
fn picked_in(state: &Obj) -> Option<FolderAgent> {
	state.get("agent").and_then(Json::as_str).and_then(FolderAgent::from_name)
}

/// The agent that runs the lessons: Claude Code until the learner picks Codex.
pub(crate) fn folder_agent(app: &App) -> FolderAgent {
	picked_in(&read_state(app)).unwrap_or(FolderAgent::Claude)
}

/// The agent that runs the lessons and the learner's own start command for it, from one read.
pub(crate) fn agent_with_command(app: &App) -> (FolderAgent, Option<String>) {
	let state = read_state(app);
	let agent = picked_in(&state).unwrap_or(FolderAgent::Claude);
	(agent, start_commands_in(&state).get(agent).map(str::to_owned))
}

/// The learner picked the agent that runs the lessons and jobs, which is checked at once; the
/// folder as it is now. The other agent's program stops once no turn uses it.
pub fn set_folder_agent(app: &Arc<App>, agent: FolderAgent) -> Result<Json, String> {
	{
		let _held = app.locks.lock(STATE);
		let mut state = read_state(app);
		state.insert("agent", agent.name());
		write_state(app, state)?;
	}
	close_other_agents_sessions(app, agent);
	check_health(app);
	Ok(agent_folder_view(app))
}

/// The model `agent`'s new lessons start on, if the learner picked one; none is the agent's own
/// default.
pub(crate) fn start_model(app: &App, agent: FolderAgent) -> Option<String> {
	read_state(app).get("model").and_then(|models| models[agent.name()].as_str().map(str::to_owned))
}

/// The model a chat's next reply runs on: its own pick while its session is on `agent` (a pick
/// made on the other agent names a model this one would refuse), else `start`, `agent`'s start
/// model; None is the agent's own default.
pub(crate) fn chat_model(record: &Json, agent: FolderAgent, start: Option<String>) -> Option<String> {
	let session = record["agentSession"]["agent"].as_str().or_else(|| record["agent"].as_str());
	let own = record["model"].as_str().filter(|_| session.is_none_or(|on| on == agent.name()));
	own.map(str::to_owned).or(start)
}

/// PATCH /api/agent-folder `{model: {claude?, codex?}}`: each agent named gets its model, and
/// null clears one. Agents not named keep theirs.
pub fn set_agent_models(app: &App, models: &Json) -> Result<Json, SetUpError> {
	let Some(given) = models.as_obj().filter(|given| !given.is_empty()) else { return Err(SetUpError::Folder(MODEL_SHAPE.to_owned())) };
	let mut changes = Vec::new();
	for (name, model) in given.iter() {
		let agent = FolderAgent::from_name(name).ok_or_else(|| SetUpError::Folder(MODEL_SHAPE.to_owned()))?;
		match model {
			Json::Null => changes.push((agent, None)),
			Json::Str(model) if usable_model(model) => changes.push((agent, Some(model.clone()))),
			_ => return Err(SetUpError::Folder(MODEL_SHAPE.to_owned())),
		}
	}
	{
		let _held = app.locks.lock(STATE);
		let mut state = read_state(app);
		let mut saved = match state.get("model") {
			Some(Json::Obj(saved)) => saved.clone(),
			_ => Obj::new(),
		};
		for (agent, model) in changes {
			match model {
				Some(model) => saved.insert(agent.name(), model),
				None => saved.remove(agent.name()),
			};
		}
		if saved.is_empty() {
			state.remove("model");
		} else {
			state.insert("model", Json::Obj(saved));
		}
		write_state(app, state).map_err(SetUpError::Disk)?;
	}
	Ok(agent_folder_view(app))
}

const MODEL_SHAPE: &str = "model must name \"claude\" or \"codex\", each with a model's name or null";

fn folder_in(app: &App, state: &Obj) -> String {
	folder_of(state).unwrap_or_else(|| app.paths.default_agent_folder.to_string_lossy().into_owned())
}

pub(crate) fn agent_folder(app: &App) -> String {
	folder_in(app, &read_state(app))
}

/// Set up: the space-setup steps godspeed writes are there.
fn is_set_up(folder: &str) -> bool {
	Path::new(folder).join(SETUP_STEPS).exists()
}

/// The folder in use, when it is set up, for the menu's Open godspeed Folder.
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
pub(crate) fn cheat_sheets_dir(app: &App) -> PathBuf {
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

/// Where the folder is and whether it's set up. `oldSetup` is the old setup still left once the
/// folder is set up (the first-time notice covers people without one).
fn view_of(app: &App, state: &Obj, folder: &str) -> Json {
	let home = home_text(app);
	let exists = is_set_up(folder);
	let old = if exists { old_setup(app) } else { OldSetup { plugin: false, codex: false } };
	json!({
		"folder": folder,
		"short": short_folder(folder, &home),
		"exists": exists,
		"startCommands": state.get("startCommands").cloned().unwrap_or_else(|| Json::Obj(Obj::new())),
		"oldSetup": old.to_json(),
		// Null until the learner picks one: the window starts no agent by itself before that.
		"agent": picked_in(state).map(FolderAgent::name),
		"model": state.get("model").cloned().unwrap_or_else(|| Json::Obj(Obj::new())),
	})
}

pub fn agent_folder_view(app: &App) -> Json {
	let state = read_state(app);
	view_of(app, &state, &folder_in(app, &state))
}

/// write_folder, and a failure in words for the learner.
fn write_folder_or_explain(folder: &str) -> Result<(), SetUpError> {
	write_folder(folder).map_err(|err| SetUpError::Folder(format!("Couldn't write to {folder}: {err}")))
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
	write_folder_or_explain(&folder)?;
	let before = remember_folder(app, &folder).map_err(SetUpError::Disk)?;
	// A moved folder takes its shortcuts along.
	if let Some(before) = before.filter(|b| resolve(Path::new(b)) != resolve(Path::new(&folder))) {
		sync_shortcuts_safely(app, &tidy(&before), true);
	}
	sync_shortcuts_safely(app, &tidy(&folder), false);
	watch_space_shortcuts(app);
	export_old_talk(app, &folder);
	if let Err(err) = remove_old_setup(app) {
		eprintln!("[agent-folder] removing the old setup failed: {err}");
	}
	Ok(view_of(app, &read_state(app), &folder))
}

/// Start an agent with the learner's own command (empty: the usual one again). The agent is
/// checked again, since its own command is asked nothing.
pub fn set_start_command(app: &Arc<App>, agent: FolderAgent, command: &str) -> Result<Json, SetUpError> {
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
	check_health(app);
	Ok(agent_folder_view(app))
}

/// Once per app start: bring an existing folder's files up to this version.
pub(crate) fn refresh_agent_folder(app: &Arc<App>) {
	if app.misc.folder_refreshed.swap(true, Ordering::SeqCst) {
		return;
	}
	let folder = agent_folder(app);
	if is_set_up(&folder)
		&& let Err(err) = fill_folder(app, &folder)
	{
		eprintln!("[agent-folder] refresh failed: {err}");
	}
}

/// The folder the agent works in. Every session opens here, so a folder without godspeed's file
/// (a new install, or a folder the learner emptied) is set up first, and the agent always finds
/// its space-setup steps.
pub(crate) fn working_folder(app: &Arc<App>) -> Result<PathBuf, String> {
	let folder = agent_folder(app);
	if !is_set_up(&folder) {
		fill_folder(app, &folder).map_err(|err| format!("cannot make the godspeed folder {folder}: {err}"))?;
	}
	Ok(PathBuf::from(folder))
}

/// Writes the folder's file and spaces/ shortcuts, keeps the shortcuts in step, and exports the old
/// Talk chat once. The shortcuts are made even when the file failed; Err is that failure.
fn fill_folder(app: &Arc<App>, folder: &str) -> Result<(), String> {
	let written = write_folder(folder);
	sync_shortcuts_safely(app, &tidy(folder), false);
	watch_space_shortcuts(app);
	export_old_talk(app, folder);
	written
}

/// The old Talk chat goes into the first folder set up after the update, once: a `Talk.md` the
/// learner later moves or deletes does not come back.
fn export_old_talk(app: &App, folder: &str) {
	if read_state(app).contains_key("talkExported") {
		return;
	}
	match export_talk(app, Path::new(folder)) {
		Ok(false) => {}
		Ok(true) => {
			let _held = app.locks.lock(STATE);
			let mut state = read_state(app);
			state.insert("talkExported", true);
			if let Err(err) = write_state(app, state) {
				eprintln!("[agent-folder] saving the Talk export failed: {err}");
			}
		}
		Err(err) => eprintln!("[agent-folder] exporting Talk failed: {err}"),
	}
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

/// Where a file sits from the godspeed folder ("made/Algebra/Practice test.pdf") when it is in
/// the folder's made/, where the agent builds files for the learner. None for any other path.
pub(crate) fn made_path(app: &App, path: &str) -> Option<String> {
	let folder = resolve(Path::new(&agent_folder(app)));
	let at = resolve(Path::new(path));
	let from_folder = at.strip_prefix(&folder).ok()?;
	from_folder.starts_with("made").then(|| from_folder.to_string_lossy().replace('\\', "/"))
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
pub(crate) fn folder_notice_agent(app: &App) -> Option<&'static str> {
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
		assert_eq!(view["exists"], Json::Bool(false));
		let short = if cfg!(windows) { folder.as_str() } else { "~/godspeed" };
		assert_eq!(view["short"].as_str(), Some(short));
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
	fn the_lesson_agent_is_claude_code_until_codex_is_picked() {
		let root = scratch_dir("folder-agent");
		let app = test_app(&root);
		write_file_atomic(&state_file(&app), r#"{"agent":"gemini","noticeSeen":true}"#).unwrap();
		assert_eq!((folder_agent(&app), &agent_folder_view(&app)["agent"]), (FolderAgent::Claude, &Json::Null), "an agent godspeed can't run is Claude Code, and no pick to the window");
		let view = set_folder_agent(&app, FolderAgent::Codex).unwrap();
		assert_eq!((folder_agent(&app), view["agent"].as_str()), (FolderAgent::Codex, Some("codex")));
		assert_eq!(std::fs::read_to_string(state_file(&app)).unwrap(), "{\n\t\"noticeSeen\": true,\n\t\"agent\": \"codex\"\n}\n");
	}

	#[test]
	fn each_agent_keeps_its_own_picked_model_and_null_brings_its_default_back() {
		let root = scratch_dir("folder-model");
		let app = test_app(&root);
		assert_eq!(stringify(&agent_folder_view(&app)["model"]), "{}");
		let view = set_agent_models(&app, &json!({ "claude": "sonnet" })).unwrap();
		assert_eq!(stringify(&view["model"]), r#"{"claude":"sonnet"}"#);
		let view = set_agent_models(&app, &json!({ "codex": "gpt-6-luna" })).unwrap();
		assert_eq!(stringify(&view["model"]), r#"{"claude":"sonnet","codex":"gpt-6-luna"}"#, "one agent's pick leaves the other's");
		assert_eq!((start_model(&app, FolderAgent::Claude).as_deref(), start_model(&app, FolderAgent::Codex).as_deref()), (Some("sonnet"), Some("gpt-6-luna")));
		set_agent_models(&app, &json!({ "claude": null })).unwrap();
		assert_eq!(start_model(&app, FolderAgent::Claude), None);
		set_agent_models(&app, &json!({ "codex": null })).unwrap();
		assert_eq!(std::fs::read_to_string(state_file(&app)).unwrap(), "{}\n", "no picks, no model key");
		for bad in [json!({}), json!({ "gemini": "x" }), json!({ "claude": 3 }), json!({ "claude": "" }), json!({ "claude": "a\nb" }), json!("sonnet")] {
			assert!(matches!(set_agent_models(&app, &bad), Err(SetUpError::Folder(_))), "{}", stringify(&bad));
		}
		write_file_atomic(&state_file(&app), r#"{"model":{"claude":"opus","codex":7,"gemini":"x"}}"#).unwrap();
		assert_eq!(stringify(&agent_folder_view(&app)["model"]), r#"{"claude":"opus"}"#, "only usable picks are read");
	}

	#[test]
	fn the_learners_own_start_command_is_kept_and_an_empty_one_brings_the_usual_back() {
		let root = scratch_dir("folder-start-command");
		let app = test_app(&root);
		let view = set_start_command(&app, FolderAgent::Claude, "  standardcompute launch claude --  ").unwrap();
		assert_eq!(stringify(&view["startCommands"]), r#"{"claude":"standardcompute launch claude --"}"#);
		assert_eq!(view["exists"], Json::Bool(false), "saving the command doesn't make the folder");
		assert!(!root.join("home/godspeed").exists());
		assert_eq!(start_command(&app, FolderAgent::Claude).as_deref(), Some("standardcompute launch claude --"));

		set_start_command(&app, FolderAgent::Codex, "standardcompute launch codex --").unwrap();
		assert_eq!(stringify(&agent_folder_view(&app)["startCommands"]), r#"{"claude":"standardcompute launch claude --","codex":"standardcompute launch codex --"}"#);

		let view = set_start_command(&app, FolderAgent::Claude, "").unwrap();
		assert_eq!(stringify(&view["startCommands"]), r#"{"codex":"standardcompute launch codex --"}"#);
		assert_eq!(start_command(&app, FolderAgent::Claude), None);
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

	/// The Talk chat an older build left, with one message.
	fn old_talk_saying_hi(app: &App) {
		let record = r#"{"id":"chat_talk","title":"Talk","createdAt":"2026-11-01T10:00:00.000Z","updatedAt":"2026-11-01T10:00:00.000Z","kind":"talk","messages":[{"id":"m1","role":"user","content":"hi"}]}"#;
		fsx::write_text_atomic(&app.paths.chats.join("chat_talk.json"), record).unwrap();
	}

	#[test]
	fn the_old_talk_chat_is_exported_once() {
		let root = scratch_dir("folder-talk");
		let app = test_app(&root);
		let folder = agent_folder(&app);
		export_old_talk(&app, &folder);
		assert!(!state_file(&app).exists(), "no Talk chat, nothing to remember");
		old_talk_saying_hi(&app);
		export_old_talk(&app, &folder);
		let talk = Path::new(&folder).join("Talk.md");
		assert!(std::fs::read_to_string(&talk).unwrap().ends_with("\n**You**\n\nhi\n"));
		assert_eq!(std::fs::read_to_string(state_file(&app)).unwrap(), "{\n\t\"talkExported\": true\n}\n");
		std::fs::remove_file(&talk).unwrap();
		export_old_talk(&app, &folder);
		assert!(!talk.exists(), "a Talk.md the learner deleted stays deleted");
	}

	#[test]
	fn the_learners_own_talk_md_is_kept_and_the_export_goes_beside_it() {
		let root = scratch_dir("folder-talk-mine");
		let app = test_app(&root);
		let folder = agent_folder(&app);
		old_talk_saying_hi(&app);
		let talk = Path::new(&folder).join("Talk.md");
		fsx::write_text_atomic(&talk, "my own notes").unwrap();
		export_old_talk(&app, &folder);
		assert_eq!(std::fs::read_to_string(&talk).unwrap(), "my own notes");
		assert!(std::fs::read_to_string(Path::new(&folder).join("Talk (godspeed).md")).unwrap().ends_with("\n**You**\n\nhi\n"));
		assert_eq!(std::fs::read_to_string(state_file(&app)).unwrap(), "{\n\t\"talkExported\": true\n}\n");
	}

	#[cfg(unix)]
	#[test]
	fn an_export_that_fails_is_tried_again_next_start() {
		use std::os::unix::fs::PermissionsExt;
		let root = scratch_dir("folder-talk-locked");
		let app = test_app(&root);
		let folder = agent_folder(&app);
		old_talk_saying_hi(&app);
		let record = std::fs::read(app.paths.chats.join("chat_talk.json")).unwrap();
		std::fs::create_dir_all(&folder).unwrap();
		std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o555)).unwrap();
		export_old_talk(&app, &folder);
		std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o755)).unwrap();
		assert!(!state_file(&app).exists(), "the flag is not set");
		assert_eq!(std::fs::read(app.paths.chats.join("chat_talk.json")).unwrap(), record);
		export_old_talk(&app, &folder);
		assert!(Path::new(&folder).join("Talk.md").exists());
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
