//! With no runtime at all a detached task is logged and dropped, never a panic. Its own test
//! binary, so no other test has stored a runtime.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use gs_base::tasks::detach;

#[test]
fn detach_with_no_runtime_does_not_panic_or_run() {
	let ran = Arc::new(AtomicBool::new(false));
	let flag = ran.clone();
	detach("test", async move { flag.store(true, Ordering::SeqCst) });
	assert!(!ran.load(Ordering::SeqCst));
}
