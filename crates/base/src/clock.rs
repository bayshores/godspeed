//! The app clock: `Date.now()` and every timer go through here, so tests can fix the start time
//! and jump ahead.
//!
//! - `GODSPEED_CONTRACT_NOW` (an ISO time) starts the clock there; it then ticks in real time.
//! - `GODSPEED_CONTRACT_CLOCK_FILE` names a file holding the total ms advanced so far. When it
//!   grows, the clock moves on by the difference, every sleep that is now due ends at once in due
//!   order, and the number is written to `<file>.applied`.
//!
//! Use `sleep`/`sleep_until` instead of tokio's timers and `now_ms` instead of `SystemTime`
//! (clippy.toml refuses the others), or a jump would not reach that timer.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::time::Duration;

use parking_lot::Mutex;
use tokio::sync::oneshot;

struct Clock {
	/// Fake time minus real time, in ms.
	offset: AtomicI64,
	seq: AtomicU64,
	/// Every pending sleep by (due time, start order), told to look again after a jump.
	sleepers: Mutex<BTreeMap<(i64, u64), oneshot::Sender<()>>>,
}

static CLOCK: LazyLock<Clock> = LazyLock::new(|| Clock { offset: AtomicI64::new(0), seq: AtomicU64::new(0), sleepers: Mutex::new(BTreeMap::new()) });

#[allow(clippy::disallowed_methods)]
fn real_ms() -> i64 {
	std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

/// `Date.now()`.
pub fn now_ms() -> i64 {
	real_ms() + CLOCK.offset.load(Ordering::SeqCst)
}

/// Reads `GODSPEED_CONTRACT_NOW` and starts watching `GODSPEED_CONTRACT_CLOCK_FILE`. Called once
/// at start-up, inside the runtime.
pub fn init_from_env() -> Result<(), String> {
	if let Ok(iso) = std::env::var("GODSPEED_CONTRACT_NOW") {
		let start = crate::time::parse_date(&iso).ok_or_else(|| format!("bad GODSPEED_CONTRACT_NOW: {iso}"))?;
		CLOCK.offset.store(start - real_ms(), Ordering::SeqCst);
		if let Ok(file) = std::env::var("GODSPEED_CONTRACT_CLOCK_FILE") {
			tokio::spawn(watch_clock_file(PathBuf::from(file)));
		}
	}
	Ok(())
}

/// Moves the clock forward and wakes every sleeper in due order to check again.
pub fn advance(by_ms: i64) {
	CLOCK.offset.fetch_add(by_ms, Ordering::SeqCst);
	let woken = std::mem::take(&mut *CLOCK.sleepers.lock());
	for (_, tx) in woken {
		let _ = tx.send(());
	}
}

/// `setTimeout`'s delay: below 1 ms or above 2^31-1 ms counts as 1.
pub async fn sleep(ms: i64) {
	let delay = if (1..=2_147_483_647).contains(&ms) { ms } else { 1 };
	sleep_until(now_ms() + delay).await;
}

/// Ends once the app clock reaches `due` (ms since the epoch).
#[allow(clippy::disallowed_methods)]
pub async fn sleep_until(due: i64) {
	loop {
		let (tx, rx) = oneshot::channel();
		let key = (due, CLOCK.seq.fetch_add(1, Ordering::SeqCst));
		// Registered before reading the clock, so a jump in between still wakes this sleep.
		CLOCK.sleepers.lock().insert(key, tx);
		let _registered = Registered(key);
		let left = due - now_ms();
		if left <= 0 {
			return;
		}
		tokio::select! {
			() = tokio::time::sleep(Duration::from_millis(left as u64)) => {}
			_ = rx => {}
		}
	}
}

/// Drops a sleeper's entry when its sleep ends or is cancelled.
struct Registered((i64, u64));

impl Drop for Registered {
	fn drop(&mut self) {
		CLOCK.sleepers.lock().remove(&self.0);
	}
}

#[allow(clippy::disallowed_methods)]
async fn watch_clock_file(file: PathBuf) {
	let applied_file = PathBuf::from(format!("{}.applied", file.display()));
	let mut applied = 0.0;
	loop {
		tokio::time::sleep(Duration::from_millis(20)).await;
		let Ok(text) = std::fs::read_to_string(&file) else { continue };
		let Ok(total) = crate::text::trim(&text).parse::<f64>() else { continue };
		if !total.is_finite() || total <= applied {
			continue;
		}
		advance((total - applied) as i64);
		applied = total;
		let _ = std::fs::write(&applied_file, gs_json::js_number(total));
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[tokio::test]
	#[allow(clippy::disallowed_methods)] // real waits, so the woken tasks get to run
	async fn a_jump_ends_due_sleeps_in_order_and_keeps_later_ones() {
		let order = std::sync::Arc::new(Mutex::new(Vec::new()));
		let start = now_ms();
		let mut tasks = Vec::new();
		for (name, delay) in [("b", 60_000), ("a", 30_000), ("late", 3_600_000)] {
			let order = order.clone();
			tasks.push(tokio::spawn(async move {
				sleep(delay).await;
				order.lock().push(name);
			}));
		}
		tokio::time::sleep(Duration::from_millis(20)).await;
		advance(61_000);
		tokio::time::sleep(Duration::from_millis(50)).await;
		assert_eq!(*order.lock(), ["a", "b"]);
		assert!(now_ms() - start >= 61_000);
		advance(3_600_000);
		for t in tasks {
			t.await.unwrap();
		}
		assert_eq!(*order.lock(), ["a", "b", "late"]);
		assert!(CLOCK.sleepers.lock().is_empty());
	}
}
