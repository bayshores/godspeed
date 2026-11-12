//! One server per data folder: an advisory lock on the folder itself, so no file is made. The
//! kernel drops it when its holder dies, so only a running or still-stopping server can hold it.

use std::fs::File;

use gs_base::config::Paths;

/// The held lock, made on a data folder that does not exist yet so it is held from the start, or
/// None when the folder cannot be made or opened. Err when another server still holds it after
/// WAIT_MS.
#[cfg(unix)]
pub async fn lock(paths: &Paths) -> Result<Option<File>, ()> {
	use std::fs::TryLockError;

	use gs_base::clock;

	// A server that was told to stop keeps the lock until it exits, at most 2 s later
	// (FORCE_EXIT_MS in main.rs), so a quick relaunch waits that out instead of failing.
	const WAIT_MS: i64 = 3000;
	const RETRY_MS: i64 = 100;

	let _ = std::fs::create_dir_all(&paths.data);
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

/// A directory cannot be locked on Windows. The desktop app's single-instance check and its
/// old-app check keep two servers off one data folder there.
#[cfg(windows)]
pub async fn lock(_paths: &Paths) -> Result<Option<File>, ()> {
	Ok(None)
}
