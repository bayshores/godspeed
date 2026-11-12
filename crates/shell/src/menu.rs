//! The application menu: the Edit items make ⌘C/⌘V work in the page, the View items own the
//! zoom keys. Built once at setup.

use tauri::menu::{AboutMetadata, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Wry};

use crate::{bug_report, log, update, window, zoom};

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

	let help = Submenu::with_items(app, "Help", true, &[&item("report-bug", "Report a Bug…", None)?])?;
	#[cfg(target_os = "macos")]
	help.set_as_help_menu_for_nsapp()?;

	Menu::with_items(app, &[&app_menu, &edit, &view, &window_menu, &help])
}

pub fn handle(app: &AppHandle, event: MenuEvent) {
	let main = app.get_webview_window("main");
	match event.id().as_ref() {
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
	window::reopen(app);
	if let Some(main) = app.get_webview_window("main") {
		let shown = main.unminimize().and_then(|()| main.set_focus());
		if let Err(err) = shown {
			log::line(&format!("cannot bring the window forward: {err}"));
		}
	}
	window::open_settings(app, "general");
	update::manual_check(app);
}
