//! The main window: built hidden on the boot page while the server starts, then sent to the app.
//! It keeps to the app origin, sends web links to the browser, saves downloads where the learner
//! picks, follows the page's title and shows itself once the page has drawn.
//!
//! WebKit asks about every frame's navigations without saying which frame, so a navigation
//! never opens the browser: a demo iframe sending itself to a web address would open it with
//! no click, over and over. Links leave through a new window or the shim's `open_link`.

use std::path::Path;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::Value;
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent};
use tauri::window::Color;
use tauri::{AppHandle, Manager, State, Url, Webview, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::commands::{AppOrigin, trusted};
use crate::paths::Paths;
use crate::push::push;
use crate::server::Server;
use crate::{log, zoom};

/// Paper, the window's color when no dark background is picked.
const PAPER: Color = Color(0xc9, 0xc7, 0xbd, 0xff);

/// A page that never asks to be shown still gets its window this long after it loaded.
const SHOW_FALLBACK: Duration = Duration::from_secs(5);

/// WebView2 refuses a second web view with other arguments in the same profile, so the demo
/// window keeps a profile of its own.
#[cfg(windows)]
const MAIN_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

/// Where the traffic lights sit: the three circles span x 16 to 76 with centers on y 23, in the
/// 48 px top bar, as in the Electron app (tao puts the first circle's left edge at x and its
/// center at y - 2).
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHTS: tauri::LogicalPosition<f64> = tauri::LogicalPosition { x: 16.0, y: 25.0 };

const SHIM: &str = include_str!("shim.js");

/// The main page's load state and the settings section a menu asked for before the page could
/// take it.
#[derive(Default)]
pub struct Page {
	loaded: AtomicBool,
	open_settings: Mutex<Option<String>>,
}

/// Builds the main window on the boot page; `server::open_window` sends it to the app.
pub fn create(app: &AppHandle) -> tauri::Result<WebviewWindow> {
	let origin = app.state::<AppOrigin>().0.clone();
	// A closed window's page is gone: a menu's open-settings now waits for the new one.
	app.state::<Page>().loaded.store(false, Ordering::SeqCst);
	#[cfg(target_os = "macos")]
	crate::mac::window::register_text_defaults();
	let platform = match std::env::consts::OS {
		"macos" => "darwin",
		"windows" => "win32",
		other => other,
	};
	let shim = SHIM.replace("__APP_ORIGIN__", &Value::from(origin.as_str()).to_string()).replace("__PLATFORM__", &Value::from(platform).to_string());
	let show_armed = Arc::new(AtomicBool::new(true));
	let (nav_origin, new_window_origin, load_origin) = (origin.clone(), origin.clone(), origin);
	let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
		.title("godspeed")
		.inner_size(1440.0, 900.0)
		.min_inner_size(640.0, 600.0)
		.center()
		.visible(false)
		.background_color(background(&app.state::<Paths>().data.join("settings.json")))
		.initialization_script(shim)
		.zoom_hotkeys_enabled(false)
		// Tauri's own handler blocks the page's HTML5 drops.
		.disable_drag_drop_handler()
		.on_navigation(move |url| route(url, &nav_origin) == Route::Stay)
		// A sandboxed demo iframe cannot open windows, so this is the page itself.
		.on_new_window(move |url, _| {
			if route(&url, &new_window_origin) == Route::Browser {
				open_in_browser(&url);
			}
			NewWindowResponse::Deny
		})
		.on_download(save_download)
		// A loading page has an empty title for a moment. Every title change moves the Mac's
		// traffic lights back to their default place, so only a real change is passed on.
		.on_document_title_changed(|window, title| {
			if !title.is_empty() && window.title().is_ok_and(|current| current != title) {
				let _ = window.set_title(&title);
				#[cfg(target_os = "macos")]
				put_lights_back(window);
			}
		})
		.on_page_load(move |window, payload| {
			let page = window.state::<Page>();
			let url = payload.url();
			let app_page = url.origin().ascii_serialization() == load_origin && url.path() != "/api/desktop/login";
			match payload.event() {
				PageLoadEvent::Started => page.loaded.store(false, Ordering::SeqCst),
				PageLoadEvent::Finished if app_page => {
					page.loaded.store(true, Ordering::SeqCst);
					let app = window.app_handle();
					zoom::push_current(app);
					flush_open_settings(app);
					if show_armed.swap(false, Ordering::SeqCst) {
						show_later(window);
					}
				}
				PageLoadEvent::Finished => {}
			}
		});
	#[cfg(all(feature = "screens", target_os = "macos"))]
	let builder = match crate::screens::init_script() {
		Some(script) => builder.initialization_script(script),
		None => builder,
	};
	#[cfg(target_os = "macos")]
	let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true).traffic_light_position(TRAFFIC_LIGHTS).allow_link_preview(false);
	#[cfg(windows)]
	let builder = builder.additional_browser_args(MAIN_BROWSER_ARGS);
	// A debug build never shares localStorage or cookies with the installed app.
	#[cfg(target_os = "macos")]
	let builder = if cfg!(debug_assertions) { builder.data_store_identifier(*b"godspeed-dev-web") } else { builder };
	#[cfg(not(target_os = "macos"))]
	let builder = if cfg!(debug_assertions) { builder.data_directory(app.state::<crate::paths::Paths>().user_data.join("webview")) } else { builder };
	let main = builder.build()?;
	#[cfg(not(target_os = "macos"))]
	main.hide_menu()?;
	#[cfg(windows)]
	crate::win::drop::install(&main)?;
	Ok(main)
}

/// The window's own color, shown before the page paints: the dark background picked in Settings,
/// Appearance, else Paper. Read for each new window, so a pick shows the next time it opens.
fn background(settings: &Path) -> Color {
	let saved = std::fs::read_to_string(settings).ok().and_then(|text| serde_json::from_str::<Value>(&text).ok());
	saved.as_ref().and_then(|saved| saved.pointer("/appearance/background")).and_then(Value::as_str).and_then(|picked| picked.parse().ok()).unwrap_or(PAPER)
}

fn open_in_browser(url: &Url) {
	if let Err(err) = tauri_plugin_opener::open_url(url.as_str(), None::<&str>) {
		log::line(&format!("cannot open {url}: {err}"));
	}
}

/// Where a page may go: the app origin, the boot page and a demo iframe's own document stay;
/// a web or mail link belongs in the browser; any other scheme goes nowhere.
#[derive(Debug, PartialEq)]
enum Route {
	Stay,
	Browser,
	Nowhere,
}

fn route(url: &Url, origin: &str) -> Route {
	if url.origin().ascii_serialization() == origin || is_boot_page(url) || is_frame_document(url) {
		Route::Stay
	// The OS would hand any other scheme to whatever app registered it.
	} else if matches!(url.scheme(), "http" | "https" | "mailto") {
		Route::Browser
	} else {
		Route::Nowhere
	}
}

/// Tauri serves the boot page at `tauri://localhost` (`http://tauri.localhost` on Windows).
fn is_boot_page(url: &Url) -> bool {
	url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
}

/// A demo card's iframe loads its `srcdoc` as `about:srcdoc`, and an empty frame is `about:blank`.
fn is_frame_document(url: &Url) -> bool {
	url.scheme() == "about" && matches!(url.path(), "srcdoc" | "blank")
}

/// Blob downloads (demo and visual cards, Export as Markdown) ask where to save, as Electron
/// did. This runs on the main thread, where a synchronous save dialog must run.
fn save_download(webview: Webview, event: DownloadEvent<'_>) -> bool {
	match event {
		DownloadEvent::Requested { destination, .. } => {
			let folder = destination.parent().map(|p| p.to_path_buf()).or_else(|| webview.path().download_dir().ok()).unwrap_or_default();
			let name = destination.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
			match rfd::FileDialog::new().set_parent(&webview.window()).set_directory(folder).set_file_name(name).save_file() {
				Some(picked) => {
					*destination = picked;
					true
				}
				None => false,
			}
		}
		DownloadEvent::Finished { success, .. } => {
			log::line(&format!("download finished (success={success})"));
			true
		}
		_ => true,
	}
}

fn show_later(window: WebviewWindow) {
	std::thread::spawn(move || {
		std::thread::sleep(SHOW_FALLBACK);
		if window.is_visible().is_ok_and(|visible| !visible) {
			let _ = show(&window);
		}
	});
}

/// AppKit puts the traffic lights back in their default place when a hidden window first shows;
/// setting the title again makes tao move them to ours.
fn show(window: &WebviewWindow) -> tauri::Result<()> {
	window.show()?;
	#[cfg(target_os = "macos")]
	window.set_title(&window.title()?)?;
	Ok(())
}

/// The title change takes effect on the main thread a moment after `set_title` returns.
#[cfg(target_os = "macos")]
fn put_lights_back(window: WebviewWindow) {
	std::thread::spawn(move || {
		std::thread::sleep(Duration::from_millis(50));
		crate::mac::window::redraw_lights(&window);
	});
}

/// Sends the page to a Settings section: now if it has loaded, else once it has.
pub fn open_settings(app: &AppHandle, section: &str) {
	*app.state::<Page>().open_settings.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(section.to_owned());
	if app.state::<Page>().loaded.load(Ordering::SeqCst) {
		flush_open_settings(app);
	}
}

fn flush_open_settings(app: &AppHandle) {
	let section = app.state::<Page>().open_settings.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take();
	if let Some(section) = section {
		push(app, "open-settings", &Value::from(section));
	}
}

/// The main window again after it was closed (the Mac keeps the app running), logged in.
pub fn reopen(app: &AppHandle) {
	// Setup manages the server only after the old-app check and the port choice let the launch
	// go on; a Dock click while that check's dialog is up has no window to open.
	if app.try_state::<Server>().is_none() || app.get_webview_window("main").is_some() {
		return;
	}
	if let Err(err) = create(app) {
		log::line(&format!("cannot open the window: {err}"));
		return;
	}
	if app.state::<Server>().is_up() {
		let app = app.clone();
		std::thread::spawn(move || {
			// The server may be restarting. It keeps running; the next click tries again.
			if let Err(err) = app.state::<Server>().open_window(&app) {
				log::line(&err);
				if let Some(main) = app.get_webview_window("main") {
					let _ = main.destroy();
				}
			}
		});
	}
}

/// A web or mail link the learner clicked in the page (shim.js).
#[tauri::command]
pub fn open_link(webview: Webview, origin: State<AppOrigin>, url: String) -> Result<(), String> {
	trusted(&webview, &origin)?;
	let url: Url = url.parse().map_err(|_| "Not a link.".to_owned())?;
	if route(&url, &origin.0) != Route::Browser {
		return Err("Not a web link.".to_owned());
	}
	open_in_browser(&url);
	Ok(())
}

pub fn main_window(webview: &Webview) -> Result<WebviewWindow, String> {
	webview.app_handle().get_webview_window("main").ok_or_else(|| "no window".to_owned())
}

/// The page drew its first screen.
#[tauri::command]
pub fn show_window(webview: Webview, origin: State<AppOrigin>) -> Result<(), String> {
	trusted(&webview, &origin)?;
	let main = main_window(&webview)?;
	if !main.is_visible().map_err(|e| e.to_string())? {
		show(&main).map_err(|e| e.to_string())?;
		main.set_focus().map_err(|e| e.to_string())?;
	}
	Ok(())
}

/// A press on a drag area of the Mac title bar.
#[tauri::command]
pub fn start_drag(webview: Webview, origin: State<AppOrigin>) -> Result<(), String> {
	trusted(&webview, &origin)?;
	main_window(&webview)?.start_dragging().map_err(|e| e.to_string())
}

/// A lone Alt shows or hides the menu bar (Windows, Linux).
#[tauri::command]
pub fn toggle_menu(webview: Webview, origin: State<AppOrigin>) -> Result<(), String> {
	trusted(&webview, &origin)?;
	let main = main_window(&webview)?;
	let shown = main.is_menu_visible().map_err(|e| e.to_string())?;
	if shown { main.hide_menu() } else { main.show_menu() }.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
	use super::*;

	fn url(text: &str) -> Url {
		text.parse().unwrap()
	}

	/// The window color for a settings.json holding `text` (none: no file).
	fn background_for(name: &str, text: Option<&str>) -> Color {
		let dir = std::env::temp_dir().join(format!("gs-shell-window-{name}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		let file = dir.join("settings.json");
		if let Some(text) = text {
			gs_base::fsx::write_text_atomic(&file, text).unwrap();
		}
		let color = background(&file);
		std::fs::remove_dir_all(dir).unwrap();
		color
	}

	#[test]
	fn the_window_takes_the_picked_dark_background() {
		assert_eq!(background_for("night", Some(r##"{"appearance":{"background":"#1b1d2a"}}"##)), Color(0x1b, 0x1d, 0x2a, 0xff));
		assert_eq!(background_for("short", Some(r##"{"appearance":{"background":"#123"}}"##)), Color(0x11, 0x22, 0x33, 0xff));
	}

	#[test]
	fn the_window_is_paper_when_nothing_is_picked() {
		assert_eq!(background_for("missing", None), PAPER);
		for (name, text) in [("null", r#"{"appearance":{"background":null}}"#), ("no-appearance", r#"{"general":{}}"#), ("corrupt", "{"), ("not-a-color", r#"{"appearance":{"background":"paper"}}"#)] {
			assert_eq!(background_for(name, Some(text)), PAPER, "{name}");
		}
	}

	#[test]
	fn the_window_stays_on_the_app_origin_and_the_boot_page() {
		let origin = "http://127.0.0.1:48061";
		assert_eq!(route(&url("http://127.0.0.1:48061/space/x"), origin), Route::Stay);
		assert_eq!(route(&url("http://127.0.0.1:48061/api/desktop/login?token=ab"), origin), Route::Stay);
		assert_eq!(route(&url("tauri://localhost/index.html"), origin), Route::Stay);
		assert_eq!(route(&url("http://tauri.localhost/index.html"), origin), Route::Stay);
	}

	#[test]
	fn a_demo_iframe_keeps_its_own_document() {
		let origin = "http://127.0.0.1:48061";
		assert_eq!(route(&url("about:srcdoc"), origin), Route::Stay);
		assert_eq!(route(&url("about:blank"), origin), Route::Stay);
		assert_eq!(route(&url("about:config"), origin), Route::Nowhere);
	}

	#[test]
	fn only_web_and_mail_links_leave_the_app() {
		let origin = "http://127.0.0.1:48061";
		assert_eq!(route(&url("http://127.0.0.1:48062/"), origin), Route::Browser);
		assert_eq!(route(&url("https://example.com/a"), origin), Route::Browser);
		assert_eq!(route(&url("mailto:a@b.c"), origin), Route::Browser);
		assert_eq!(route(&url("file:///tmp/a"), origin), Route::Nowhere);
		assert_eq!(route(&url("smb://host/share"), origin), Route::Nowhere);
		assert_eq!(route(&url("javascript:alert(1)"), origin), Route::Nowhere);
		assert_eq!(route(&url("vscode://file/etc/passwd"), origin), Route::Nowhere);
		assert_eq!(route(&url("search-ms:query=x&crumb=location:\\\\host\\share"), origin), Route::Nowhere);
		assert_eq!(route(&url("x-apple.systempreferences:com.apple.preference.security"), origin), Route::Nowhere);
	}
}
