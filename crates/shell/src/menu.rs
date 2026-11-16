//! The application menu: the Edit items make ⌘C/⌘V work in the page, the View items own the
//! zoom keys, and on the Mac the File and Go items open the app's pages. Built once at setup.

use serde_json::Value;
use tauri::menu::{AboutMetadata, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Wry};

use crate::server::Server;
use crate::{bug_report, log, open, update, window, zoom};

#[cfg(target_os = "macos")]
const DEVTOOLS_KEYS: &str = "Alt+CmdOrCtrl+I";
#[cfg(not(target_os = "macos"))]
const DEVTOOLS_KEYS: &str = "Ctrl+Shift+I";

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
	let item = |id: &str, text: &str, keys: Option<&str>| MenuItem::with_id(app, id, text, true, keys);
	let separator = || PredefinedMenuItem::separator(app);
	let info = app.package_info();
	let about = AboutMetadata { name: Some(info.name.clone()), version: Some(info.version.to_string()), ..AboutMetadata::default() };

	let about = PredefinedMenuItem::about(app, Some("About godspeed"), Some(about))?;
	let check = item("check-updates", "Check for Updates…", None)?;
	// The predefined Quit is unsupported on GTK 3, so every OS shares this one.
	let quit = item("quit", "Quit godspeed", Some("CmdOrCtrl+Q"))?;
	let sep1 = separator()?;
	#[cfg(target_os = "macos")]
	let (hide, hide_others, sep2) = (PredefinedMenuItem::hide(app, None)?, PredefinedMenuItem::hide_others(app, None)?, separator()?);
	#[cfg(target_os = "macos")]
	let app_items: Vec<&dyn IsMenuItem<Wry>> = vec![&about, &check, &sep1, &hide, &hide_others, &sep2, &quit];
	#[cfg(not(target_os = "macos"))]
	let app_items: Vec<&dyn IsMenuItem<Wry>> = vec![&about, &check, &sep1, &quit];
	let app_menu = Submenu::with_items(app, "godspeed", true, &app_items)?;

	let (cut, copy, paste, select_all) = (PredefinedMenuItem::cut(app, None)?, PredefinedMenuItem::copy(app, None)?, PredefinedMenuItem::paste(app, None)?, PredefinedMenuItem::select_all(app, None)?);
	// GTK 3 has no Undo or Redo item, and a custom one would take Ctrl+Z from the page's editors.
	#[cfg(not(target_os = "linux"))]
	let (undo, redo, sep3) = (PredefinedMenuItem::undo(app, None)?, PredefinedMenuItem::redo(app, None)?, separator()?);
	#[cfg(not(target_os = "linux"))]
	let edit_items: Vec<&dyn IsMenuItem<Wry>> = vec![&undo, &redo, &sep3, &cut, &copy, &paste, &select_all];
	#[cfg(target_os = "linux")]
	let edit_items: Vec<&dyn IsMenuItem<Wry>> = vec![&cut, &copy, &paste, &select_all];
	let edit = Submenu::with_items(app, "Edit", true, &edit_items)?;

	#[cfg(target_os = "macos")]
	let fullscreen = PredefinedMenuItem::fullscreen(app, None)?;
	#[cfg(not(target_os = "macos"))]
	let fullscreen = item("fullscreen", "Toggle Full Screen", Some("F11"))?;
	let view = Submenu::with_items(
		app,
		"View",
		true,
		&[
			&item("reload", "Reload", Some("CmdOrCtrl+R"))?,
			&item("devtools", "Toggle Developer Tools", Some(DEVTOOLS_KEYS))?,
			&separator()?,
			// muda has no Plus key; the page catches ⌘+ (shim.js).
			&item("zoom-reset", "Actual Size", Some("CmdOrCtrl+0"))?,
			&item("zoom-in", "Zoom In", Some("CmdOrCtrl+="))?,
			&item("zoom-out", "Zoom Out", Some("CmdOrCtrl+-"))?,
			&separator()?,
			&fullscreen,
		],
	)?;

	#[cfg(target_os = "macos")]
	let window_menu = {
		let menu = Submenu::with_items(
			app,
			"Window",
			true,
			&[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::maximize(app, Some("Zoom"))?, &separator()?, &PredefinedMenuItem::bring_all_to_front(app, None)?],
		)?;
		menu.set_as_windows_menu_for_nsapp()?;
		menu
	};
	#[cfg(windows)]
	let window_menu = Submenu::with_items(app, "Window", true, &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::close_window(app, None)?])?;
	// GTK 3 has neither as a predefined item.
	#[cfg(target_os = "linux")]
	let window_menu = Submenu::with_items(app, "Window", true, &[&item("minimize", "Minimize", None)?, &item("close-window", "Close Window", None)?])?;

	// Windows and Linux leave these out: their keys would be Ctrl keys, which the agent's
	// terminal needs (Ctrl+[ is Esc).
	#[cfg(target_os = "macos")]
	let file = Submenu::with_items(
		app,
		"File",
		true,
		&[&item("page:new-session", "Study", Some("CmdOrCtrl+N"))?, &item("page:sessions-search", "Search Lessons", Some("CmdOrCtrl+Shift+F"))?, &separator()?, &item("open-folder", "Open godspeed Folder", None)?],
	)?;
	#[cfg(target_os = "macos")]
	let go = Submenu::with_items(
		app,
		"Go",
		true,
		&[
			&item("page:back", "Back", Some("CmdOrCtrl+["))?,
			&item("page:forward", "Forward", Some("CmdOrCtrl+]"))?,
			&separator()?,
			&item("page:go:/", "Today", None)?,
			&item("page:jump-graph", "Graph", Some("CmdOrCtrl+G"))?,
			&item("page:go:/space", "Progress", None)?,
			&item("page:go:/space/files", "Files", None)?,
			&item("page:go:/space/deadlines", "Deadlines", None)?,
			&item("page:go:/space/cheat-sheets", "Cheat Sheets", None)?,
		],
	)?;

	let help = Submenu::with_items(app, "Help", true, &[&item("report-bug", "Report a Bug…", None)?])?;
	#[cfg(target_os = "macos")]
	help.set_as_help_menu_for_nsapp()?;

	#[cfg(target_os = "macos")]
	return Menu::with_items(app, &[&app_menu, &file, &edit, &view, &go, &window_menu, &help]);
	#[cfg(not(target_os = "macos"))]
	Menu::with_items(app, &[&app_menu, &edit, &view, &window_menu, &help])
}

pub fn handle(app: &AppHandle, event: MenuEvent) {
	let id = event.id().as_ref();
	// The page runs a page item, as it does the same item's key in a browser.
	if let Some(action) = id.strip_prefix("page:") {
		show_window(app);
		window::push_when_loaded(app, "menu", Value::from(action));
		return;
	}
	let main = app.get_webview_window("main");
	match id {
		"open-folder" => open_folder(app),
		"check-updates" => check_for_updates(app),
		"quit" => app.exit(0),
		"reload" => {
			if let Some(main) = main {
				let _ = main.reload();
			}
		}
		"devtools" => {
			#[cfg(any(debug_assertions, feature = "devtools"))]
			if let Some(main) = main {
				if main.is_devtools_open() { main.close_devtools() } else { main.open_devtools() }
			}
		}
		"zoom-reset" => zoom::apply(app, 1.0),
		"zoom-in" => zoom::step(app, 1),
		"zoom-out" => zoom::step(app, -1),
		"fullscreen" => {
			if let Some(main) = main {
				let _ = main.is_fullscreen().and_then(|on| main.set_fullscreen(!on));
			}
		}
		"minimize" => {
			if let Some(main) = main {
				let _ = main.minimize();
			}
		}
		"close-window" => {
			if let Some(main) = main {
				let _ = main.close();
			}
		}
		"report-bug" => bug_report::open(app),
		_ => {}
	}
}

/// A manual check reports its result in Settings, General, so the window opens there.
fn check_for_updates(app: &AppHandle) {
	show_window(app);
	window::push_when_loaded(app, "open-settings", Value::from("general"));
	update::manual_check(app);
}

/// The main window, made again if it was closed, out of the Dock and in front.
fn show_window(app: &AppHandle) {
	window::reopen(app);
	if let Some(main) = app.get_webview_window("main") {
		let shown = main.unminimize().and_then(|()| window::focus(&main));
		if let Err(err) = shown {
			log::line(&format!("cannot bring the window forward: {err}"));
		}
	}
}

/// Asking the server for the folder waits on its answer, so it runs off the menu's thread.
fn open_folder(app: &AppHandle) {
	let app = app.clone();
	std::thread::spawn(move || {
		let folder = app.try_state::<Server>().and_then(|server| server.agent_folder()).flatten();
		let Some(folder) = folder else { return log::line("the godspeed folder is not set up yet") };
		if let Err(err) = open::open_path(&folder) {
			log::line(&format!("cannot open the godspeed folder: {err}"));
		}
	});
}
