//! Attach: a picture or a PDF saved in the godspeed folder and its path typed into the teacher's
//! input.

use std::path::Path;

use super::registry::Terminals;
use super::{NOT_SHOWN, NOT_THERE, Role, Terminal, state_ended};

/// The largest file Attach takes.
pub(super) const ATTACH_MAX: usize = 20 * 1024 * 1024;
pub(super) const ATTACH_TOO_BIG: &str = "That file is over 20 MB.";
pub(super) const ATTACH_KINDS: &str = "Attach takes pictures (PNG, JPEG, GIF or WebP) and PDFs.";
const ATTACH_TEACHER: &str = "Attach is for the teacher's screen.";
const ATTACH_NOT_SAVED: &str = "godspeed couldn't save that file in its folder.";
pub(super) const ATTACH_UNTYPABLE: &str = "godspeed's folder has a line break in its path, so Attach can't type it.";

impl Terminals {
	/// Attach: a picture or a PDF saved in the godspeed folder, where the agent reads it without
	/// asking, and its path typed into the teacher's input like a paste (escaped as a Finder drag
	/// types it), then a space and no Enter, so the learner adds words and sends. Answers the
	/// saved path. The terminal must be shown, but the window need not have the focus: a file
	/// dropped from Finder leaves Finder in front, and what is typed is only a path the shell
	/// saved itself.
	pub fn add_file(&self, id: &str, name: &str, bytes: &[u8], folder: &Path) -> Result<String, String> {
		let terminal = self.find(id)?;
		if terminal.role != Role::Teacher {
			return Err(ATTACH_TEACHER.to_owned());
		}
		let attached = terminal.state().attached;
		// Shown, but no focus check: a Finder drop leaves Finder in front. Safe, since only a path
		// the shell saved itself is typed, never a line break.
		if !attached {
			return Err(NOT_SHOWN.to_owned());
		}
		if bytes.len() > ATTACH_MAX {
			return Err(ATTACH_TOO_BIG.to_owned());
		}
		if !attachable(bytes) {
			return Err(ATTACH_KINDS.to_owned());
		}
		let dir = folder.join(".godspeed").join("attachments");
		let file = dir.join(attachment_name(name, bytes));
		let path = file.to_string_lossy().into_owned();
		if path.chars().any(char::is_control) {
			return Err(ATTACH_UNTYPABLE.to_owned());
		}
		let existed = file.exists();
		std::fs::create_dir_all(&dir).and_then(|()| gs_base::fsx::write_atomic(&file, bytes, None)).map_err(|_| ATTACH_NOT_SAVED.to_owned())?;
		send_attachment(&terminal, &file, existed)?;
		Ok(path)
	}
}

/// An attached file's bytes from the page's base64 text. The text's length bounds the bytes, so
/// a file over the limit is refused before it is decoded.
pub fn attachment_bytes(data: &str) -> Result<Vec<u8>, String> {
	if data.len() / 4 * 3 > ATTACH_MAX + 2 {
		return Err(ATTACH_TOO_BIG.to_owned());
	}
	Ok(gs_base::base64::decode(data))
}

/// Types a saved attachment's path, if the terminal is still shown and running: the save took a
/// while, off the main thread. When it is not, a copy this attach made goes again.
pub(super) fn send_attachment(terminal: &Terminal, file: &Path, existed: bool) -> Result<(), String> {
	let typed = typed_path(&file.to_string_lossy());
	let sent = {
		let state = terminal.state();
		let typed = if state.screen.bracketed_paste() { format!("\x1b[200~{typed}\x1b[201~ ") } else { format!("{typed} ") };
		if state.attached { state.io.as_ref().filter(|_| !state_ended(&state)).ok_or(NOT_THERE).and_then(|io| io.input.send(typed.into_bytes()).map_err(|_| NOT_THERE)) } else { Err(NOT_SHOWN) }
	};
	if sent.is_err() && !existed {
		let _ = std::fs::remove_file(file);
	}
	sent.map_err(str::to_owned)
}

/// A path as a drag from the file manager types it into a terminal: on Windows in quotes when it
/// has a space, elsewhere with a backslash before each space and character a shell reads.
pub(super) fn typed_path(path: &str) -> String {
	if cfg!(windows) {
		return if path.contains(' ') { format!("\"{path}\"") } else { path.to_owned() };
	}
	let mut typed = String::with_capacity(path.len());
	for c in path.chars() {
		if c.is_whitespace() || "\\!\"#$&'()*;<>?[]^`{|}~".contains(c) {
			typed.push('\\');
		}
		typed.push(c);
	}
	typed
}

/// A picture (PNG, JPEG, GIF, WebP) or a PDF, by its first bytes.
pub(super) fn attachable(bytes: &[u8]) -> bool {
	let webp = bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP".as_slice());
	webp || [b"\x89PNG\r\n\x1a\n".as_slice(), b"\xff\xd8\xff", b"GIF8", b"%PDF-"].iter().any(|magic| bytes.starts_with(magic))
}

/// `<sha12>-<name>`: the name's last part, every character but letters, digits, `.`, `-` and `_`
/// as `_`, so the typed path needs no quotes in any agent or shell. The same file keeps its name.
pub(super) fn attachment_name(name: &str, bytes: &[u8]) -> String {
	let last = name.rsplit(['/', '\\']).next().unwrap_or_default();
	let clean: String = last.chars().map(|c| if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' }).collect();
	let clean = clean.trim_start_matches('.');
	let hash = gs_base::hash::sha256_hex(bytes);
	format!("{}-{}", &hash[..12], if clean.is_empty() { "file" } else { clean })
}
