//! The terminal commands (`window.lh.terminals` in shim.js). Each checks `trusted()` first. The
//! page names a role, an agent and a terminal id; it never names a program, an argument or a
//! folder, and it can type only into a terminal it shows while the window has the focus.

use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State, Webview};

use super::{Agent, NOT_SET_UP, Outlet, Prompt, Role, Terminals};
use crate::commands::{AppOrigin, trusted};
use crate::paths::Paths;
use crate::server::Server;
use crate::{log, push, window};

/// The app's outlet: pushes to the page, the live ids to the server, lines to the log.
pub struct AppOutlet(pub AppHandle);

impl Outlet for AppOutlet {
	fn push(&self, channel: &str, payload: Value) {
		push::push(&self.0, channel, &payload);
	}

	fn live(&self, ids: Vec<String>) {
		if let Some(server) = self.0.try_state::<Server>() {
			server.send(None, &gs_shell_rpc::ToServer::Terminals { live: ids });
		}
	}

	fn log(&self, line: &str) {
		log::line(line);
	}
}

fn focused(webview: &Webview) -> bool {
	window::main_window(webview).is_ok_and(|main| main.is_focused().unwrap_or(false))
}

/// Starts the godspeed folder's start script for a role and an agent: `{ id }`, or why it could
/// not. The server says where the folder is.
#[tauri::command(async)]
pub fn terminal_start(webview: Webview, origin: State<AppOrigin>, terminals: State<Terminals>, paths: State<Paths>, server: State<Server>, role: String, agent: String) -> Result<Value, String> {
	trusted(&webview, &origin)?;
	let (Some(role), Some(agent)) = (Role::parse(&role), Agent::parse(&agent)) else { return Err(NOT_SET_UP.to_owned()) };
	let folder = server.agent_folder().ok_or(super::NO_START)?.ok_or(NOT_SET_UP)?;
	let id = terminals.start(role, agent, &folder, std::env::vars_os().collect(), &paths.data)?;
	Ok(json!({ "id": id }))
}

#[tauri::command(async)]
pub fn terminal_attach(webview: Webview, origin: State<AppOrigin>, terminals: State<Terminals>, id: String) -> Result<(), String> {
	trusted(&webview, &origin)?;
	terminals.attach(&id)
}

#[tauri::command(async)]
pub fn terminal_detach(webview: Webview, origin: State<AppOrigin>, terminals: State<Terminals>, id: String) -> Result<(), String> {
	trusted(&webview, &origin)?;
	terminals.detach(&id)
}

/// Without `async`, so keys reach the terminal in the order they were typed.
#[tauri::command]
pub fn terminal_write(webview: Webview, origin: State<AppOrigin>, terminals: State<Terminals>, id: String, data: String) -> Result<(), String> {
	trusted(&webview, &origin)?;
	terminals.write(&id, &data, focused(&webview))
}

/// The trust and Enter buttons.
#[tauri::command]
pub fn terminal_answer(webview: Webview, origin: State<AppOrigin>, terminals: State<Terminals>, id: String, kind: String) -> Result<(), String> {
	trusted(&webview, &origin)?;
	let kind = match kind.as_str() {
		"trust" => Prompt::Trust,
		"enter" => Prompt::Enter,
		_ => return Err("Not a question godspeed answers.".to_owned()),
	};
	terminals.answer(&id, kind)
}

/// The shell reads the clipboard itself. The clipboard needs the main thread on the Mac and
/// Linux, where a command without `async` runs, in order with the keys.
#[tauri::command]
pub fn terminal_paste(webview: Webview, origin: State<AppOrigin>, terminals: State<Terminals>, id: String) -> Result<(), String> {
	trusted(&webview, &origin)?;
	let text = clipboard_text().unwrap_or_default();
	terminals.paste(&id, &text, focused(&webview))
}

#[tauri::command(async)]
pub fn terminal_stop(webview: Webview, origin: State<AppOrigin>, terminals: State<Terminals>, id: String) -> Result<(), String> {
	trusted(&webview, &origin)?;
	terminals.stop(&id)
}

#[tauri::command(async)]
pub fn terminal_list(webview: Webview, origin: State<AppOrigin>, terminals: State<Terminals>) -> Result<Value, String> {
	trusted(&webview, &origin)?;
	Ok(terminals.list())
}

#[cfg(target_os = "macos")]
fn clipboard_text() -> Option<String> {
	crate::mac::clipboard::text()
}

#[cfg(windows)]
fn clipboard_text() -> Option<String> {
	crate::win::clipboard::text()
}

#[cfg(target_os = "linux")]
fn clipboard_text() -> Option<String> {
	crate::linux::clipboard::text()
}

#[cfg(test)]
mod tests {
	#[test]
	fn every_terminal_command_checks_the_page_first() {
		let source = include_str!("commands.rs").split("#[cfg(test)]").next().unwrap();
		let commands: Vec<&str> = source.split("#[tauri::command").skip(1).collect();
		assert_eq!(commands.len(), 8);
		for command in commands {
			let body = &command[command.find('{').unwrap() + 1..];
			assert!(body.trim_start().starts_with("trusted(&webview, &origin)?;"), "{}", &command[..80]);
		}
	}
}
