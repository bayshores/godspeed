//! One Claude helper process serving many sessions, each its own Agent SDK query. godspeed names
//! the sessions; the helper reports Claude Code's own session id for each.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use gs_base::tasks;
use gs_json::stringify;
use parking_lot::Mutex;
use tokio::sync::{mpsc, oneshot};

use super::protocol::{self, ClaudeProgram, FromHelper, Reading};
use crate::event::{End, Part, REFUSED, SessionEvent, TOOL_DROPPED, ToolReply, Verdict};
use crate::pipes::{self, Reader, Started};
use crate::session::{Link, Session, SessionSpec};

const LABEL: &str = "claude helper";

pub struct Connection {
	state: Arc<State>,
	program: ClaudeProgram,
	_reader: Reader,
}

struct State {
	out: mpsc::UnboundedSender<String>,
	sessions: Mutex<HashMap<String, Arc<Open>>>,
	/// Opens waiting for the helper's `opened`, or its error.
	opening: Mutex<HashMap<String, oneshot::Sender<Result<String, String>>>>,
	next: Mutex<u64>,
	alive: AtomicBool,
}

/// One open session: where its events go, and the turn it runs.
struct Open {
	events: mpsc::UnboundedSender<SessionEvent>,
	turn: Mutex<Turn>,
}

#[derive(Default)]
struct Turn {
	running: bool,
	started: bool,
	interrupting: bool,
	reading: Reading,
	/// Steers sent since the learner's last message. Claude Code runs one that comes after the
	/// turn's last step as a turn of its own, so these outlive the turn they were sent in.
	steers: usize,
}

impl Connection {
	pub fn start(started: Started, program: ClaudeProgram) -> Arc<Connection> {
		let state = Arc::new(State { out: pipes::writer(LABEL, started.writer), sessions: Mutex::new(HashMap::new()), opening: Mutex::new(HashMap::new()), next: Mutex::new(1), alive: AtomicBool::new(true) });
		let reading = state.clone();
		let reader = tasks::spawn(LABEL, async move {
			let why = pipes::read(started.reader, started.process, |line| reading.take(&line)).await;
			reading.end(&why);
		});
		Arc::new(Connection { state, program, _reader: Reader(reader) })
	}

	pub fn alive(&self) -> bool {
		self.state.alive.load(Ordering::SeqCst)
	}

	pub async fn open(self: &Arc<Self>, spec: SessionSpec) -> Result<Session, String> {
		let key = {
			let mut next = self.state.next.lock();
			*next += 1;
			format!("s{}", *next - 1)
		};
		let (events, rx) = mpsc::unbounded_channel();
		let (opened, answer) = oneshot::channel();
		self.state.sessions.lock().insert(key.clone(), Arc::new(Open { events, turn: Mutex::new(Turn::default()) }));
		self.state.opening.lock().insert(key.clone(), opened);
		self.state.write(&protocol::open(&key, &spec, &self.program));
		let native_id = match answer.await.unwrap_or_else(|_| Err("the Claude helper stopped".to_owned())) {
			Ok(id) => id,
			Err(err) => {
				self.state.sessions.lock().remove(&key);
				return Err(err);
			}
		};
		Ok(Session::new(native_id, rx, Link::Claude(SessionLink { connection: self.clone(), key })))
	}
}

/// A session's hold on its query in the helper.
pub struct SessionLink {
	connection: Arc<Connection>,
	key: String,
}

impl SessionLink {
	fn open(&self) -> Result<Arc<Open>, String> {
		self.connection.state.sessions.lock().get(&self.key).cloned().ok_or_else(|| "Claude Code stopped; open the session again".to_owned())
	}

	pub fn send(&self, parts: &[Part]) -> Result<(), String> {
		*self.open()?.turn.lock() = Turn { running: true, ..Turn::default() };
		self.connection.state.write(&protocol::send(&self.key, parts, false));
		Ok(())
	}

	pub fn steer(&self, parts: &[Part]) -> Result<(), String> {
		self.open()?.turn.lock().steers += 1;
		self.connection.state.write(&protocol::send(&self.key, parts, true));
		Ok(())
	}

	pub fn interrupt(&self) -> Result<(), String> {
		self.open()?.turn.lock().interrupting = true;
		self.connection.state.write(&protocol::interrupt(&self.key));
		Ok(())
	}

	pub fn set_model(&self, model: &str) -> Result<(), String> {
		self.open()?;
		self.connection.state.write(&protocol::model(&self.key, model));
		Ok(())
	}

	/// Ends the query, and with it the session's Claude Code.
	pub fn close(&self) {
		if self.connection.state.sessions.lock().remove(&self.key).is_some() {
			self.connection.state.write(&protocol::close(&self.key));
		}
	}
}

impl State {
	fn write(&self, message: &gs_json::Json) {
		// Gone only once the helper has stopped, which the reader reports.
		let _ = self.out.send(stringify(message));
	}

	fn session(&self, key: &str) -> Option<Arc<Open>> {
		self.sessions.lock().get(key).cloned()
	}

	fn take(self: &Arc<Self>, line: &str) {
		let message = match protocol::from_helper(line) {
			Ok(message) => message,
			Err(err) => return eprintln!("[{LABEL}] a line godspeed cannot read ({err}): {}", line.chars().take(200).collect::<String>()),
		};
		match message {
			FromHelper::Opened { session, native_id } => {
				let opened = self.opening.lock().remove(&session);
				if let Some(opened) = opened {
					let _ = opened.send(Ok(native_id));
				}
			}
			FromHelper::Sdk { session, message } => {
				let Some(open) = self.session(&session) else { return };
				let mut turn = open.turn.lock();
				if !turn.running {
					// A steer's own turn starts with the model at work; anything else outside a turn
					// (the session's start-up) is not the reply.
					if turn.steers == 0 || !protocol::model_at_work(&message) {
						return;
					}
					*turn = Turn { running: true, steers: turn.steers - 1, ..Turn::default() };
				}
				if !turn.started {
					turn.started = true;
					let _ = open.events.send(SessionEvent::TurnStarted);
				}
				let (events, finish) = protocol::read_sdk(&message, &mut turn.reading);
				for event in events {
					let _ = open.events.send(event);
				}
				if let Some(finish) = finish {
					let end = finish.end(turn.interrupting);
					*turn = Turn { steers: turn.steers, ..Turn::default() };
					let _ = open.events.send(SessionEvent::Ended(end));
				}
			}
			FromHelper::ToolCall { id, session, call } => {
				let state = self.clone();
				let (reply, answer) = oneshot::channel();
				if let Some(open) = self.session(&session) {
					let _ = open.events.send(SessionEvent::ToolCall { call, reply });
				}
				tasks::detach(LABEL, async move {
					let reply = answer.await.unwrap_or_else(|_| ToolReply { content: vec![Part::Text(TOOL_DROPPED.to_owned())], is_error: true, ends_turn: false });
					state.write(&protocol::tool_result(&id, &reply));
				});
			}
			FromHelper::Approval { id, session, ask } => {
				let state = self.clone();
				let (reply, answer) = oneshot::channel();
				if let Some(open) = self.session(&session) {
					let _ = open.events.send(SessionEvent::Approval { ask, reply });
				}
				tasks::detach(LABEL, async move {
					let verdict = answer.await.unwrap_or(Verdict { allow: false, message: None });
					// The SDK passes a refusal's message to Claude, and needs one.
					let message = verdict.message.or_else(|| (!verdict.allow).then(|| REFUSED.to_owned()));
					state.write(&protocol::approval(&id, &Verdict { allow: verdict.allow, message }));
				});
			}
			FromHelper::Closed { session } => {
				let open = self.sessions.lock().remove(&session);
				if let Some(open) = open {
					stopped(&open, "Claude Code stopped".to_owned());
				}
			}
			FromHelper::Error { session, message } => {
				eprintln!("[{LABEL}] {}{message}", session.as_deref().map(|s| format!("{s}: ")).unwrap_or_default());
				let Some(session) = session else { return };
				let opened = self.opening.lock().remove(&session);
				if let Some(opened) = opened {
					let _ = opened.send(Err(message));
				} else if let Some(open) = self.session(&session) {
					stopped(&open, message);
				}
			}
		}
	}

	/// The helper stopped: every open session ends, and the next open starts a new one.
	fn end(&self, why: &str) {
		eprintln!("[{LABEL}] stopped: {why}");
		self.alive.store(false, Ordering::SeqCst);
		for (_, opened) in self.opening.lock().drain() {
			let _ = opened.send(Err(format!("the Claude helper stopped: {why}")));
		}
		for (_, open) in self.sessions.lock().drain() {
			let _ = open.events.send(SessionEvent::Ended(End::Failed(format!("the Claude helper stopped: {why}"))));
		}
	}
}

/// A session whose Claude Code ended mid-turn fails that turn.
fn stopped(open: &Open, why: String) {
	if std::mem::take(&mut *open.turn.lock()).running {
		let _ = open.events.send(SessionEvent::Ended(End::Failed(why)));
	}
}
