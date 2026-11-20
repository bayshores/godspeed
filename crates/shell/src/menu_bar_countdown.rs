//! The menu bar item (Mac): the g logo, the time left to the nearest deadline beside it, and a
//! menu of the coming deadlines. The server decides the words; this only draws them. A click in
//! its menu reaches `menu::handle` through the app's run loop, as the app menu's do, so the item
//! registers no handler of its own (each click would run twice).

use gs_shell_rpc::CountdownRow;
use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Wry};

use crate::{log, menu};

const ID: &str = "menu-bar-countdown";

/// Shows the item with the server's words; the first time makes it.
pub fn show(app: &AppHandle, title: Option<String>, rows: Vec<CountdownRow>) {
	on_main(app, move |app| draw(app, title.as_deref(), &rows));
}

/// Takes the item out of the menu bar.
pub fn remove(app: &AppHandle) {
	on_main(app, |app| {
		app.remove_tray_by_id(ID);
		Ok(())
	});
}

/// AppKit's menu bar lives on the main thread.
fn on_main(app: &AppHandle, work: impl FnOnce(&AppHandle) -> tauri::Result<()> + Send + 'static) {
	let handle = app.clone();
	let sent = app.run_on_main_thread(move || {
		if let Err(err) = work(&handle) {
			log::line(&format!("cannot draw the menu bar countdown: {err}"));
		}
	});
	if let Err(err) = sent {
		log::line(&format!("cannot draw the menu bar countdown: {err}"));
	}
}

fn draw(app: &AppHandle, title: Option<&str>, rows: &[CountdownRow]) -> tauri::Result<()> {
	// The Mac drops a single "&" from menu text; "&&" shows one.
	let deadlines = rows.iter().map(|row| MenuItem::with_id(app, format!("page:go:{}", row.page), row.text.replace('&', "&&"), true, None::<&str>)).collect::<tauri::Result<Vec<_>>>()?;
	let separator = PredefinedMenuItem::separator(app)?;
	let open = MenuItem::with_id(app, menu::OPEN_WINDOW, "Open godspeed", true, None::<&str>)?;
	let quit = MenuItem::with_id(app, menu::QUIT, menu::QUIT_TEXT, true, None::<&str>)?;
	let mut items: Vec<&dyn IsMenuItem<Wry>> = deadlines.iter().map(|item| item as &dyn IsMenuItem<Wry>).collect();
	if !items.is_empty() {
		items.push(&separator);
	}
	items.extend([&open as &dyn IsMenuItem<Wry>, &quit]);
	let tray = match app.tray_by_id(ID) {
		Some(tray) => tray,
		// A template image: macOS tints it to the menu bar's text color.
		None => TrayIconBuilder::with_id(ID).icon(tauri::include_image!("icons/menu-bar-countdown.png")).icon_as_template(true).build(app)?,
	};
	tray.set_menu(Some(Menu::with_items(app, &items)?))?;
	tray.set_title(title)
}
