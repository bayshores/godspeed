//! `AbortController` + `AbortSignal` in one cloneable handle. A child aborts with its parent but
//! not the other way round, like the tool guard's controller that forwards the run's abort.
//! Listeners run inside `abort()`, as an `AbortSignal`'s do, so what they emit comes before
//! anything the aborting caller does next.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Weak};

use parking_lot::Mutex;
use tokio::sync::watch;

#[derive(Clone)]
pub struct Abort(Arc<Inner>);

type Listener = Box<dyn FnOnce() + Send>;

struct Inner {
	fired: watch::Sender<bool>,
	children: Mutex<Vec<Weak<Inner>>>,
	listeners: Mutex<Vec<(u64, Listener)>>,
	next_listener: AtomicU64,
}

/// A listener added by `on_abort`; dropping it removes the listener.
pub struct OnAbort {
	abort: Weak<Inner>,
	id: u64,
}

impl Drop for OnAbort {
	fn drop(&mut self) {
		if let Some(inner) = self.abort.upgrade() {
			inner.listeners.lock().retain(|(id, _)| *id != self.id);
		}
	}
}

impl Default for Abort {
	fn default() -> Abort {
		Abort::new()
	}
}

impl Abort {
	pub fn new() -> Abort {
		Abort(Arc::new(Inner { fired: watch::channel(false).0, children: Mutex::new(Vec::new()), listeners: Mutex::new(Vec::new()), next_listener: AtomicU64::new(0) }))
	}

	/// Aborts this handle and every child (a second call does nothing).
	pub fn abort(&self) {
		fire(&self.0);
	}

	pub fn is_aborted(&self) -> bool {
		*self.0.fired.borrow()
	}

	/// Ends once aborted (at once if it already is).
	pub async fn aborted(&self) {
		let mut rx = self.0.fired.subscribe();
		let _ = rx.wait_for(|fired| *fired).await;
	}

	/// Runs `f` inside the `abort()` call that aborts this handle (at once if it already is), unless
	/// the returned guard was dropped first.
	pub fn on_abort(&self, f: impl FnOnce() + Send + 'static) -> OnAbort {
		let id = self.0.next_listener.fetch_add(1, Ordering::Relaxed);
		let guard = OnAbort { abort: Arc::downgrade(&self.0), id };
		let mut listeners = self.0.listeners.lock();
		if self.is_aborted() {
			drop(listeners);
			f();
		} else {
			listeners.push((id, Box::new(f)));
		}
		guard
	}

	/// A handle that aborts when this one does; aborting it leaves this one alone.
	pub fn child(&self) -> Abort {
		let child = Abort::new();
		let mut children = self.0.children.lock();
		children.retain(|c| c.strong_count() > 0);
		children.push(Arc::downgrade(&child.0));
		drop(children);
		if self.is_aborted() {
			child.abort();
		}
		child
	}
}

fn fire(inner: &Inner) {
	if inner.fired.send_replace(true) {
		return;
	}
	let listeners = std::mem::take(&mut *inner.listeners.lock());
	for (_, listener) in listeners {
		listener();
	}
	let children = std::mem::take(&mut *inner.children.lock());
	for child in children.iter().filter_map(Weak::upgrade) {
		fire(&child);
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[tokio::test]
	async fn children_follow_their_parent_only() {
		let parent = Abort::new();
		let child = parent.child();
		let grandchild = child.child();
		grandchild.abort();
		assert!(!child.is_aborted() && !parent.is_aborted());
		let waiter = tokio::spawn({
			let child = child.clone();
			async move { child.aborted().await }
		});
		parent.abort();
		waiter.await.unwrap();
		assert!(child.is_aborted());
		assert!(parent.child().is_aborted(), "a child of an aborted handle starts aborted");
	}

	#[test]
	fn listeners_run_inside_abort_until_dropped() {
		let parent = Abort::new();
		let child = parent.child();
		let heard = Arc::new(Mutex::new(Vec::new()));
		let hear = |name: &'static str| {
			let heard = heard.clone();
			move || heard.lock().push(name)
		};
		let _kept = child.on_abort(hear("kept"));
		drop(child.on_abort(hear("dropped")));
		parent.abort();
		assert_eq!(*heard.lock(), ["kept"]);
		let _late = child.on_abort(hear("late"));
		assert_eq!(*heard.lock(), ["kept", "late"], "a listener on an aborted handle runs at once");
	}
}
