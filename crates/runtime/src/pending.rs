//! Questions sent to the agent that wait for its answer by key: a request id, a session being
//! opened, a model list, a sign-in. The connection's reader settles them as answers come.

use std::collections::HashMap;
use std::hash::Hash;
use std::sync::atomic::{AtomicU64, Ordering};

use parking_lot::Mutex;
use tokio::sync::oneshot;

type Answer<T> = Result<T, String>;

type Waiting<K, T> = HashMap<K, oneshot::Sender<Answer<T>>>;

/// Once closed, every ask still waiting fails with why, and so does every later ask, so none
/// waits on an answer that cannot come.
pub(crate) struct Pending<K, T> {
	/// Err with why once closed.
	waiting: Mutex<Result<Waiting<K, T>, String>>,
	next: AtomicU64,
}

impl<K: Eq + Hash, T> Pending<K, T> {
	pub fn new() -> Pending<K, T> {
		Pending { waiting: Mutex::new(Ok(HashMap::new())), next: AtomicU64::new(1) }
	}

	/// A number no earlier call gave, counting from 1.
	pub fn next_id(&self) -> u64 {
		self.next.fetch_add(1, Ordering::Relaxed)
	}

	/// Waits for the answer to `key`, or fails at once when closed.
	pub fn ask(&self, key: K) -> Result<oneshot::Receiver<Answer<T>>, String> {
		let (tx, rx) = oneshot::channel();
		self.waiting.lock().as_mut().map_err(|why| why.clone())?.insert(key, tx);
		Ok(rx)
	}

	/// Gives the ask waiting on `key` its answer; false when none waits.
	pub fn settle(&self, key: &K, answer: Answer<T>) -> bool {
		let waiting = self.waiting.lock().as_mut().ok().and_then(|waiting| waiting.remove(key));
		let Some(tx) = waiting else { return false };
		// Whoever asked may have stopped waiting.
		let _ = tx.send(answer);
		true
	}

	pub fn close(&self, why: &str) {
		let waiting = std::mem::replace(&mut *self.waiting.lock(), Err(why.to_owned()));
		for (_, tx) in waiting.into_iter().flatten() {
			let _ = tx.send(Err(why.to_owned()));
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[tokio::test]
	async fn each_ask_gets_its_own_answer_once() {
		let pending = Pending::<u64, &str>::new();
		let (one, two) = (pending.next_id(), pending.next_id());
		assert_eq!((one, two), (1, 2));
		let (first, second) = (pending.ask(one).unwrap(), pending.ask(two).unwrap());
		assert!(pending.settle(&two, Err("refused".to_owned())));
		assert!(pending.settle(&one, Ok("yes")));
		assert!(!pending.settle(&one, Ok("again")), "an answered ask waits no more");
		assert_eq!((first.await.unwrap(), second.await.unwrap()), (Ok("yes"), Err("refused".to_owned())));
	}

	#[tokio::test]
	async fn closing_fails_waiting_asks_and_an_ask_after_it_fails_at_once() {
		let pending = Pending::<u64, ()>::new();
		let waiting = pending.ask(1).unwrap();
		pending.close("it stopped");
		assert_eq!(waiting.await.unwrap(), Err("it stopped".to_owned()));
		assert_eq!(pending.ask(2).err(), Some("it stopped".to_owned()));
		assert!(!pending.settle(&2, Ok(())), "no answer is taken once closed");
	}
}
