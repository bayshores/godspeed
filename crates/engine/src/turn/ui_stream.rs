//! One lesson turn as a background object whose views are SSE streams
//!. The wire is the agent's own events:
//!
//! ```text
//! data: {"type":"agent_start"}\n\n … data: {"type":"agent_end","messages":[…]}\n\n data: [DONE]\n\n
//! ```
//!
//! plus `{"type":"error","errorText"}` when the run could not start. Call ids are made unique
//! first (call_ids.rs). The turn keeps a compact log for views that attach later: settled events
//! as they are and only the latest `message_update`; live updates go out at most once per flush
//! window, and anything pending goes out before the next settled event.

use std::sync::Arc;

use gs_base::clock;
use gs_json::{Json, json, stringify};
use parking_lot::Mutex;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};

use super::abort::Abort;
use super::agent::Agent;
use super::call_ids::ToolCallIdUniquifier;
use super::events::AgentEvent;
use super::messages::role;

/// The headers of a turn's SSE response (GET /api/chats/{id}/stream).
pub const SSE_HEADERS: [(&str, &str); 3] = [("Content-Type", "text/event-stream"), ("Cache-Control", "no-cache, no-transform"), ("X-Accel-Buffering", "no")];

const DONE_FRAME: &str = "data: [DONE]\n\n";

/// `on_settle_failure(error, reported_error_text)`.
pub type SettleFailureFn = Box<dyn Fn(&str, Option<&str>) + Send + Sync>;

pub struct TurnSpec {
	/// The turn's agent, built from the record for this turn.
	pub agent: Arc<Agent>,
	/// The error text views see when the run could not start (TS `onError`).
	pub on_error: Box<dyn Fn(&str) -> String + Send + Sync>,
	/// The error text views see when `on_finish` failed.
	pub on_settle_error: Box<dyn Fn(&str) -> String + Send + Sync>,
	/// Clean-up after a failed `on_finish`, with the error text already reported, if any.
	pub on_settle_failure: SettleFailureFn,
	/// Persist and finish: gets the agent's final transcript without system messages (ids as
	/// the wire showed them); the caller saves the part past its own base.
	pub on_finish: Box<dyn Fn(Vec<Json>) -> Result<(), String> + Send + Sync>,
	/// Every tool-call id the chat record already holds.
	pub used_tool_call_ids: Vec<String>,
	/// The live update window (100 ms in the app).
	pub update_flush_ms: i64,
}

/// The running turn: `subscribe` for a view, `abort` for the remote kill.
#[derive(Clone)]
pub struct TurnHandle(Arc<Turn>);

struct Turn {
	spec: TurnSpec,
	abort: Abort,
	/// Messages in the agent before this run (history: their ids never change).
	base: usize,
	uniquifier: Mutex<ToolCallIdUniquifier>,
	wire: Mutex<Wire>,
}

#[derive(Default)]
struct Wire {
	settled: bool,
	reported_error: Option<String>,
	log: Vec<Json>,
	/// The log index of the streaming message's latest update.
	update_slot: Option<usize>,
	/// The latest update not yet sent live.
	pending: Option<Json>,
	/// The flush timer's number while one is set.
	flush_armed: Option<u64>,
	flushes: u64,
	views: Vec<UnboundedSender<String>>,
}

fn frame(event: &Json) -> String {
	format!("data: {}\n\n", stringify(event))
}

impl Wire {
	fn broadcast(&mut self, event: &Json) {
		let f = frame(event);
		self.views.retain(|v| v.send(f.clone()).is_ok());
	}

	fn flush_pending(&mut self) {
		self.flush_armed = None;
		if let Some(event) = self.pending.take() {
			self.broadcast(&event);
		}
	}
}

/// Builds the turn without starting it: register the handle, then `start` it, so a turn that
/// settles at once cannot settle before it is registered.
pub fn run_pi_turn(spec: TurnSpec) -> TurnHandle {
	let base = spec.agent.messages().len();
	let uniquifier = Mutex::new(ToolCallIdUniquifier::new(spec.used_tool_call_ids.clone()));
	let turn = Arc::new(Turn { spec, abort: Abort::new(), base, uniquifier, wire: Mutex::new(Wire::default()) });
	let listener = Arc::downgrade(&turn);
	turn.spec.agent.subscribe(Arc::new(move |event: &AgentEvent| {
		if let Some(turn) = listener.upgrade() {
			turn.handle(event.clone());
		}
	}));
	TurnHandle(turn)
}

impl TurnHandle {
	/// Runs the agent on from its transcript, in the background.
	pub fn start(&self) {
		let turn = self.0.clone();
		tokio::spawn(async move {
			let Err(err) = turn.spec.agent.continue_run(turn.abort.clone()).await else { return };
			if turn.wire.lock().settled {
				eprintln!("[turn] error after settlement: {err}");
				return;
			}
			eprintln!("[turn] agent loop failed: {err}");
			let text = (turn.spec.on_error)(&err);
			turn.wire.lock().reported_error = Some(text.clone());
			turn.send(json!({ "type": "error", "errorText": text }));
			turn.settle();
			turn.close_all();
		});
	}

	/// A new view: the whole log so far, then live frames, ending with `[DONE]` once the turn
	/// settles. Dropping the receiver detaches the view; the turn runs on.
	pub fn subscribe(&self) -> UnboundedReceiver<String> {
		let (tx, rx) = unbounded_channel();
		let mut wire = self.0.wire.lock();
		for event in &wire.log {
			let _ = tx.send(frame(event));
		}
		if wire.settled {
			let _ = tx.send(DONE_FRAME.to_owned());
		} else {
			wire.views.push(tx);
		}
		rx
	}

	/// The remote kill: the loop's `agent_end` settles the turn as usual.
	pub fn abort(&self) {
		if !self.0.wire.lock().settled {
			self.0.abort.abort();
		}
	}
}

impl Turn {
	fn handle(self: &Arc<Self>, event: AgentEvent) {
		if self.wire.lock().settled {
			return;
		}
		let event = self.uniquifier.lock().event(event);
		let end = matches!(event, AgentEvent::AgentEnd { .. });
		self.send(event.to_json());
		if end {
			self.settle();
			self.close_all();
		}
	}

	fn send(self: &Arc<Self>, event: Json) {
		let mut wire = self.wire.lock();
		if wire.settled {
			return;
		}
		match event["type"].as_str() {
			Some("message_update") => {
				match wire.update_slot {
					Some(i) => wire.log[i] = event.clone(),
					None => {
						wire.update_slot = Some(wire.log.len());
						wire.log.push(event.clone());
					}
				}
				wire.pending = Some(event);
				self.arm_flush(&mut wire);
				return;
			}
			Some("message_end") => wire.update_slot = None,
			_ => {}
		}
		wire.flush_pending();
		wire.broadcast(&event);
		wire.log.push(event);
	}

	fn arm_flush(self: &Arc<Self>, wire: &mut Wire) {
		if wire.flush_armed.is_some() {
			return;
		}
		wire.flushes += 1;
		let number = wire.flushes;
		wire.flush_armed = Some(number);
		let turn = Arc::downgrade(self);
		let delay = self.spec.update_flush_ms;
		tokio::spawn(async move {
			clock::sleep(delay).await;
			if let Some(turn) = turn.upgrade() {
				let mut wire = turn.wire.lock();
				if wire.flush_armed == Some(number) {
					wire.flush_pending();
				}
			}
		});
	}

	/// The settle seam: `on_finish` gets the agent's own final transcript.
	fn settle(self: &Arc<Self>) {
		let all = self.spec.agent.messages();
		let settled: Vec<Json> = self.uniquifier.lock().remap_settled(&all, self.base).into_iter().filter(|m| role(m) != "system").collect();
		let Err(err) = (self.spec.on_finish)(settled) else { return };
		eprintln!("[turn] settlement failed: {err}");
		let reported = self.wire.lock().reported_error.clone();
		(self.spec.on_settle_failure)(&err, reported.as_deref());
		if reported.is_none() {
			let text = (self.spec.on_settle_error)(&err);
			self.wire.lock().reported_error = Some(text.clone());
			self.send(json!({ "type": "error", "errorText": text }));
		}
	}

	fn close_all(&self) {
		let mut wire = self.wire.lock();
		if wire.settled {
			return;
		}
		wire.flush_pending();
		wire.settled = true;
		for view in std::mem::take(&mut wire.views) {
			let _ = view.send(DONE_FRAME.to_owned());
		}
	}
}
