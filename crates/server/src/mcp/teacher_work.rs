//! The teacher's own calls, as steps of its round of work (Follow's slip). A call counts when it
//! comes from godspeed's teacher terminal, or from an agent outside godspeed that is not the
//! helper, and never while that agent holds background work (a space check, godspeed's own jobs).
//! Tools run inside a lesson reply or a deadline's Ask go through respond, so they make no step.

use gs_base::clock;
use gs_core::session::teacher_steps::{RoundCall, StepNames, round_call};
use gs_json::Json;
use gs_services::App;

use super::caller::from_waiter;
use super::tools::ToolCall;

/// Notes one checked call before it runs, so a slow search shows while it runs.
pub fn note_call(call: &ToolCall<'_>, name: &str, args: &Json) {
	let app = call.app;
	let agent = call.agent();
	let teacher = app.bridge.is_teacher_terminal(call.terminal);
	let outside = call.terminal.is_none() && args["helper"].as_bool() != Some(true) && !app.bridge.is_helper_agent(agent.as_deref());
	if !(teacher || outside) || app.bridge.holds_background_work(agent.as_deref()) {
		return;
	}
	match round_call(name, args, &Names(app)) {
		// The folder's waiter waits for its session while it works; only the agent's own wait
		// says it is done.
		Some(RoundCall::WorkLoop) if name == "wait_for_work" && !from_waiter(call.meta) => app.bridge.teacher_waits(call.terminal),
		Some(RoundCall::WorkLoop) | None => {}
		Some(RoundCall::Logged) => app.bridge.teacher_call(call.terminal, None, clock::now_ms()),
		Some(RoundCall::Step(step)) => app.bridge.teacher_call(call.terminal, Some(step), clock::now_ms()),
	}
}

struct Names<'a>(&'a App);

impl StepNames for Names<'_> {
	fn space(&self, id: &str) -> Option<String> {
		self.0.stores.spaces.get_space(id)?["name"].as_str().map(str::to_owned)
	}

	fn file(&self, space_id: &str, file_id: &str) -> Option<String> {
		let space = self.0.stores.spaces.get_space(space_id)?;
		space["files"].items().iter().find(|f| f["id"].as_str() == Some(file_id))?["name"].as_str().map(str::to_owned)
	}

	fn lesson(&self, id: &str) -> Option<String> {
		self.0.stores.chats.get_chat(id)?["title"].as_str().map(str::to_owned)
	}

	fn obsidian(&self) -> bool {
		gs_services::vault::notes_in_obsidian(self.0)
	}
}
