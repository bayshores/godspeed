//! The scanner: catches up files left unfinished, and each minute rescans linked folders, checks the
//! notes vault and the spaces.

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

/// Starts the 60-second linked-folder scan, vault check and space check, once per process. Ten
/// seconds after the start (so it never competes with the window's first load) every space is
/// gone over once (`scan_at_start`).
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
			crate::spaces::space_checks::check_spaces(&timer, clock::now_ms());
		}
	});
	let startup = app.clone();
	detach("spaces", async move {
		clock::sleep(STARTUP_SCAN_DELAY_MS).await;
		scan_at_start(&startup).await;
	});
}

/// Waiting files queued, linked folders rescanned, the spaces checked and unindexed files
/// indexed. The agent jobs run on is there from the start, so the spaces are checked now rather
/// than at the first minute's scan.
async fn scan_at_start(app: &Arc<App>) {
	queue_waiting_files(app);
	for record in app.stores.spaces.list_space_records() {
		if !record["closed"].truthy() {
			scan_linked_folder(app, record["id"].str_or_empty(), false);
		}
	}
	crate::spaces::space_checks::check_spaces(app, clock::now_ms());
	index_unindexed_files(app).await;
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[tokio::test]
	async fn the_spaces_are_checked_at_the_start() {
		let app = test_app(&scratch_dir("scan-at-start"));
		let id = app.stores.spaces.create_space(&json!({ "name": "Wave Optics" })).unwrap()["id"].str_or_empty().to_owned();
		app.stores.spaces.save_files(&id, vec![json!({ "id": "f1", "origin": "copied", "name": "Notes.md", "path": "f1/Notes.md", "kind": "study", "contentFp": "x", "status": "ready", "addedAt": "2026-11-01T10:00:00.000Z" })], &[]).unwrap();
		app.stores.spaces.add_deadline(&id, &json!({ "kind": "exam", "name": "Final", "date": "2099-03-02" })).unwrap();
		scan_at_start(&app).await;
		assert_eq!(app.spaces.requests.running.lock().checking.as_deref(), Some(id.as_str()), "the exam with nothing linked is checked");
	}
}
