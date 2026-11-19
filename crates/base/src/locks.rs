//! Locks that replace Node's single thread. Node ran every read-modify-write of a file with no
//! `await` inside, so nothing could interleave; here requests run in parallel, so each such
//! section holds the lock of what it changes. Locks are re-entrant on one thread (a service may
//! call a store that takes the same lock), and a guard is not `Send`, so holding one across an
//! `.await` in a spawned task does not compile. Take at most one, or in this order: space, chat,
//! graph, app file; several of one kind in id order, and settings.json before another app file
//! (docs/rust-server.md, "Locks"). Code under a chat lock never waits for a space lock: a space is
//! read with `try_lock` (`get_space`) and progress reads mocks with no lock.

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::lock_api::ArcReentrantMutexGuard;
use parking_lot::{Mutex, RawMutex, RawThreadId, ReentrantMutex};

/// What a lock covers.
#[derive(Clone, Copy, Debug)]
pub enum LockKey<'a> {
	/// A space record, its files and cheat sheets.
	Space(&'a str),
	/// A lesson record and its folder.
	Chat(&'a str),
	/// One graph family: None is "No space".
	Graph(Option<&'a str>),
	/// A single app file under the data folder, by name ("settings.json", "jobs/<id>.json").
	AppFile(&'a str),
}

impl LockKey<'_> {
	fn text(&self) -> String {
		match self {
			LockKey::Space(id) => format!("space:{id}"),
			LockKey::Chat(id) => format!("chat:{id}"),
			LockKey::Graph(scope) => format!("graph:{}", scope.unwrap_or("")),
			LockKey::AppFile(name) => format!("file:{name}"),
		}
	}
}

type Held = Arc<Mutex<HashMap<String, Arc<ReentrantMutex<()>>>>>;

/// A held lock. Dropping it releases the lock and forgets the entry when nobody else holds or
/// waits for it.
pub struct Guard {
	inner: Option<ArcReentrantMutexGuard<RawMutex, RawThreadId, ()>>,
	held: Held,
	key: String,
}

impl Drop for Guard {
	fn drop(&mut self) {
		drop(self.inner.take());
		#[cfg(any(test, feature = "lock-order-check"))]
		order::release(&self.key);
		let mut held = self.held.lock();
		// Only the map holds the entry: no guard and no thread waiting in `entry`.
		if held.get(&self.key).is_some_and(|entry| Arc::strong_count(entry) == 1) {
			held.remove(&self.key);
		}
	}
}

#[derive(Clone, Default)]
pub struct Locks {
	held: Held,
}

impl Locks {
	pub fn new() -> Locks {
		Locks::default()
	}

	/// Waits for and holds the lock until the guard drops. In tests this panics when a thread
	/// already holds a lock that comes later in the order.
	pub fn lock(&self, key: LockKey<'_>) -> Guard {
		#[cfg(any(test, feature = "lock-order-check"))]
		order::check(&key);
		let inner = self.entry(&key).lock_arc();
		self.guard(key, inner)
	}

	/// The lock if no other thread holds it: for a caller that may already hold a lock that
	/// comes after this one. It never waits, so it is not checked against the order.
	pub fn try_lock(&self, key: LockKey<'_>) -> Option<Guard> {
		let inner = self.entry(&key).try_lock_arc()?;
		Some(self.guard(key, inner))
	}

	fn guard(&self, key: LockKey<'_>, inner: ArcReentrantMutexGuard<RawMutex, RawThreadId, ()>) -> Guard {
		#[cfg(any(test, feature = "lock-order-check"))]
		order::acquire(&key);
		Guard { inner: Some(inner), held: self.held.clone(), key: key.text() }
	}

	fn entry(&self, key: &LockKey<'_>) -> Arc<ReentrantMutex<()>> {
		self.held.lock().entry(key.text()).or_default().clone()
	}
}

/// The documented order, checked in tests: a thread holds a stack of the locks it took,
/// and taking one that comes earlier than one it holds is a bug.
#[cfg(any(test, feature = "lock-order-check"))]
mod order {
	use std::cell::RefCell;

	use super::LockKey;

	thread_local! {
		static HELD_HERE: RefCell<Vec<(u8, String)>> = const { RefCell::new(Vec::new()) };
	}

	/// Space, chat, graph, then app files with settings.json first.
	fn rank(key: &LockKey<'_>) -> u8 {
		match key {
			LockKey::Space(_) => 0,
			LockKey::Chat(_) => 1,
			LockKey::Graph(_) => 2,
			LockKey::AppFile("settings.json") => 3,
			LockKey::AppFile(_) => 4,
		}
	}

	pub(super) fn check(key: &LockKey<'_>) {
		let (rank, text) = (rank(key), key.text());
		HELD_HERE.with_borrow(|held| {
			if held.iter().any(|(_, held_text)| *held_text == text) {
				return;
			}
			if let Some((_, later)) = held.iter().find(|(held_rank, _)| *held_rank > rank) {
				panic!("lock order: took {text} while holding {later}; the order is space, chat, graph, settings.json, other app files");
			}
		});
	}

	pub(super) fn acquire(key: &LockKey<'_>) {
		HELD_HERE.with_borrow_mut(|held| held.push((rank(key), key.text())));
	}

	/// Runs in `Guard::drop`, which may run while the thread ends: a panic there would abort, so
	/// a thread-local that is already gone is skipped.
	pub(super) fn release(text: &str) {
		let _ = HELD_HERE.try_with(|cell| {
			let mut held = cell.borrow_mut();
			if let Some(at) = held.iter().rposition(|(_, held_text)| held_text == text) {
				held.remove(at);
			}
		});
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
		let _other = locks.lock(LockKey::Space("a"));
		assert!(locks.try_lock(LockKey::Space("a")).is_some(), "the same thread gets it again");
		let l3 = locks.clone();
		assert!(std::thread::spawn(move || l3.try_lock(LockKey::Space("a")).is_none()).join().unwrap(), "another thread doesn't wait for it");
	}

	#[test]
	fn an_entry_goes_when_its_last_guard_drops_and_stays_while_one_is_held_or_awaited() {
		let locks = Locks::new();
		let outer = locks.lock(LockKey::Chat("a"));
		let inner = locks.lock(LockKey::Chat("a"));
		drop(inner);
		assert_eq!(locks.held.lock().len(), 1, "the outer guard still holds it");
		let l2 = locks.clone();
		let waiter = std::thread::spawn(move || drop(l2.lock(LockKey::Chat("a"))));
		std::thread::sleep(std::time::Duration::from_millis(50));
		drop(outer);
		waiter.join().unwrap();
		assert!(locks.held.lock().is_empty(), "nobody holds or waits for it any more");
		drop(locks.lock(LockKey::Space("s")));
		drop(locks.try_lock(LockKey::AppFile("x.json")));
		assert!(locks.held.lock().is_empty());
	}

	#[test]
	fn many_threads_on_a_few_keys_never_share_a_lock_and_leave_no_entry() {
		use std::sync::atomic::{AtomicUsize, Ordering};
		const KEYS: [&str; 3] = ["a", "b", "c"];
		let locks = Locks::new();
		let inside: Arc<[AtomicUsize; 3]> = Arc::new([AtomicUsize::new(0), AtomicUsize::new(0), AtomicUsize::new(0)]);
		let threads: Vec<_> = (0..8)
			.map(|thread| {
				let (locks, inside) = (locks.clone(), inside.clone());
				std::thread::spawn(move || {
					for round in 0..2000 {
						let at = (thread + round) % KEYS.len();
						let _guard = locks.lock(LockKey::Chat(KEYS[at]));
						assert_eq!(inside[at].fetch_add(1, Ordering::SeqCst), 0, "two threads hold {}", KEYS[at]);
						let _again = (round % 7 == 0).then(|| locks.lock(LockKey::Chat(KEYS[at])));
						inside[at].fetch_sub(1, Ordering::SeqCst);
					}
				})
			})
			.collect();
		for thread in threads {
			thread.join().unwrap();
		}
		assert!(locks.held.lock().is_empty(), "every entry went with its last guard");
	}

	/// The panic message of `take` run on its own thread, or None when it did not panic.
	#[cfg(any(test, feature = "lock-order-check"))]
	fn panic_of(take: impl FnOnce(&Locks) + Send + 'static) -> Option<String> {
		let result = std::thread::spawn(move || take(&Locks::new())).join();
		result.err().and_then(|payload| payload.downcast_ref::<String>().cloned())
	}

	#[cfg(any(test, feature = "lock-order-check"))]
	#[test]
	fn taking_an_earlier_lock_than_one_held_panics() {
		let in_order = panic_of(|locks| {
			let _space = locks.lock(LockKey::Space("s"));
			let _chat = locks.lock(LockKey::Chat("c"));
			let _graph = locks.lock(LockKey::Graph(None));
			let _settings = locks.lock(LockKey::AppFile("settings.json"));
			let _other = locks.lock(LockKey::AppFile("jobs/a.json"));
			let _again = locks.lock(LockKey::Chat("c"));
			let _try = locks.try_lock(LockKey::Space("t"));
		});
		assert_eq!(in_order, None);
		let space_after_file = panic_of(|locks| {
			let _other = locks.lock(LockKey::AppFile("jobs/a.json"));
			let _space = locks.lock(LockKey::Space("s"));
		});
		assert!(space_after_file.is_some_and(|m| m.contains("took space:s while holding file:jobs/a.json")));
		let settings_after_file = panic_of(|locks| {
			let _other = locks.lock(LockKey::AppFile("jobs/a.json"));
			let _settings = locks.lock(LockKey::AppFile("settings.json"));
		});
		assert!(settings_after_file.is_some_and(|m| m.contains("took file:settings.json while holding file:jobs/a.json")));
	}
}
