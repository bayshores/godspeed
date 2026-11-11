//! Ported from src/backend/agent/subagents/bg-llm-semaphore.ts: one pool of 3 permits for the
//! background model jobs that run beside extraction (topic grouping).
//!
//! First come, first served, and abort-aware: a queued caller that aborts marks its ticket dead,
//! and the permit handoff skips it. A handed-off permit keeps `active` as it is (the releaser
//! left it for the next holder); only a fresh take counts up. Counting both would slowly
//! deadlock the pool at 3 with an empty queue.

use std::collections::VecDeque;
use std::fmt;
use std::future::Future;

use gs_engine::turn::abort::Abort;
use parking_lot::Mutex;
use tokio::sync::oneshot;

/// Background model concurrency for the whole server.
const PERMIT_COUNT: usize = 3;

/// The server's one permit pool.
#[derive(Default)]
pub struct BgLlmSlots(Mutex<Slots>);

#[derive(Default)]
struct Slots {
	active: usize,
	queue: VecDeque<Ticket>,
	next_ticket: u64,
}

struct Ticket {
	id: u64,
	resolve: oneshot::Sender<()>,
	dead: bool,
}

/// The caller aborted while it waited in the queue (TS: an `AbortError`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedAbort;

impl fmt::Display for QueuedAbort {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str("background LLM job aborted while queued for a permit")
	}
}

/// Runs `critical` under one permit of the pool. `signal` kills a queued ticket: it marks itself
/// dead and answers `QueuedAbort`; the handoff skips it.
pub async fn with_bg_llm_slot<T, F, Fut>(slots: &BgLlmSlots, signal: Option<&Abort>, critical: F) -> Result<T, QueuedAbort>
where
	F: FnOnce() -> Fut,
	Fut: Future<Output = T>,
{
	let permit = take_permit(slots, signal).await?;
	let value = critical().await;
	drop(permit);
	Ok(value)
}

/// Gives the permit back when the critical section ends, also when its future is dropped.
struct Permit<'a>(&'a BgLlmSlots);

impl Drop for Permit<'_> {
	fn drop(&mut self) {
		let mut s = self.0.0.lock();
		// Handoff: a waiting ticket inherits the permit (active stays); dead tickets are skipped,
		// and so is one whose caller stopped waiting.
		while let Some(next) = s.queue.pop_front() {
			if !next.dead && next.resolve.send(()).is_ok() {
				return;
			}
		}
		s.active -= 1;
	}
}

/// Marks a still-queued ticket dead when its wait ends without the permit.
struct Waiting<'a> {
	slots: &'a BgLlmSlots,
	id: u64,
}

impl Drop for Waiting<'_> {
	fn drop(&mut self) {
		if let Some(ticket) = self.slots.0.lock().queue.iter_mut().find(|t| t.id == self.id) {
			ticket.dead = true;
		}
	}
}

async fn take_permit<'a>(slots: &'a BgLlmSlots, signal: Option<&Abort>) -> Result<Permit<'a>, QueuedAbort> {
	let (id, mut granted) = {
		let mut s = slots.0.lock();
		if s.active < PERMIT_COUNT {
			s.active += 1;
			return Ok(Permit(slots));
		}
		let (resolve, granted) = oneshot::channel();
		s.next_ticket += 1;
		let id = s.next_ticket;
		s.queue.push_back(Ticket { id, resolve, dead: false });
		(id, granted)
	};
	let waiting = Waiting { slots, id };
	let aborted = async {
		match signal {
			Some(signal) => signal.aborted().await,
			None => std::future::pending().await,
		}
	};
	tokio::select! {
		biased;
		got = &mut granted => {
			drop(waiting);
			got.map(|()| Permit(slots)).map_err(|_| QueuedAbort)
		}
		() = aborted => {
			// Dead first, then a permit that arrived before that is still ours to use or pass on.
			drop(waiting);
			match granted.try_recv() {
				Ok(()) => Ok(Permit(slots)),
				Err(_) => Err(QueuedAbort),
			}
		}
	}
}

#[cfg(test)]
mod tests {
	use std::sync::Arc;
	use std::sync::atomic::{AtomicUsize, Ordering};

	use tokio::sync::Notify;

	use super::*;

	fn active(slots: &BgLlmSlots) -> usize {
		slots.0.lock().active
	}

	/// Holds a permit until `release` is notified, counting how many run at once.
	async fn hold(slots: Arc<BgLlmSlots>, release: Arc<Notify>, running: Arc<AtomicUsize>, signal: Option<Abort>) -> Result<usize, QueuedAbort> {
		with_bg_llm_slot(&slots, signal.as_ref(), || async {
			let now = running.fetch_add(1, Ordering::SeqCst) + 1;
			release.notified().await;
			running.fetch_sub(1, Ordering::SeqCst);
			now
		})
		.await
	}

	async fn settle() {
		for _ in 0..20 {
			tokio::task::yield_now().await;
		}
	}

	#[tokio::test]
	async fn three_run_and_the_fourth_waits_for_a_handoff() {
		let slots = Arc::new(BgLlmSlots::default());
		let release = Arc::new(Notify::new());
		let running = Arc::new(AtomicUsize::new(0));
		let tasks: Vec<_> = (0..4).map(|_| tokio::spawn(hold(slots.clone(), release.clone(), running.clone(), None))).collect();
		settle().await;
		assert_eq!(running.load(Ordering::SeqCst), 3);
		assert_eq!(slots.0.lock().queue.len(), 1);
		release.notify_one();
		settle().await;
		assert_eq!(running.load(Ordering::SeqCst), 3, "the waiter inherited the permit");
		assert_eq!(active(&slots), 3, "a handed-off permit does not count up");
		for _ in 0..3 {
			release.notify_one();
			settle().await;
		}
		for task in tasks {
			assert!(task.await.unwrap().unwrap() <= 3);
		}
		assert_eq!(active(&slots), 0);
	}

	#[tokio::test]
	async fn an_aborted_waiter_is_skipped() {
		let slots = Arc::new(BgLlmSlots::default());
		let release = Arc::new(Notify::new());
		let running = Arc::new(AtomicUsize::new(0));
		let holders: Vec<_> = (0..3).map(|_| tokio::spawn(hold(slots.clone(), release.clone(), running.clone(), None))).collect();
		settle().await;
		let abort = Abort::new();
		let doomed = tokio::spawn(hold(slots.clone(), release.clone(), running.clone(), Some(abort.clone())));
		let next = tokio::spawn(hold(slots.clone(), release.clone(), running.clone(), None));
		settle().await;
		abort.abort();
		assert_eq!(doomed.await.unwrap(), Err(QueuedAbort));
		assert_eq!(QueuedAbort.to_string(), "background LLM job aborted while queued for a permit");
		release.notify_one();
		settle().await;
		assert_eq!(running.load(Ordering::SeqCst), 3, "the live waiter got the permit");
		for _ in 0..3 {
			release.notify_one();
			settle().await;
		}
		for task in holders {
			task.await.unwrap().unwrap();
		}
		next.await.unwrap().unwrap();
		assert_eq!(active(&slots), 0);
		assert!(slots.0.lock().queue.is_empty());
	}

	#[tokio::test]
	async fn an_already_aborted_signal_still_takes_a_free_permit() {
		let slots = BgLlmSlots::default();
		let abort = Abort::new();
		abort.abort();
		assert_eq!(with_bg_llm_slot(&slots, Some(&abort), || async { 7 }).await, Ok(7));
		assert_eq!(active(&slots), 0);
	}

	#[tokio::test]
	async fn a_dropped_critical_section_gives_its_permit_back() {
		let slots = Arc::new(BgLlmSlots::default());
		let task = tokio::spawn({
			let slots = slots.clone();
			async move { with_bg_llm_slot(&slots, None, std::future::pending::<()>).await }
		});
		settle().await;
		assert_eq!(active(&slots), 1);
		task.abort();
		let _ = task.await;
		assert_eq!(active(&slots), 0);
	}
}
