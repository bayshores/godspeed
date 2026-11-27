//! One `codex app-server` and its threads: each godspeed session is one thread. Notifications
//! and requests are routed to their thread's session by thread id.

use std::collections::HashMap;
use std::sync::Arc;

use gs_base::config::VERSION;
use gs_base::tasks;
use gs_json::Json;
use parking_lot::Mutex;
use tokio::sync::{mpsc, oneshot};

use super::wire::{self, Item, Note, ServerRequest, TurnStatus};
use crate::event::{End, Part, SessionEvent, ToolReply, Verdict};
use crate::jsonrpc::{Incoming, Rpc, UNKNOWN_METHOD};
use crate::models::Model;
use crate::pending::Pending;
use crate::pipes::{self, Reader, Started};
use crate::session::{Session, SessionSpec, Trouble};

const LABEL: &str = "codex app-server";

pub struct Connection {
	state: Arc<State>,
	reader: Reader,
}

struct State {
	rpc: Rpc,
	threads: Mutex<HashMap<String, Arc<Thread>>>,
	/// Sign-ins waiting to end, by login id.
	logins: Pending<String, ()>,
	trouble: Trouble,
}

/// A ChatGPT sign-in started in godspeed's own Codex folder: the learner finishes it on `url`.
pub(crate) struct CodexLogin {
	pub id: String,
	pub url: String,
	/// How it ended; an error says why (cancelled, failed, or Codex stopped).
	pub ended: oneshot::Receiver<Result<(), String>>,
}

/// One open thread: where its events go, and the turn it runs.
struct Thread {
	events: mpsc::UnboundedSender<SessionEvent>,
	turn: Mutex<Turn>,
	/// A model picked since the last turn started, sent with the next.
	model: Mutex<Option<String>>,
}

#[derive(Default)]
struct Turn {
	id: Option<String>,
	/// Calls whose reply ends the turn, by call id and tool: the turn is interrupted once Codex
	/// has recorded the call as completed, since an earlier interrupt cancels it.
	ending: Vec<(String, String)>,
	/// The turn was interrupted to end it after a question, so it counts as completed and
	/// nothing more of it is passed on.
	ended_by_tool: bool,
	error: Option<String>,
}

impl Connection {
	/// Starts talking to an app-server on `started`'s pipes and waits for its handshake. A refused
	/// sign-in is told to `trouble`.
	pub async fn start(started: Started, trouble: Trouble) -> Result<Arc<Connection>, String> {
		let state = Arc::new(State { rpc: Rpc::new(pipes::writer(LABEL, started.writer)), threads: Mutex::new(HashMap::new()), logins: Pending::new(), trouble });
		let (reading, ending) = (state.clone(), state.clone());
		let reader = pipes::serve(LABEL, started.reader, started.process, move |line| reading.take(&line), move |why| ending.end(why));
		let connection = Arc::new(Connection { state, reader });
		connection.state.rpc.request(wire::INITIALIZE, wire::initialize(VERSION)).await?;
		connection.state.rpc.notify(wire::INITIALIZED);
		Ok(connection)
	}

	pub fn alive(&self) -> bool {
		self.reader.alive()
	}

	/// Starts a thread, or resumes the one `spec.resume` names.
	pub async fn open(self: &Arc<Self>, spec: SessionSpec) -> Result<Session, String> {
		let rpc = &self.state.rpc;
		let result = match &spec.resume {
			Some(thread) => rpc.request(wire::THREAD_RESUME, wire::thread_resume(thread, &spec)).await?,
			None => rpc.request(wire::THREAD_START, wire::thread_start(&spec)).await?,
		};
		let id = wire::thread_id(&result).ok_or("Codex started a thread without an id")?;
		let (events, rx) = mpsc::unbounded_channel();
		self.state.threads.lock().insert(id.clone(), Arc::new(Thread { events, turn: Mutex::new(Turn::default()), model: Mutex::new(None) }));
		Ok(Session::new(id.clone(), rx, crate::session::Link::Codex(ThreadLink { connection: self.clone(), id })))
	}

	pub async fn account(&self) -> Result<Json, String> {
		self.state.rpc.request(wire::ACCOUNT_READ, wire::account_read()).await
	}

	pub async fn login_start(&self) -> Result<CodexLogin, String> {
		let result = self.state.rpc.request(wire::LOGIN_START, wire::login_start()).await?;
		let (id, url) = wire::login_started(&result).ok_or("Codex started a sign-in without a page to open")?;
		let ended = self.state.logins.ask(id.clone())?;
		Ok(CodexLogin { id, url, ended })
	}

	/// Ends the sign-in; its `ended` then says it was cancelled.
	pub async fn login_cancel(&self, login: &str) -> Result<(), String> {
		self.state.rpc.request(wire::LOGIN_CANCEL, wire::login_cancel(login)).await.map(drop)
	}

	/// Every model the picker lists, page by page.
	pub async fn models(&self) -> Result<Vec<Model>, String> {
		let (mut all, mut cursor) = (Vec::new(), None);
		loop {
			let result = self.state.rpc.request(wire::MODEL_LIST, wire::model_list(cursor.as_deref())).await?;
			let (page, next) = wire::models(&result);
			all.extend(page);
			match next {
				Some(next) => cursor = Some(next),
				None => return Ok(all),
			}
		}
	}
}

/// A session's hold on its thread.
pub struct ThreadLink {
	connection: Arc<Connection>,
	id: String,
}

impl ThreadLink {
	fn thread(&self) -> Result<Arc<Thread>, String> {
		self.connection.state.threads.lock().get(&self.id).cloned().ok_or_else(|| "Codex stopped; open the session again".to_owned())
	}

	pub async fn send(&self, parts: &[Part]) -> Result<(), String> {
		let thread = self.thread()?;
		let model = thread.model.lock().take();
		let result = self.connection.state.rpc.request(wire::TURN_START, wire::turn_start(&self.id, parts, model.as_deref())).await?;
		if let Some(turn) = wire::turn_id(&result) {
			thread.turn.lock().id.get_or_insert(turn);
		}
		Ok(())
	}

	pub async fn steer(&self, parts: &[Part]) -> Result<(), String> {
		let turn = self.thread()?.turn.lock().id.clone().ok_or("no turn is running")?;
		self.connection.state.rpc.request(wire::TURN_STEER, wire::turn_steer(&self.id, &turn, parts)).await.map(drop)
	}

	pub async fn interrupt(&self) -> Result<(), String> {
		let turn = self.thread()?.turn.lock().id.clone().ok_or("no turn is running")?;
		self.connection.state.rpc.request(wire::TURN_INTERRUPT, wire::turn_interrupt(&self.id, &turn)).await.map(drop)
	}

	pub fn set_model(&self, model: &str) -> Result<(), String> {
		*self.thread()?.model.lock() = Some(model.to_owned());
		Ok(())
	}

	/// Stops routing the thread's events and lets app-server unload it.
	pub fn close(&self) {
		if self.connection.state.threads.lock().remove(&self.id).is_none() {
			return;
		}
		let state = self.connection.state.clone();
		let id = self.id.clone();
		tasks::detach(LABEL, async move {
			if let Err(err) = state.rpc.request(wire::THREAD_UNSUBSCRIBE, wire::thread_unsubscribe(&id)).await {
				eprintln!("[{LABEL}] closing thread {id}: {err}");
			}
		});
	}
}

impl State {
	fn thread(&self, id: &str) -> Option<Arc<Thread>> {
		self.threads.lock().get(id).cloned()
	}

	fn take(self: &Arc<Self>, line: &str) {
		match self.rpc.take(line) {
			None => {}
			Some(Incoming::Notification { method, params }) => self.on_note(wire::note(&method, &params)),
			Some(Incoming::Request { id, method, params }) => self.on_request(id, &method, &params),
		}
	}

	fn on_note(self: &Arc<Self>, note: Note) {
		if matches!(note, Note::TurnCompleted { signed_out: true, .. } | Note::Error { signed_out: true, .. }) {
			self.trouble.tell();
		}
		let thread_id = match &note {
			Note::TurnStarted { thread, .. } | Note::TextDelta { thread, .. } | Note::Item { thread, .. } | Note::Usage { thread, .. } | Note::Compacted { thread } | Note::TurnCompleted { thread, .. } | Note::Error { thread, .. } => thread.clone(),
			Note::LoginEnded { login, result } => {
				self.logins.settle(login, result.clone());
				return;
			}
			Note::Other => return,
		};
		let Some(thread) = self.thread(&thread_id) else {
			if let Note::Error { message, .. } = &note {
				eprintln!("[{LABEL}] {message}");
			}
			return;
		};
		let emit = |event: SessionEvent| {
			// A dropped session no longer listens.
			let _ = thread.events.send(event);
		};
		let quiet = thread.turn.lock().ended_by_tool;
		match note {
			Note::TurnStarted { turn, .. } => {
				*thread.turn.lock() = Turn { id: Some(turn), ..Turn::default() };
				emit(SessionEvent::TurnStarted);
			}
			Note::TextDelta { text, .. } if !quiet => emit(SessionEvent::TextDelta(text)),
			Note::Item { item: Item::Message { text }, done: true, .. } if !quiet => emit(SessionEvent::TextDone(text)),
			Note::Item { item: Item::Own { id, kind, item }, done, .. } if !quiet => emit(SessionEvent::OwnTool { id, name: kind, input: item, done }),
			Note::Item { turn, item: Item::ToolCall { id, tool }, done: true, .. } => self.end_after(&thread, &thread_id, &turn, &id, &tool),
			Note::Usage { usage, .. } => emit(SessionEvent::Usage(usage)),
			Note::Compacted { .. } => emit(SessionEvent::Compacted),
			Note::TurnCompleted { status, error, .. } => {
				let turn = std::mem::take(&mut *thread.turn.lock());
				let end = match status {
					TurnStatus::Completed => End::Completed,
					TurnStatus::Interrupted if turn.ended_by_tool => End::Completed,
					TurnStatus::Interrupted => End::Interrupted,
					TurnStatus::Failed => End::Failed(turn.error.or(error).unwrap_or_else(|| "the turn failed".to_owned())),
				};
				emit(SessionEvent::Ended(end));
			}
			Note::Error { message, will_retry, .. } => {
				eprintln!("[{LABEL}] thread {thread_id}: {message}{}", if will_retry { " (retrying)" } else { "" });
				if !will_retry {
					thread.turn.lock().error = Some(message);
				}
			}
			_ => {}
		}
	}

	/// A godspeed tool call is completed in Codex's record: if its reply ends the turn, the turn
	/// is interrupted now.
	fn end_after(self: &Arc<Self>, thread: &Thread, thread_id: &str, turn_id: &str, call: &str, tool: &str) {
		{
			let mut turn = thread.turn.lock();
			let Some(at) = turn.ending.iter().position(|(id, name)| id == call || name == tool) else { return };
			turn.ending.remove(at);
			turn.ended_by_tool = true;
		}
		let state = self.clone();
		let (thread_id, turn_id) = (thread_id.to_owned(), turn_id.to_owned());
		tasks::detach(LABEL, async move {
			if let Err(err) = state.rpc.request(wire::TURN_INTERRUPT, wire::turn_interrupt(&thread_id, &turn_id)).await {
				eprintln!("[{LABEL}] ending the turn after a question: {err}");
			}
		});
	}

	fn on_request(self: &Arc<Self>, id: Json, method: &str, params: &Json) {
		let request = wire::server_request(method, params);
		let thread_id = match &request {
			ServerRequest::ToolCall { thread, .. } | ServerRequest::Approval { thread, .. } => thread.clone(),
			ServerRequest::Unknown => {
				eprintln!("[{LABEL}] a request godspeed does not answer: {method}");
				return self.rpc.respond_error(id, UNKNOWN_METHOD, "godspeed does not handle this request");
			}
		};
		let Some(thread) = self.thread(&thread_id) else {
			return self.rpc.respond_error(id, UNKNOWN_METHOD, "this thread is closed in godspeed");
		};
		let state = self.clone();
		match request {
			ServerRequest::ToolCall { call, .. } => {
				let (reply, answer) = oneshot::channel();
				let (call_id, tool) = (call.id.clone(), call.name.clone());
				let _ = thread.events.send(SessionEvent::ToolCall { call, reply });
				tasks::detach(LABEL, async move {
					let reply = answer.await.unwrap_or_else(|_| ToolReply::dropped());
					// Marked before the answer goes, so Codex cannot complete the call first.
					if reply.ends_turn {
						thread.turn.lock().ending.push((call_id, tool));
					}
					state.rpc.respond(id, wire::tool_result(&reply));
				});
			}
			ServerRequest::Approval { ask, form, .. } => {
				let (reply, answer) = oneshot::channel();
				let _ = thread.events.send(SessionEvent::Approval { ask, reply });
				tasks::detach(LABEL, async move {
					let verdict = answer.await.unwrap_or_else(|_| Verdict::refused());
					state.rpc.respond(id, wire::approval_answer(&form, &verdict));
				});
			}
			ServerRequest::Unknown => {}
		}
	}

	/// app-server stopped: every open session ends, and the next open starts a new one.
	fn end(&self, why: &str) {
		eprintln!("[{LABEL}] stopped: {why}");
		self.rpc.close();
		let why = format!("Codex stopped: {why}");
		for (_, thread) in self.threads.lock().drain() {
			let _ = thread.events.send(SessionEvent::Ended(End::Failed(why.clone())));
		}
		self.logins.close(&why);
	}
}
