//! plan_init (src/backend/agent/tools/plan.ts): the teacher writes the whole dependency map as a
//! mermaid block, once and again whenever it is wrong. Statuses are derived from the quiz nodeId
//! tags, never declared.

use std::sync::Arc;

use gs_core::session::plan_tree::create_tree;
use gs_json::{Json, json, stringify};

use super::fn_tool::FnTool;
use super::mermaid_plan::parse_mermaid_plan;
use super::ports::ChatPort;
use super::schema::{object, string_min};

/// What the plan-reading tools close over: the lesson and its storage.
#[derive(Clone)]
pub struct PlanContext {
	pub chat_id: String,
	pub chat_store: Arc<dyn ChatPort>,
}

/// Rides plan_init's slim result: the moment the ids become load-bearing.
const PLAN_NODE_IDS_REMINDER: &str = "These are the plan's node ids \u{2014} the only valid nodeId values for every quiz and explain call from here on. Reference them exactly.";

pub fn plan_init_tool(ctx: &PlanContext) -> FnTool {
	let ctx = ctx.clone();
	let parameters = object(
		&["mermaid"],
		vec![(
			"mermaid",
			string_min(
				1,
				"A mermaid graph block (any direction), e.g.:\ngraph TD\n  primitives[Number primitives] --> operators[Arithmetic operators] --> expressions[Evaluating expressions]\n\
				The only strict rule: ids are permanent lowercase slugs (a-z, 0-9, hyphens/underscores) \u{2014} checks reference them via nodeId. \
				Titles are free single-line text; `-->` means 'from = prerequisite' (chains fine); no subgraphs, styles, or classes.",
			),
		)],
	);
	let description = "Write or REWRITE this session's plan map \u{2014} the dependency graph the learner follows live in the plan window. \
		Call once right after the probe concludes, to present the map; re-call whenever the map is wrong (the new block replaces the old tree). \
		A mermaid graph block (any direction): one node per line (`slug[Short Title]` \u{2014} slugs are permanent lowercase ids: a-z, 0-9, hyphens/underscores), \
		`-->` edges meaning 'from must be understood before to' (chains fine). 5\u{2013}15 nodes: a map, not a syllabus \u{2014} one reasoning step per node, compress. \
		Every check you fire names the node it assesses via `nodeId`; where the lesson stands derives from those tags.";
	FnTool::server("plan_init", description, parameters, move |args, _ctx| {
		let ctx = ctx.clone();
		async move {
			if ctx.chat_store.get_chat(&ctx.chat_id).is_none() {
				return Ok(json!({ "ok": false, "error": format!("Chat not found: {}", ctx.chat_id) }));
			}
			let plan = match parse_mermaid_plan(args["mermaid"].as_str().unwrap_or_default()) {
				Ok(plan) => plan,
				// The model needs the problems, not its own map back.
				Err(problems) => return Ok(json!({ "ok": false, "error": problems.join("\n") })),
			};
			let tree = match create_tree(&plan.nodes, &plan.edges) {
				Ok(tree) => tree,
				Err(message) => return Ok(json!({ "ok": false, "error": message })),
			};
			ctx.chat_store.save_tree(&ctx.chat_id, &tree)?;
			let node_ids: Vec<Json> = tree["nodes"].as_arr().into_iter().flatten().map(|n| n["id"].clone()).collect();
			let text = stringify(&json!({ "ok": true, "nodeIds": node_ids, "reminder": PLAN_NODE_IDS_REMINDER }));
			Ok(json!({ "text": text, "details": { "ok": true, "tree": tree } }))
		}
	})
}
