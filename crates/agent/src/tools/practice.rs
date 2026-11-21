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
use gs_core::session::question_core::{problem_choice_fields, problem_choice_problems};
use gs_core::study::topic_end::{ends_topic, long_problem_stop, topic_stop};
use gs_engine::turn::tool_execute::{conclude_result, invalid_input_result, problem_result, study_conclude_result};
use gs_core::study::homework::conclude_marks_done;
use gs_json::{Json, json, quote, stringify};
use parking_lot::Mutex;

use super::fn_tool::FnTool;
use super::heal::heal_tool_record;
use super::homework::{ProblemList, post_problems_tool};
use super::jobs::{JobToolContext, pdf_tool, research_tool};
use super::plan::PlanContext;
use super::questions::{PlanOrder, node_id_problem};
use super::ports::{ChatPort, ProblemPages};
use super::problem_piece::{NO_STATEMENT, source_field, typed, with_piece};
use gs_core::session::schema::{literals_or_null, object, one_of_literals, string};
use super::side::{LessonSide, file_tools, filter_enabled};

/// The whole graph's nodes (id and name), read fresh per pose.
pub type GraphNodes = Arc<dyn Fn() -> Vec<Json> + Send + Sync>;

/// The plan's node ids, read fresh per call.
pub type PlanNodes = Arc<dyn Fn() -> Vec<String> + Send + Sync>;

/// What the practice tools close over.
#[derive(Clone)]
pub struct PracticeToolContext {
	pub chat_id: String,
	pub chat_store: Arc<dyn ChatPort>,
	/// With it, targets are checked against every proposition of the graph, not only the
	/// session's picks. Without it, nothing is checked.
	pub graph_nodes: Option<GraphNodes>,
	pub jobs: Option<JobToolContext>,
	pub side: LessonSide,
	pub pages: Arc<dyn ProblemPages>,
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
	let mut fields = vec![(
		"statement",
		string("The problem as the learner sees it (markdown + LaTeX). Required unless you pass source. Starts with the problem itself, never a title or heading line: godspeed already titles it \"Problem N\". Must be self-contained and solvable from the session's material. When you pass options, the statement never lists them again and never says how many to pick: the rows say \"Select all that apply\" themselves. NEVER announces the target proposition."),
	)];
	fields.extend(problem_choice_fields());
	fields.extend([
		("source", source_field(None)),
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
	]);
	object(&["mode", "modelSolution"], fields)
}

/// The problem schema of a study session: it also names the plan node the problem is about, and
/// in a lesson with a problem list (`listed`) may name a listed problem by number.
fn study_problem_parameters(listed: bool) -> Json {
	let mut parameters = problem_parameters();
	let node_id = string("REQUIRED \u{2014} the topic this problem is about: a node id from the [Study plan].");
	if let Some(schema) = parameters.as_obj_mut() {
		if let Some(required) = schema.get_mut("required").and_then(Json::as_arr_mut) {
			required.push(Json::from("nodeId"));
		}
		if let Some(properties) = schema.get_mut("properties").and_then(Json::as_obj_mut) {
			properties.insert("nodeId", node_id);
			if listed {
				properties.insert("number", string("A listed problem's number (post_problems). One listed with its page needs no statement or source."));
			}
		}
	}
	parameters
}

/// The listed problem a pose names by number, or the refusal.
fn listed_problem(list: &Arc<dyn ProblemList>, number: &str) -> Result<Json, Json> {
	let listed = list.problems();
	if listed.is_empty() {
		return Err(invalid_input_result("problem", &["no problems are listed yet \u{2014} post them with post_problems first".to_owned()]));
	}
	listed.iter().find(|p| p["number"].as_str() == Some(number)).cloned().ok_or_else(|| {
		let numbers: Vec<&str> = listed.iter().map(|p| p["number"].str_or_empty()).collect();
		invalid_input_result("problem", &[format!("no problem numbered {}; the numbers are {}", quote(number), numbers.join(", "))])
	})
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

/// Why a pose is refused before its source is looked at, if it is: the problem checks, the
/// statement or source (a listed problem's own piece will do), a problem already active, the
/// targets, and last, in Study, the plan order.
fn pose_refusal(args: &Json, gate: &TurnGate, graph_nodes: Option<&GraphNodes>, plan_nodes: Option<&PlanNodes>, order: Option<&PlanOrder>, has_piece: bool) -> Option<Json> {
	if let Some(problem) = plan_nodes.and_then(|nodes| node_id_problem(&nodes(), args["nodeId"].str_or_empty())) {
		return Some(invalid_input_result("problem", &[problem]));
	}
	let choice_problems = problem_choice_problems(args);
	if !choice_problems.is_empty() {
		return Some(invalid_input_result("problem", &choice_problems));
	}
	if typed(&args["statement"]).is_none() && args["source"].is_null() && !has_piece {
		return Some(invalid_input_result("problem", &[NO_STATEMENT.to_owned()]));
	}
	if *gate.problem_active.lock() {
		return Some(invalid_input_result("problem", &["a problem is already active \u{2014} call conclude on it before posing the next one".to_owned()]));
	}
	// Only tagged problems are checked: an absent target poses freely.
	if let (Some(nodes), Some(target)) = (graph_nodes, args["target"].as_arr().filter(|t| !t.is_empty())) {
		let list = nodes();
		let unknown: Vec<Json> = target.iter().filter(|t| t.as_str().is_none_or(|name| resolve_target_id(name, &list).is_none())).cloned().collect();
		if !unknown.is_empty() {
			return Some(invalid_input_result(
				"problem",
				&[format!(
					"target {} is not a known proposition \u{2014} targets must be proposition ids from the session context; if the material is not in the map, omit target entirely",
					stringify(&Json::Arr(unknown))
				)],
			));
		}
	}
	order.and_then(|order| order.refusal(args["nodeId"].str_or_empty())).map(|skip| invalid_input_result("problem", &[skip]))
}

/// The pose, with its extra checks for a study session (`plan_nodes`) and, in a lesson with a
/// problem list, its listed problems by number. A `source` is looked up before the problem becomes
/// active; the calls run one at a time, so nothing poses in between.
fn problem_tool(gate: &Arc<TurnGate>, graph_nodes: Option<GraphNodes>, parameters: Json, plan: Option<(PlanNodes, Arc<PlanOrder>)>, pages: &Arc<dyn ProblemPages>, list: Option<Arc<dyn ProblemList>>) -> FnTool {
	let description = "Pose one practice problem. Ends the turn \u{2014} the problem stays in view beside the lesson, and the \
		learner's work and questions on it arrive back as their messages. The modelSolution rides this call's \
		arguments and stays hidden from the learner until you conclude (conclude shows it verbatim \u{2014} the \
		reveal needs no new field). Only one problem may be active \u{2014} conclude it before posing the next.";
	let (gate, run_nodes, prepare_nodes, pages) = (gate.clone(), graph_nodes.clone(), graph_nodes, pages.clone());
	let plain = problem_parameters();
	FnTool::immediate_async("problem", description, parameters, move |args| {
		let (gate, run_nodes, plan, pages, list) = (gate.clone(), run_nodes.clone(), plan.clone(), pages.clone(), list.clone());
		async move {
			let listed = match (&list, args["number"].as_str()) {
				(Some(list), Some(number)) => match listed_problem(list, number) {
					Ok(listed) => Some(listed),
					Err(refusal) => return refusal,
				},
				_ => None,
			};
			let piece = listed.as_ref().map(|p| &p["piece"]).filter(|piece| !piece.is_null());
			let (plan_nodes, order) = plan.as_ref().map(|(nodes, order)| (nodes, order.as_ref())).unzip();
			if let Some(refusal) = pose_refusal(&args, &gate, run_nodes.as_ref(), plan_nodes, order, piece.is_some()) {
				return refusal;
			}
			let mut shown = None;
			if let (Some(piece), None, true) = (piece, typed(&args["statement"]), args["source"].is_null()) {
				shown = listed.as_ref().map(|p| json!({ "piece": piece.clone(), "text": p["text"].clone() }));
			} else if !args["source"].is_null() {
				match pages.find(&args["source"], typed(&args["statement"])).await {
					Ok(found) => shown = Some(found),
					Err(why) => return invalid_input_result("problem", &[why]),
				}
			}
			*gate.problem_active.lock() = true;
			let posed = problem_result("the learner's work and questions on it arrive as their messages.");
			match shown {
				Some(shown) => with_piece(posed, &shown),
				None => posed,
			}
		}
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
					"REQUIRED \u{2014} the outcome: solved, solvedWithHints, movedOn (the learner asked for a different problem or part, in their words), or surrendered (the learner said they give up or asked for this problem's solution) \u{2014} bare words, no quotes (dismissed is synthesized, never yours). A question, \"show me\" or \"give me an example\" is neither: the problem stays open.",
				),
			),
			(
				"verdict",
				string("REQUIRED \u{2014} the plain-language verdict: what was credited, where it broke. On a wrong answer: localize the break, do NOT give the correction. A part the learner left blank is not credited."),
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
		Between problems, answer their questions about the concluded one. Never conclude while parts you will still \
		ask remain: concluding shows the solution at once, giving their answers away, so ask them first and conclude \
		after the last part. Nothing may conclude unless a problem is active."
	)
}

/// Concludes under the gate; `result` gives the result for the record's messages as they were
/// before this turn.
fn gated_conclude(description: String, gate: &Arc<TurnGate>, record: PlanContext, result: impl Fn(&Json, &[Json]) -> Json + Send + Sync + 'static) -> FnTool {
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
fn conclude_tool(gate: &Arc<TurnGate>, record: PlanContext) -> FnTool {
	gated_conclude(conclude_description(" \u{2014} no further tool calls."), gate, record, |_, messages| conclude_result(long_problem_stop(messages, clock::now_ms())))
}

/// Study's conclude: one that finishes its problem's topic ends on that topic's stop and tells the
/// agent to call topic_done; otherwise it is practice's. A listed problem solved is marked done.
fn study_conclude_tool(gate: &Arc<TurnGate>, record: PlanContext, list: Option<Arc<dyn ProblemList>>) -> FnTool {
	let description = conclude_description(
		", with no further tool calls. When this conclude finishes a topic, the verdict is your closing words: write no other prose, then read what the next topic needs and call topic_done in its own reply.",
	);
	let ended = gate.clone();
	gated_conclude(description, gate, record, move |args, messages| {
		let now = clock::now_ms();
		let active = active_problem_of(messages);
		if let (Some(list), Some(number)) = (&list, active.as_ref().and_then(|a| a.input["number"].as_str()))
			&& conclude_marks_done(&args["outcome"])
		{
			list.mark_done(number);
		}
		let stop = match ends_topic(args, active.as_ref()) {
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
/// names its plan node like a quiz does. A lesson on files has its first file's problem list
/// (`list`): post_problems fills it, a pose may name one of it, and conclude marks it done.
pub fn study_problem_tools(gate: &Arc<TurnGate>, record: PlanContext, graph_nodes: Option<GraphNodes>, plan: (PlanNodes, Arc<PlanOrder>), pages: &Arc<dyn ProblemPages>, list: Option<&Arc<dyn ProblemList>>) -> Vec<FnTool> {
	let mut tools = Vec::new();
	if let Some(list) = list {
		tools.push(post_problems_tool(list.clone(), pages.clone()));
	}
	tools.push(problem_tool(gate, graph_nodes, study_problem_parameters(list.is_some()), Some(plan), pages, list.cloned()));
	tools.push(study_conclude_tool(gate, record, list.cloned()));
	tools
}

/// The practice agent's whole registry. Any side tool `enabled` sets to false is dropped;
/// problem and conclude are the session, so they never are.
pub fn practice_tools(ctx: &PracticeToolContext, enabled: Option<&Json>) -> Vec<FnTool> {
	let gate = TurnGate::new(problem_is_active(&ctx.chat_store, &ctx.chat_id));
	let record = PlanContext { chat_id: ctx.chat_id.clone(), chat_store: ctx.chat_store.clone() };
	let mut tools = vec![problem_tool(&gate, ctx.graph_nodes.clone(), problem_parameters(), None, &ctx.pages, None), conclude_tool(&gate, record)];
	tools.extend(practice_side_tools(ctx.jobs.as_ref(), &ctx.side, enabled));
	heal_tool_record(tools)
}

/// The rarely needed set practice and homework share: the learner's files, the research and pdf
/// jobs (demo and visual stay teach-only) and the lesson's side tools. The teacher's Settings
/// switches apply to them.
pub fn practice_side_tools(jobs: Option<&JobToolContext>, side: &LessonSide, enabled: Option<&Json>) -> Vec<FnTool> {
	let mut tools = file_tools();
	if let Some(jobs) = jobs {
		tools.extend([research_tool(jobs), pdf_tool(jobs)]);
	}
	tools.extend(side.tools());
	filter_enabled(tools, enabled)
}

#[cfg(test)]
mod tests {
	use gs_core::contracts::chat::{CONCLUDE_ACK_TEXT, STUDY_TOPIC_END_ACK_TEXT};
	use gs_engine::turn::abort::Abort;
	use gs_engine::turn::tool::{Tool, ToolContext};

	use super::*;
	use crate::tools::questions::study_quiz_tool;
	use crate::tools::test_record::{FakePages, learner_at, planned_record, record};

	/// The plan's node ids, and its order check on a record with no plan, which never refuses.
	fn plan() -> (PlanNodes, Arc<PlanOrder>) {
		(Arc::new(|| vec!["reg".to_owned()]), PlanOrder::new(&record(Vec::new())))
	}

	#[tokio::test]
	async fn a_first_call_that_skips_an_earlier_node_is_refused_once_a_node() {
		let tree = json!({ "nodes": [{ "id": "reg" }, { "id": "cv" }, { "id": "bias" }], "edges": [] });
		let asked_reg = json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "q0", "name": "quiz", "arguments": { "nodeId": "reg" } }] });
		let lesson = planned_record(tree, vec![asked_reg]);
		let order = PlanOrder::new(&lesson);
		let nodes: PlanNodes = Arc::new(|| ["reg", "cv", "bias"].map(str::to_owned).to_vec());
		let quiz = study_quiz_tool(&lesson, &order);
		let mut tools = study_problem_tools(&TurnGate::new(false), lesson, None, (nodes, order), &no_pages(), None);
		tools.push(quiz);
		let ask = |node: &str| json!({ "type": "check", "nodeId": node, "question": "Q?", "options": [{ "label": "A" }, { "label": "B" }], "explanation": "E.", "correctAnswer": "A" });
		let pose = json!({ "statement": "s", "nodeId": "bias", "mode": "recall", "modelSolution": "m" });
		let refused = run(&tools, "problem", pose).await;
		assert_eq!(refused["isError"], json!(true), "{refused:?}");
		assert!(refused["content"][0]["text"].str_or_empty().ends_with("- nodeId \"bias\": \"cv\" comes first and nothing in this lesson asked it. Ask it first. His answers in this lesson justify skipping it: send the same call again."), "{refused:?}");
		assert_ne!(run(&tools, "quiz", ask("bias")).await["isError"], json!(true), "sent again, by either tool, it goes through");
		assert_ne!(run(&tools, "quiz", ask("reg")).await["isError"], json!(true), "a node already asked never blocks");
	}

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

	fn no_pages() -> Arc<dyn ProblemPages> {
		FakePages::new(Err("no pages".to_owned()))
	}

	fn study_conclude(minutes: i64) -> (FnTool, Arc<TurnGate>) {
		let gate = TurnGate::new(true);
		let tools = study_problem_tools(&gate, record(worked(minutes)), None, plan(), &no_pages(), None);
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
			let PlanContext { chat_id, chat_store } = record(worked(minutes));
			let ctx = PracticeToolContext { chat_id, chat_store, graph_nodes: None, jobs: None, side: LessonSide::default(), pages: no_pages() };
			practice_tools(&ctx, None).into_iter().find(|t| t.name() == "conclude").unwrap()
		};
		let out = conclude(&practice(26), "solved", Json::Null).await;
		assert_eq!((out["content"][0]["text"].as_str(), out["details"]["stop"]["kind"].as_str()), (Some(CONCLUDE_ACK_TEXT), Some("problem")));
		assert_eq!(conclude(&practice(20), "solved", Json::Null).await, conclude_result(None), "under 25 minutes: no stop");
	}

	async fn pose_with(input: Json, pages: Arc<dyn ProblemPages>) -> (Json, Arc<TurnGate>) {
		let gate = TurnGate::new(false);
		let tools = study_problem_tools(&gate, record(vec![]), None, plan(), &pages, None);
		let tool = tools.into_iter().find(|t| t.name() == "problem").unwrap();
		(tool.execute(input, ToolContext { tool_call_id: "p1".to_owned(), abort: Abort::new() }).await.unwrap(), gate)
	}

	async fn pose(input: Json) -> Json {
		pose_with(input, no_pages()).await.0
	}

	fn from_page() -> Json {
		json!({ "mode": "recall", "modelSolution": "m", "nodeId": "reg", "source": { "fileId": "f_1", "page": 2, "starts": "2. Second" } })
	}

	#[tokio::test]
	async fn a_source_poses_the_piece_and_gives_the_teacher_its_words() {
		let shown = json!({ "piece": { "fileId": "f_1" }, "text": "2. Second problem" });
		let pages = FakePages::new(Ok(shown.clone()));
		let (out, gate) = pose_with(from_page(), pages.clone()).await;
		assert_eq!(out["details"], shown);
		assert_eq!(out["terminate"], Json::Bool(true));
		assert_eq!(out["content"][0]["text"].as_str().unwrap(), "Problem posed \u{2014} the turn ends here; the learner's work and questions on it arrive as their messages.\nThe problem as the file prints it:\n2. Second problem");
		assert!(*gate.problem_active.lock());
		assert_eq!(pages.asked.lock().as_slice(), [(from_page()["source"].clone(), None)]);
		let mut typed = from_page();
		typed.set("statement", "Typed words");
		let again = FakePages::new(Ok(shown));
		pose_with(typed, again.clone()).await;
		assert_eq!(again.asked.lock()[0].1.as_deref(), Some("Typed words"), "a scan keeps what the teacher typed");
	}

	#[tokio::test]
	async fn a_source_that_is_not_found_refuses_and_poses_nothing() {
		let (out, gate) = pose_with(from_page(), FakePages::new(Err("\"2. Second\" is not on page 2.".to_owned()))).await;
		assert_eq!(out["isError"].as_bool(), Some(true));
		assert!(out["details"]["problems"][0].as_str().unwrap().contains("is not on page 2"));
		assert!(!*gate.problem_active.lock());
	}

	#[tokio::test]
	async fn a_pose_needs_a_statement_or_a_source() {
		let mut bare = from_page();
		bare.as_obj_mut().unwrap().remove("source");
		let out = pose(bare.clone()).await;
		assert_eq!(out["details"]["problems"][0].as_str(), Some("give the statement, or a source to show the page itself"));
		bare.set("statement", "  ");
		assert_eq!(pose(bare).await["isError"].as_bool(), Some(true), "spaces are no statement");
		let (typed_only, _) = pose_with(json!({ "statement": "s", "mode": "recall", "modelSolution": "m", "nodeId": "reg" }), no_pages()).await;
		assert_eq!(typed_only["details"], Json::Null);
	}

	#[tokio::test]
	async fn a_choice_problem_takes_two_to_eight_labelled_options() {
		let labels = |n: usize| (0..n).map(|i| json!({ "label": format!("choice {i}") })).collect::<Vec<_>>();
		let with = |extra: Json| {
			let mut input = json!({ "statement": "s", "mode": "recall", "modelSolution": "m", "nodeId": "reg" });
			for (key, value) in extra.as_obj().unwrap().iter() {
				input.as_obj_mut().unwrap().insert(key, value.clone());
			}
			input
		};
		let problem_of = |out: &Json| out["details"]["problems"][0].as_str().unwrap_or_default().to_owned();
		let out = pose(with(json!({ "options": labels(1) }))).await;
		assert_eq!(out["isError"].as_bool(), Some(true));
		assert!(problem_of(&out).contains("1 items"), "{}", problem_of(&out));
		assert!(problem_of(&pose(with(json!({ "options": labels(9) }))).await).contains("9 items"));
		assert!(problem_of(&pose(with(json!({ "options": [{ "label": "a" }, { "label": "  " }] }))).await).contains("options[1].label is empty"));
		assert!(problem_of(&pose(with(json!({ "multiSelect": true }))).await).contains("multiSelect needs options"));
		assert_ne!(pose(with(json!({ "options": labels(2), "multiSelect": true }))).await["isError"].as_bool(), Some(true), "two options is enough");
	}

	/// A lesson on files' list: f_test's problems, 1 cut from its page and 2 typed.
	struct FirstFile(Mutex<Vec<Json>>);

	impl ProblemList for FirstFile {
		fn problems(&self) -> Vec<Json> {
			self.0.lock().clone()
		}
		fn post(&self, problems: &[Json]) -> Option<String> {
			*self.0.lock() = problems.to_vec();
			None
		}
		fn mark_done(&self, number: &str) {
			for p in self.0.lock().iter_mut().filter(|p| p["number"].as_str() == Some(number)) {
				p.set("done", true);
			}
		}
		fn file_id(&self) -> Option<String> {
			Some("f_test".to_owned())
		}
	}

	fn first_file() -> Arc<FirstFile> {
		Arc::new(FirstFile(Mutex::new(vec![
			json!({ "number": "1", "title": "Limits", "text": "1. Find the limit.", "piece": { "fileId": "f_test" }, "done": false }),
			json!({ "number": "2", "title": "Series", "text": "Sum it.", "done": false }),
		])))
	}

	fn files_tools(list: &Arc<FirstFile>, messages: Vec<Json>, pages: &Arc<FakePages>, active: bool) -> Vec<FnTool> {
		let list: Arc<dyn ProblemList> = list.clone();
		let pages: Arc<dyn ProblemPages> = pages.clone();
		study_problem_tools(&TurnGate::new(active), record(messages), None, plan(), &pages, Some(&list))
	}

	async fn run(tools: &[FnTool], name: &str, args: Json) -> Json {
		tools.iter().find(|t| t.name() == name).unwrap().execute(args, ToolContext { tool_call_id: "t1".to_owned(), abort: Abort::new() }).await.unwrap()
	}

	#[tokio::test]
	async fn a_lesson_on_files_lists_only_its_first_files_problems() {
		let pages = FakePages::new(Ok(json!({ "piece": { "fileId": "f_test" }, "text": "3. Prove it." })));
		let tools = files_tools(&first_file(), vec![], &pages, false);
		let other = json!({ "problems": [{ "number": "3", "title": "Proof", "source": { "fileId": "f_key", "page": 1, "starts": "3. Prove" } }] });
		let out = run(&tools, "post_problems", other).await;
		assert!(out["content"][0]["text"].str_or_empty().contains("problem 3: its source is in f_key, but this lesson lists the problems of f_test only"), "{out:?}");
		assert!(pages.asked.lock().is_empty(), "nothing is looked up");
		let unnamed = json!({ "problems": [{ "number": "3", "title": "Proof", "source": { "page": 1, "starts": "3. Prove" } }] });
		assert_ne!(run(&tools, "post_problems", unnamed).await["isError"].as_bool(), Some(true));
		assert_eq!(pages.asked.lock()[0].0["fileId"].as_str(), Some("f_test"), "a source names the first file");
	}

	#[tokio::test]
	async fn a_listed_problem_is_posed_by_number_and_solved_marks_it_done() {
		let list = first_file();
		let pages = FakePages::new(Err("no pages".to_owned()));
		let tools = files_tools(&list, vec![], &pages, false);
		let by_number = |number: &str| json!({ "number": number, "mode": "recall", "modelSolution": "m", "nodeId": "reg" });
		let out = run(&tools, "problem", by_number("1")).await;
		assert_eq!((out["details"]["piece"]["fileId"].as_str(), out["details"]["text"].as_str()), (Some("f_test"), Some("1. Find the limit.")), "{out:?}");
		let tools = files_tools(&list, vec![], &pages, false);
		assert!(run(&tools, "problem", by_number("9")).await["content"][0]["text"].str_or_empty().contains("no problem numbered \"9\"; the numbers are 1, 2"));
		assert!(run(&tools, "problem", by_number("2")).await["content"][0]["text"].str_or_empty().contains(NO_STATEMENT), "a typed problem needs its statement");

		let posed = json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "p1", "name": "problem", "arguments": by_number("1") }], "timestamp": clock::now_ms() });
		let result = json!({ "role": "toolResult", "toolCallId": "p1", "toolName": "problem", "details": null, "isError": false, "timestamp": clock::now_ms() });
		let open = || files_tools(&list, vec![posed.clone(), result.clone()], &pages, true);
		conclude(open().iter().find(|t| t.name() == "conclude").unwrap(), "movedOn", Json::Null).await;
		assert_eq!(list.0.lock()[0]["done"], json!(false), "moved on: not done");
		conclude(open().iter().find(|t| t.name() == "conclude").unwrap(), "solved", Json::Null).await;
		assert_eq!(list.0.lock()[0]["done"], json!(true));
	}

	#[test]
	fn the_pose_schema_offers_options_and_multi_select_as_optional() {
		assert!(study_problem_parameters(true)["properties"]["number"].as_obj().is_some() && study_problem_parameters(false)["properties"].get("number").is_none());
		for parameters in [problem_parameters(), study_problem_parameters(false), study_problem_parameters(true)] {
			assert_eq!(parameters["properties"]["source"]["required"], json!(["fileId", "page", "starts"]));
			assert!(!parameters["required"].items().contains(&Json::from("statement")), "a source may stand in for it");
			assert!(parameters["properties"]["options"]["items"]["properties"]["label"].as_obj().is_some());
			assert_eq!(parameters["properties"]["multiSelect"]["type"].as_str(), Some("boolean"));
			let required: Vec<&str> = parameters["required"].as_arr().unwrap().iter().filter_map(Json::as_str).collect();
			assert!(!required.contains(&"options") && !required.contains(&"multiSelect"));
		}
	}
}
