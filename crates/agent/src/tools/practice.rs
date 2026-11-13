//! The practice tools: the session runs on `problem` (pose:
//! ends the turn, the commitment rides the call's arguments) and `conclude` (ends the problem, so
//! closing words may follow; the next pose waits for the learner's go-ahead, which asking for
//! another problem or part is). An agent cannot pose while a problem is active and cannot conclude
//! with nothing active.

use std::sync::Arc;

use gs_base::clock;
use gs_core::graph::chains::resolve_target_id;
use gs_core::messages::native_messages::active_problem_of;
use gs_core::session::argument_heal::heal_encoded_arguments;
use gs_core::study::topic_end::{ends_topic, long_problem_stop, topic_stop};
use gs_engine::turn::tool_execute::{conclude_result, invalid_input_result, problem_result, study_conclude_result};
use gs_json::{Json, json, stringify};
use parking_lot::Mutex;

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

/// The stored record's messages (none when the lesson is gone).
pub(super) fn record_messages(chat_store: &Arc<dyn ChatPort>, chat_id: &str) -> Vec<Json> {
	match chat_store.get_chat(chat_id).and_then(|mut record| record.as_obj_mut()?.remove("messages")) {
		Some(Json::Arr(messages)) => messages,
		_ => Vec::new(),
	}
}

/// Whether a problem is open in the stored record.
pub fn problem_is_active(chat_store: &Arc<dyn ChatPort>, chat_id: &str) -> bool {
	active_problem_of(&record_messages(chat_store, chat_id)).is_some()
}

/// A topic finished this turn, and whether its topic_done is stored yet.
#[derive(Clone)]
pub(super) struct TopicEnd {
	pub node_id: String,
	pub stored: bool,
}

/// One turn's gate, shared by problem, conclude and topic_done. It starts from the record, which
/// only updates when the turn ends, so the tools keep their own copy for the rest of the turn.
pub struct TurnGate {
	problem_active: Mutex<bool>,
	topic_ended: Mutex<Option<TopicEnd>>,
}

impl TurnGate {
	pub fn new(problem_active: bool) -> Arc<TurnGate> {
		Arc::new(TurnGate { problem_active: Mutex::new(problem_active), topic_ended: Mutex::new(None) })
	}

	pub(super) fn topic_ended(&self) -> Option<TopicEnd> {
		self.topic_ended.lock().clone()
	}

	pub(super) fn set_topic_ended(&self, node_id: &str, stored: bool) {
		*self.topic_ended.lock() = Some(TopicEnd { node_id: node_id.to_owned(), stored });
	}
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
fn problem_tool(gate: &Arc<TurnGate>, graph_nodes: Option<GraphNodes>, parameters: Json, node_check: Option<NodeCheck>) -> FnTool {
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
		let mut active = gate.problem_active.lock();
		if *active {
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
		*active = true;
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

/// The conclude description around how the turn ends after it.
fn conclude_description(turn_end: &str) -> String {
	format!(
		"Conclude the active problem: records the outcome + verdict, reveals the committed solution, and frees \
		the learner's composer. After the result, say your closing words about the learner's work if useful, then \
		END YOUR TURN{turn_end} The next problem waits for the learner's explicit go-ahead (a \
		*Next problem* message, or their own words asking for the next one). The one exception: when the learner \
		asked for a different problem or part, that ask is the go-ahead, so pose it right after this result. \
		Between problems, answer their questions about the concluded one. Nothing may conclude unless a problem is active."
	)
}

/// Where the lesson record is, for the stop a conclude makes.
#[derive(Clone)]
pub struct LessonRecord {
	pub chat_id: String,
	pub chat_store: Arc<dyn ChatPort>,
}

/// Concludes under the gate; `result` gives the result for the record's messages as they were
/// before this turn.
fn gated_conclude(description: String, gate: &Arc<TurnGate>, record: LessonRecord, result: impl Fn(&Json, &[Json]) -> Json + Send + Sync + 'static) -> FnTool {
	let gate = gate.clone();
	FnTool::immediate("conclude", description, conclude_parameters(), move |args| {
		{
			let mut active = gate.problem_active.lock();
			if !*active {
				return invalid_input_result("conclude", &["no active problem to conclude \u{2014} pose one first".to_owned()]);
			}
			*active = false;
		}
		result(&args, &record_messages(&record.chat_store, &record.chat_id))
	})
	.sequential()
}

/// Practice's conclude: a problem that took long ends on a stop; the text is unchanged.
fn conclude_tool(gate: &Arc<TurnGate>, record: LessonRecord) -> FnTool {
	gated_conclude(conclude_description(" \u{2014} no further tool calls."), gate, record, |_, messages| conclude_result(long_problem_stop(messages, clock::now_ms())))
}

/// Study's conclude: one that finishes its problem's topic ends on that topic's stop and tells the
/// agent to call topic_done; otherwise it is practice's.
fn study_conclude_tool(gate: &Arc<TurnGate>, record: LessonRecord) -> FnTool {
	let description = conclude_description(
		", with no further tool calls. When this conclude finishes a topic, the verdict is your closing words: write no other prose, then read what the next topic needs and call topic_done in its own reply.",
	);
	let ended = gate.clone();
	gated_conclude(description, gate, record, move |args, messages| {
		let now = clock::now_ms();
		let stop = match ends_topic(args, active_problem_of(messages).as_ref()) {
			Some(node_id) => {
				ended.set_topic_ended(&node_id, false);
				Some(topic_stop(messages, &node_id, now))
			}
			None => long_problem_stop(messages, now),
		};
		study_conclude_result(stop)
	})
}

/// A study session's problem and conclude, under the turn gate topic_done shares. The problem
/// names its plan node like a quiz does.
pub fn study_problem_tools(gate: &Arc<TurnGate>, record: LessonRecord, graph_nodes: Option<GraphNodes>, node_check: NodeCheck) -> Vec<FnTool> {
	vec![problem_tool(gate, graph_nodes, study_problem_parameters(), Some(node_check)), study_conclude_tool(gate, record)]
}

/// The practice agent's whole registry. Any side tool `enabled` sets to false is dropped;
/// problem and conclude are the session, so they never are.
pub fn practice_tools(ctx: &PracticeToolContext, enabled: Option<&Json>) -> Vec<FnTool> {
	let gate = TurnGate::new(problem_is_active(&ctx.chat_store, &ctx.chat_id));
	let record = LessonRecord { chat_id: ctx.chat_id.clone(), chat_store: ctx.chat_store.clone() };
	let mut tools = vec![problem_tool(&gate, ctx.graph_nodes.clone(), problem_parameters(), None), conclude_tool(&gate, record)];
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

#[cfg(test)]
mod tests {
	use gs_core::contracts::chat::{CONCLUDE_ACK_TEXT, STUDY_TOPIC_END_ACK_TEXT};
	use gs_engine::turn::abort::Abort;
	use gs_engine::turn::tool::{Tool, ToolContext};

	use super::*;
	use crate::tools::test_record::{learner_at, record};

	/// A problem on `reg` posed `minutes` ago, worked on every 4 minutes since.
	fn worked(minutes: i64) -> Vec<Json> {
		let posed = json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "p1", "name": "problem", "arguments": { "statement": "s", "nodeId": "reg" } }], "timestamp": clock::now_ms() - minutes * 60_000 });
		let result = json!({ "role": "toolResult", "toolCallId": "p1", "toolName": "problem", "details": null, "isError": false, "timestamp": clock::now_ms() - minutes * 60_000 });
		[vec![posed, result], (0..minutes / 4).map(|i| learner_at(minutes - 4 * (i + 1))).collect()].concat()
	}

	async fn conclude(tool: &FnTool, outcome: &str, rung: Json) -> Json {
		let args = json!({ "outcome": outcome, "verdict": "v", "rung": rung, "missClass": null, "retest": false });
		tool.execute(args, ToolContext { tool_call_id: "c1".to_owned(), abort: Abort::new() }).await.unwrap()
	}

	fn study_conclude(minutes: i64) -> (FnTool, Arc<TurnGate>) {
		let gate = TurnGate::new(true);
		let tools = study_problem_tools(&gate, record(worked(minutes)), None, Arc::new(|_| None));
		(tools.into_iter().find(|t| t.name() == "conclude").unwrap(), gate)
	}

	#[tokio::test]
	async fn a_study_conclude_that_finishes_its_topic_stops_there() {
		let (tool, gate) = study_conclude(12);
		let out = conclude(&tool, "solvedWithHints", json!("R2")).await;
		assert_eq!(out["content"][0]["text"].as_str(), Some(STUDY_TOPIC_END_ACK_TEXT));
		let stop = &out["details"]["stop"];
		assert_eq!((stop["kind"].as_str(), stop["nodeId"].as_str(), stop["activeMinutes"].as_f64()), (Some("topic"), Some("reg"), Some(12.0)));
		assert_eq!(gate.topic_ended().map(|t| (t.node_id, t.stored)), Some(("reg".to_owned(), false)));
	}

	#[tokio::test]
	async fn a_long_problem_stops_on_the_shipped_text() {
		let (tool, gate) = study_conclude(26);
		let out = conclude(&tool, "solvedWithHints", json!("R3")).await;
		assert_eq!(out["content"][0]["text"].as_str(), Some(CONCLUDE_ACK_TEXT));
		assert_eq!((out["details"]["stop"]["kind"].as_str(), out["details"]["stop"]["activeMinutes"].as_f64()), (Some("problem"), Some(26.0)));
		assert!(gate.topic_ended().is_none());

		let practice = |minutes| {
			let LessonRecord { chat_id, chat_store } = record(worked(minutes));
			let ctx = PracticeToolContext { chat_id, chat_store, graph_nodes: None, graph: None, jobs: None, side: LessonSide::default() };
			practice_tools(&ctx, None).into_iter().find(|t| t.name() == "conclude").unwrap()
		};
		let out = conclude(&practice(26), "solved", Json::Null).await;
		assert_eq!((out["content"][0]["text"].as_str(), out["details"]["stop"]["kind"].as_str()), (Some(CONCLUDE_ACK_TEXT), Some("problem")));
		assert_eq!(conclude(&practice(20), "solved", Json::Null).await, conclude_result(None), "under 25 minutes: no stop");
	}
}
