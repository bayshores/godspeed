//! cheat-sheets.ts and cheat-sheet-pdf.ts: the one writer of a deadline's cheat sheet and the
//! requests behind it. Each message in a sheet's chat is one background request to the learner's
//! agent; one request at a time per sheet, and each change goes out as "cheat-sheet-changed".

mod cheat_sheet_pdf;
mod context;
mod files;
mod folder;
#[cfg(test)]
mod golden_tests;
mod reads;
mod run;

use std::collections::{HashMap, HashSet};

use gs_base::events::EventKind;
use gs_engine::turn::abort::Abort;
use gs_json::json;
use parking_lot::Mutex;

use crate::App;

pub use reads::{cheat_sheet_file, cheat_sheet_pdf, cheat_sheet_view, class_sheets_view, sheet_pdf_file};
pub use run::{AskInput, ask, remove_rule, retry, stop};

/// The message a sheet's agent is answering.
pub(crate) struct Running {
	pub message_id: String,
	pub abort: Abort,
}

/// The message the last request failed on and why, for Try again.
pub(crate) struct Failed {
	pub message_id: String,
	pub error: String,
}

/// The live state inside `App`.
#[derive(Default)]
pub struct CheatSheetsState {
	pub(crate) runs: Mutex<HashMap<String, Running>>,
	pub(crate) failed: Mutex<HashMap<String, Failed>>,
	/// Folder PDFs already looked at ("<path> <mtime>"), so each is read once.
	pub(crate) folder_seen: Mutex<HashSet<String>>,
}

/// Why a call did not finish: a refusal the route answers with its status, or a throw (the
/// route's empty 500).
#[derive(Debug, PartialEq)]
pub enum Stop {
	Refuse(u16, String),
	Throw(String),
}

impl From<String> for Stop {
	fn from(message: String) -> Stop {
		Stop::Throw(message)
	}
}

pub type Outcome<T> = Result<T, Stop>;

pub(crate) fn refuse<T>(status: u16, error: impl Into<String>) -> Outcome<T> {
	Err(Stop::Refuse(status, error.into()))
}

pub(crate) fn changed(app: &App, deadline_id: &str) {
	app.events.emit(EventKind::CheatSheetChanged, json!({ "deadlineId": deadline_id }));
}

pub(crate) const NEWER: &str = "A newer godspeed saved this cheat sheet. Update godspeed to change it.";
pub(crate) const BUSY: &str = "Your agent is still answering your last message about this sheet.";
