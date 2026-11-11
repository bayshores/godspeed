//! The agents waiting for work, in the order they started waiting. A wake lets them claim one at
//! a time in that order, as Node's waiter set resolved them: the agent that waited first takes
//! the item, the others find it taken and wait again at the back.

use std::collections::VecDeque;

use parking_lot::Mutex;
use tokio::sync::Notify;

#[derive(Default)]
pub(super) struct Waiters {
	line: Mutex<Line>,
	/// A wake: every waiter looks at the line again.
	wake: Notify,
	/// A woken waiter finished its claim: the next one in line may claim.
	turn: Notify,
}

#[derive(Default)]
struct Line {
	next: u64,
	/// Waiting, in the order they started.
	waiting: Vec<u64>,
	/// Woken, claiming one at a time from the front.
	woken: VecDeque<u64>,
}

/// One waiter's place in line; dropping it (a claim done, or a caller that went away) lets the
/// next one claim.
pub(super) struct Ticket<'a> {
	waiters: &'a Waiters,
	id: u64,
}

impl Waiters {
	/// Wakes every waiter; they claim in the order they started waiting.
	pub(super) fn wake_all(&self) {
		let mut line = self.line.lock();
		let waiting = std::mem::take(&mut line.waiting);
		line.woken.extend(waiting);
		drop(line);
		self.wake.notify_waiters();
	}

	/// Joins the line and waits until a wake, `timer` or `stop` ends the wait, then until it is
	/// this waiter's turn to claim. Hold the ticket until the claim is done.
	pub(super) async fn wait(&self, timer: impl Future<Output = ()>, stop: impl Future<Output = ()>) -> Ticket<'_> {
		let woken = self.wake.notified();
		tokio::pin!(woken);
		woken.as_mut().enable();
		let ticket = {
			let mut line = self.line.lock();
			line.next += 1;
			let id = line.next;
			line.waiting.push(id);
			Ticket { waiters: self, id }
		};
		tokio::select! {
			() = woken => {}
			() = timer => {}
			() = stop => {}
		}
		ticket.my_turn().await;
		ticket
	}
}

impl Ticket<'_> {
	/// Returns at once unless this waiter was woken; then when the ones woken before it claimed.
	async fn my_turn(&self) {
		loop {
			let next = self.waiters.turn.notified();
			tokio::pin!(next);
			next.as_mut().enable();
			{
				let mut line = self.waiters.line.lock();
				line.waiting.retain(|&w| w != self.id);
				if !line.woken.contains(&self.id) || line.woken.front() == Some(&self.id) {
					return;
				}
			}
			next.await;
		}
	}
}

impl Drop for Ticket<'_> {
	fn drop(&mut self) {
		let mut line = self.waiters.line.lock();
		line.waiting.retain(|&w| w != self.id);
		line.woken.retain(|&w| w != self.id);
		drop(line);
		self.waiters.turn.notify_waiters();
	}
}

#[cfg(test)]
mod tests {
	use std::sync::Arc;

	use super::*;

	#[tokio::test]
	async fn woken_waiters_claim_in_the_order_they_started_waiting() {
		let waiters = Arc::new(Waiters::default());
		let order = Arc::new(Mutex::new(Vec::new()));
		let mut tasks = Vec::new();
		for n in 0..3 {
			let (line, order) = (waiters.clone(), order.clone());
			tasks.push(tokio::spawn(async move {
				let ticket = line.wait(std::future::pending(), std::future::pending()).await;
				// The later ones get every chance to claim first.
				tokio::task::yield_now().await;
				order.lock().push(n);
				drop(ticket);
			}));
			while waiters.line.lock().waiting.len() < n + 1 {
				tokio::task::yield_now().await;
			}
		}
		waiters.wake_all();
		for task in tasks {
			task.await.unwrap();
		}
		assert_eq!(*order.lock(), vec![0, 1, 2]);
		assert!(waiters.line.lock().woken.is_empty());
	}

	#[tokio::test]
	async fn a_waiter_that_went_away_gives_up_its_turn() {
		let waiters = Arc::new(Waiters::default());
		let first = tokio::spawn({
			let waiters = waiters.clone();
			async move { drop(waiters.wait(std::future::pending(), std::future::pending()).await) }
		});
		while waiters.line.lock().waiting.is_empty() {
			tokio::task::yield_now().await;
		}
		let second = {
			let waiters = waiters.clone();
			tokio::spawn(async move { drop(waiters.wait(std::future::pending(), std::future::pending()).await) })
		};
		while waiters.line.lock().waiting.len() < 2 {
			tokio::task::yield_now().await;
		}
		first.abort();
		let _ = first.await;
		waiters.wake_all();
		second.await.unwrap();
	}
}
