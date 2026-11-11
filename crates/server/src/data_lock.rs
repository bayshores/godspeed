//! One server per data folder: an advisory lock on the folder itself, so no file is made. The
//! kernel drops it when its holder dies, so only a running or still-stopping server can hold it.

use std::fs::{File, TryLockError};

use gs_base::clock;
use gs_base::config::Paths;

/// A server that was told to stop keeps the lock until it exits, at most 2 s later (FORCE_EXIT_MS
/// in main.rs), so a quick relaunch waits that out instead of failing.
const WAIT_MS: i64 = 3000;
const RETRY_MS: i64 = 100;

/// The held lock, or None when the folder does not exist yet (nothing to guard). Err when another
/// server still holds it after WAIT_MS.
pub async fn lock(paths: &Paths) -> Result<Option<File>, ()> {
	let Ok(dir) = File::open(&paths.data) else { return Ok(None) };
	let give_up = clock::now_ms() + WAIT_MS;
	loop {
		match dir.try_lock() {
			Ok(()) => return Ok(Some(dir)),
			Err(TryLockError::WouldBlock) if clock::now_ms() < give_up => clock::sleep(RETRY_MS).await,
			Err(_) => return Err(()),
		}
	}
}
