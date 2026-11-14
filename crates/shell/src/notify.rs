//! System notifications the server asks for (deadline reminders), shown from Rust with Tauri's
//! notification plugin. Clicks are not handled. The Mac asks the learner once, at the first one.

use tauri::plugin::{Plugin, TauriPlugin};
use tauri::{AppHandle, Wry};
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

pub fn show(app: &AppHandle, title: &str, body: &str) {
	if let Err(err) = app.notification().builder().title(title).body(body).show() {
		log::line(&format!("notification: {err}"));
	}
}
