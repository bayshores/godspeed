//! Where a lesson stands on its plan tree.
//!
//! Position comes from the tagged question CALLS in the transcript, never from their results: the
//! latest tagged call's node is current, nodes of earlier tagged calls are visited.

use std::collections::HashSet;

use gs_json::Json;

/// The tools whose calls tag position.
const TAGGING_TOOLS: [&str; 3] = ["quiz", "explain", "problem"];

/// The derived view the plan panel renders.
pub struct PlanStatuses {
	/// The node the most recent tagged call is about.
	pub current: Option<String>,
	/// Nodes of earlier tagged calls.
	pub visited: HashSet<String>,
}

/// "current", "visited" or "upcoming".
pub fn derived_node_status(statuses: &PlanStatuses, node_id: &str) -> &'static str {
	if statuses.current.as_deref() == Some(node_id) {
		"current"
	} else if statuses.visited.contains(node_id) {
		"visited"
	} else {
		"upcoming"
	}
}

/// `derivePlanStatusesLh`: statuses from the native record's tagging calls, in any state. A tag
/// that is not a node of the tree moves nothing, and consecutive repeats count as one stay.
pub fn derive_plan_statuses_lh(tree: &Json, messages: &[Json]) -> PlanStatuses {
	let ids: HashSet<&str> = tree["nodes"].as_arr().into_iter().flatten().filter_map(|n| n["id"].as_str()).collect();
	let mut stays: Vec<&str> = Vec::new();
	for m in messages.iter().filter(|m| m["role"].as_str() == Some("assistant")) {
		for block in m["content"].as_arr().into_iter().flatten() {
			if block["type"].as_str() != Some("toolCall") || !block["name"].as_str().is_some_and(|n| TAGGING_TOOLS.contains(&n)) {
				continue;
			}
			let Some(node_id) = block["arguments"]["nodeId"].as_str().filter(|id| ids.contains(id)) else { continue };
			if stays.last() != Some(&node_id) {
				stays.push(node_id);
			}
		}
	}
	let current = stays.last().map(|s| (*s).to_owned());
	let visited = stays[..stays.len().saturating_sub(1)].iter().map(|s| (*s).to_owned()).collect();
	PlanStatuses { current, visited }
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn call(name: &str, node: &str) -> Json {
		json!({ "role": "assistant", "content": [{ "type": "toolCall", "name": name, "arguments": { "nodeId": node } }] })
	}

	#[test]
	fn latest_tag_is_current_and_earlier_ones_visited() {
		let tree = json!({ "nodes": [{ "id": "a" }, { "id": "b" }, { "id": "c" }], "edges": [] });
		let messages = [call("quiz", "a"), call("quiz", "a"), call("explain", "b"), call("quiz", "zzz"), call("read", "c"), call("problem", "a")];
		let s = derive_plan_statuses_lh(&tree, &messages);
		assert_eq!(s.current.as_deref(), Some("a"));
		assert_eq!(derived_node_status(&s, "a"), "current");
		assert_eq!(derived_node_status(&s, "b"), "visited");
		assert_eq!(derived_node_status(&s, "c"), "upcoming");
		assert!(derive_plan_statuses_lh(&tree, &[]).current.is_none());
	}
}
