//! The space services (src/backend/server/spaces.ts and its neighbours): the cross-store work
//! behind every space route, MCP space tool and the linked-folder scanner.
//!
//! spaces.ts is split by job: `lifecycle` (create, edit, delete, move a lesson), `deadlines`,
//! `files` (add, re-kind, retry, remove), `folder` (link, unlink, scan), `pipeline` (the per-space
//! file queue that turns files into text, facts and search passages) and `text_cache`. Its exports
//! are re-exported here, so callers write `spaces::add_copied_file`.

pub mod space_actions;
pub mod space_card;
pub mod space_search;
pub mod space_shortcuts;
mod deadlines;
mod files;
mod folder;
mod lifecycle;
mod pipeline;
mod state;
mod text_cache;

pub use deadlines::{add_space_deadline, deadline_with_space, list_space_deadlines, list_open_deadlines, remove_space_deadline, update_space_deadline};
pub use files::{AGENT_FILE_READING_REFUSAL, add_copied_file, add_file_from_path, remove_file, replace_copied_file, retry_file, set_file_kind, source_id_for};
pub use folder::{folder_status_of, link_folder, scan_linked_folder, unlink_folder};
pub use lifecycle::{delete_space, move_chat_to_space, request_space_scope, update_space};
pub use pipeline::{enqueue_file, queue_waiting_files, start_space_scanner};
pub use state::SpacesState;

/// Why a space action was refused: the HTTP status, a machine code and the message.
#[derive(Clone, Debug, PartialEq)]
pub struct SpaceFailure {
	pub status: u16,
	pub code: String,
	pub error: String,
}

impl SpaceFailure {
	/// What the TS threw (a disk error): routes answer it as an empty 500, like an uncaught throw.
	pub fn thrown(error: impl Into<String>) -> SpaceFailure {
		SpaceFailure { status: 500, code: String::new(), error: error.into() }
	}

	pub fn is_thrown(&self) -> bool {
		self.code.is_empty()
	}
}

/// `{ ok: true, value } | { ok: false, status, code, error }`.
pub type SpaceOutcome<T> = Result<T, SpaceFailure>;

pub(crate) fn fail<T>(status: u16, code: &str, error: impl Into<String>) -> SpaceOutcome<T> {
	Err(SpaceFailure { status, code: code.to_owned(), error: error.into() })
}

pub(crate) fn no_space<T>() -> SpaceOutcome<T> {
	fail(404, "not_found", "No such space")
}
