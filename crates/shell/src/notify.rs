//! System notifications the server asks for (deadline reminders), shown from Rust with Tauri's
//! notification plugin. Clicks are not handled.

use tauri::plugin::{Plugin, TauriPlugin};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_notification::NotificationExt;

use crate::log;

/// The plugin without its page script. That script asks the app for the notification permission
/// on every page load, and the demo window, which may call no command, would report the refusal
/// as an error in every demo. Nothing in a page uses notifications.
pub struct Notifications(TauriPlugin<Wry>);

impl Notifications {
	pub fn new() -> Notifications {
		Notifications(tauri_plugin_notification::init())
	}
}

impl Plugin<Wry> for Notifications {
	fn name(&self) -> &'static str {
		self.0.name()
	}

	fn initialize(&mut self, app: &AppHandle, config: serde_json::Value) -> Result<(), Box<dyn std::error::Error>> {
		self.0.initialize(app, config)
	}
}

/// Hands the notification to the system, unless the window has the focus: the learner then sees
/// the deadline on Today already, and a Mac may skip the banner of the app in front. The answer is
/// whether it was handed over.
pub fn show(app: &AppHandle, title: &str, body: &str) -> bool {
	if app.get_webview_window("main").is_some_and(|main| main.is_focused().unwrap_or(false)) {
		return false;
	}
	match app.notification().builder().title(title).body(body).show() {
		Ok(()) => true,
		Err(err) => {
			log::line(&format!("notification: {err}"));
			false
		}
	}
}
