//! The prober's, teacher's and study session's registries. The prober
//! and the teacher are different agents with different tools. Their question tools share a name
//! family but are different tools: the prober's quiz has no nodeId at all, the teacher's carries
//! the validated one.

use std::sync::Arc;
use std::sync::atomic::Ordering;

use gs_core::messages::pending::is_question_tool;
use gs_engine::turn::tool::Tool;
use gs_engine::turn::tool_execute::invalid_input_result;
use gs_json::Json;

use super::fn_tool::FnTool;
use super::heal::heal_tool_record;
use super::homework::ProblemList;
use super::jobs::{JobToolContext, demo_tool, pdf_tool, research_tool};
use super::lesson_parts::LessonParts;
use super::plan::{PlanContext, plan_init_tool};
use super::plot::plot_tool;
use super::ports::ProblemPages;
use super::practice::{GraphNodes, PlanNodes, TurnGate, problem_is_active, study_problem_tools};
use super::probe::{ProbeDoneContext, ProbeGate, probe_done_tool};
use super::questions::{PlanOrder, ask_user_question_tool, plan_node_ids, probe_explain_tool, probe_quiz_tool, study_explain_tool, study_quiz_tool, teach_explain_tool, teach_quiz_tool, write_code_tool};
use super::side::{LessonSide, file_tools, filter_enabled};
use super::topic_done::{CheckMarks, topic_done_tool};
use super::work_plan::work_plan_tool;

/// What the prober's registry closes over: probe_done's needs and the job dispatch, since
/// research and pdf are in the probe phase too.
#[derive(Clone)]
pub struct ProberToolContext {
	pub probe: ProbeDoneContext,
	pub jobs: JobToolContext,
	pub side: LessonSide,
}

#[derive(Clone)]
pub struct TeacherToolContext {
	pub plan: PlanContext,
	pub jobs: JobToolContext,
	pub side: LessonSide,
}

/// A study session's tools close over the teacher's context plus the graph its problem targets
/// are checked against, and the source mark check of topic_done's lead.
#[derive(Clone)]
pub struct StudyToolContext {
	pub teacher: TeacherToolContext,
	pub graph_nodes: Option<GraphNodes>,
	pub check_marks: CheckMarks,
	pub pages: Arc<dyn ProblemPages>,
	/// The app made no plan for this lesson, so the agent writes it with plan_init.
	pub writes_plan: bool,
	/// A lesson on files: its first file's problem list.
	pub problems: Option<Arc<dyn ProblemList>>,
}

/// `explain: true` in the resolved settings arms free-recall checks (explain or recall, quiz or
/// probe dropped); anything else is multiple choice.
fn free_recall(enabled: Option<&Json>) -> bool {
	enabled.is_some_and(|e| e["explain"] == Json::Bool(true))
}

/// The settings without the quizzing keys, so the filter can never drop the quizzing tool (the
/// derivation above is its only switch).
fn without_mechanics(enabled: Option<&Json>) -> Option<Json> {
	let mut rest = enabled?.clone();
	if let Some(settings) = rest.as_obj_mut() {
		settings.remove("explain");
		settings.remove("quiz");
	}
	Some(rest)
}

/// The prober's question tools under this turn's gate: refused once probe_done succeeded, and a
/// clean pose marks a question open so a probe_done later in the same batch is refused. A failed
/// pose leaves the gate alone, so the prober can retry.
fn with_probe_gate(gate: &Arc<ProbeGate>, tool: FnTool) -> FnTool {
	if !is_question_tool(tool.name()) {
		return tool;
	}
	let (gate, name) = (gate.clone(), tool.name().to_owned());
	tool.with_run(move |run| {
		Arc::new(move |args, ctx| {
			let (run, gate, name) = (run.clone(), gate.clone(), name.clone());
			Box::pin(async move {
				if gate.concluded.load(Ordering::SeqCst) {
					return Ok(invalid_input_result(&name, &["The probe is already concluded; no more questions.".to_owned()]));
				}
				let result = run(args, ctx).await?;
				if !result["isError"].truthy() {
					gate.question_posed.store(true, Ordering::SeqCst);
				}
				Ok(result)
			})
		})
	})
}

/// The prober's tools: the probe quiz (recall under free recall) and ask, the learner's files,
/// research and pdf, the lesson's side tools, and probe_done. `enabled` drops any
/// tool explicitly off; probe_done is added after the filter, since a prober that can never
/// conclude is a lockout.
pub fn prober_tools(ctx: &ProberToolContext, enabled: Option<&Json>) -> Vec<FnTool> {
	let gate = Arc::new(ProbeGate::default());
	let mut tools = vec![if free_recall(enabled) { probe_explain_tool() } else { probe_quiz_tool() }, ask_user_question_tool(), write_code_tool()];
	tools.extend(file_tools());
	tools.push(work_plan_tool());
	tools.extend([research_tool(&ctx.jobs), pdf_tool(&ctx.jobs)]);
	tools.extend(ctx.side.tools());
	let mut tools = filter_enabled(tools, without_mechanics(enabled).as_ref());
	tools.push(probe_done_tool(&ctx.probe, &gate));
	heal_tool_record(tools.into_iter().map(|tool| with_probe_gate(&gate, tool)).collect())
}

/// The teacher's tools: the teach questions (validated nodeId), plan, jobs and the learner's
/// files. `enabled` drops any tool explicitly off.
pub fn teacher_tools(ctx: &TeacherToolContext, enabled: Option<&Json>) -> Vec<FnTool> {
	let question = if free_recall(enabled) { teach_explain_tool(&ctx.plan) } else { teach_quiz_tool(&ctx.plan) };
	heal_tool_record(teacher_tools_asking(ctx, enabled, question, true))
}

/// The teacher's tools with `question` as the graded question tool, not yet healed; plan_init
/// only when `writes_plan`.
fn teacher_tools_asking(ctx: &TeacherToolContext, enabled: Option<&Json>, question: FnTool, writes_plan: bool) -> Vec<FnTool> {
	let mut tools = vec![question, ask_user_question_tool(), write_code_tool()];
	tools.extend(file_tools());
	if writes_plan {
		tools.push(plan_init_tool(&ctx.plan));
	}
	tools.push(work_plan_tool());
	tools.extend([research_tool(&ctx.jobs), demo_tool(&ctx.jobs), pdf_tool(&ctx.jobs)]);
	tools.extend(ctx.side.tools());
	filter_enabled(tools, without_mechanics(enabled).as_ref())
}

/// A study session's tools: the teacher's (its quiz takes `standalone` and `onPlot`; plan_init
/// only when the agent writes the plan) plus practice's problem and conclude, the problem naming
/// its plan node like a quiz, the question and the problem sharing one plan-order check, the plot
/// in multiple-choice lessons (its guess checked by `parts`' hook), and topic_done after a
/// finished topic.
pub fn study_tools(ctx: &StudyToolContext, enabled: Option<&Json>, parts: &Arc<LessonParts>) -> Vec<FnTool> {
	let plan = ctx.teacher.plan.clone();
	let plan_nodes: PlanNodes = Arc::new(move || plan_node_ids(&plan));
	let record = ctx.teacher.plan.clone();
	let gate = TurnGate::new(problem_is_active(&record.chat_store, &record.chat_id));
	let order = PlanOrder::new(&record);
	let recall = free_recall(enabled);
	let question = if recall { study_explain_tool(&ctx.teacher.plan, &order) } else { study_quiz_tool(&ctx.teacher.plan, &order) };
	let mut tools = teacher_tools_asking(&ctx.teacher, enabled, question, ctx.writes_plan);
	tools.extend(study_problem_tools(&gate, record.clone(), ctx.graph_nodes.clone(), (plan_nodes.clone(), order), &ctx.pages, ctx.problems.as_ref()));
	if !recall {
		tools.push(plot_tool(record.clone(), parts));
	}
	tools.push(topic_done_tool(record, &gate, ctx.check_marks.clone(), plan_nodes, !recall));
	heal_tool_record(tools)
}
