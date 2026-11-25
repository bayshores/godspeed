//! The teacher's own calls, as steps of its round of work (Follow's slip). A call counts when it
//! comes from godspeed's teacher terminal or from an agent outside godspeed. Lessons and jobs run
//! on their own agent sessions, so nothing here is theirs. The agent's own tools (web search, file
//! reads, commands) are told by the folder's hook, which only runs in godspeed's terminals, so only
//! those terminals count for them.

use gs_base::clock;
use gs_core::session::teacher_steps::{RoundCall, own_tool_step, round_call};
use gs_json::Json;
use gs_services::App;
use gs_services::turns::step_names::AppStepNames;

/// Notes one checked call from the agent in `terminal` (None: outside godspeed) before it runs,
/// so a slow search shows while it runs.
pub fn note_call(app: &App, terminal: Option<&str>, name: &str, args: &Json) {
	if !(terminal.is_none() || app.terminals.is_teacher_terminal(terminal)) {
		return;
	}
	match round_call(name, args, &AppStepNames(app)) {
		None => {}
		Some(RoundCall::Logged) => app.terminals.teacher_call(terminal, None, clock::now_ms()),
		Some(RoundCall::Step(step)) => app.terminals.teacher_call(terminal, Some(step), clock::now_ms()),
	}
}

/// One of the agent's own tools, as the folder's hook in `terminal` told it. The subject goes in
/// the step's words and nowhere else: no log, no event.
pub fn note_own_tool(app: &App, terminal: &str, tool: &str, subject: Option<&str>) {
	if !app.terminals.is_teacher_terminal(Some(terminal)) {
		return;
	}
	let Some(step) = own_tool_step(tool, subject) else { return };
	app.terminals.teacher_call(Some(terminal), Some(step), clock::now_ms());
}
