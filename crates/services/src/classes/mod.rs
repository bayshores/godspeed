//! The class services (src/backend/server/classes.ts and its neighbours): the cross-store work
//! behind every class route, MCP class tool and the linked-folder scanner.
//!
//! classes.ts is split by job: `lifecycle` (create, edit, delete, move a lesson), `deadlines`,
//! `files` (add, re-kind, retry, remove), `folder` (link, unlink, scan), `pipeline` (the per-class
//! file queue that turns files into text, facts and search passages) and `text_cache`. Its exports
//! are re-exported here, so callers write `classes::add_copied_file`.

pub mod class_actions;
pub mod class_card;
pub mod class_search;
pub mod class_shortcuts;
mod deadlines;
mod files;
mod folder;
mod lifecycle;
mod pipeline;
mod state;
mod text_cache;

pub use deadlines::{add_class_deadline, deadline_with_class, list_class_deadlines, list_open_deadlines, remove_class_deadline, update_class_deadline};
pub use files::{AGENT_FILE_READING_REFUSAL, add_copied_file, add_file_from_path, remove_file, replace_copied_file, retry_file, set_file_kind, source_id_for};
pub use folder::{folder_status_of, link_folder, scan_linked_folder, unlink_folder};
pub use lifecycle::{create_class, delete_class, get_class, list_classes, move_chat_to_class, request_class_scope, update_class};
pub use pipeline::{enqueue_file, queue_waiting_files, start_class_scanner};
pub use state::ClassesState;

/// Why a class action was refused: the HTTP status, a machine code and the message.
#[derive(Clone, Debug, PartialEq)]
pub struct ClassFailure {
	pub status: u16,
	pub code: String,
	pub error: String,
}

impl ClassFailure {
	/// What the TS threw (a disk error): routes answer it as an empty 500, like an uncaught throw.
	pub fn thrown(error: impl Into<String>) -> ClassFailure {
		ClassFailure { status: 500, code: String::new(), error: error.into() }
	}

	pub fn is_thrown(&self) -> bool {
		self.code.is_empty()
	}
}

/// `{ ok: true, value } | { ok: false, status, code, error }`.
pub type ClassOutcome<T> = Result<T, ClassFailure>;

pub(crate) fn fail<T>(status: u16, code: &str, error: impl Into<String>) -> ClassOutcome<T> {
	Err(ClassFailure { status, code: code.to_owned(), error: error.into() })
}

pub(crate) fn no_class<T>() -> ClassOutcome<T> {
	fail(404, "not_found", "No such class")
}
