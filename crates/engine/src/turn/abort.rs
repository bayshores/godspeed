//! `AbortController` + `AbortSignal` in one cloneable handle. A child aborts with its parent but
//! not the other way round, like the tool guard's controller that forwards the run's abort.

use std::sync::{Arc, Weak};

use parking_lot::Mutex;
use tokio::sync::watch;

#[derive(Clone)]
pub struct Abort(Arc<Inner>);

struct Inner {
	fired: watch::Sender<bool>,
	children: Mutex<Vec<Weak<Inner>>>,
}

impl Default for Abort {
	fn default() -> Abort {
		Abort::new()
	}
}

impl Abort {
	pub fn new() -> Abort {
		Abort(Arc::new(Inner { fired: watch::channel(false).0, children: Mutex::new(Vec::new()) }))
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
		let waiter = gs_base::tasks::spawn("test", {
			let child = child.clone();
			async move { child.aborted().await }
		});
		parent.abort();
		waiter.await.unwrap();
		assert!(child.is_aborted());
		assert!(parent.child().is_aborted(), "a child of an aborted handle starts aborted");
	}
}
