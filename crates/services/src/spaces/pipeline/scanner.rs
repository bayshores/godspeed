//! The scanner: catches up files left unfinished, rescans linked folders and checks the notes vault on a timer.

use std::sync::Arc;

use gs_base::clock;
use gs_base::tasks::detach;
use gs_core::spaces::file_state::FileStatus;

use super::enqueue_file;
use super::indexing::index_unindexed_files;
use crate::spaces::folder::scan_linked_folder;
use crate::App;

/// How long after launch the catch-up of unfinished files waits.
const STARTUP_SCAN_DELAY_MS: i64 = 10_000;
const SCAN_PERIOD_MS: i64 = 60_000;

/// Queues every file left waiting or unfinished (app start, the graph turned back on).
pub fn queue_waiting_files(app: &Arc<App>) {
	for record in app.stores.spaces.list_space_records() {
		if record["closed"].truthy() {
			continue;
		}
		for file in record["files"].items() {
			if FileStatus::of(file).is_some_and(FileStatus::is_waiting) {
				enqueue_file(app, record["id"].str_or_empty(), file["id"].str_or_empty());
			}
		}
	}
}

/// Starts the 60-second linked-folder scan and vault check, once per process. Ten seconds after the start (so it
/// never competes with the window's first load) every space is checked once: waiting files
/// queued, linked folders rescanned, unindexed files indexed.
pub fn start_space_scanner(app: &Arc<App>) {
	if app.spaces.scanner_started.swap(true, std::sync::atomic::Ordering::SeqCst) {
		return;
	}
	let timer = app.clone();
	detach("spaces", async move {
		let mut due = clock::now_ms() + SCAN_PERIOD_MS;
		loop {
			clock::sleep_until(due).await;
			due = clock::now_ms() + SCAN_PERIOD_MS;
			for summary in timer.stores.spaces.list_spaces() {
				if !summary["closed"].truthy() && summary["linkedFolder"].truthy() {
					scan_linked_folder(&timer, summary["id"].str_or_empty(), false);
				}
			}
			crate::vault::minute_check(&timer);
			crate::vault::send_waiting(&timer);
		}
	});
	let startup = app.clone();
	detach("spaces", async move {
		clock::sleep(STARTUP_SCAN_DELAY_MS).await;
		queue_waiting_files(&startup);
		for record in startup.stores.spaces.list_space_records() {
			if !record["closed"].truthy() {
				scan_linked_folder(&startup, record["id"].str_or_empty(), false);
			}
		}
		index_unindexed_files(&startup).await;
	});
}
