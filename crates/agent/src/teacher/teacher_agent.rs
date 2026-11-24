//! The lesson agents: study (every new session), the prober and the teacher (older teach
//! lessons), practice (older practice sessions) and homework. A prober and a teacher share one
//! record with different prompts and tools. Each turn builds its agent's instructions and tools
//! fresh from the record.

use std::collections::HashSet;
use std::sync::Arc;

use gs_base::text::trim;
use gs_core::contracts::chat::TOPIC_DONE_TOOL;
use gs_core::messages::native_messages::{PRACTICE_CONCLUDE_TOOL, PRACTICE_PROBLEM_TOOL};
use gs_core::messages::pending::is_question_tool;
use gs_core::session::tool_switches::{TOGGLEABLE_TOOLS, switched_off_tools_note};
use gs_engine::turn::agent::BeforeToolCallFn;
use gs_engine::turn::tool::Tool;
use gs_engine::turn::tool_host::ToolHost;
use gs_json::Json;
use gs_store::prompt_overrides::PromptOverrides;

use crate::tools::fn_tool::FnTool;
use crate::tools::homework::{HomeworkToolContext, homework_tools};
use crate::tools::lesson_parts::{HOLDS, LessonParts};
use crate::tools::lesson::{ProberToolContext, StudyToolContext, TeacherToolContext, prober_tools, study_tools, teacher_tools};
use crate::tools::practice::{PracticeToolContext, practice_tools};
use crate::tools::questions::bare_question_tools;

use super::prompt_segments::{AgentKind, effective_prompt_segments};

const SEPARATOR: &str = "\n\n---\n\n";

const SIDE_TURN_REFUSAL: &str = "A question is already waiting for the learner. Answer the side question in text instead.";

/// The switchable tools each agent's registry carries: demos and figures are teacher-only.
fn switches(kind: AgentKind) -> &'static [&'static str] {
	match kind {
		AgentKind::Prober | AgentKind::Practice | AgentKind::Homework => &["research", "pdf"],
		AgentKind::Teacher | AgentKind::Study | AgentKind::StudyFiles => &TOGGLEABLE_TOOLS,
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
	pub prompts: &'a PromptOverrides,
	/// A bare registry for tests. It is never switch-filtered: the caller owns it.
	pub tools: Option<Vec<Arc<dyn Tool>>>,
	/// The resolved per-user tool switches: the registries drop any tool explicitly off, and the
	/// system prompt names the ones that are.
	pub tool_toggles: Option<Json>,
	/// The learner's rules section, appended after the instructions.
	pub learner_rules: Option<String>,
	/// The turn answers a side question: a question is already waiting, so the question and
	/// problem tools refuse.
	pub side_turn: bool,
	/// The caller's own check of a call, after the agent's: Some(reason) refuses it.
	pub call_check: Option<BeforeToolCallFn>,
}

impl<'a> AgentBuildOptions<'a> {
	pub fn new(prompts: &'a PromptOverrides) -> AgentBuildOptions<'a> {
		AgentBuildOptions { prompts, tools: None, tool_toggles: None, learner_rules: None, side_turn: false, call_check: None }
	}
}

/// A lesson agent: its instructions, and its tools with the rules for their calls.
pub struct LessonSetup {
	pub prompt: String,
	pub host: ToolHost,
	/// Study's plot and guess, which can hold a half until the turn's end.
	pub parts: Option<Arc<LessonParts>>,
}

/// The tools whose clean result ends the turn, so the learner's answer starts the next one: a
/// question, for practice-like agents a pose, and for Study a stored topic_done. A call that
/// failed its authoring checks does not, so the agent can try again.
fn stop_tools(kind: AgentKind, tools: &[FnTool]) -> HashSet<String> {
	let poses_problems = matches!(kind, AgentKind::Practice | AgentKind::Study | AgentKind::StudyFiles | AgentKind::Homework);
	let ends_topics = matches!(kind, AgentKind::Study | AgentKind::StudyFiles);
	let stops = |name: &str| is_question_tool(name) || (poses_problems && name == PRACTICE_PROBLEM_TOOL) || (ends_topics && name == TOPIC_DONE_TOOL);
	tools.iter().map(|t| t.name()).filter(|name| stops(name)).map(str::to_owned).collect()
}

/// A side turn keeps the question tools, problem and conclude in the list but refuses them: an
/// unchanged tool list keeps the agent's session as it is. A plot still draws, with no guess
/// (the lesson-parts hook).
fn side_turn_refused(tools: &[FnTool]) -> Vec<String> {
	tools.iter().map(|t| t.name()).filter(|name| is_question_tool(name) || [PRACTICE_PROBLEM_TOOL, PRACTICE_CONCLUDE_TOOL].contains(name)).map(str::to_owned).collect()
}

/// The agent's own check first, then the caller's.
fn both_checks(first: Option<BeforeToolCallFn>, second: Option<BeforeToolCallFn>) -> Option<BeforeToolCallFn> {
	match (first, second) {
		(Some(first), Some(second)) => Some(Box::new(move |ctx| first(ctx).or_else(|| second(ctx)))),
		(first, second) => first.or(second),
	}
}

fn build_setup(kind: AgentKind, opts: AgentBuildOptions, tools: Vec<FnTool>, lesson_parts: Option<Arc<LessonParts>>) -> LessonSetup {
	// The doctrine still mentions switched-off tools; the note tells the model they are gone.
	let note = switched_off_tools_note(opts.tool_toggles.as_ref(), switches(kind));
	let parts = [compose_instructions(kind, opts.prompts), note, opts.learner_rules.unwrap_or_default()];
	let prompt = parts.into_iter().filter(|part| !part.is_empty()).collect::<Vec<_>>().join(SEPARATOR);
	let stops = stop_tools(kind, &tools);
	let refused = if opts.side_turn { side_turn_refused(&tools) } else { Vec::new() };
	let holds = lesson_parts.iter().flat_map(|_| HOLDS.map(str::to_owned));
	let host = ToolHost::new(tools.into_iter().map(FnTool::into_arc).collect(), both_checks(lesson_parts.as_ref().map(LessonParts::hook), opts.call_check), stops).refuse(refused, SIDE_TURN_REFUSAL).holding(holds);
	LessonSetup { prompt, host, parts: lesson_parts }
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
pub fn prober_setup(ctx: &ProberToolContext, opts: AgentBuildOptions) -> LessonSetup {
	let tools = prober_tools(ctx, opts.tool_toggles.as_ref());
	build_setup(AgentKind::Prober, opts, tools, None)
}

/// The teacher: enters at planning (the probe is already concluded, its assessment is in the
/// transcript) and owns plan_init and the full toolset. Without a context the tools fall back to
/// the validation-free question set.
pub fn teacher_setup(ctx: Option<&TeacherToolContext>, mut opts: AgentBuildOptions) -> LessonSetup {
	let tools = registry(&mut opts, |enabled| ctx.map_or_else(bare_question_tools, |ctx| teacher_tools(ctx, enabled)));
	build_setup(AgentKind::Teacher, opts, tools, None)
}

/// Practice sessions, built from turn 1 with no prober and teacher split. The session runs on
/// problem and conclude plus the rarely used extras; no plan or question tools.
pub fn practice_setup(ctx: &PracticeToolContext, mut opts: AgentBuildOptions) -> LessonSetup {
	let tools = registry(&mut opts, |enabled| practice_tools(ctx, enabled));
	build_setup(AgentKind::Practice, opts, tools, None)
}

/// Study (every new session): the teacher from turn 1, with no prober, plus practice's problem and
/// conclude. The tool list is the same every turn, so the agent's session keeps its tools.
pub fn study_setup(ctx: &StudyToolContext, mut opts: AgentBuildOptions) -> LessonSetup {
	let parts = LessonParts::new(&ctx.teacher.plan);
	let tools = registry(&mut opts, |enabled| study_tools(ctx, enabled, &parts));
	let kind = if ctx.problems.is_some() { AgentKind::StudyFiles } else { AgentKind::Study };
	build_setup(kind, opts, tools, Some(parts))
}

/// Homework: one deadline's problems, one at a time, hints only.
pub fn homework_setup(ctx: &HomeworkToolContext, mut opts: AgentBuildOptions) -> LessonSetup {
	let tools = registry(&mut opts, |enabled| homework_tools(ctx, enabled));
	build_setup(AgentKind::Homework, opts, tools, None)
}
