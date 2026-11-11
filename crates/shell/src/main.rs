//! godspeed, the desktop app: one window on the app page that godspeed-server serves.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bug_report;
mod commands;
mod demo;
#[cfg(not(target_os = "macos"))]
mod demo_webview;
mod first_run;
mod fonts;
mod log;
#[cfg(target_os = "macos")]
mod mac;
mod menu;
mod old_app;
mod open;
mod paths;
mod push;
mod quit;
mod restarts;
mod rpc;
mod server;
mod update;
mod window;
mod zoom;

use tauri::{App, Manager, RunEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::commands::AppOrigin;
use crate::paths::Paths;
use crate::server::Server;

fn main() {
	log::catch_panics();
	let builder = tauri::Builder::default();
	// Another launch brings the running window forward. Debug builds skip it, so they run
	// beside the installed app.
	#[cfg(not(debug_assertions))]
	let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
		// A window still hidden while the app starts shows itself once drawn.
		if let Some(main) = app.get_webview_window("main").filter(|main| main.is_visible().unwrap_or(false)) {
			let _ = main.unminimize();
			let _ = main.set_focus();
		}
	}));
	let app = builder
		.plugin(tauri_plugin_dialog::init())
		.invoke_handler(tauri::generate_handler![
			window::show_window,
			window::expand_window,
			window::start_drag,
			window::toggle_menu,
			window::open_link,
			zoom::get_zoom,
			zoom::set_zoom,
			zoom::zoom_step,
			zoom::zoom_reset,
			commands::pick_folder,
			commands::show_in_folder,
			commands::open_path,
			commands::open_agent,
			commands::report_bug,
			commands::list_fonts,
			#[cfg(target_os = "macos")]
			commands::appkit::print_pdf,
			#[cfg(target_os = "macos")]
			commands::appkit::drag_paths,
			#[cfg(target_os = "macos")]
			commands::appkit::title_bar_double_click,
		])
		.setup(setup)
		.build(tauri::generate_context!())
		.expect("the app could not start");
	app.run(|app, event| match event {
		RunEvent::ExitRequested { code, api, .. } => match code {
			// The last window closed: the Mac keeps the app running.
			None if cfg!(target_os = "macos") => api.prevent_exit(),
			Some(tauri::RESTART_EXIT_CODE) => quit::restarting(),
			_ => {}
		},
		RunEvent::Exit => quit::run(app),
		#[cfg(target_os = "macos")]
		RunEvent::Reopen { .. } => window::reopen(app),
		// A demo window left at that moment would keep the process alive.
		#[cfg(not(target_os = "macos"))]
		RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } if label == "main" => app.exit(0),
		RunEvent::MenuEvent(event) => menu::handle(app, event),
		_ => {}
	});
}

fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
	let handle = app.handle().clone();
	let paths = Paths::new(&handle)?;
	if old_app::electron_running(&paths.user_data) {
		// Nothing in userData is touched, not even the log the old app writes, and no server starts.
		let quit = handle.clone();
		handle.dialog().message(old_app::STILL_OPEN).title("godspeed").kind(MessageDialogKind::Info).buttons(MessageDialogButtons::Ok).show(move |_| quit.exit(0));
		return Ok(());
	}
	log::open(&paths.logs);
	if let Err(err) = old_app::write_pid(&paths.user_data) {
		log::line(&format!("cannot write shell.pid: {err}"));
	}
	first_run::run(&paths.user_data, &paths.updater_cache, &app.package_info().version.to_string());
	app.manage(paths);
	let server = match Server::choose() {
		Ok(server) => server,
		Err(err) => {
			log::line(&err);
			handle.exit(1);
			return Ok(());
		}
	};
	app.manage(AppOrigin(server.window_origin()));
	app.manage(window::Page::default());
	// Last of what the window needs: a managed server tells `window::reopen` it can build one.
	app.manage(server);
	app.manage(zoom::Zoom::default());
	app.manage(rpc::Demos::start(&handle));
	app.set_menu(menu::build(&handle)?)?;
	window::create(&handle)?;
	Server::start(&handle);
	Ok(())
}
