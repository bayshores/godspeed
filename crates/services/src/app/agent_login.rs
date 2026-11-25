//! Signing the picked agent in from the setup card, one sign-in at a time. Codex signs in to
//! godspeed's own Codex folder; Claude Code runs its own `claude auth login`, which may ask for a
//! code the sign-in page shows. A finished sign-in checks the agent again; a failed one stays on
//! the card until the next starts or a check finds the agent signed in.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use gs_base::events::EventKind;
use gs_base::tasks;
use gs_core::spaces::agent_folder::FolderAgent;
use gs_json::{Json, json};
use gs_runtime::{Login, LoginControl};
use parking_lot::Mutex;

use super::agent_folder::{folder_agent, start_command};
use super::agent_health::check_health;
use super::agents::runtime;
use crate::App;

#[derive(Default)]
pub struct LoginState {
	signing: Mutex<Signing>,
	/// Held while a sign-in starts, so two starts never make two.
	starting: tokio::sync::Mutex<()>,
	next: AtomicU64,
}

#[derive(Default)]
enum Signing {
	#[default]
	None,
	Running { agent: FolderAgent, id: u64, url: String, takes_code: bool, control: LoginControl },
	Failed { agent: FolderAgent, reason: String },
}

/// Why a sign-in request was refused or failed.
#[derive(Debug, PartialEq)]
pub enum LoginError {
	/// No sign-in runs, or this one takes no code.
	NoLogin,
	/// The request or the learner's setup does not allow it; the text says why.
	Refused(String),
	/// The agent could not start it; the text says why.
	Failed(String),
}

impl LoginError {
	pub fn status(&self) -> u16 {
		match self {
			LoginError::NoLogin => 409,
			LoginError::Refused(_) => 400,
			LoginError::Failed(_) => 500,
		}
	}

	pub fn message(&self) -> &str {
		match self {
			LoginError::NoLogin => "No sign-in that takes this is running.",
			LoginError::Refused(why) | LoginError::Failed(why) => why,
		}
	}
}

fn told(app: &App) {
	app.events.emit(EventKind::AgentHealth, json!({}));
}

/// The health view's `login`: the picked agent's sign-in running (its page, and whether it takes
/// a code) or failed (why), else null.
pub(super) fn login_view(app: &App, agent: FolderAgent) -> Json {
	match &*app.agents.login.signing.lock() {
		Signing::Running { agent: running, url, takes_code, .. } if *running == agent => json!({ "url": url, "code": takes_code }),
		Signing::Failed { agent: failed, reason } if *failed == agent => json!({ "failed": reason }),
		_ => Json::Null,
	}
}

/// A check found the agent signed in: a failed sign-in no longer shows.
pub(super) fn passed_login(app: &App) {
	let mut signing = app.agents.login.signing.lock();
	if matches!(*signing, Signing::Failed { .. }) {
		*signing = Signing::None;
	}
}

/// POST /api/agent/login: starts the picked agent's sign-in and gives the page to open. While one
/// runs, its page; one left from the other agent is cancelled first.
pub async fn start_login(app: &Arc<App>) -> Result<String, LoginError> {
	let _starting = app.agents.login.starting.lock().await;
	let agent = folder_agent(app);
	let left = {
		let mut signing = app.agents.login.signing.lock();
		if let Signing::Running { agent: running, url, .. } = &*signing
			&& *running == agent
		{
			return Ok(url.clone());
		}
		match std::mem::take(&mut *signing) {
			Signing::Running { control, .. } => Some(control),
			other => {
				*signing = other;
				None
			}
		}
	};
	if let Some(left) = left
		&& let Err(err) = left.cancel().await
	{
		eprintln!("[agent login] cancelling the other agent's sign-in failed: {err}");
	}
	let own_command = start_command(app, agent).is_some();
	let Login { url, takes_code, ended, control } = match runtime(app).login().await {
		Ok(login) => login,
		Err(reason) if own_command => return Err(LoginError::Refused(reason)),
		Err(reason) => {
			eprintln!("[agent login] {reason}");
			*app.agents.login.signing.lock() = Signing::Failed { agent, reason: reason.clone() };
			told(app);
			return Err(LoginError::Failed(reason));
		}
	};
	let id = app.agents.login.next.fetch_add(1, Ordering::SeqCst);
	*app.agents.login.signing.lock() = Signing::Running { agent, id, url: url.clone(), takes_code, control };
	told(app);
	let weak = Arc::downgrade(app);
	tasks::detach("agent login", async move {
		let result = ended.await.unwrap_or_else(|_| Err("the sign-in stopped".to_owned()));
		let Some(app) = weak.upgrade() else { return };
		{
			let mut signing = app.agents.login.signing.lock();
			// A cancel or a newer sign-in took its place.
			if !matches!(&*signing, Signing::Running { id: running, .. } if *running == id) {
				return;
			}
			*signing = match &result {
				Ok(()) => Signing::None,
				Err(reason) => Signing::Failed { agent, reason: reason.clone() },
			};
		}
		match result {
			Ok(()) => check_health(&app),
			Err(reason) => {
				eprintln!("[agent login] {reason}");
				told(&app);
			}
		}
	});
	Ok(url)
}

/// POST /api/agent/login/code: the code Claude Code's sign-in page showed.
pub async fn send_login_code(app: &Arc<App>, code: &str) -> Result<(), LoginError> {
	let agent = folder_agent(app);
	let control = match &*app.agents.login.signing.lock() {
		Signing::Running { agent: running, control, takes_code: true, .. } if *running == agent => control.clone(),
		_ => return Err(LoginError::NoLogin),
	};
	control.send_code(code).await.map_err(LoginError::Refused)
}

/// POST /api/agent/login/cancel: ends the running sign-in; the card shows Log in again.
pub async fn cancel_login(app: &Arc<App>) -> Result<(), LoginError> {
	let control = {
		let mut signing = app.agents.login.signing.lock();
		match std::mem::take(&mut *signing) {
			Signing::Running { control, .. } => control,
			other => {
				*signing = other;
				return Err(LoginError::NoLogin);
			}
		}
	};
	told(app);
	control.cancel().await.map_err(LoginError::Failed)
}
