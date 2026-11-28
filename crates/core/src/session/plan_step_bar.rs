//! The step bar's count over the native record
//! ("2 / 4"). The plan's steps are counted in learning order, each with its derived status.

use std::collections::HashMap;

use gs_json::Json;

use super::plan::{derive_plan_statuses_lh, derived_node_status};
use crate::study::topic_end::opener_nodes;

fn id_of(node: &Json) -> &str {
	node["id"].str_or_empty()
}

/// Plan node ids in learning order: prerequisites first, ties in authored order. A malformed
/// tree (a cycle) keeps the rest in authored order. A duplicated id resolves to its last node.
pub(crate) fn ordered_plan_ids(tree: &Json) -> Vec<&str> {
	let nodes: &[Json] = tree["nodes"].items();
	let index: HashMap<&str, usize> = nodes.iter().enumerate().map(|(i, n)| (id_of(n), i)).collect();
	let mut indegree: HashMap<&str, usize> = nodes.iter().map(|n| (id_of(n), 0)).collect();
	let mut next: HashMap<&str, Vec<&str>> = HashMap::new();
	for edge in tree["edges"].items().iter() {
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

/// The first plan node before `node_id` in learning order that nothing in the record tagged (a
/// shown opener's question counts): a first tagged call on `node_id` skips it. None once
/// `node_id` itself is tagged, or when it is in no plan.
pub fn skipped_node(tree: &Json, messages: &[Json], node_id: &str) -> Option<String> {
	let order = ordered_plan_ids(tree);
	let at = order.iter().position(|id| *id == node_id)?;
	let statuses = derive_plan_statuses_lh(tree, messages, &opener_nodes(messages));
	let tagged = |id: &str| statuses.current.as_deref() == Some(id) || statuses.visited.contains(id);
	if tagged(node_id) {
		return None;
	}
	order[..at].iter().find(|id| !tagged(id)).map(|id| (*id).to_owned())
}

/// The step bar's count: the current step's number, or the steps done while none is current.
pub fn step_position(statuses: &[&str]) -> usize {
	statuses.iter().position(|s| *s == "current").map_or_else(|| statuses.iter().filter(|s| **s == "visited").count(), |i| i + 1)
}

/// What the step bar shows: the steps it ticks, how many steps there are, the current step's
/// number and its title.
pub struct StepBar {
	pub done: usize,
	pub total: usize,
	pub step: usize,
	/// None before the first tagged call or when the current step has no title.
	pub current_title: Option<Json>,
}

/// The step bar over the native record, from one derivation of the plan's statuses. A shown
/// opener's question moves it, as it does in the window. It ticks the visited steps, and the
/// current one when it is `finished` (the topic of the stop the lesson waits at or ended on).
pub fn step_bar(tree: &Json, messages: &[Json], finished: Option<&str>) -> StepBar {
	let derived = derive_plan_statuses_lh(tree, messages, &opener_nodes(messages));
	let order = ordered_plan_ids(tree);
	let statuses: Vec<&str> = order.iter().map(|id| derived_node_status(&derived, id)).collect();
	let done = order
		.iter()
		.zip(&statuses)
		.filter(|(id, status)| match **status {
			"visited" => true,
			"current" => finished == Some(**id),
			_ => false,
		})
		.count();
	let current = derived.current.as_deref().and_then(|current| tree["nodes"].as_arr()?.iter().find(|n| id_of(n) == current));
	StepBar { done, total: statuses.len(), step: step_position(&statuses), current_title: current.and_then(|node| node["title"].as_str().filter(|t| !t.is_empty())).map(Json::from) }
}

/// The current step's node id, which is its topic's id.
pub fn current_step_id(tree: &Json, messages: &[Json]) -> Option<String> {
	derive_plan_statuses_lh(tree, messages, &opener_nodes(messages)).current
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
		let count = |messages: &[Json]| {
			let bar = step_bar(&tree, messages, None);
			(bar.step, bar.total)
		};
		assert_eq!(count(&[]), (0, 3));
		assert_eq!(count(&[call("a"), call("b")]), (2, 3));
		assert_eq!(step_position(&["visited", "upcoming", "visited"]), 2);
	}

	#[test]
	fn the_ticked_count_is_the_visited_steps_and_the_current_one_once_finished() {
		let tree = json!({ "nodes": [{ "id": "a" }, { "id": "b" }, { "id": "c" }], "edges": [] });
		let done = |messages: &[Json], finished: Option<&str>| step_bar(&tree, messages, finished).done;
		assert_eq!(done(&[], None), 0);
		assert_eq!(done(&[call("a"), call("c")], None), 1, "c is under way");
		assert_eq!(done(&[call("a"), call("c")], Some("c")), 2, "c's topic stopped");
		assert_eq!(done(&[call("a"), call("c")], Some("a")), 1, "only the current step finishes this way");
		assert_eq!(done(&[call("c"), call("a")], None), 1, "a step behind the current one in learning order still counts");
	}

	#[test]
	fn a_first_call_on_a_node_skips_the_earlier_untagged_ones() {
		let tree = json!({ "nodes": [{ "id": "c" }, { "id": "a" }, { "id": "b" }], "edges": [{ "from": "a", "to": "c" }] });
		assert_eq!(skipped_node(&tree, &[], "a"), None, "the first node skips nothing");
		assert_eq!(skipped_node(&tree, &[], "b").as_deref(), Some("a"), "learning order, prerequisites first");
		assert_eq!(skipped_node(&tree, &[call("a")], "b").as_deref(), Some("c"));
		assert_eq!(skipped_node(&tree, &[call("a"), call("c")], "b"), None);
		assert_eq!(skipped_node(&tree, &[call("b")], "b"), None, "a node already tagged goes on");
		assert_eq!(skipped_node(&tree, &[], "zz"), None);
	}

	#[test]
	fn the_current_step_title_needs_a_tagged_call_and_a_title() {
		let tree = json!({ "nodes": [{ "id": "a", "title": "Regularization" }, { "id": "b", "title": "" }], "edges": [] });
		let title = |messages: &[Json]| step_bar(&tree, messages, None).current_title;
		assert_eq!(title(&[]), None);
		assert_eq!(title(&[call("a")]), Some(json!("Regularization")));
		assert_eq!(title(&[call("a"), call("b")]), None);
		assert_eq!(title(&[call("zz")]), None);
		assert_eq!(current_step_id(&tree, &[call("b")]).as_deref(), Some("b"));
	}
}
