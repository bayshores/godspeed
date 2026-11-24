//! The teacher's own calls, as steps of its round of work (Follow's slip). A call counts when it
//! comes from godspeed's teacher terminal, or from an agent outside godspeed that is not the
//! helper, and never while that agent holds background work (a space check, godspeed's own jobs).
//! An agent that holds a lesson's turn works on that lesson: its steps go to the lesson's desk and
//! never to the round. Tools run inside a lesson reply or a deadline's Ask go through respond, so
//! they make no step here. The agent's own tools (web search, file reads, commands) are told by
//! the folder's hook, which only runs in godspeed's terminals, so only those terminals count for
//! them.

use gs_base::clock;
use gs_core::session::teacher_steps::{RoundCall, own_tool_step, round_call};
use gs_json::Json;
use gs_services::App;
use gs_services::turns::step_names::AppStepNames;
use gs_services::turns::turn_work::{note_own_call, note_step};

use super::caller::from_waiter;
use super::tools::ToolCall;

/// Notes one checked call before it runs, so a slow search shows while it runs.
pub fn note_call(call: &ToolCall<'_>, name: &str, args: &Json) {
	let app = call.app;
	let agent = call.agent();
	if let Some(lesson) = app.bridge.lesson_held_by(call.terminal, agent.as_deref()) {
		if let Some(RoundCall::Step(step)) = round_call(name, args, &AppStepNames(app)) {
			note_own_call(app, &lesson, name, args, step);
		}
		return;
	}
	let outside = call.terminal.is_none() && args["helper"].as_bool() != Some(true) && !app.bridge.is_helper_agent(agent.as_deref());
	if !counts(app, call.terminal, outside, agent.as_deref()) {
		return;
	}
	match round_call(name, args, &AppStepNames(app)) {
		// The folder's waiter waits for its session while it works; only the agent's own wait
		// says it is done.
		Some(RoundCall::WorkLoop) if name == "wait_for_work" && !from_waiter(call.meta) => app.bridge.teacher_waits(call.terminal),
		Some(RoundCall::WorkLoop) | None => {}
		Some(RoundCall::Logged) => app.bridge.teacher_call(call.terminal, None, clock::now_ms()),
		Some(RoundCall::Step(step)) => app.bridge.teacher_call(call.terminal, Some(step), clock::now_ms()),
	}
}

/// One of the agent's own tools, as the folder's hook in `terminal` told it. The subject goes in
/// the step's words and nowhere else: no log, no event.
pub fn note_own_tool(app: &App, terminal: &str, tool: &str, subject: Option<&str>) {
	let agent = app.bridge.terminal_chat(terminal);
	let lesson = app.bridge.lesson_held_by(Some(terminal), agent.as_deref());
	if lesson.is_none() && !counts(app, Some(terminal), false, agent.as_deref()) {
		return;
	}
	let Some(step) = own_tool_step(tool, subject) else { return };
	match lesson {
		Some(lesson) => note_step(app, &lesson, step, None, None),
		None => app.bridge.teacher_call(Some(terminal), Some(step), clock::now_ms()),
	}
}

/// A call counts from the teacher's terminal or, when `outside`, from an agent outside godspeed
/// that is not the helper; never while that agent holds background work.
fn counts(app: &App, terminal: Option<&str>, outside: bool, agent: Option<&str>) -> bool {
	(app.bridge.is_teacher_terminal(terminal) || outside) && !app.bridge.holds_background_work(agent)
}
