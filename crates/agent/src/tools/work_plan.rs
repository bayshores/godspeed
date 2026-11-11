//! work_plan (src/backend/agent/tools/work-plan.ts): the plan for the reply being worked on,
//! shown to the learner. Nothing is stored; the call's own input is the plan.

use gs_json::json;

use super::fn_tool::FnTool;
use super::schema::object;

pub fn work_plan_tool() -> FnTool {
	let parameters = object(
		&["items", "done"],
		vec![
			(
				"items",
				json!({
					"type": "array",
					"items": { "type": "string", "minLength": 1, "maxLength": 80 },
					"minItems": 3,
					"maxItems": 6,
					"description": "The steps for this reply, in order, each a few plain words the learner reads, e.g. 'Read Theorem 1 in Rosen 7.1'.",
				}),
			),
			("done", json!({ "type": "integer", "minimum": 0, "description": "How many items, from the top, are finished." })),
		],
	);
	let description = "Show the learner your plan for this reply while you work. Call it first when the reply needs more than one step, then call it again with the same items and a higher `done` as you finish each one. Skip it for a reply that is a single step.";
	FnTool::server("work_plan", description, parameters, |args, _ctx| async move {
		let items = args["items"].as_arr().map_or(0, Vec::len);
		let done = args["done"].as_f64().unwrap_or(0.0);
		if done > items as f64 {
			return Ok(json!({ "ok": false, "error": format!("done ({}) is more than the {items} items", gs_json::js_number(done)) }));
		}
		Ok(json!("Plan shown to the learner."))
	})
}
