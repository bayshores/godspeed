//! The server's end of the protocol: requests to the shell wait here for their answer, and login
//! tokens wait for the window.

use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use gs_base::clock;
use tokio::sync::oneshot;

use crate::lines::{read_lines, write_line};
use crate::login::LoginTokens;
use crate::messages::{DemoOutcome, DemoResult, SvgOutcome, ToServer, ToShell};

/// How long the shell gets to answer a request.
const REQUEST_LIMIT_MS: i64 = 60_000;
const TIMED_OUT: &str = "demo check timed out";

/// Who waits for a request's answer; it takes only the answer of its own kind.
enum Waiter {
	Demo(oneshot::Sender<Result<DemoResult, String>>),
	Svg(oneshot::Sender<Result<String, String>>),
	Notify(oneshot::Sender<Result<bool, String>>),
}

impl Waiter {
	fn kind(&self) -> &'static str {
		match self {
			Waiter::Demo(_) => "demo",
			Waiter::Svg(_) => "svg",
			Waiter::Notify(_) => "notify",
		}
	}
}

/// The server's handle on the shell (clones share it).
#[derive(Clone)]
pub struct ShellLink(Arc<Inner>);

type OnTerminals = Box<dyn Fn(Vec<String>) + Send + Sync>;
type AgentFolder = Box<dyn Fn() -> Option<String> + Send + Sync>;

struct Inner {
	out: Mutex<Box<dyn Write + Send>>,
	last_id: AtomicU64,
	pending: Mutex<HashMap<u64, Waiter>>,
	login_tokens: LoginTokens,
	on_terminals: Mutex<Option<OnTerminals>>,
	agent_folder: Mutex<Option<AgentFolder>>,
}

impl ShellLink {
	/// `out` is the server's stdout in the app; nothing else may write there.
	pub fn new(out: impl Write + Send + 'static) -> ShellLink {
		ShellLink(Arc::new(Inner { out: Mutex::new(Box::new(out)), last_id: AtomicU64::new(0), pending: Mutex::default(), login_tokens: LoginTokens::default(), on_terminals: Mutex::default(), agent_folder: Mutex::default() }))
	}

	pub fn send(&self, msg: &ToShell) {
		if let Err(err) = write_line(&mut *lock(&self.0.out), msg) {
			eprintln!("cannot write to the desktop shell: {err}");
		}
	}

	/// Runs a demo's HTML in the shell's browser and reports what went wrong in it. An error the
	/// shell reports comes back as the Err text.
	pub async fn demo(&self, html: &str, probe: Option<&str>) -> Result<DemoResult, String> {
		self.request(|id| ToShell::Demo { id, html: html.to_owned(), probe: probe.map(str::to_owned) }, Waiter::Demo).await
	}

	/// The shell's browser snapshot of an SVG as a base64 PNG of exactly `width` × `height` px.
	pub async fn svg(&self, svg: &str, width: u32, height: u32) -> Result<String, String> {
		self.request(|id| ToShell::Svg { id, svg: svg.to_owned(), width, height }, Waiter::Svg).await
	}

	/// Shows a system notification, unless the window has the focus; the answer is whether it
	/// went to the system.
	pub async fn notify(&self, title: &str, body: &str) -> Result<bool, String> {
		self.request(|id| ToShell::Notify { id, title: title.to_owned(), body: body.to_owned() }, Waiter::Notify).await
	}

	/// Sends the message `make` builds with a fresh id and waits for its answer.
	async fn request<T>(&self, make: impl FnOnce(u64) -> ToShell, waiter: fn(oneshot::Sender<Result<T, String>>) -> Waiter) -> Result<T, String> {
		let id = self.0.last_id.fetch_add(1, Ordering::SeqCst) + 1;
		let (tx, rx) = oneshot::channel();
		lock(&self.0.pending).insert(id, waiter(tx));
		// Removes the entry however the wait ends, a dropped request included.
		let _waiting = Waiting { link: self, id };
		self.send(&make(id));
		tokio::select! {
			answer = rx => answer.unwrap_or_else(|_| Err(TIMED_OUT.to_owned())),
			() = clock::sleep(REQUEST_LIMIT_MS) => Err(TIMED_OUT.to_owned()),
		}
	}

	/// Who hears the shell's live terminal ids.
	pub fn on_terminals(&self, hear: impl Fn(Vec<String>) + Send + Sync + 'static) {
		*lock(&self.0.on_terminals) = Some(Box::new(hear));
	}

	/// Who says where the godspeed folder is, when it is set up.
	pub fn on_agent_folder(&self, find: impl Fn() -> Option<String> + Send + Sync + 'static) {
		*lock(&self.0.agent_folder) = Some(Box::new(find));
	}

	/// Handles every message on `input` (the server's stdin) until it ends; bad lines are logged
	/// and skipped.
	pub fn listen(&self, input: impl BufRead) {
		for msg in read_lines(input) {
			match msg {
				Ok(msg) => self.receive(msg),
				Err(err) => eprintln!("desktop shell: {err}"),
			}
		}
	}

	pub fn receive(&self, msg: ToServer) {
		match msg {
			ToServer::Login { id, token } => {
				if self.0.login_tokens.add(token) {
					self.send(&ToShell::LoginOk { id });
				} else {
					eprintln!("desktop shell: skipped a login token that is not 64 hex");
				}
			}
			ToServer::DemoDone { id, outcome } => {
				if let Some(Waiter::Demo(tx)) = self.waiter(id, "demo") {
					let _ = tx.send(match outcome {
						DemoOutcome::Result(result) => Ok(result),
						DemoOutcome::Error(err) => Err(err),
					});
				}
			}
			ToServer::SvgDone { id, outcome } => {
				if let Some(Waiter::Svg(tx)) = self.waiter(id, "svg") {
					let _ = tx.send(match outcome {
						SvgOutcome::Png(png) => Ok(png),
						SvgOutcome::Error(err) => Err(err),
					});
				}
			}
			ToServer::NotifyDone { id, shown } => {
				if let Some(Waiter::Notify(tx)) = self.waiter(id, "notify") {
					let _ = tx.send(Ok(shown));
				}
			}
			ToServer::Terminals { live } => {
				if let Some(hear) = &*lock(&self.0.on_terminals) {
					hear(live);
				}
			}
			ToServer::AgentFolder { id } => {
				let folder = lock(&self.0.agent_folder).as_ref().and_then(|find| find());
				self.send(&ToShell::AgentFolder { id, folder });
			}
		}
	}

	/// Whether `token` is a login token the shell sent and has not expired; it works once.
	pub fn take_login(&self, token: &str) -> bool {
		self.0.login_tokens.take(token)
	}

	/// The waiter for an answer of `kind` to request `id`. An answer to a request that already
	/// gave up is dropped, and so is one of the wrong kind: that request then times out.
	fn waiter(&self, id: u64, kind: &str) -> Option<Waiter> {
		let mut pending = lock(&self.0.pending);
		let expected = pending.get(&id)?.kind();
		if expected != kind {
			eprintln!("desktop shell: skipped a {kind} answer to {expected} request {id}");
			return None;
		}
		pending.remove(&id)
	}
}

struct Waiting<'a> {
	link: &'a ShellLink,
	id: u64,
}

impl Drop for Waiting<'_> {
	fn drop(&mut self) {
		lock(&self.link.0.pending).remove(&self.id);
	}
}

/// A panic elsewhere while holding one of these locks leaves the data whole, so keep going.
pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
	mutex.lock().unwrap_or_else(PoisonError::into_inner)
}
