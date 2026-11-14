//! The agent requests a prep has out: its sheet and, per mock, the questions or the grades. One
//! at a time per key; each start and end goes out as "prep-changed", and the last failure is kept
//! for Try again.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;

use gs_base::events::EventKind;
use gs_base::locks::LockKey;
use gs_engine::turn::abort::Abort;
use gs_json::json;
use parking_lot::Mutex;

use crate::App;

#[derive(Default)]
struct Runs {
	/// Each key's request out now, with the number that tells it from a later one.
	running: HashMap<String, (u64, Abort)>,
	/// Why each key's last request failed.
	failed: HashMap<String, String>,
	started: u64,
}

/// The live state inside `App`.
#[derive(Default)]
pub struct MockRunsState(Mutex<Runs>);

/// The key of a mock's request (a prep's sheet is keyed by its space id).
pub fn mock_run_key(space_id: &str, mock_id: &str) -> String {
	format!("{space_id}/{mock_id}")
}

pub fn is_running(app: &App, key: &str) -> bool {
	app.mocks.runs.0.lock().running.contains_key(key)
}

pub fn run_error(app: &App, key: &str) -> Option<String> {
	app.mocks.runs.0.lock().failed.get(key).cloned()
}

fn changed(app: &App, space_id: &str) {
	app.events.emit(EventKind::PrepChanged, json!({ "spaceId": space_id }));
}

/// Ends a run however its task ends: forgotten (unless a later run took its key) and announced.
struct RunEnd {
	app: Arc<App>,
	space_id: String,
	key: String,
	n: u64,
}

impl Drop for RunEnd {
	fn drop(&mut self) {
		// The space lock: a space delete that stopped this run finishes before the run ends.
		let _guard = self.app.locks.lock(LockKey::Space(&self.space_id));
		{
			let mut runs = self.app.mocks.runs.0.lock();
			if runs.running.get(&self.key).is_some_and(|(n, _)| *n == self.n) {
				runs.running.remove(&self.key);
			}
		}
		changed(&self.app, &self.space_id);
	}
}

/// Starts `work` under `key`; false when that key's request is still out.
pub fn start_run<F>(app: &Arc<App>, space_id: &str, key: &str, work: impl FnOnce(Abort) -> F) -> bool
where
	F: Future<Output = Result<(), String>> + Send + 'static,
{
	let abort = Abort::new();
	let n = {
		let mut runs = app.mocks.runs.0.lock();
		if runs.running.contains_key(key) {
			return false;
		}
		runs.started += 1;
		let n = runs.started;
		runs.running.insert(key.to_owned(), (n, abort.clone()));
		runs.failed.remove(key);
		n
	};
	changed(app, space_id);
	let end = RunEnd { app: app.clone(), space_id: space_id.to_owned(), key: key.to_owned(), n };
	let running = work(abort.clone());
	tokio::spawn(async move {
		let result = running.await;
		if let Err(error) = result
			&& !abort.is_aborted()
		{
			eprintln!("[prep {}] the request failed: {error}", end.key);
			end.app.mocks.runs.0.lock().failed.insert(end.key.clone(), error);
		}
		drop(end);
	});
	true
}

/// Stops one key's request and forgets its failure.
pub fn cancel_run(app: &App, key: &str) {
	let stopped = {
		let mut runs = app.mocks.runs.0.lock();
		runs.failed.remove(key);
		runs.running.remove(key)
	};
	// Outside the lock: abort listeners may run code that reads the runs.
	if let Some((_, abort)) = stopped {
		abort.abort();
	}
}

/// Stops everything a deleted prep had out.
pub fn cancel_mock_runs(app: &App, space_id: &str) {
	let keys: Vec<String> = {
		let runs = app.mocks.runs.0.lock();
		let mine = |key: &&String| *key == space_id || key.strip_prefix(space_id).is_some_and(|rest| rest.starts_with('/'));
		runs.running.keys().chain(runs.failed.keys()).filter(mine).cloned().collect()
	};
	for key in keys {
		cancel_run(app, &key);
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[tokio::test]
	async fn one_request_per_key_its_failure_kept_until_the_next_start() {
		let root = scratch_dir("prep-runs");
		let app = test_app(&root);
		let mut events = app.events.subscribe();
		let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
		assert!(start_run(&app, "spc_a", "spc_a", move |_| async move { rx.await.unwrap() }));
		assert!(!start_run(&app, "spc_a", "spc_a", |_| async { Ok(()) }), "the key's request is still out");
		assert!(is_running(&app, "spc_a"));
		tx.send(Err("the agent never sent the sheet".to_owned())).unwrap();
		for _ in 0..2 {
			assert_eq!(events.recv().await.unwrap().sse_frame(), "event: prep-changed\ndata: {\"spaceId\":\"spc_a\"}\n\n");
		}
		assert!(!is_running(&app, "spc_a"));
		assert_eq!(run_error(&app, "spc_a").as_deref(), Some("the agent never sent the sheet"));
		assert!(start_run(&app, "spc_a", "spc_a", |_| std::future::pending()));
		assert_eq!(run_error(&app, "spc_a"), None, "a new start forgets the failure");
	}

	#[tokio::test]
	async fn a_deleted_prep_stops_its_sheet_and_its_mocks_but_no_other_prep() {
		let root = scratch_dir("prep-runs-cancel");
		let app = test_app(&root);
		let aborts = Arc::new(Mutex::new(Vec::new()));
		for (space, key) in [("spc_a", "spc_a".to_owned()), ("spc_a", mock_run_key("spc_a", "mock_1")), ("spc_ab", "spc_ab".to_owned())] {
			let aborts = aborts.clone();
			start_run(&app, space, &key, move |abort| {
				aborts.lock().push(abort.clone());
				async move {
					abort.aborted().await;
					Err("aborted".to_owned())
				}
			});
		}
		cancel_mock_runs(&app, "spc_a");
		let fired: Vec<bool> = aborts.lock().iter().map(Abort::is_aborted).collect();
		assert_eq!(fired, [true, true, false]);
		assert!(!is_running(&app, "spc_a") && !is_running(&app, "spc_a/mock_1") && is_running(&app, "spc_ab"));
		tokio::task::yield_now().await;
		assert_eq!(run_error(&app, "spc_a"), None, "an aborted request is no failure");
	}
}
