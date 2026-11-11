//! The trust check every command makes first.

/// The origin of the app page: the server's, or Vite's in `desktop:dev`.
pub struct AppOrigin(pub String);

/// Only the main window's page on the app origin may call a command.
pub fn trusted(webview: &tauri::Webview, state: &AppOrigin) -> Result<(), String> {
	let on_app_origin = webview.url().is_ok_and(|url| url.origin().ascii_serialization() == state.0);
	if webview.label() == "main" && on_app_origin { Ok(()) } else { Err("Untrusted desktop request.".to_owned()) }
}
