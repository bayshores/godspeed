//! The terminal commands (`window.lh.terminals` in shim.js). Each checks `trusted_terminal()`
//! first, so they come from the main window or the terminal window. The page names a role, an
//! agent and a terminal id; it never names a program, an argument or a folder, and it can type
//! only into a terminal it shows: keys only while its window has the focus, an attached file's
//! path also while it has not.

use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State, Webview};

use super::attach::attachment_bytes;
use super::{Agent, NOT_SET_UP, Outlet, Prompt, Role, Terminals, To};
use crate::commands::{AppOrigin, trusted_terminal};
use crate::paths::Paths;
use crate::server::Server;
use crate::window::TERMINAL_WINDOWS;
use crate::{log, push};

/// The app's outlet: pushes to the page, the live ids and typed messages to the server, lines to
/// the log.
pub struct AppOutlet(pub AppHandle);

impl Outlet for AppOutlet {
	fn push(&self, to: To, channel: &str, payload: Value) {
		match to {
			To::All => TERMINAL_WINDOWS.iter().for_each(|label| push::push_to(&self.0, label, channel, &payload)),
			To::Window(label) => push::push_to(&self.0, label, channel, &payload),
		}
	}

	fn live(&self, ids: Vec<String>, teacher: Option<String>) {
		if let Some(server) = self.0.try_state::<Server>() {
			server.send(None, &gs_shell_rpc::ToServer::Terminals { live: ids, teacher });
		}
	}

	fn typed(&self, id: &str) {
		if let Some(server) = self.0.try_state::<Server>() {
			server.send(None, &gs_shell_rpc::ToServer::Typed { terminal: id.to_owned() });
		}
	}

	fn log(&self, line: &str) {
		log::line(line);
	}
}

/// The calling window's label, when that window has the focus.
fn focused(webview: &Webview) -> Option<&str> {
	webview.window().is_focused().unwrap_or(false).then(|| webview.label())
}

/// Starts the godspeed folder's start script for a role and an agent: `{ id }`, or why it could
/// not. The server says where the folder is. `resume`: the teacher's chat to go back to.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn terminal_start(webview: Webview, origin: State<AppOrigin>, terminals: State<Terminals>, paths: State<Paths>, server: State<Server>, role: String, agent: String, resume: Option<String>) -> Result<Value, String> {
	trusted_terminal(&webview, &origin)?;
	let (Some(role), Some(agent)) = (Role::parse(&role), Agent::parse(&agent)) else { return Err(NOT_SET_UP.to_owned()) };
	let folder = server.agent_folder().ok_or(super::NO_START)?.ok_or(NOT_SET_UP)?;
	let id = terminals.start(role, agent, &folder, std::env::vars_os().collect(), &paths.data, resume.as_deref())?;
	Ok(json!({ "id": id }))
}

#[tauri::command(async)]
pub fn terminal_attach(webview: Webview, origin: State<AppOrigin>, terminals: State<Terminals>, id: String) -> Result<(), String> {
	trusted_terminal(&webview, &origin)?;
	terminals.attach(&id, webview.label())
}

#[tauri::command(async)]
pub fn terminal_detach(webview: Webview, origin: State<AppOrigin>, terminals: State<Terminals>, id: String) -> Result<(), String> {
	trusted_terminal(&webview, &origin)?;
	terminals.detach(&id, webview.label())
}

/// Without `async`, so the last size asked is the last one set. Answers the size in force.
#[tauri::command]
pub fn terminal_resize(webview: Webview, origin: State<AppOrigin>, terminals: State<Terminals>, id: String, cols: u16, rows: u16) -> Result<Value, String> {
	trusted_terminal(&webview, &origin)?;
	let (cols, rows) = terminals.resize(&id, cols, rows)?;
	Ok(json!({ "cols": cols, "rows": rows }))
}

/// Without `async`, so keys reach the terminal in the order they were typed.
#[tauri::command]
pub fn terminal_write(webview: Webview, origin: State<AppOrigin>, terminals: State<Terminals>, id: String, data: String) -> Result<(), String> {
	trusted_terminal(&webview, &origin)?;
	terminals.write(&id, &data, focused(&webview))
}

/// The trust and Enter buttons.
#[tauri::command]
pub fn terminal_answer(webview: Webview, origin: State<AppOrigin>, terminals: State<Terminals>, id: String, kind: String) -> Result<(), String> {
	trusted_terminal(&webview, &origin)?;
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
	trusted_terminal(&webview, &origin)?;
	let text = clipboard_text().unwrap_or_default();
	terminals.paste(&id, &text, focused(&webview))
}

/// A starter key's line, sent as if the learner typed it. Off the main thread: it waits for the
/// agent's input to show the line.
#[tauri::command(async)]
pub fn terminal_send(webview: Webview, origin: State<AppOrigin>, terminals: State<Terminals>, id: String, line: String) -> Result<(), String> {
	trusted_terminal(&webview, &origin)?;
	terminals.send(&id, &line, focused(&webview))
}

/// Attach: a picture or a PDF the learner picked or dropped on the teacher's screen, as base64.
/// Off the main thread: a 20 MB file is decoded, hashed and written, after a wait for the
/// folder. Answers the path.
#[tauri::command(async)]
pub fn terminal_add_file(webview: Webview, origin: State<AppOrigin>, terminals: State<Terminals>, server: State<Server>, id: String, name: String, data: String) -> Result<String, String> {
	trusted_terminal(&webview, &origin)?;
	let bytes = attachment_bytes(&data)?;
	let folder = server.agent_folder().flatten().ok_or(NOT_SET_UP)?;
	terminals.add_file(&id, &name, &bytes, std::path::Path::new(&folder), webview.label())
}

#[tauri::command(async)]
pub fn terminal_stop(webview: Webview, origin: State<AppOrigin>, terminals: State<Terminals>, id: String) -> Result<(), String> {
	trusted_terminal(&webview, &origin)?;
	terminals.stop(&id)
}

#[tauri::command(async)]
pub fn terminal_list(webview: Webview, origin: State<AppOrigin>, terminals: State<Terminals>) -> Result<Value, String> {
	trusted_terminal(&webview, &origin)?;
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
		assert_eq!(commands.len(), 11);
		for command in commands {
			let body = &command[command.find('{').unwrap() + 1..];
			assert!(body.trim_start().starts_with("trusted_terminal(&webview, &origin)?;"), "{}", &command[..80]);
		}
	}
}
