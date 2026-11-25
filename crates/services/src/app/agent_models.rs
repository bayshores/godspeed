//! GET /api/agent/models: the models the picked agent offers, in its own order, for the card's
//! model picker. The one new chats and lessons start on is saved in agent-folder.json.

use std::sync::Arc;

use gs_json::{Json, json};

use super::agents::runtime;
use crate::App;

/// `default` marks the agent's own default, which is what no saved model means.
pub async fn agent_models(app: &Arc<App>) -> Result<Json, String> {
	let runtime = runtime(app);
	let models: Json = runtime.models().await?.into_iter().map(|model| json!({ "id": model.id, "name": model.name, "default": model.default })).collect();
	Ok(json!({ "agent": runtime.agent().name(), "models": models }))
}
