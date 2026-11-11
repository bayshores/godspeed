//! Shell to page messages, through the shim's `window.__lhPush`, so the page needs no Tauri
//! event permissions.

use serde_json::Value;
use tauri::{AppHandle, Manager};

pub fn push(app: &AppHandle, channel: &str, payload: &Value) {
	let Some(main) = app.get_webview_window("main") else { return };
	// The boot page has no shim.
	let script = format!("window.__lhPush?.({}, {payload})", Value::from(channel));
	let _ = main.eval(script);
}
