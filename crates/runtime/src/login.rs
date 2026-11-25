//! Signing the learner in to their agent from godspeed, with no terminal. Codex signs in to
//! godspeed's own settings folder through app-server; Claude Code runs its own
//! `claude auth login`, which writes its own login. godspeed never reads or copies a login.

use std::sync::Arc;

use gs_core::spaces::agent_folder::FolderAgent;
use tokio::sync::oneshot;

use crate::claude::login::ClaudeLogin;
use crate::codex::agent::{CodexLogin, Connection as CodexConnection};
use crate::session::Runtime;

/// A sign-in under way.
pub struct Login {
	/// The page the learner signs in on.
	pub url: String,
	/// Claude Code's sign-in page may show a code for the learner to paste back.
	pub takes_code: bool,
	/// Ok once signed in; an error says why not (cancelled, failed, or timed out).
	pub ended: oneshot::Receiver<Result<(), String>>,
	pub control: LoginControl,
}

/// Sends the sign-in a code or cancels it. Dropping the last one ends Claude Code's.
#[derive(Clone)]
pub struct LoginControl(Arc<Control>);

enum Control {
	Codex { connection: Arc<CodexConnection>, id: String },
	Claude(ClaudeLogin),
}

impl LoginControl {
	/// Gives Claude Code the code its sign-in page showed.
	pub async fn send_code(&self, code: &str) -> Result<(), String> {
		match &*self.0 {
			Control::Codex { .. } => Err("Codex's sign-in takes no code".to_owned()),
			Control::Claude(login) => login.send_code(code).await,
		}
	}

	/// Stops the sign-in; `ended` then says so.
	pub async fn cancel(&self) -> Result<(), String> {
		match &*self.0 {
			Control::Codex { connection, id } => connection.login_cancel(id).await,
			Control::Claude(login) => {
				login.cancel();
				Ok(())
			}
		}
	}
}

/// What a sign-in answers while the learner starts the agent with their own command, which
/// godspeed asks nothing of.
const OWN_COMMAND: &str = "godspeed starts this agent with your own command, so it doesn't sign it in.";

impl Runtime {
	/// Starts the learner's sign-in; the window opens `url` when the agent did not.
	pub async fn login(&self) -> Result<Login, String> {
		if self.own_command().is_some() {
			return Err(OWN_COMMAND.to_owned());
		}
		match self.agent() {
			FolderAgent::Codex => {
				let connection = self.codex_connection().await?;
				let CodexLogin { id, url, ended } = connection.login_start().await?;
				Ok(Login { url, takes_code: false, ended, control: LoginControl(Arc::new(Control::Codex { connection, id })) })
			}
			FolderAgent::Claude => {
				let env = self.env().ok_or("the stand-in agent has no sign-in")?;
				let (login, url, ended) = ClaudeLogin::start(env).await?;
				Ok(Login { url, takes_code: true, ended, control: LoginControl(Arc::new(Control::Claude(login))) })
			}
		}
	}
}
