//! Vault notes: godspeed writes one Obsidian-style note per idea into the learner's vault and
//! reads the vault for the teacher's search. The vault folder is the learner's own, so every
//! write goes through `write` and every read through the reader here.

mod index;
mod lesson_tool;
mod maintain;
mod notes_list;
mod pass;
mod search;
mod setup;
mod source;
#[cfg(test)]
mod test_support;
mod topic_data;
mod write;

use std::io;
use std::path::Path;

use parking_lot::Mutex;

use crate::App;
use index::VaultReader;

pub use lesson_tool::lesson_vault_tool;
pub use maintain::{minute_check, reviewed};
pub use notes_list::space_vault_notes;
pub use pass::{Ask, AskReply, PassState, Taken, answer_ask, catch_up, lesson_left, lesson_vault_notes, queue_lesson, send_waiting, take_for_grouping};
pub use search::search_vault;
pub use setup::{change_vault, notes_in_obsidian, retry_vault, vault_status};
pub use write::{picked_vault, write_vault_note, write_vault_words};

pub const NO_VAULT: &str = "No vault picked. The learner picks one in Settings.";

/// The vault's reader, opened on first use and again when the learner picks another folder.
#[derive(Default)]
pub struct VaultState {
	reader: Mutex<Option<VaultReader>>,
	pass: PassState,
}

/// Why the vault cannot be used now.
#[derive(Debug, PartialEq)]
pub enum VaultError {
	NoVault,
	/// The folder is not there (an unplugged drive, a folder the learner moved).
	Missing,
	Failed(String),
}

impl VaultError {
	fn of(err: &io::Error) -> VaultError {
		match err.kind() {
			io::ErrorKind::NotFound => VaultError::Missing,
			_ => VaultError::Failed(gs_base::fsx::error_code(err).map_or_else(|| err.to_string(), |code| format!("{code} ({err})"))),
		}
	}

	pub fn message(&self) -> String {
		match self {
			VaultError::NoVault => NO_VAULT.to_owned(),
			VaultError::Missing => "The vault folder is missing. Check that its drive is connected, or pick the vault again in Settings.".to_owned(),
			VaultError::Failed(why) => format!("The vault cannot be read: {why}"),
		}
	}
}

/// Runs `read` on the reader of the vault Settings names, opening it first when it is not open.
fn with_reader<T>(app: &App, read: impl FnOnce(&mut VaultReader) -> T) -> Result<T, VaultError> {
	let setting = setup::setting(app).map_err(VaultError::Failed)?;
	let root = setting.path.ok_or(VaultError::NoVault)?;
	let mut held = app.vault.reader.lock();
	if held.as_ref().is_none_or(|reader| reader.root() != Path::new(&root)) {
		*held = None;
		*held = Some(VaultReader::open(Path::new(&root)).map_err(|err| VaultError::of(&err))?);
	}
	Ok(read(held.as_mut().expect("opened above")))
}

/// Looks at the vault again. Ok(true) when a note changed.
fn rescan(app: &App) -> Result<bool, VaultError> {
	with_reader(app, |reader| reader.rescan().map_err(|err| VaultError::of(&err)))?
}

fn notes_changed(app: &App) {
	app.events.emit(gs_base::events::EventKind::VaultNotesChanged, gs_json::json!({}));
}
