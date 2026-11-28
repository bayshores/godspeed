//! One Claude helper process serving many sessions, each its own Agent SDK query. godspeed names
//! the sessions; the helper reports Claude Code's own session id for each.

use std::collections::HashMap;
use std::sync::Arc;

use gs_base::tasks;
use gs_json::stringify;
use parking_lot::Mutex;
use tokio::sync::{mpsc, oneshot};

use super::protocol::{self, ClaudeProgram, FromHelper, Reading};
use crate::event::{End, Part, SessionEvent, ToolReply, Verdict};
use crate::models::Model;
use crate::pending::Pending;
use crate::pipes::{self, Reader, Started};
use crate::session::{Link, Session, SessionSpec, Trouble};

const LABEL: &str = "claude helper";

/// Why a question fails once the helper has gone.
const STOPPED: &str = "the Claude helper stopped";

pub(crate) struct Connection {
	state: Arc<State>,
	program: ClaudeProgram,
	reader: Reader,
}

struct State {
	out: mpsc::UnboundedSender<String>,
	sessions: Mutex<HashMap<String, Arc<Open>>>,
	/// Opens waiting for the helper's `opened`, or its error, by session key.
	opening: Pending<String, String>,
	/// Model lists asked for, by question id.
	models: Pending<String, Vec<Model>>,
	trouble: Trouble,
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
	reading: Reading,
}

impl Connection {
	/// A refused sign-in is told to `trouble`.
	pub fn start(started: Started, program: ClaudeProgram, trouble: Trouble) -> Arc<Connection> {
		let state = Arc::new(State { out: pipes::writer(LABEL, started.writer), sessions: Mutex::new(HashMap::new()), opening: Pending::new(), models: Pending::new(), trouble });
		let (reading, ending) = (state.clone(), state.clone());
		let reader = pipes::serve(LABEL, started.reader, started.process, move |line| reading.take(&line), move |why| ending.end(why));
		Arc::new(Connection { state, program, reader })
	}

	pub fn alive(&self) -> bool {
		self.reader.alive()
	}

	pub async fn open(self: &Arc<Self>, spec: SessionSpec) -> Result<Session, String> {
		let key = format!("s{}", self.state.opening.next_id());
		let answer = self.state.opening.ask(key.clone())?;
		let (events, rx) = mpsc::unbounded_channel();
		self.state.sessions.lock().insert(key.clone(), Arc::new(Open { events, turn: Mutex::new(Turn::default()) }));
		self.state.write(&protocol::open(&key, &spec, &self.program));
		let native_id = match answer.await.unwrap_or_else(|_| Err(STOPPED.to_owned())) {
			Ok(id) => id,
			Err(err) => {
				self.state.sessions.lock().remove(&key);
				return Err(err);
			}
		};
		Ok(Session::new(native_id, rx, Link::Claude(SessionLink { connection: self.clone(), key })))
	}

	/// The models Claude Code offers, which the helper asks it for.
	pub async fn models(&self) -> Result<Vec<Model>, String> {
		let id = format!("m{}", self.state.models.next_id());
		let answer = self.state.models.ask(id.clone())?;
		self.state.write(&protocol::models(&id, &self.program));
		answer.await.unwrap_or_else(|_| Err(STOPPED.to_owned()))
	}
}

/// A session's hold on its query in the helper.
pub(crate) struct SessionLink {
	connection: Arc<Connection>,
	key: String,
}

impl SessionLink {
	fn open(&self) -> Result<Arc<Open>, String> {
		self.connection.state.sessions.lock().get(&self.key).cloned().ok_or_else(|| "Claude Code stopped; open the session again".to_owned())
	}

	pub fn send(&self, parts: &[Part]) -> Result<(), String> {
		*self.open()?.turn.lock() = Turn { running: true, ..Turn::default() };
		self.connection.state.write(&protocol::send(&self.key, parts));
		Ok(())
	}

	pub fn interrupt(&self) -> Result<(), String> {
		self.open()?.turn.lock().reading.interrupting = true;
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
				self.opening.settle(&session, Ok(native_id));
			}
			FromHelper::Sdk { session, message } => {
				if protocol::signed_out(&message) {
					self.trouble.tell();
				}
				let Some(open) = self.session(&session) else { return };
				let mut turn = open.turn.lock();
				// Outside a turn (the session's start-up) is not the reply.
				if !turn.running {
					return;
				}
				if !turn.started {
					turn.started = true;
					let _ = open.events.send(SessionEvent::TurnStarted);
				}
				let (events, end) = protocol::read_sdk(&message, &mut turn.reading);
				for event in events {
					let _ = open.events.send(event);
				}
				if let Some(end) = end {
					*turn = Turn::default();
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
					let reply = answer.await.unwrap_or_else(|_| ToolReply::dropped());
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
					let verdict = answer.await.unwrap_or_else(|_| Verdict::refused());
					state.write(&protocol::approval(&id, &verdict));
				});
			}
			FromHelper::Closed { session } => {
				let open = self.sessions.lock().remove(&session);
				if let Some(open) = open {
					stopped(&open, "Claude Code stopped".to_owned());
				}
			}
			FromHelper::Models { id, models } => {
				self.models.settle(&id, models);
			}
			FromHelper::Error { session, message } => {
				eprintln!("[{LABEL}] {}{message}", session.as_deref().map(|s| format!("{s}: ")).unwrap_or_default());
				let Some(session) = session else { return };
				if !self.opening.settle(&session, Err(message.clone()))
					&& let Some(open) = self.session(&session)
				{
					stopped(&open, message);
				}
			}
		}
	}

	/// The helper stopped: every open session ends, and the next open starts a new one.
	fn end(&self, why: &str) {
		eprintln!("[{LABEL}] stopped: {why}");
		let why = format!("{STOPPED}: {why}");
		self.opening.close(&why);
		self.models.close(&why);
		for (_, open) in self.sessions.lock().drain() {
			let _ = open.events.send(SessionEvent::Ended(End::Failed(why.clone())));
		}
	}
}

/// A session whose Claude Code ended mid-turn fails that turn.
fn stopped(open: &Open, why: String) {
	if std::mem::take(&mut *open.turn.lock()).running {
		let _ = open.events.send(SessionEvent::Ended(End::Failed(why)));
	}
}
