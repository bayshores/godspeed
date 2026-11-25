//! A talk turn's instructions and tools: godspeed's data tools, each run as the learner asked for
//! it in godspeed itself, so the window opens what it starts.

use std::collections::HashSet;
use std::sync::{Arc, Weak};

use futures_util::future::BoxFuture;
use gs_agent::teacher::teacher_agent::LessonSetup;
use gs_core::spaces::agent_folder::FolderAgent;
use gs_engine::turn::tool::{Tool, ToolContext};
use gs_engine::turn::tool_host::ToolHost;
use gs_json::Json;

use super::prompt::talk_prompt;
use super::tools::{ToolCall, checked_arguments, run_tool, tool_list};
use crate::App;
use crate::app::agent_memory::current_agent_briefing;

/// The most the "Where you left off" briefing takes of a new session's first message.
const BRIEFING_MAX_CHARS: usize = 8_000;

/// One of godspeed's data tools, as the talk session's agent calls it.
struct DataTool {
	app: Weak<App>,
	/// The agent's name, which the activity log and saved rules show.
	caller: &'static str,
	name: String,
	description: String,
	schema: Json,
}

impl Tool for DataTool {
	fn name(&self) -> &str {
		&self.name
	}

	fn description(&self) -> &str {
		&self.description
	}

	fn parameters(&self) -> &Json {
		&self.schema
	}

	/// The same check the outside door makes, so a call is refused in the same words either way.
	fn prepare_arguments(&self, args: Json) -> Result<Json, String> {
		checked_arguments(&self.name, &args).map_err(|failed| failed["content"][0]["text"].str_or_empty().to_owned())
	}

	fn execute(&self, args: Json, _ctx: ToolContext) -> BoxFuture<'_, Result<Json, String>> {
		Box::pin(async move {
			let app = self.app.upgrade().ok_or("godspeed is closing")?;
			let call = ToolCall { app: &app, caller: Some(self.caller), asked_here: true };
			Ok(run_tool(&call, &self.name, &args).await)
		})
	}
}

/// The talk session's instructions and tools on `agent`. No tool ends the turn: the agent ends it
/// when it has answered.
pub fn talk_setup(app: &Arc<App>, agent: FolderAgent) -> LessonSetup {
	let tools: Vec<Arc<dyn Tool>> = tool_list()
		.items()
		.iter()
		.map(|tool| -> Arc<dyn Tool> {
			Arc::new(DataTool {
				app: Arc::downgrade(app),
				caller: agent.label(),
				name: tool["name"].str_or_empty().to_owned(),
				description: tool["description"].str_or_empty().to_owned(),
				schema: tool["inputSchema"].clone(),
			})
		})
		.collect();
	LessonSetup { prompt: talk_prompt(), host: ToolHost::new(tools, None, HashSet::new()), parts: None }
}

/// The first message of a new talk session: where the learner is now.
pub fn talk_opening(app: &App) -> String {
	current_agent_briefing(app, BRIEFING_MAX_CHARS)
}
