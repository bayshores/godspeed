//! `ask_agent`: a plugin's request for model work, sent to the learner's own agent as one submit
//! job, as a cheat sheet message is. One request at a time per plugin, so a plugin can't queue up
//! the agent's work.

use std::sync::Arc;

use gs_agent::subagents::plugin_asker::{PluginAsk, ask_for_plugin};
use gs_engine::turn::abort::Abort;
use gs_engine::turn::models::agent_engine;
use gs_json::{Json, stringify};

use super::installed::installed_manifest;
use super::manifest::uses;
use super::state::{resolve_state, saved_entry};
use crate::App;
use crate::outcome::{Outcome, Stop, refuse};

/// The most a prompt, and the schema, may take.
const ASK_MAX_BYTES: usize = 4096;

/// Ends the plugin's turn when the request does, however it ends: the agent's work is stopped
/// when the window stops waiting, and the plugin may ask again.
struct Asking {
	app: Arc<App>,
	id: String,
	abort: Abort,
}

impl Drop for Asking {
	fn drop(&mut self) {
		self.abort.abort();
		self.app.plugins.asking.lock().remove(&self.id);
	}
}

/// The agent's answer, matching `schema`.
pub async fn ask_agent(app: &Arc<App>, id: &str, prompt: &str, schema: &Json) -> Outcome<Json> {
	let manifest = installed_manifest(app, id)?;
	if !uses(&manifest, "agent") {
		return refuse(403, "This plugin doesn't say it uses the agent.");
	}
	if !resolve_state(&manifest, &saved_entry(app, id)?).0 {
		return refuse(409, "This plugin is off.");
	}
	if gs_base::text::trim(prompt).is_empty() {
		return refuse(400, "Say what the agent should do.");
	}
	if prompt.len() > ASK_MAX_BYTES {
		return refuse(400, "A request can be at most 4 KB.");
	}
	if schema.as_obj().is_none() || stringify(schema).len() > ASK_MAX_BYTES {
		return refuse(400, "The answer's schema must be a JSON Schema object of at most 4 KB.");
	}
	if !app.plugins.asking.lock().insert(id.to_owned()) {
		return refuse(409, "Your agent is still on this plugin's last request.");
	}
	let asking = Asking { app: app.clone(), id: id.to_owned(), abort: Abort::new() };
	let ask = PluginAsk { name: manifest["name"].str_or_empty().to_owned(), prompt: prompt.to_owned(), schema: schema.clone(), engine: agent_engine(&app.bridge), signal: asking.abort.clone() };
	let answer = ask_for_plugin(&app.bridge, ask).await.map_err(|e| Stop::Refuse(502, e.to_string()));
	drop(asking);
	answer
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::plugins::state::set_state;
	use crate::plugins::test_plugin::install_test_plugin;

	fn refusal(outcome: Outcome<Json>) -> (u16, String) {
		match outcome {
			Err(Stop::Refuse(status, message)) => (status, message),
			other => panic!("{other:?}"),
		}
	}

	#[tokio::test]
	async fn requests_the_plugin_may_not_make_are_refused() {
		let root = scratch_dir("plugin-ask");
		let app = test_app(&root);
		let schema = json!({ "type": "object" });
		assert_eq!(refusal(ask_agent(&app, "memes", "hi", &schema).await).0, 404);
		install_test_plugin(&app, &json!({ "uses": [] }));
		assert_eq!(refusal(ask_agent(&app, "memes", "hi", &schema).await), (403, "This plugin doesn't say it uses the agent.".to_owned()));
		let manifest = install_test_plugin(&app, &json!({}));
		assert_eq!(refusal(ask_agent(&app, "memes", " ", &schema).await).0, 400);
		assert_eq!(refusal(ask_agent(&app, "memes", &"x".repeat(4097), &schema).await), (400, "A request can be at most 4 KB.".to_owned()));
		assert_eq!(refusal(ask_agent(&app, "memes", "hi", &json!("string")).await).0, 400);
		assert_eq!(refusal(ask_agent(&app, "memes", "hi", &json!({ "description": "x".repeat(4096) })).await).0, 400);
		app.plugins.asking.lock().insert("memes".to_owned());
		assert_eq!(refusal(ask_agent(&app, "memes", "hi", &schema).await).0, 409);
		set_state(&app, "memes", &manifest, &json!({ "enabled": false })).unwrap();
		assert_eq!(refusal(ask_agent(&app, "memes", "hi", &schema).await), (409, "This plugin is off.".to_owned()));
	}
}
