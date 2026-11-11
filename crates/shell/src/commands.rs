//! The trust check every command makes first, and the commands that reach the OS for the page
//! (`window.lh` in shim.js). Window, zoom and update commands live beside what they drive.

use tauri::{Manager, State, Webview};
use tauri_plugin_dialog::DialogExt;

use crate::{bug_report, fonts, open};

/// The origin of the app page: the server's, or Vite's in `desktop:dev`.
pub struct AppOrigin(pub String);

/// Only the main window's page on the app origin may call a command.
pub fn trusted(webview: &Webview, state: &AppOrigin) -> Result<(), String> {
	let on_app_origin = webview.url().is_ok_and(|url| url.origin().ascii_serialization() == state.0);
	if webview.label() == "main" && on_app_origin { Ok(()) } else { Err("Untrusted desktop request.".to_owned()) }
}

/// The native folder picker: the chosen absolute path, or null when cancelled.
#[tauri::command]
pub async fn pick_folder(webview: Webview, origin: State<'_, AppOrigin>) -> Result<Option<String>, String> {
	trusted(&webview, &origin)?;
	let (tx, mut rx) = tauri::async_runtime::channel(1);
	webview.dialog().file().set_parent(&webview.window()).pick_folder(move |picked| {
		let _ = tx.try_send(picked.and_then(|path| path.into_path().ok()).map(|path| path.to_string_lossy().into_owned()));
	});
	Ok(rx.recv().await.flatten())
}

/// Shows a file selected in Finder (the OS file manager).
#[tauri::command(async)]
pub fn show_in_folder(webview: Webview, origin: State<AppOrigin>, path: String) -> Result<(), String> {
	trusted(&webview, &origin)?;
	open::show_in_folder(&path)
}

/// Opens a folder or a PDF in its default app.
#[tauri::command(async)]
pub fn open_path(webview: Webview, origin: State<AppOrigin>, path: String) -> Result<(), String> {
	trusted(&webview, &origin)?;
	open::open_path(&path)
}

/// Opens a terminal running the godspeed folder's start script: null, or why it could not.
#[tauri::command(async)]
pub fn open_agent(webview: Webview, origin: State<AppOrigin>, folder: String, agent: String) -> Result<Option<String>, String> {
	trusted(&webview, &origin)?;
	Ok(open::open_agent(&folder, &agent))
}

#[tauri::command]
pub fn report_bug(webview: Webview, origin: State<AppOrigin>) -> Result<(), String> {
	trusted(&webview, &origin)?;
	bug_report::open(webview.app_handle());
	Ok(())
}

/// The installed font families. AppKit's font manager needs the main thread, where a command
/// without `async` runs; elsewhere the list is read off it.
#[cfg_attr(target_os = "macos", tauri::command)]
#[cfg_attr(not(target_os = "macos"), tauri::command(async))]
pub fn list_fonts(webview: Webview, origin: State<AppOrigin>) -> Result<Vec<String>, String> {
	trusted(&webview, &origin)?;
	Ok(fonts::list())
}

/// Commands the Mac needs from AppKit.
#[cfg(target_os = "macos")]
pub mod appkit {
	use std::path::{Path, PathBuf};

	use tauri::{State, Webview};

	use super::{AppOrigin, trusted};
	use crate::mac::window::DoubleClick;
	use crate::paths::Paths;
	use crate::{mac, window};

	/// The canonical path of a PDF inside the data folder, else why not.
	fn pdf_in(data: &Path, path: &str) -> Result<PathBuf, String> {
		let real = std::fs::canonicalize(path).map_err(|_| "That file isn't there.".to_owned())?;
		let inside = std::fs::canonicalize(data).is_ok_and(|data| real.starts_with(data));
		let is_pdf = real.is_file() && real.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"));
		if inside && is_pdf { Ok(real) } else { Err("Only a PDF in the godspeed data folder can be printed.".to_owned()) }
	}

	/// Opens the print sheet for a cheat sheet's PDF.
	#[tauri::command]
	pub fn print_pdf(webview: Webview, origin: State<AppOrigin>, paths: State<Paths>, path: String) -> Result<(), String> {
		trusted(&webview, &origin)?;
		mac::print::print_pdf(&window::main_window(&webview)?, &pdf_in(&paths.data, &path)?)
	}

	/// The paths of the files being dragged over the window (WebKit gives the page none).
	#[tauri::command]
	pub fn drag_paths(webview: Webview, origin: State<AppOrigin>) -> Result<Vec<String>, String> {
		trusted(&webview, &origin)?;
		Ok(mac::window::drag_paths())
	}

	/// A double-click on the title bar does what System Settings says.
	#[tauri::command]
	pub fn title_bar_double_click(webview: Webview, origin: State<AppOrigin>) -> Result<(), String> {
		trusted(&webview, &origin)?;
		let main = window::main_window(&webview)?;
		match mac::window::double_click_action() {
			DoubleClick::Minimize => main.minimize(),
			DoubleClick::Nothing => Ok(()),
			DoubleClick::Zoom if main.is_maximized().map_err(|err| err.to_string())? => main.unmaximize(),
			DoubleClick::Zoom => main.maximize(),
		}
		.map_err(|err| err.to_string())
	}

	#[cfg(test)]
	mod tests {
		use super::*;

		fn temp(name: &str) -> PathBuf {
			let dir = std::env::temp_dir().join(format!("gs-shell-print-{name}-{}", std::process::id()));
			let _ = std::fs::remove_dir_all(&dir);
			std::fs::create_dir_all(dir.join("data/cheat-sheets")).unwrap();
			std::fs::create_dir_all(dir.join("elsewhere")).unwrap();
			dir
		}

		#[test]
		fn only_a_pdf_inside_the_data_folder_prints() {
			let dir = temp("pdf-in");
			let data = dir.join("data");
			let sheet = data.join("cheat-sheets/v1.PDF");
			gs_base::fsx::write_text_atomic(&sheet, "%PDF").unwrap();
			gs_base::fsx::write_text_atomic(&data.join("notes.txt"), "x").unwrap();
			gs_base::fsx::write_text_atomic(&dir.join("elsewhere/a.pdf"), "%PDF").unwrap();
			std::os::unix::fs::symlink(dir.join("elsewhere/a.pdf"), data.join("link.pdf")).unwrap();

			assert_eq!(pdf_in(&data, sheet.to_str().unwrap()), Ok(std::fs::canonicalize(&sheet).unwrap()));
			let through_dots = format!("{}/cheat-sheets/../../elsewhere/a.pdf", data.display());
			for refused in [data.join("notes.txt").to_str().unwrap(), dir.join("elsewhere/a.pdf").to_str().unwrap(), data.join("link.pdf").to_str().unwrap(), &through_dots, data.join("cheat-sheets").to_str().unwrap()] {
				assert!(pdf_in(&data, refused).is_err(), "{refused}");
			}
			assert!(pdf_in(&data, data.join("missing.pdf").to_str().unwrap()).is_err());
			std::fs::remove_dir_all(dir).unwrap();
		}
	}
}
