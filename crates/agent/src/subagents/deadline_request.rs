//! A deadline request as one background run of the learner's agent: it reads the space's files
//! and changes the deadline (and the files it writes) with the space tools. Its last line is for
//! the learner when nothing changed.

use std::sync::Arc;

use gs_engine::bridge::Bridge;
use gs_engine::turn::tool::Tool;
use gs_json::Json;

use super::pi_run::{RunError, SubagentRunOptions, run_subagent};

const INSTRUCTIONS: &str = "You do one task for a learner in godspeed, a learning app, on their deadlines. The learner does not see this conversation; what you change shows on the deadline's page.

- Work from the space's own files first: a practice exam or review sheet, the schedule, announcements. File ids come from read_space with files: true; find what is inside the files with search_space_files and read_passage.
- Never make up dates, times or facts. When the files don't settle it, change nothing.
- End with one short line for the learner: what you changed, or why the files don't settle it.";

/// Model calls allowed.
const MAX_TURNS: usize = 16;

pub struct DeadlineRequest {
	/// "Deadline: CSE 21 Midterm": the work item's label.
	pub label: String,
	pub prompt: String,
	pub tools: Vec<Arc<dyn Tool>>,
}

/// Runs the request to the end: its last text.
pub async fn run_deadline_request(bridge: &Bridge, request: DeadlineRequest) -> Result<String, RunError> {
	let mut run = SubagentRunOptions::new(INSTRUCTIONS, Json::from(request.prompt), MAX_TURNS);
	run.task_label = Some(request.label);
	Ok(run_subagent(bridge, request.tools, run).await?.text)
}
