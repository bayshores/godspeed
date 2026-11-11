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

/// What the shell answered a request with.
#[derive(Debug, Clone, PartialEq)]
pub enum Reply {
	Demo(DemoResult),
	/// The PNG, base64.
	Svg(String),
}

type Answer = Result<Reply, String>;

/// The server's handle on the shell (clones share it).
#[derive(Clone)]
pub struct ShellLink(Arc<Inner>);

struct Inner {
	out: Mutex<Box<dyn Write + Send>>,
	last_id: AtomicU64,
	pending: Mutex<HashMap<u64, oneshot::Sender<Answer>>>,
	login_tokens: LoginTokens,
}

impl ShellLink {
	/// `out` is the server's stdout in the app; nothing else may write there.
	pub fn new(out: impl Write + Send + 'static) -> ShellLink {
		ShellLink(Arc::new(Inner { out: Mutex::new(Box::new(out)), last_id: AtomicU64::new(0), pending: Mutex::default(), login_tokens: LoginTokens::default() }))
	}

	pub fn send(&self, msg: &ToShell) {
		if let Err(err) = write_line(&mut *lock(&self.0.out), msg) {
			eprintln!("cannot write to the desktop shell: {err}");
		}
	}

	/// Sends the message `make` builds with a fresh id and waits for its answer. An error the
	/// shell reports comes back as the Err text.
	pub async fn request(&self, make: impl FnOnce(u64) -> ToShell) -> Answer {
		let id = self.0.last_id.fetch_add(1, Ordering::SeqCst) + 1;
		let (tx, rx) = oneshot::channel();
		lock(&self.0.pending).insert(id, tx);
		// Removes the entry however the wait ends, a dropped request included.
		let _waiting = Waiting { link: self, id };
		self.send(&make(id));
		tokio::select! {
			answer = rx => answer.unwrap_or_else(|_| Err(TIMED_OUT.to_owned())),
			() = clock::sleep(REQUEST_LIMIT_MS) => Err(TIMED_OUT.to_owned()),
		}
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
			ToServer::DemoDone { id, outcome } => self.answer(
				id,
				match outcome {
					DemoOutcome::Result(result) => Ok(Reply::Demo(result)),
					DemoOutcome::Error(err) => Err(err),
				},
			),
			ToServer::SvgDone { id, outcome } => self.answer(
				id,
				match outcome {
					SvgOutcome::Png(png) => Ok(Reply::Svg(png)),
					SvgOutcome::Error(err) => Err(err),
				},
			),
		}
	}

	/// Whether `token` is a login token the shell sent and has not expired; it works once.
	pub fn take_login(&self, token: &str) -> bool {
		self.0.login_tokens.take(token)
	}

	/// An answer to a request that already gave up is dropped.
	fn answer(&self, id: u64, answer: Answer) {
		if let Some(tx) = lock(&self.0.pending).remove(&id) {
			let _ = tx.send(answer);
		}
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
