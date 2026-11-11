//! Locks that replace Node's single thread. Node ran every read-modify-write of a file with no
//! `await` inside, so nothing could interleave; here requests run in parallel, so each such
//! section holds the lock of what it changes. Locks are re-entrant on one thread (a service may
//! call a store that takes the same lock), and a guard is not `Send`, so holding one across an
//! `.await` in a spawned task does not compile. Take at most one, or in this order: class, chat,
//! graph, app file.

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::lock_api::ArcReentrantMutexGuard;
use parking_lot::{Mutex, RawMutex, RawThreadId, ReentrantMutex};

/// What a lock covers.
#[derive(Clone, Copy, Debug)]
pub enum LockKey<'a> {
	/// A class record, its files and cheat sheets.
	Class(&'a str),
	/// A lesson record (or Talk) and its folder.
	Chat(&'a str),
	/// One graph family: None is "No class".
	Graph(Option<&'a str>),
	/// A single app file under the data folder, by name ("settings.json", "jobs/<id>.json").
	AppFile(&'a str),
}

impl LockKey<'_> {
	fn text(&self) -> String {
		match self {
			LockKey::Class(id) => format!("class:{id}"),
			LockKey::Chat(id) => format!("chat:{id}"),
			LockKey::Graph(scope) => format!("graph:{}", scope.unwrap_or("")),
			LockKey::AppFile(name) => format!("file:{name}"),
		}
	}
}

pub type Guard = ArcReentrantMutexGuard<RawMutex, RawThreadId, ()>;

#[derive(Clone, Default)]
pub struct Locks {
	held: Arc<Mutex<HashMap<String, Arc<ReentrantMutex<()>>>>>,
}

impl Locks {
	pub fn new() -> Locks {
		Locks::default()
	}

	/// Waits for and holds the lock until the guard drops.
	pub fn lock(&self, key: LockKey<'_>) -> Guard {
		let lock = self.held.lock().entry(key.text()).or_default().clone();
		lock.lock_arc()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn same_thread_reenters_and_other_threads_wait() {
		let locks = Locks::new();
		let outer = locks.lock(LockKey::Chat("a"));
		let inner = locks.lock(LockKey::Chat("a"));
		drop(inner);
		let l2 = locks.clone();
		let waited = std::thread::spawn(move || {
			let t = std::time::Instant::now();
			let _g = l2.lock(LockKey::Chat("a"));
			t.elapsed()
		});
		std::thread::sleep(std::time::Duration::from_millis(50));
		drop(outer);
		assert!(waited.join().unwrap() >= std::time::Duration::from_millis(40));
		let _other = locks.lock(LockKey::Class("a"));
	}
}
