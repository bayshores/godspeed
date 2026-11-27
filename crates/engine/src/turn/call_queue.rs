//! The order a turn's tool calls start in. Calls run side by side, except a call of a tool that
//! runs alone (`ExecutionMode::Sequential`): it starts once every earlier call is done, and no
//! later call starts before it is done.

use std::collections::VecDeque;

pub(super) struct CallQueue<T> {
	/// The calls that came in and have not started, each with whether it runs alone.
	waiting: VecDeque<(T, bool)>,
	running: usize,
	/// The one running call runs alone.
	alone: bool,
}

impl<T> CallQueue<T> {
	pub fn new() -> CallQueue<T> {
		CallQueue { waiting: VecDeque::new(), running: 0, alone: false }
	}

	pub fn push(&mut self, call: T, alone: bool) {
		self.waiting.push_back((call, alone));
	}

	/// The next call that may start now, counted as running until `done`.
	pub fn start(&mut self) -> Option<T> {
		let (_, alone) = self.waiting.front()?;
		if self.alone || (*alone && self.running > 0) {
			return None;
		}
		let (call, alone) = self.waiting.pop_front()?;
		self.running += 1;
		self.alone = alone;
		Some(call)
	}

	/// One running call ended.
	pub fn done(&mut self) {
		self.running -= 1;
		self.alone = false;
	}

	pub fn running(&self) -> usize {
		self.running
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn started(queue: &mut CallQueue<&'static str>) -> Vec<&'static str> {
		std::iter::from_fn(|| queue.start()).collect()
	}

	#[test]
	fn calls_start_side_by_side_in_the_order_they_came() {
		let mut queue = CallQueue::new();
		queue.push("a", false);
		queue.push("b", false);
		assert_eq!(started(&mut queue), ["a", "b"]);
		assert_eq!(queue.running(), 2);
	}

	#[test]
	fn a_call_that_runs_alone_waits_for_the_earlier_ones_and_holds_back_the_later_ones() {
		let mut queue = CallQueue::new();
		for (call, alone) in [("search", false), ("quiz", true), ("read", false), ("plot", true)] {
			queue.push(call, alone);
		}
		assert_eq!(started(&mut queue), ["search"]);
		queue.done();
		assert_eq!(started(&mut queue), ["quiz"], "read came after quiz, so it waits");
		queue.done();
		assert_eq!(started(&mut queue), ["read"], "plot waits for read");
		queue.done();
		assert_eq!(started(&mut queue), ["plot"]);
		queue.done();
		assert_eq!((started(&mut queue), queue.running()), (Vec::new(), 0));
	}
}
