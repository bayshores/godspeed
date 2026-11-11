//! The class services' live state (the TS module's globalThis maps), kept in memory only: every
//! launch rescans.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use gs_files::text::TextChecks;
use gs_json::Json;
use gs_transcribe::model::ModelDownload;
use parking_lot::Mutex;
use tokio::sync::Notify;

/// A linked-folder path at a class's last scan: its size and time (None once gone) and since
/// when it has held still.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct SeenFile {
	pub sig: Option<String>,
	pub since: i64,
}

/// One class's file queue: files wait in order and one worker processes them.
#[derive(Default)]
pub(super) struct Queue {
	pub waiting: VecDeque<String>,
	pub running: bool,
}

#[derive(Default)]
pub struct ClassesState {
	pub(super) queues: Mutex<HashMap<String, Queue>>,
	/// `<class>:<file>` keys waiting in a queue (a file is queued once).
	pub(super) queued: Mutex<HashSet<String>>,
	/// Told whenever a queue drains or a triage ends, for `class_idle` and waiting rescans.
	pub(super) settled: Arc<Notify>,
	/// Each class's linked folder at its last scan (a FolderStatus).
	pub(super) folder_scans: Mutex<HashMap<String, Json>>,
	/// Classes deleted while work was queued: their queued work is skipped.
	pub(super) cancelled: Mutex<HashSet<String>>,
	pub(super) seen_files: Mutex<HashMap<String, HashMap<String, SeenFile>>>,
	/// Classes whose new folder files are being triaged, by triage number.
	pub(super) triaging: Mutex<HashMap<String, u64>>,
	pub(super) triage_count: Mutex<u64>,
	pub(super) scanner_started: AtomicBool,
	pub(super) shortcut_watch: AtomicBool,
	pub(super) text_checks: TextChecks,
	pub(super) speech_model: ModelDownload,
}
