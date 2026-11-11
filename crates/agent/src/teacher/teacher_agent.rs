//! The agents (src/backend/agent/teacher-agent.ts): study (every new session), the prober and the
//! teacher (older teach lessons), practice (older practice sessions), homework and talk (the
//! teacher's panel, outside lessons). A prober and a teacher share one transcript with different
//! prompts and tools. Each turn builds its agent fresh from the record and drops it at turn end.

use std::collections::HashSet;
use std::sync::Arc;

use gs_base::text::trim;
use gs_core::messages::native_messages::{PRACTICE_CONCLUDE_TOOL, PRACTICE_PROBLEM_TOOL, to_llm_messages};
use gs_core::messages::pending::is_question_tool;
use gs_core::session::tool_switches::{TOGGLEABLE_TOOLS, switched_off_tools_note};
use gs_engine::turn::agent::{Agent, AgentOptions, FinishFn, QueueMode};
use gs_engine::turn::events::AgentEvent;
use gs_engine::turn::faux::Engine;
use gs_engine::turn::tool::Tool;
use gs_json::{Json, json};
use gs_store::prompt_overrides::PromptOverrides;

use crate::subagents::pi_run::OnUsage;
use crate::tools::fn_tool::FnTool;
use crate::tools::homework::{HomeworkToolContext, homework_tools};
use crate::tools::lesson::{ProberToolContext, StudyToolContext, TeacherToolContext, prober_tools, study_tools, teacher_tools};
use crate::tools::practice::{PracticeToolContext, practice_tools};
use crate::tools::questions::bare_question_tools;
use crate::tools::talk::{ClassActions, talk_tools};

use super::prompt_segments::{AgentKind, effective_prompt_segments};

const SEPARATOR: &str = "\n\n---\n\n";

const SIDE_TURN_REFUSAL: &str = "A question or problem is already waiting for the learner. Answer the side question in text instead.";

/// The switchable tools each agent's registry carries: demos and figures are teacher-only.
fn switches(kind: AgentKind) -> &'static [&'static str] {
	match kind {
		AgentKind::Prober | AgentKind::Practice | AgentKind::Homework => &["research", "pdf"],
		AgentKind::Teacher | AgentKind::Study => &TOGGLEABLE_TOOLS,
		AgentKind::Talk => &[],
	}
}

/// What the model gets as instructions: the agent's parts in order, a part the learner saved their
/// own version of composing that version.
pub fn compose_instructions(kind: AgentKind, prompts: &PromptOverrides) -> String {
	let segments = effective_prompt_segments(kind, prompts);
	let texts: Vec<&str> = segments.iter().map(|s| trim(s.override_text.as_deref().unwrap_or(s.source_text))).filter(|t| !t.is_empty()).collect();
	texts.join(SEPARATOR)
}

pub struct AgentBuildOptions<'a> {
	pub engine: Engine,
	pub prompts: &'a PromptOverrides,
	/// The transcript so far, as pi messages (the record is the agent's state).
	pub messages: Vec<Json>,
	pub on_usage: Option<OnUsage>,
	/// A bare registry for tests. It is never switch-filtered: the caller owns it.
	pub tools: Option<Vec<Arc<dyn Tool>>>,
	/// The resolved per-user tool switches: the registries drop any tool explicitly off, and the
	/// system prompt names the ones that are.
	pub tool_toggles: Option<Json>,
	/// The learner's rules section, appended after the instructions.
	pub learner_rules: Option<String>,
	/// The chat id, kept across the prober, teacher and practice agents of one conversation.
	pub chat_id: Option<String>,
	/// The turn answers a side question: a question or problem is already waiting, so the question
	/// and problem tools refuse.
	pub side_turn: bool,
}

impl<'a> AgentBuildOptions<'a> {
	pub fn new(engine: Engine, prompts: &'a PromptOverrides) -> AgentBuildOptions<'a> {
		AgentBuildOptions { engine, prompts, messages: Vec::new(), on_usage: None, tools: None, tool_toggles: None, learner_rules: None, chat_id: None, side_turn: false }
	}
}

/// The turn's question-stop rule: a question call that resolved cleanly ends the run, and the
/// learner's answer arrives as the next request. A call that failed its authoring checks must not
/// stop the run, so the model can retry within the turn. Results of a lone question already stop
/// the run; this covers a question mixed with other calls. Practice-like agents wait on a pose too.
fn question_stopper(kind: AgentKind) -> FinishFn {
	let poses_problems = matches!(kind, AgentKind::Practice | AgentKind::Study | AgentKind::Homework);
	Box::new(move |turn| {
		let asking = |name: &str| is_question_tool(name) || (poses_problems && name == PRACTICE_PROBLEM_TOOL);
		let called: HashSet<&str> = turn.message["content"]
			.as_arr()
			.into_iter()
			.flatten()
			.filter(|c| c["type"].as_str() == Some("toolCall") && c["name"].as_str().is_some_and(asking))
			.filter_map(|c| c["id"].as_str())
			.collect();
		!called.is_empty() && !turn.tool_results.iter().any(|r| r["toolCallId"].as_str().is_some_and(|id| called.contains(id)) && r["isError"].truthy())
	})
}

/// A side turn keeps the question tools, problem and conclude but refuses them: an unchanged tool
/// list keeps the outside agent's conversation a cheap delta instead of a full resend.
fn side_turn_tools(tools: Vec<FnTool>) -> Vec<FnTool> {
	tools
		.into_iter()
		.map(|tool| {
			if is_question_tool(tool.name()) || tool.name() == PRACTICE_PROBLEM_TOOL || tool.name() == PRACTICE_CONCLUDE_TOOL {
				tool.with_run(|_| Arc::new(|_, _| Box::pin(async { Ok(json!({ "content": [{ "type": "text", "text": SIDE_TURN_REFUSAL }], "isError": true })) })))
			} else {
				tool
			}
		})
		.collect()
}

fn build_agent(kind: AgentKind, opts: AgentBuildOptions, tools: Vec<FnTool>) -> Arc<Agent> {
	let tools = if opts.side_turn { side_turn_tools(tools) } else { tools };
	// The doctrine still mentions switched-off tools; the note tells the model they are gone.
	let note = switched_off_tools_note(opts.tool_toggles.as_ref(), switches(kind));
	let parts = [compose_instructions(kind, opts.prompts), note, opts.learner_rules.unwrap_or_default()];
	let system_prompt = parts.into_iter().filter(|part| !part.is_empty()).collect::<Vec<_>>().join(SEPARATOR);
	let agent = Agent::new(AgentOptions {
		engine: opts.engine,
		system_prompt,
		tools: tools.into_iter().map(FnTool::into_arc).collect(),
		messages: opts.messages,
		session_id: opts.chat_id,
		// A lesson is one continuous teach, quiz, teach run, so markers handed to a live run join
		// at one turn boundary instead of costing a teacher turn each.
		steering_mode: QueueMode::All,
		convert_to_llm: Some(Box::new(to_llm_messages)),
		finish_turn: Some(question_stopper(kind)),
	});
	if let Some(on_usage) = opts.on_usage {
		agent.subscribe(Arc::new(move |event| {
			if let AgentEvent::MessageEnd(message) = event
				&& message["role"].as_str() == Some("assistant")
				&& message.get("usage").is_some()
				// A cancelled call's usage is only partial or estimated.
				&& message["stopReason"].as_str() != Some("aborted")
			{
				on_usage(&message["usage"]);
			}
		}));
	}
	agent
}

/// The explicit registry when the caller passed one, else the built one.
fn registry(opts: &mut AgentBuildOptions, build: impl FnOnce(Option<&Json>) -> Vec<FnTool>) -> Vec<FnTool> {
	match opts.tools.take() {
		Some(tools) => tools.into_iter().map(FnTool::from_tool).collect(),
		None => build(opts.tool_toggles.as_ref()),
	}
}

/// The prober: one quizzing tool plus ask and probe_done, lean on probing doctrine. Its whole job
/// is bracketing the learner's edge and concluding with the assessment, which also queues the
/// handoff wake and is the transcript seam the teacher's construction keys on.
pub fn create_prober_agent(ctx: &ProberToolContext, opts: AgentBuildOptions) -> Arc<Agent> {
	let tools = prober_tools(ctx, opts.tool_toggles.as_ref());
	build_agent(AgentKind::Prober, opts, tools)
}

/// The teacher: enters at planning (the probe is already concluded, its assessment is in the
/// transcript) and owns plan_init and the full toolset. Without a context the tools fall back to
/// the validation-free question set.
pub fn create_teacher_agent(ctx: Option<&TeacherToolContext>, mut opts: AgentBuildOptions) -> Arc<Agent> {
	let tools = registry(&mut opts, |enabled| ctx.map_or_else(bare_question_tools, |ctx| teacher_tools(ctx, enabled)));
	build_agent(AgentKind::Teacher, opts, tools)
}

/// Practice sessions, built from turn 1 with no prober and teacher split. The session runs on
/// problem and conclude plus the rarely used extras; no plan or question tools.
pub fn create_practice_agent(ctx: &PracticeToolContext, mut opts: AgentBuildOptions) -> Arc<Agent> {
	let tools = registry(&mut opts, |enabled| practice_tools(ctx, enabled));
	build_agent(AgentKind::Practice, opts, tools)
}

/// Study (every new session): the teacher from turn 1, with no prober, plus practice's problem and
/// conclude. The tool list is the same every turn, so the outside agent keeps getting small deltas.
pub fn create_study_agent(ctx: &StudyToolContext, mut opts: AgentBuildOptions) -> Arc<Agent> {
	let tools = registry(&mut opts, |enabled| study_tools(ctx, enabled));
	build_agent(AgentKind::Study, opts, tools)
}

/// Homework: one deadline's problems, one at a time, hints only.
pub fn create_homework_agent(ctx: &HomeworkToolContext, mut opts: AgentBuildOptions) -> Arc<Agent> {
	let tools = registry(&mut opts, |enabled| homework_tools(ctx, enabled));
	build_agent(AgentKind::Homework, opts, tools)
}

/// Talk (the teacher's panel): one ongoing chat outside any lesson, for setting up classes, files
/// and deadlines and quick questions. Its tools are the class actions.
pub fn create_talk_agent(actions: &ClassActions, mut opts: AgentBuildOptions) -> Arc<Agent> {
	let tools = registry(&mut opts, |_| talk_tools(actions));
	build_agent(AgentKind::Talk, opts, tools)
}
