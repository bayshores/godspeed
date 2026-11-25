//! A line the learner typed in the teacher's terminal while a talk page (a lesson, a cheat sheet)
//! is on screen: the agent's prompt hook hands it here, the window's page sends it the way its own
//! box would, and the hook then blocks it in the terminal. Files from the terminal's attach button
//! come along as the page's attachments.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use gs_base::events::EventKind;
use gs_base::{base64, clock};
use gs_core::messages::attachments::{attachment_type, typed_attachments};
use gs_json::{Json, json};
use parking_lot::Mutex;
use tokio::sync::oneshot;

use super::agent_folder::agent_folder;
use crate::App;

/// How long the window has to say the page sent the line.
const CONFIRM_MS: i64 = 3_000;

#[derive(Default)]
pub struct Lines {
	next: AtomicU64,
	waiting: Mutex<HashMap<u64, oneshot::Sender<bool>>>,
}

/// The line goes to the page on screen when the learner just pressed Enter for it in the
/// teacher's terminal and the window confirms the page sent it: then the page's name ("lesson"),
/// and the shell clears the line Claude Code puts back in its input. Otherwise None, and the
/// agent reads the line as usual.
pub async fn take_terminal_line(app: &App, terminal: Option<&str>, line: &str) -> Option<String> {
	let page = to_page(app, terminal, line).await;
	if page.is_none()
		&& let Some(terminal) = terminal
	{
		app.terminals.chat_line(terminal, clock::now_ms());
		super::teacher_chats::typed(app, terminal, line);
	}
	page
}

async fn to_page(app: &App, terminal: Option<&str>, line: &str) -> Option<String> {
	let page = app.terminals.take_line(terminal, clock::now_ms())?;
	let terminal = terminal?;
	let (text, names) = typed_attachments(line);
	let attachments = read_attachments(&Path::new(&agent_folder(app)).join(".godspeed").join("attachments"), &names);
	let lines = &app.misc.lines;
	let id = lines.next.fetch_add(1, Ordering::Relaxed);
	let (tx, rx) = oneshot::channel();
	lines.waiting.lock().insert(id, tx);
	app.events.emit(EventKind::TerminalLine, json!({ "id": id, "text": text, "attachments": attachments }));
	let sent = tokio::select! {
		sent = rx => sent.unwrap_or(false),
		() = clock::sleep(CONFIRM_MS) => false,
	};
	lines.waiting.lock().remove(&id);
	if !sent {
		return None;
	}
	if let Some(shell) = &app.shell {
		shell.send(&gs_shell_rpc::ToShell::ClearLine { terminal: terminal.to_owned(), line: line.to_owned() });
	}
	Some(page)
}

/// The window's answer for line `id`: whether its page sent it. False when no line waits.
pub fn confirm_terminal_line(app: &App, id: u64, sent: bool) -> bool {
	app.misc.lines.waiting.lock().remove(&id).is_some_and(|tx| tx.send(sent).is_ok())
}

/// The named files the attach button saved, as attachments; a name with no such file is left out.
fn read_attachments(dir: &Path, names: &[String]) -> Vec<Json> {
	names
		.iter()
		.filter_map(|name| {
			let bytes = std::fs::read(dir.join(name)).ok()?;
			Some(json!({ "name": name, "mimeType": attachment_type(name, ""), "data": base64::encode(&bytes) }))
		})
		.collect()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn reads_only_the_named_files_that_are_there() {
		let dir = std::env::temp_dir().join(format!("gs-lines-{}", std::process::id()));
		std::fs::create_dir_all(&dir).unwrap();
		gs_base::fsx::write_atomic(&dir.join("0123456789ab-a.png"), b"ABC", None).unwrap();
		let read = read_attachments(&dir, &["0123456789ab-a.png".to_owned(), "0123456789ab-gone.pdf".to_owned()]);
		assert_eq!(read, vec![json!({ "name": "0123456789ab-a.png", "mimeType": "image/png", "data": "QUJD" })]);
		std::fs::remove_dir_all(&dir).unwrap();
	}
}
