//! The step bar's count over the native record
//! ("2 / 4"). The plan's steps are counted in learning order, each with its derived status.

use std::collections::HashMap;

use gs_json::{Json, Obj};

use super::plan::{derive_plan_statuses_lh, derived_node_status};
use crate::study::topic_end::opener_nodes;

fn id_of(node: &Json) -> &str {
	node["id"].as_str().unwrap_or_default()
}

/// Plan node ids in learning order: prerequisites first, ties in authored order. A malformed
/// tree (a cycle) keeps the rest in authored order. A duplicated id resolves to its last node.
pub(crate) fn ordered_plan_ids(tree: &Json) -> Vec<&str> {
	let nodes: &[Json] = tree["nodes"].as_arr().map_or(&[], Vec::as_slice);
	let index: HashMap<&str, usize> = nodes.iter().enumerate().map(|(i, n)| (id_of(n), i)).collect();
	let mut indegree: HashMap<&str, usize> = nodes.iter().map(|n| (id_of(n), 0)).collect();
	let mut next: HashMap<&str, Vec<&str>> = HashMap::new();
	for edge in tree["edges"].as_arr().into_iter().flatten() {
		let (Some(from), Some(to)) = (edge["from"].as_str(), edge["to"].as_str()) else { continue };
		if !index.contains_key(from) || !index.contains_key(to) {
			continue;
		}
		*indegree.entry(to).or_insert(0) += 1;
		next.entry(from).or_default().push(to);
	}
	let mut ready: Vec<&str> = nodes.iter().map(id_of).filter(|id| indegree[id] == 0).collect();
	let mut out: Vec<&str> = Vec::new();
	while !ready.is_empty() {
		ready.sort_by_key(|id| index[id]);
		let id = ready.remove(0);
		out.push(id);
		for &to in next.get(id).into_iter().flatten() {
			let degree = indegree.entry(to).or_insert(0);
			*degree = degree.wrapping_sub(1);
			if *degree == 0 {
				ready.push(to);
			}
		}
	}
	for node in nodes {
		if !out.contains(&id_of(node)) {
			out.push(id_of(node));
		}
	}
	out
}

/// The step bar's count: the current step's number, or the steps done while none is current.
pub fn step_position(statuses: &[&str]) -> usize {
	statuses.iter().position(|s| *s == "current").map_or_else(|| statuses.iter().filter(|s| **s == "visited").count(), |i| i + 1)
}

/// `planPositionLh`: `{done, total}` over the native record. A shown opener's question moves it,
/// as it does in the window.
pub fn plan_position_lh(tree: &Json, messages: &[Json]) -> Json {
	let derived = derive_plan_statuses_lh(tree, messages, &opener_nodes(messages));
	let statuses: Vec<&str> = ordered_plan_ids(tree).into_iter().map(|id| derived_node_status(&derived, id)).collect();
	let mut out = Obj::new();
	out.insert("done", step_position(&statuses) as f64);
	out.insert("total", statuses.len() as f64);
	Json::Obj(out)
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn call(node: &str) -> Json {
		json!({ "role": "assistant", "content": [{ "type": "toolCall", "name": "quiz", "arguments": { "nodeId": node } }] })
	}

	#[test]
	fn prerequisites_come_first_and_ties_keep_authored_order() {
		let tree = json!({ "nodes": [{ "id": "c" }, { "id": "a" }, { "id": "b" }, { "id": "d" }], "edges": [{ "from": "a", "to": "c" }, { "from": "zz", "to": "a" }] });
		assert_eq!(ordered_plan_ids(&tree), ["a", "c", "b", "d"]);
		let cycle = json!({ "nodes": [{ "id": "x" }, { "id": "y" }, { "id": "z" }], "edges": [{ "from": "x", "to": "y" }, { "from": "y", "to": "x" }] });
		assert_eq!(ordered_plan_ids(&cycle), ["z", "x", "y"]);
	}

	#[test]
	fn the_count_follows_the_current_step_or_the_visited_ones() {
		let tree = json!({ "nodes": [{ "id": "a" }, { "id": "b" }, { "id": "c" }], "edges": [] });
		assert_eq!(plan_position_lh(&tree, &[]), json!({ "done": 0, "total": 3 }));
		assert_eq!(plan_position_lh(&tree, &[call("a"), call("b")]), json!({ "done": 2, "total": 3 }));
		assert_eq!(step_position(&["visited", "upcoming", "visited"]), 2);
	}
}
