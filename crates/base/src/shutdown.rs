//! The server is stopping (SIGTERM, or the app closed our stdin). Long waits (an agent's
//! `wait_for_work`, the event stream) end when this fires, so the 2 s close does not cut them off
//! mid-write.

use std::sync::LazyLock;

use tokio::sync::watch;

static STOP: LazyLock<watch::Sender<bool>> = LazyLock::new(|| watch::channel(false).0);

pub fn trigger() {
	STOP.send_replace(true);
}

pub fn is_stopping() -> bool {
	*STOP.borrow()
}

/// Ends once `trigger` has been called (at once if it already was).
pub async fn wait() {
	let mut rx = STOP.subscribe();
	let _ = rx.wait_for(|stopping| *stopping).await;
}

#[cfg(test)]
mod tests {
	use super::*;

	#[tokio::test]
	async fn waiters_end_after_trigger() {
		let waiter = tokio::spawn(wait());
		assert!(!is_stopping());
		trigger();
		waiter.await.unwrap();
		assert!(is_stopping());
		wait().await;
	}
}
