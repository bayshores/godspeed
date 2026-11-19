//! Shell to page messages, through the shim's `window.__lhPush`, so the page needs no Tauri
//! event permissions.

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::window::MAIN;

/// Pushes to the main window.
pub fn push(app: &AppHandle, channel: &str, payload: &Value) {
	push_to(app, MAIN, channel, payload);
}

/// Pushes to the window with this label; nothing happens when there is none.
pub fn push_to(app: &AppHandle, label: &str, channel: &str, payload: &Value) {
	let Some(window) = app.get_webview_window(label) else { return };
	// The boot page has no shim.
	let script = format!("window.__lhPush?.({}, {payload})", Value::from(channel));
	let _ = window.eval(script);
}
