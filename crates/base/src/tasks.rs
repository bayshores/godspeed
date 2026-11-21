//! Every task starts here. `tokio::spawn` panics on a thread outside the runtime (one started with
//! `std::thread::spawn`, like the one that reads the shell's messages), so tasks start on the
//! current runtime, else on the one `set_runtime` stored. Clippy refuses the plain tokio calls
//! everywhere else (`clippy.toml`).

use std::any::Any;
use std::sync::OnceLock;

use tokio::runtime::Handle;
use tokio::task::JoinHandle;

static RUNTIME: OnceLock<Handle> = OnceLock::new();

/// Stores the runtime this is called on, for tasks started outside it. Called first in `main`.
#[allow(clippy::disallowed_methods)]
pub fn set_runtime() {
	let _ = RUNTIME.set(Handle::current());
}

/// The runtime a task starts on: the current one, else the stored one.
fn handle(label: &str) -> Option<Handle> {
	let handle = Handle::try_current().ok().or_else(|| RUNTIME.get().cloned());
	if handle.is_none() {
		eprintln!("[{label}] no runtime");
	}
	handle
}

/// Runs `future` on its own task that nobody awaits. A panic in it is printed as
/// `[<label>] task panicked: <message>`, where a dropped handle would swallow it. With no runtime
/// at all it is logged and does not run.
pub fn detach(label: &'static str, future: impl Future<Output = ()> + Send + 'static) {
	let Some(runtime) = handle(label) else { return };
	let task = runtime.spawn(future);
	runtime.spawn(async move {
		if let Err(err) = task.await
			&& let Ok(panic) = err.try_into_panic()
		{
			eprintln!("[{label}] task panicked: {}", panic_message(panic.as_ref()));
		}
	});
}

/// Runs `future` on its own task whose handle the caller awaits, stores or aborts. A handle needs
/// a runtime, so with none at all this panics with `[<label>] no runtime`.
pub fn spawn<F>(label: &'static str, future: F) -> JoinHandle<F::Output>
where
	F: Future + Send + 'static,
	F::Output: Send + 'static,
{
	handle(label).unwrap_or_else(|| panic!("[{label}] no runtime")).spawn(future)
}

/// Runs blocking `work` on the runtime's blocking threads. Panics like `spawn` with no runtime.
pub fn spawn_blocking<T: Send + 'static>(label: &'static str, work: impl FnOnce() -> T + Send + 'static) -> JoinHandle<T> {
	handle(label).unwrap_or_else(|| panic!("[{label}] no runtime")).spawn_blocking(work)
}

fn panic_message(panic: &(dyn Any + Send)) -> &str {
	if let Some(message) = panic.downcast_ref::<&str>() {
		message
	} else if let Some(message) = panic.downcast_ref::<String>() {
		message
	} else {
		"no message"
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_panic_message_is_its_text_whether_it_was_a_literal_or_formatted() {
		assert_eq!(panic_message(&"literal"), "literal");
		assert_eq!(panic_message(&format!("formatted {}", 1)), "formatted 1");
		assert_eq!(panic_message(&7), "no message");
	}

	#[tokio::test]
	async fn a_detached_task_runs_and_a_detached_panic_leaves_the_runtime_working() {
		let (tx, rx) = tokio::sync::oneshot::channel();
		detach("test", async move {
			tx.send(1).unwrap();
		});
		assert_eq!(rx.await.unwrap(), 1);
		detach("test", async { panic!("boom") });
		let (tx, rx) = tokio::sync::oneshot::channel();
		detach("test", async move {
			tx.send(2).unwrap();
		});
		assert_eq!(rx.await.unwrap(), 2);
	}

	#[test]
	fn a_plain_thread_starts_its_task_on_the_stored_runtime() {
		let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(1).enable_all().build().unwrap();
		runtime.block_on(async { set_runtime() });
		let (tx, rx) = std::sync::mpsc::channel();
		std::thread::spawn(move || {
			assert!(Handle::try_current().is_err(), "the thread is outside the runtime");
			detach("test", async move {
				tx.send(3).unwrap();
			});
		})
		.join()
		.unwrap();
		assert_eq!(rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap(), 3);
	}
}
