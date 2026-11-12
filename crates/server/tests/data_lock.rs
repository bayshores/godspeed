//! The data-folder lock is held from the start, waits out a server that is still stopping, then
//! gives up. Windows has no lock.

#![cfg(unix)]

use std::fs::File;

use gs_base::config::Paths;
use gs_base::{clock, ids};
use gs_server::data_lock;

#[tokio::test]
async fn waits_for_a_stopping_server_then_gives_up() {
	let dir = std::env::temp_dir().join(format!("gs-data-lock-{}", ids::uuid()));
	let paths = Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.clone());
	let first = data_lock::lock(&paths).await.unwrap().expect("a missing folder is made and locked");
	assert!(File::open(&paths.data).unwrap().try_lock().is_err(), "a second server starting at once finds it locked");
	drop(first);

	let other = File::open(&paths.data).unwrap();
	other.lock().unwrap();
	let waiting = tokio::spawn({
		let paths = paths.clone();
		async move { data_lock::lock(&paths).await }
	});
	clock::sleep(300).await;
	assert!(!waiting.is_finished(), "waits while the other server holds it");
	drop(other);
	let held = waiting.await.unwrap().unwrap().expect("taken once the other server exits");

	let waiting = tokio::spawn({
		let paths = paths.clone();
		async move { data_lock::lock(&paths).await }
	});
	clock::sleep(300).await;
	clock::advance(3000);
	assert!(waiting.await.unwrap().is_err(), "gives up on a server that keeps it");
	drop(held);
	std::fs::remove_dir_all(&dir).unwrap();
}
