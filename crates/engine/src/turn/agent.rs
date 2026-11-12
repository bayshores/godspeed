//! The stateful agent (pi-agent-core agent.ts): owns the transcript, runs the loop, emits
//! events, and queues steering and follow-up messages for a running loop.

use std::future::Future;
use std::sync::Arc;

use gs_json::Json;
use parking_lot::Mutex;

use super::abort::Abort;
use super::events::AgentEvent;
use super::faux::Engine;
use super::messages::role;
use super::tool::Tool;
use super::transcript::{initial_system_message, tool_declaration};

/// How a queue drains at a turn boundary.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum QueueMode {
	/// Every queued message at once (the lesson's steering).
	All,
	/// The first queued message only (pi's default).
	OneAtATime,
}

/// The finished turn the `finish_turn` hook decides on.
pub struct FinishedTurn<'a> {
	pub message: &'a Json,
	pub tool_results: &'a [Json],
}

/// pi's `convertToLlm`: the transcript as the model gets it. Must not fail.
pub type ConvertFn = Box<dyn Fn(&[Json]) -> Vec<Json> + Send + Sync>;
/// pi's `finishTurn`: true ends the run at this turn (before the steering poll).
pub type FinishFn = Box<dyn FnMut(&FinishedTurn) -> bool + Send>;
/// An event listener; called in subscription order, outside the agent's locks.
pub type Listener = Arc<dyn Fn(&AgentEvent) + Send + Sync>;

pub struct AgentOptions {
	pub engine: Engine,
	/// Seeds the leading system message (with the tools) unless `messages` starts with one.
	pub system_prompt: String,
	pub tools: Vec<Arc<dyn Tool>>,
	pub messages: Vec<Json>,
	/// The conversation id passed to the model (the chat id for lessons).
	pub session_id: Option<String>,
	pub steering_mode: QueueMode,
	/// None keeps the user, assistant, tool result and system messages.
	pub convert_to_llm: Option<ConvertFn>,
	pub finish_turn: Option<FinishFn>,
}

impl AgentOptions {
	pub fn new(engine: Engine) -> AgentOptions {
		AgentOptions {
			engine,
			system_prompt: String::new(),
			tools: Vec::new(),
			messages: Vec::new(),
			session_id: None,
			steering_mode: QueueMode::OneAtATime,
			convert_to_llm: None,
			finish_turn: None,
		}
	}
}

pub struct Agent {
	pub(super) engine: Engine,
	pub(super) tools: Vec<Arc<dyn Tool>>,
	pub(super) session_id: Option<String>,
	pub(super) convert_to_llm: Option<ConvertFn>,
	pub(super) finish_turn: Mutex<Option<FinishFn>>,
	messages: Mutex<Vec<Json>>,
	steering: Mutex<Vec<Json>>,
	steering_mode: QueueMode,
	follow_ups: Mutex<Vec<Json>>,
	listeners: Mutex<Vec<Listener>>,
	/// The running loop's abort, while one runs.
	active: Mutex<Option<Abort>>,
	/// Counts model calls and run ends, for `next_model_call`.
	model_calls: tokio::sync::watch::Sender<u64>,
}

/// Clears the active run when the run ends or its future is dropped.
struct ActiveRun<'a>(&'a Agent);

impl Drop for ActiveRun<'_> {
	fn drop(&mut self) {
		*self.0.active.lock() = None;
		self.0.passed_model_call();
	}
}

fn drain(queue: &mut Vec<Json>, mode: QueueMode) -> Vec<Json> {
	match mode {
		QueueMode::All => std::mem::take(queue),
		QueueMode::OneAtATime if queue.is_empty() => Vec::new(),
		QueueMode::OneAtATime => vec![queue.remove(0)],
	}
}

impl Agent {
	pub fn new(options: AgentOptions) -> Arc<Agent> {
		let mut messages = options.messages;
		let declarations: Vec<Json> = options.tools.iter().map(|t| tool_declaration(t.as_ref())).collect();
		if messages.first().is_none_or(|m| role(m) != "system")
			&& let Some(system) = initial_system_message(&options.system_prompt, &declarations)
		{
			messages.insert(0, system);
		}
		Arc::new(Agent {
			engine: options.engine,
			tools: options.tools,
			session_id: options.session_id,
			convert_to_llm: options.convert_to_llm,
			finish_turn: Mutex::new(options.finish_turn),
			messages: Mutex::new(messages),
			steering: Mutex::new(Vec::new()),
			steering_mode: options.steering_mode,
			follow_ups: Mutex::new(Vec::new()),
			listeners: Mutex::new(Vec::new()),
			active: Mutex::new(None),
			model_calls: tokio::sync::watch::Sender::new(0),
		})
	}

	/// The transcript (pi's `agent.state.messages`): the seeded system message, the messages it
	/// was built with, and every message the runs added.
	pub fn messages(&self) -> Vec<Json> {
		self.messages.lock().clone()
	}

	pub fn subscribe(&self, listener: Listener) {
		self.listeners.lock().push(listener);
	}

	/// Queues a message for the next turn boundary of the running loop.
	pub fn steer(&self, message: Json) {
		self.steering.lock().push(message);
	}

	/// Queues a message to run once the loop would otherwise stop.
	pub fn follow_up(&self, message: Json) {
		self.follow_ups.lock().push(message);
	}

	/// Aborts the running loop, if any.
	pub fn abort(&self) {
		if let Some(abort) = self.active.lock().as_ref() {
			abort.abort();
		}
	}

	pub fn is_running(&self) -> bool {
		self.active.lock().is_some()
	}

	/// Resolves once the running loop next calls the model, or ends. Work a tool call starts in
	/// the background waits for it: Node's went on only after the loop's synchronous steps, so
	/// what it delivers misses the steering poll right after that tool call.
	pub fn next_model_call(&self) -> impl Future<Output = ()> + Send + use<> {
		let mut calls = self.model_calls.subscribe();
		async move {
			let _ = calls.changed().await;
		}
	}

	pub(super) fn passed_model_call(&self) {
		self.model_calls.send_modify(|n| *n += 1);
	}

	/// Runs the loop with `messages` as the new prompt. `abort` is the run's abort (`abort()`
	/// fires it too); a run already going is an error.
	pub async fn prompt(&self, messages: Vec<Json>, abort: Abort) -> Result<(), String> {
		if self.is_running() {
			return Err("Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.".to_owned());
		}
		self.run(Some(messages), false, abort).await
	}

	/// Runs the loop on from the transcript. After an assistant message only queued steering or
	/// follow-up messages can continue it.
	pub async fn continue_run(&self, abort: Abort) -> Result<(), String> {
		if self.is_running() {
			return Err("Agent is already processing. Wait for completion before continuing.".to_owned());
		}
		let last_role = {
			let messages = self.messages.lock();
			if messages.is_empty() || messages.iter().all(|m| role(m) == "system") {
				return Err("No messages to continue from".to_owned());
			}
			role(messages.last().expect("not empty")).to_owned()
		};
		if last_role == "assistant" {
			let steering = self.steering_messages();
			if !steering.is_empty() {
				return self.run(Some(steering), true, abort).await;
			}
			let follow_ups = self.follow_up_messages();
			if !follow_ups.is_empty() {
				return self.run(Some(follow_ups), false, abort).await;
			}
			return Err("Cannot continue from message role: assistant".to_owned());
		}
		self.run(None, false, abort).await
	}

	async fn run(&self, prompts: Option<Vec<Json>>, skip_initial_steering: bool, abort: Abort) -> Result<(), String> {
		{
			let mut active = self.active.lock();
			if active.is_some() {
				return Err("Agent is already processing.".to_owned());
			}
			*active = Some(abort.clone());
		}
		let _active = ActiveRun(self);
		self.run_loop(prompts, skip_initial_steering, &abort).await;
		Ok(())
	}

	pub(super) fn steering_messages(&self) -> Vec<Json> {
		drain(&mut self.steering.lock(), self.steering_mode)
	}

	pub(super) fn follow_up_messages(&self) -> Vec<Json> {
		drain(&mut self.follow_ups.lock(), QueueMode::OneAtATime)
	}

	/// Records the event in the transcript, then tells the listeners.
	pub(super) fn emit(&self, event: AgentEvent) {
		if let AgentEvent::MessageEnd(message) = &event {
			self.messages.lock().push(message.clone());
		}
		let listeners = self.listeners.lock().clone();
		for listener in listeners {
			listener(&event);
		}
	}
}
