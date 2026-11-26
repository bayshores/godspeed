//! One lesson turn on the learner's own agent: it opens (or goes on with) the lesson's agent
//! session, sends the turn's input, runs each godspeed tool call through the `ToolHost`, and turns
//! the session's events into the record's messages and the turn stream's events
//! (`TranscriptBuilder`). Steers, Stop and the learner's answers to permission questions reach the
//! running turn through it.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_base::{ids, tasks};
use gs_core::messages::native_messages::turn_input;
use gs_json::{Json, json};
use gs_runtime::{Ask, End, Part, Session, SessionEvent, ToolReply, Verdict};
use parking_lot::Mutex;
use tokio::sync::{mpsc, oneshot, watch};

use super::abort::Abort;
use super::events::{AgentEvent, Listener};
use super::messages::{parts_of, tool_result_message};
use super::record::{TranscriptBuilder, wrote_anything};
use super::tool_host::{HostReply, Reply, ToolHost};

/// Which session a turn asks for: the lesson's own, or a new one that starts from the record.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Opening {
	GoOn,
	New,
}

/// An open session and what the turn sends it first. `knew` is true when the session already
/// held the lesson, so a first native turn that fails with nothing written is tried once more on
/// a new session (a resume Claude Code or Codex could not do).
pub struct Opened {
	pub session: Arc<Session>,
	pub input: Vec<Part>,
	pub knew: bool,
}

pub type OpenFn = Box<dyn Fn(Opening) -> BoxFuture<'static, Result<Opened, String>> + Send + Sync>;
/// The words of one finished message, checked; what comes back is stored and shown.
pub type TextCheck = Box<dyn Fn(&str) -> String + Send + Sync>;

/// What the lesson's desk hears that the turn stream does not carry.
#[derive(Clone, Debug, PartialEq)]
pub enum DeskEvent {
	/// One of the agent's own tools started (a command, a file read, a web search).
	OwnTool { name: String, input: Json },
	/// A permission question waits for the learner.
	Approval { id: String, ask: Json },
	/// It was answered, or denied by Stop or the turn's end.
	ApprovalDone { id: String },
}

pub type DeskListener = Arc<dyn Fn(&DeskEvent) + Send + Sync>;

pub struct SessionTurnSpec {
	pub open: OpenFn,
	pub host: ToolHost,
	pub check_text: TextCheck,
	/// The record before the turn: the before-call hook reads it with the reply.
	pub before: Vec<Json>,
	/// The model record the assistant messages carry.
	pub model: Json,
	/// Codex folds a steer into the running turn; Claude Code gets it as the next turn.
	pub folds_steers: bool,
}

#[derive(Default)]
struct State {
	session: Option<Arc<Session>>,
	/// Between the session's open and the turn's end.
	running: bool,
	/// A native turn runs on the session now.
	native: bool,
	/// Steers for the session's next native turn.
	held: Vec<Json>,
	/// A question for the learner ended the turn; held steers wait for his answer.
	ended_by_tool: bool,
	/// The session compacted its own history; the lesson rolls over at its next turn.
	compacted: bool,
	approvals: HashMap<String, oneshot::Sender<Verdict>>,
}

pub struct SessionTurn {
	open: OpenFn,
	host: Arc<ToolHost>,
	check_text: TextCheck,
	before: Vec<Json>,
	folds_steers: bool,
	builder: Mutex<TranscriptBuilder>,
	state: Mutex<State>,
	listeners: Mutex<Vec<Listener>>,
	desk: Mutex<Vec<DeskListener>>,
	abort: Abort,
	/// Counts the model's calls (each reply to a tool) and the turn's end, for `next_model_call`.
	model_calls: watch::Sender<u64>,
}

/// The input a list of record messages makes: what the session has not seen past `seen`, or all
/// of it from the last cut, which opens with its summary.
pub fn input_of(messages: &[Json], seen: Option<&str>) -> Vec<Part> {
	parts_of(&turn_input(messages, seen))
}

/// A permission question as the lesson's desk reads it.
pub fn ask_json(ask: &Ask) -> Json {
	match ask {
		Ask::Tool { name, input } => json!({ "kind": "tool", "name": name, "input": input.clone() }),
		Ask::Command { command, cwd, reason } => json!({ "kind": "command", "command": command, "cwd": cwd, "reason": reason.clone() }),
		Ask::FileChange { reason } => json!({ "kind": "fileChange", "reason": reason.clone() }),
		Ask::Permissions { reason, permissions } => json!({ "kind": "permissions", "reason": reason.clone(), "permissions": permissions.clone() }),
		Ask::Question { questions } => json!({ "kind": "question", "questions": questions.clone() }),
		Ask::Elicitation { server, message } => json!({ "kind": "elicitation", "server": server, "message": message }),
	}
}

/// What comes back to the loop from a call that ran on its own task.
struct Ran {
	block: Json,
	reply: HostReply,
	answer: oneshot::Sender<ToolReply>,
}

impl SessionTurn {
	pub fn new(spec: SessionTurnSpec) -> Arc<SessionTurn> {
		Arc::new(SessionTurn {
			open: spec.open,
			host: Arc::new(spec.host),
			check_text: spec.check_text,
			before: spec.before,
			folds_steers: spec.folds_steers,
			builder: Mutex::new(TranscriptBuilder::new(spec.model)),
			state: Mutex::default(),
			listeners: Mutex::default(),
			desk: Mutex::default(),
			abort: Abort::new(),
			model_calls: watch::Sender::new(0),
		})
	}

	pub fn subscribe(&self, listener: Listener) {
		self.listeners.lock().push(listener);
	}

	pub fn on_desk(&self, listener: DeskListener) {
		self.desk.lock().push(listener);
	}

	/// The turn's new messages so far, as the record keeps them.
	pub fn messages(&self) -> Vec<Json> {
		self.builder.lock().messages().to_vec()
	}

	/// The agent's own id for the session the turn ran on.
	pub fn native_id(&self) -> Option<String> {
		self.state.lock().session.as_ref().map(|s| s.native_id().to_owned())
	}

	/// The session compacted its own history during the turn.
	pub fn compacted(&self) -> bool {
		self.state.lock().compacted
	}

	pub fn is_running(&self) -> bool {
		self.state.lock().running
	}

	/// Resolves once the agent next calls the model (after a tool's reply) or the turn ends. A job
	/// a tool call starts waits for it, so what it delivers lands after that call's step.
	pub fn next_model_call(&self) -> impl Future<Output = ()> + Send + use<> {
		let mut calls = self.model_calls.subscribe();
		async move {
			let _ = calls.changed().await;
		}
	}

	fn tell(&self, events: Vec<AgentEvent>) {
		let listeners = self.listeners.lock().clone();
		for event in &events {
			for listener in &listeners {
				listener(event);
			}
		}
	}

	fn tell_desk(&self, event: DeskEvent) {
		let listeners = self.desk.lock().clone();
		for listener in listeners {
			listener(&event);
		}
	}

	/// Changes the record being built; its events go out once the lock is let go.
	fn build<T>(&self, change: impl FnOnce(&mut TranscriptBuilder, &mut dyn FnMut(AgentEvent)) -> T) -> T {
		let mut events = Vec::new();
		let out = change(&mut self.builder.lock(), &mut |event| events.push(event));
		self.tell(events);
		out
	}

	/// A message for the running turn: a marker or the learner's words. Codex reads it in the
	/// turn it runs; otherwise it goes as the session's next native turn, once this one ends.
	pub fn steer(&self, message: Json) {
		let mut state = self.state.lock();
		let session = state.session.clone().filter(|_| self.folds_steers && state.native);
		let Some(session) = session else {
			state.held.push(message);
			return;
		};
		drop(state);
		let input = input_of(std::slice::from_ref(&message), None);
		self.builder.lock().steer(message);
		tasks::detach("lesson turn", async move {
			if let Err(err) = session.steer(&input).await {
				eprintln!("[lesson turn] a steer did not reach the agent: {err}");
			}
		});
	}

	/// Stop: the running tools see the abort, the agent is interrupted, and every permission
	/// question still waiting is denied.
	pub fn abort(&self) {
		self.abort.abort();
		let session = self.state.lock().session.clone();
		self.deny_waiting();
		if let Some(session) = session {
			tasks::detach("lesson turn", async move {
				if let Err(err) = session.interrupt().await {
					eprintln!("[lesson turn] the agent could not be stopped: {err}");
				}
			});
		}
	}

	/// The learner's answer to a permission question; false when none waits by that id.
	pub fn answer_approval(&self, id: &str, allow: bool) -> bool {
		let Some(reply) = self.state.lock().approvals.remove(id) else { return false };
		let _ = reply.send(Verdict { allow, message: None });
		self.tell_desk(DeskEvent::ApprovalDone { id: id.to_owned() });
		true
	}

	fn deny_waiting(&self) {
		let waiting: Vec<_> = self.state.lock().approvals.drain().collect();
		for (id, reply) in waiting {
			let _ = reply.send(Verdict { allow: false, message: None });
			self.tell_desk(DeskEvent::ApprovalDone { id });
		}
	}

	/// Runs the turn to its end. Err only when no session could be opened.
	pub async fn run(self: &Arc<Self>) -> Result<(), String> {
		self.state.lock().running = true;
		let mut opened = match (self.open)(Opening::GoOn).await {
			Ok(opened) => opened,
			Err(err) => {
				self.state.lock().running = false;
				self.model_calls.send_modify(|n| *n += 1);
				return Err(err);
			}
		};
		self.build(|b, emit| b.start(emit));
		let mut retried = false;
		let end = loop {
			self.state.lock().session = Some(opened.session.clone());
			let end = if self.abort.is_aborted() { End::Interrupted } else { self.native_turn(&opened.session, &opened.input).await };
			let nothing = !wrote_anything(self.builder.lock().messages());
			if matches!(end, End::Failed(_)) && opened.knew && nothing && !retried && !self.abort.is_aborted() {
				retried = true;
				eprintln!("[lesson turn] the lesson's session failed ({end:?}); going on in a new one");
				match (self.open)(Opening::New).await {
					Ok(fresh) => {
						opened = fresh;
						continue;
					}
					Err(err) => break End::Failed(err),
				}
			}
			let held = {
				let mut state = self.state.lock();
				if end == End::Completed && !state.ended_by_tool && !self.abort.is_aborted() { std::mem::take(&mut state.held) } else { Vec::new() }
			};
			if held.is_empty() {
				break end;
			}
			opened.input = input_of(&held, None);
			self.build(|b, emit| {
				b.end_reply(emit);
				for message in held {
					b.steer(message);
				}
			});
		};
		self.deny_waiting();
		self.build(|b, emit| b.finish(&end, emit));
		self.state.lock().running = false;
		self.model_calls.send_modify(|n| *n += 1);
		Ok(())
	}

	/// One native turn on `session`, to its end.
	async fn native_turn(self: &Arc<Self>, session: &Arc<Session>, input: &[Part]) -> End {
		self.state.lock().native = true;
		let end = match session.send(input).await {
			Ok(()) => self.drain(session).await,
			Err(err) => End::Failed(err),
		};
		self.state.lock().native = false;
		end
	}

	async fn drain(self: &Arc<Self>, session: &Arc<Session>) -> End {
		let (ran_tx, mut ran_rx) = mpsc::unbounded_channel::<Ran>();
		let mut running = 0usize;
		let end = loop {
			tokio::select! {
				event = session.next() => match event {
					None => break End::Failed("the agent stopped".to_owned()),
					Some(SessionEvent::Ended(end)) => break end,
					Some(event) => {
						if self.take(event, &ran_tx) {
							running += 1;
						}
					}
				},
				Some(ran) = ran_rx.recv() => {
					running -= 1;
					self.ran(ran);
				}
			}
		};
		// A call still running was stopped with the turn; its result is kept.
		while running > 0 {
			let Some(ran) = ran_rx.recv().await else { break };
			running -= 1;
			self.ran(ran);
		}
		end
	}

	/// One event; true when it started a tool call.
	fn take(self: &Arc<Self>, event: SessionEvent, ran: &mpsc::UnboundedSender<Ran>) -> bool {
		match event {
			SessionEvent::TurnStarted => {}
			SessionEvent::TextDelta(text) => self.build(|b, emit| b.delta(&text, emit)),
			SessionEvent::TextDone(text) => {
				let checked = (self.check_text)(&text);
				self.build(|b, emit| b.text_done(checked, emit));
			}
			SessionEvent::OwnTool { name, input, done: false, .. } => self.tell_desk(DeskEvent::OwnTool { name, input }),
			SessionEvent::OwnTool { .. } => {}
			// The step's calls go in first, so each call's check sees the whole step.
			SessionEvent::Calls(calls) => self.build(|b, emit| {
				for call in &calls {
					b.tool_call(&call.id, &call.name, &call.args, self.host.may_hold(&call.name), emit);
				}
			}),
			SessionEvent::ToolCall { call, reply } => {
				let (block, message, earlier) = self.build(|b, emit| {
					let block = b.tool_call(&call.id, &call.name, &call.args, self.host.may_hold(&call.name), emit);
					emit(AgentEvent::ToolExecutionStart { tool_call_id: call.id.clone(), tool_name: call.name.clone(), args: call.args.clone() });
					(block, b.reply().cloned().unwrap_or_default(), b.before_reply().to_vec())
				});
				let before: Vec<Json> = self.before.iter().cloned().chain(earlier).collect();
				let (host, abort, ran) = (self.host.clone(), self.abort.clone(), ran.clone());
				tasks::detach("lesson tool", async move {
					let out = host.call(&block, Reply { before: &before, message: &message }, &abort).await;
					let _ = ran.send(Ran { block, reply: out, answer: reply });
				});
				return true;
			}
			SessionEvent::Approval { ask, reply } => {
				let id = ids::uuid_hex("approval", 12);
				if self.abort.is_aborted() {
					let _ = reply.send(Verdict { allow: false, message: None });
					return false;
				}
				self.state.lock().approvals.insert(id.clone(), reply);
				self.tell_desk(DeskEvent::Approval { id, ask: ask_json(&ask) });
			}
			SessionEvent::Usage(usage) => self.builder.lock().usage(usage),
			SessionEvent::Compacted => self.state.lock().compacted = true,
			SessionEvent::Ended(_) => {}
		}
		false
	}

	/// A call's result: recorded (a held call set aside instead, a call it releases put back with
	/// its own result first), shown, and answered to the agent.
	fn ran(&self, ran: Ran) {
		let Ran { block, reply, answer } = ran;
		let id = block["id"].str_or_empty().to_owned();
		self.build(|b, emit| {
			emit(AgentEvent::ToolExecutionEnd {
				tool_call_id: id.clone(),
				tool_name: block["name"].str_or_empty().to_owned(),
				result: reply.result.clone(),
				is_error: reply.is_error,
				duration_ms: reply.duration_ms,
			});
			if reply.held {
				b.set_aside(&id, emit);
				return;
			}
			b.decide(&id);
			if reply.ends_turn {
				b.decide_all();
			}
			if let Some(release) = &reply.releases
				&& let Some(held) = b.release(&release.id, &id, emit)
				&& let Some(result) = &release.result
			{
				b.tool_result(tool_result_message(&held, result, false, None), emit);
			}
			b.tool_result(tool_result_message(&block, &reply.result, reply.is_error, reply.duration_ms), emit);
		});
		if reply.ends_turn {
			self.state.lock().ended_by_tool = true;
		}
		let _ = answer.send(reply.agent_reply());
		self.model_calls.send_modify(|n| *n += 1);
	}
}
