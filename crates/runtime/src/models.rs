//! The models an agent offers, for the model picker: Codex's `model/list`, and Claude Code's
//! through the helper. Asking makes no model call.

use gs_base::clock;

use crate::session::{Connection, Runtime};

/// One model the agent offers. `default` is the agent's own default: what runs when the learner
/// picks none.
#[derive(Clone, Debug, PartialEq)]
pub struct Model {
	pub id: String,
	pub name: String,
	pub default: bool,
}

/// Asking takes at most this long; Claude Code starts to answer.
const LIST_MS: i64 = 15_000;

impl Runtime {
	pub async fn models(&self) -> Result<Vec<Model>, String> {
		let listing = async {
			match self.connection().await? {
				Connection::Codex(codex) => codex.models().await,
				Connection::Claude(claude) => claude.models().await,
			}
		};
		clock::within(LIST_MS, listing).await.unwrap_or_else(|| Err("the agent took too long to list its models".to_owned()))
	}
}
