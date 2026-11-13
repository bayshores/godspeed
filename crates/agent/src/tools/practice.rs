//! The practice tools: the session runs on `problem` (pose:
//! ends the turn, the commitment rides the call's arguments) and `conclude` (ends the problem, so
//! closing words may follow; the next pose waits for the learner's go-ahead, which asking for
//! another problem or part is). An agent cannot pose while a problem is active and cannot conclude
//! with nothing active.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use gs_core::graph::chains::resolve_target_id;
use gs_core::messages::native_messages::active_problem_of;
use gs_core::session::argument_heal::heal_encoded_arguments;
use gs_engine::turn::tool_execute::{conclude_result, invalid_input_result, problem_result};
use gs_json::{Json, json, stringify};

use super::fn_tool::FnTool;
use super::graph::GraphToolContext;
use super::heal::heal_tool_record;
use super::jobs::{JobToolContext, job_tools};
use super::ports::ChatPort;
use gs_core::session::schema::{literals_or_null, object, one_of_literals, string};
use super::side::{LessonSide, file_tools, filter_enabled, graph_and_side};

/// The whole graph's nodes (id and name), read fresh per pose.
pub type GraphNodes = Arc<dyn Fn() -> Vec<Json> + Send + Sync>;

/// Checks a plan node id; the problem it names, or none.
pub type NodeCheck = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

/// What the practice tools close over.
#[derive(Clone)]
pub struct PracticeToolContext {
	pub chat_id: String,
	pub chat_store: Arc<dyn ChatPort>,
	/// With it, targets are checked against every proposition of the graph, not only the
	/// session's picks. Without it, nothing is checked.
	pub graph_nodes: Option<GraphNodes>,
	/// The map readers, behind the same settings gate as the prober's.
	pub graph: Option<GraphToolContext>,
	pub jobs: Option<JobToolContext>,
	pub side: LessonSide,
}

/// Whether a problem is open in the stored record. A turn's gate starts from this: the record only
/// updates when the turn ends, so the tools flip their own copy for the rest of the turn.
pub fn problem_is_active(chat_store: &Arc<dyn ChatPort>, chat_id: &str) -> bool {
	chat_store.get_chat(chat_id).is_some_and(|record| active_problem_of(record["messages"].as_arr().map_or(&[][..], Vec::as_slice)).is_some())
}

fn problem_parameters() -> Json {
	object(
		&["statement", "mode", "modelSolution"],
		vec![
			(
				"statement",
				string("REQUIRED \u{2014} the problem as the learner sees it (markdown + LaTeX). Must be self-contained and solvable from the session's material. NEVER announces the target proposition."),
			),
			("mode", one_of_literals(&["recall", "discrimination", "composition"], "REQUIRED \u{2014} the demand mode: recall, discrimination, or composition (bare words, no quotes).")),
			(
				"target",
				json!({
					"type": "array",
					"items": { "type": "string" },
					"minItems": 1,
					"description": "The proposition id(s) this problem exercises, from the session context's [id] list \u{2014} include when the material is in the map (the outcome counts toward the learner's readiness for them); OMIT entirely when it is not (a topic session poses untagged problems). Names are normalized to ids at the seam; an unknown proposition is rejected.",
				}),
			),
			(
				"modelSolution",
				string("REQUIRED \u{2014} the full solution, moves in order, committed BEFORE the learner sees the problem. This IS the reveal \u{2014} conclude shows it verbatim; never re-author it."),
			),
		],
	)
}

/// The problem schema of a study session: it also names the plan node the problem is about.
fn study_problem_parameters() -> Json {
	let mut parameters = problem_parameters();
	let node_id = string("REQUIRED \u{2014} the topic this problem is about: a node id from the [Study plan].");
	if let Some(schema) = parameters.as_obj_mut() {
		if let Some(required) = schema.get_mut("required").and_then(Json::as_arr_mut) {
			required.push(Json::from("nodeId"));
		}
		if let Some(properties) = schema.get_mut("properties").and_then(Json::as_obj_mut) {
			properties.insert("nodeId", node_id);
		}
	}
	parameters
}

/// Names silently become ids, so the record carries the canonical ones (the mastery trace groups on
/// them); an unresolvable string passes through for the pose to reject. An empty list means "no
/// targets" and is healed away, so the record's form is tagged or absent, never empty.
fn normalize_target(mut args: Json, graph_nodes: Option<&GraphNodes>) -> Json {
	let Some(obj) = args.as_obj_mut() else { return args };
	let target = obj.get("target").and_then(Json::as_arr).cloned();
	match (graph_nodes, target) {
		(None, Some(target)) if target.is_empty() => {
			obj.remove("target");
		}
		(Some(nodes), Some(target)) if !target.is_empty() => {
			let list = nodes();
			let resolved: Vec<Json> = target.iter().map(|t| t.as_str().and_then(|name| resolve_target_id(name, &list)).map_or_else(|| t.clone(), Json::from)).collect();
			obj.insert("target", resolved);
		}
		(Some(_), _) => {
			obj.remove("target");
		}
		_ => {}
	}
	args
}

/// The pose, with its extra checks for a study session (`node_check`).
fn problem_tool(gate: &Arc<AtomicBool>, graph_nodes: Option<GraphNodes>, parameters: Json, node_check: Option<NodeCheck>) -> FnTool {
	let description = "Pose one practice problem. Ends the turn \u{2014} the problem stays in view beside the lesson, and the \
		learner's work and questions on it arrive back as their messages. The modelSolution rides this call's \
		arguments and stays hidden from the learner until you conclude (conclude shows it verbatim \u{2014} the \
		reveal needs no new field). Only one problem may be active \u{2014} conclude it before posing the next.";
	let (gate, run_nodes, prepare_nodes) = (gate.clone(), graph_nodes.clone(), graph_nodes);
	let plain = problem_parameters();
	FnTool::immediate("problem", description, parameters, move |args| {
		if let Some(problem) = node_check.as_ref().and_then(|check| check(args["nodeId"].as_str().unwrap_or_default())) {
			return invalid_input_result("problem", &[problem]);
		}
		if gate.load(Ordering::SeqCst) {
			return invalid_input_result("problem", &["a problem is already active \u{2014} call conclude on it before posing the next one".to_owned()]);
		}
		// Only tagged problems are checked: an absent target poses freely.
		if let (Some(nodes), Some(target)) = (&run_nodes, args["target"].as_arr().filter(|t| !t.is_empty())) {
			let list = nodes();
			let unknown: Vec<Json> = target.iter().filter(|t| t.as_str().is_none_or(|name| resolve_target_id(name, &list).is_none())).cloned().collect();
			if !unknown.is_empty() {
				return invalid_input_result(
					"problem",
					&[format!(
						"target {} is not a known proposition \u{2014} targets must be proposition ids from the session context; if the material is not in the map, omit target entirely",
						stringify(&Json::Arr(unknown))
					)],
				);
			}
		}
		gate.store(true, Ordering::SeqCst);
		problem_result("the learner's work and questions on it arrive as their messages.")
	})
	.sequential()
	.prepared(move |args| Ok(normalize_target(heal_encoded_arguments(&args, &plain), prepare_nodes.as_ref())))
}

fn conclude_parameters() -> Json {
	object(
		&["outcome", "verdict", "rung", "missClass", "retest"],
		vec![
			(
				"outcome",
				one_of_literals(
					&["solved", "solvedWithHints", "movedOn", "surrendered", "dismissed"],
					"REQUIRED \u{2014} the outcome: solved, solvedWithHints, movedOn, or surrendered \u{2014} bare words, no quotes (dismissed is synthesized, never yours).",
				),
			),
			(
				"verdict",
				string("REQUIRED \u{2014} the plain-language verdict: what was credited, where it broke. On a wrong answer: localize the break, do NOT give the correction."),
			),
			(
				"rung",
				literals_or_null(&["R0", "R1", "R2", "R3", "R4", "R5"], "REQUIRED \u{2014} the hint-ladder rung the problem needed: R0 through R5, or null = no hint was given (bare, no quotes)."),
			),
			(
				"missClass",
				literals_or_null(
					&["cue", "discrimination", "execution", "careless", "structural"],
					"REQUIRED \u{2014} the miss classification: cue, discrimination, execution, careless, or structural \u{2014} or null = no miss (bare, no quotes).",
				),
			),
			("retest", json!({ "type": "boolean", "description": "REQUIRED \u{2014} true marks the problem for a fresh-surface retest before the session ends." })),
		],
	)
}

fn conclude_tool(gate: &Arc<AtomicBool>) -> FnTool {
	let gate = gate.clone();
	let description = "Conclude the active problem: records the outcome + verdict, reveals the committed solution, and frees \
		the learner's composer. After the result, say your closing words about the learner's work if useful, then \
		END YOUR TURN \u{2014} no further tool calls. The next problem waits for the learner's explicit go-ahead (a \
		*Next problem* message, or their own words asking for the next one). The one exception: when the learner \
		asked for a different problem or part, that ask is the go-ahead, so pose it right after this result. \
		Between problems, answer their questions about the concluded one. Nothing may conclude unless a problem is active.";
	FnTool::immediate("conclude", description, conclude_parameters(), move |_args| {
		if !gate.load(Ordering::SeqCst) {
			return invalid_input_result("conclude", &["no active problem to conclude \u{2014} pose one first".to_owned()]);
		}
		gate.store(false, Ordering::SeqCst);
		conclude_result()
	})
	.sequential()
}

/// A study session's problem and conclude, sharing one turn gate. The problem names its plan node
/// like a quiz does.
pub fn study_problem_tools(chat_id: &str, chat_store: &Arc<dyn ChatPort>, graph_nodes: Option<GraphNodes>, node_check: NodeCheck) -> Vec<FnTool> {
	let gate = Arc::new(AtomicBool::new(problem_is_active(chat_store, chat_id)));
	vec![problem_tool(&gate, graph_nodes, study_problem_parameters(), Some(node_check)), conclude_tool(&gate)]
}

/// The practice agent's whole registry. Any side tool `enabled` sets to false is dropped;
/// problem and conclude are the session, so they never are.
pub fn practice_tools(ctx: &PracticeToolContext, enabled: Option<&Json>) -> Vec<FnTool> {
	let gate = Arc::new(AtomicBool::new(problem_is_active(&ctx.chat_store, &ctx.chat_id)));
	let mut tools = vec![problem_tool(&gate, ctx.graph_nodes.clone(), problem_parameters(), None), conclude_tool(&gate)];
	tools.extend(practice_side_tools(ctx.jobs.as_ref(), ctx.graph.as_ref(), &ctx.side, enabled));
	heal_tool_record(tools)
}

/// The rarely needed set practice and homework share: the learner's files, the research and pdf
/// jobs (demo and visual stay teach-only), the map readers when the settings gate opened, the space
/// tools, save_rule and the deadline changes. The teacher's Settings switches apply to them.
pub fn practice_side_tools(jobs: Option<&JobToolContext>, graph: Option<&GraphToolContext>, side: &LessonSide, enabled: Option<&Json>) -> Vec<FnTool> {
	let mut tools = file_tools();
	if let Some(jobs) = jobs {
		let jobs = job_tools(jobs);
		tools.extend([jobs.research, jobs.pdf]);
	}
	tools.extend(graph_and_side(graph, side));
	filter_enabled(tools, enabled)
}
