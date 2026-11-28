//! A talk turn's instructions and tools: godspeed's data tools, each run as the learner asked for
//! it in godspeed itself, so the window opens what it starts.

use std::collections::HashSet;
use std::sync::Arc;

use gs_agent::teacher::teacher_agent::LessonSetup;
use gs_agent::tools::fn_tool::FnTool;
use gs_core::spaces::agent_folder::FolderAgent;
use gs_engine::turn::tool::Tool;
use gs_engine::turn::tool_host::ToolHost;

use super::prompt::talk_prompt;
use super::tools::reply::failure;
use super::tools::{ToolCall, checked_arguments, run_tool, tool_list};
use crate::App;
use crate::app::agent_memory::current_agent_briefing;

/// The most the "Where you left off" briefing takes of a new session's first message.
const BRIEFING_MAX_CHARS: usize = 8_000;

/// The talk session's instructions and tools on `agent`. No tool ends the turn: the agent ends it
/// when it has answered. Each tool is godspeed's data tool as the agent calls it; the agent's name
/// is what the activity log and saved rules show.
pub(crate) fn talk_setup(app: &Arc<App>, agent: FolderAgent) -> LessonSetup {
	let caller = agent.label();
	let tools: Vec<Arc<dyn Tool>> = tool_list()
		.items()
		.iter()
		.map(|tool| {
			let name = tool["name"].str_or_empty().to_owned();
			let (app, run_name, check_name) = (Arc::downgrade(app), name.clone(), name.clone());
			FnTool::immediate_async(&name, tool["description"].str_or_empty(), tool["inputSchema"].clone(), move |args| {
				let (app, name) = (app.clone(), run_name.clone());
				async move {
					let Some(app) = app.upgrade() else { return failure("godspeed is closing") };
					run_tool(&ToolCall { app: &app, caller: Some(caller) }, &name, &args).await
				}
			})
			.prepared(move |args| checked_arguments(&check_name, &args))
			.into_arc()
		})
		.collect();
	LessonSetup { prompt: talk_prompt(), host: ToolHost::new(tools, None, HashSet::new()), parts: None }
}

/// The first message of a new talk session: where the learner is now.
pub(crate) fn talk_opening(app: &App) -> String {
	current_agent_briefing(app, BRIEFING_MAX_CHARS)
}
