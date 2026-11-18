//! Background tasks that nobody awaits.

use std::any::Any;

/// Runs `future` on its own task. A panic in it is printed as `[<label>] task panicked: <message>`,
/// where a dropped handle would swallow it.
pub fn detach(label: &'static str, future: impl Future<Output = ()> + Send + 'static) {
	let task = tokio::spawn(future);
	tokio::spawn(async move {
		if let Err(err) = task.await
			&& let Ok(panic) = err.try_into_panic()
		{
			eprintln!("[{label}] task panicked: {}", panic_message(panic.as_ref()));
		}
	});
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
}
