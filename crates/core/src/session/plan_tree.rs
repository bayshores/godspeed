//! Ported from src/shared/core/plan-tree.ts: the validated plan tree.
//!
//! Every failure is a message written for the agent, flowing straight back as a tool-result
//! error that says exactly what is wrong and which id or edge is at fault.
//!
//! Invariants: node ids are unique and non-empty; every edge endpoint is an existing node; the
//! structure is a DAG (no self-loops, no duplicate edges, no cycles).

use std::collections::{HashMap, HashSet};

use gs_base::text;
use gs_json::{Json, Obj};

use super::js_text::js_string;

fn assert_valid_node(node: &Json) -> Result<(), String> {
	let id = node["id"].as_str().filter(|id| !text::trim(id).is_empty());
	let Some(id) = id else {
		return Err("Every node needs a non-empty `id` (a stable slug like 'chain-rule-intuition').".to_owned());
	};
	if node["title"].as_str().is_none_or(|t| text::trim(t).is_empty()) {
		return Err(format!("Node \"{id}\" needs a non-empty `title`."));
	}
	Ok(())
}

fn require_node(ids: &HashSet<&str>, endpoint: Option<&Json>, what: &str) -> Result<(), String> {
	if endpoint.and_then(Json::as_str).is_some_and(|id| ids.contains(id)) {
		return Ok(());
	}
	Err(format!("{what} references unknown node id \"{}\" \u{2014} it is not in the tree.", js_string(endpoint)))
}

/// Would adding from-to close a loop? Walk forward from `to`; reaching `from` means yes.
fn creates_cycle(edges: &[(String, String)], from: &str, to: &str) -> bool {
	let mut adjacency: HashMap<&str, Vec<&str>> = HashMap::new();
	for (a, b) in edges {
		adjacency.entry(a).or_default().push(b);
	}
	let mut stack = vec![to];
	let mut seen: HashSet<&str> = HashSet::new();
	while let Some(current) = stack.pop() {
		if current == from {
			return true;
		}
		if !seen.insert(current) {
			continue;
		}
		stack.extend(adjacency.get(current).into_iter().flatten());
	}
	false
}

/// Full edge validation against the nodes and the edges accepted so far.
fn assert_valid_edge(edge: &Json, ids: &HashSet<&str>, accepted: &[(String, String)]) -> Result<(String, String), String> {
	require_node(ids, edge.get("from"), "Edge `from`")?;
	require_node(ids, edge.get("to"), "Edge `to`")?;
	let (Some(from), Some(to)) = (edge["from"].as_str(), edge["to"].as_str()) else { unreachable!("both endpoints were found among the node ids") };
	if from == to {
		return Err(format!("Edge \"{from}\" \u{2192} \"{to}\" is a self-loop \u{2014} a node can't require itself."));
	}
	if accepted.iter().any(|(a, b)| a == from && b == to) {
		return Err(format!("Edge \"{from}\" \u{2192} \"{to}\" already exists \u{2014} duplicate edges are not allowed."));
	}
	if creates_cycle(accepted, from, to) {
		return Err(format!(
			"Edge \"{from}\" \u{2192} \"{to}\" would create a cycle: \"{to}\" already leads (directly or transitively) back to \"{from}\". \"from\" must be understood before \"to\" \u{2014} the tree is a DAG."
		));
	}
	Ok((from.to_owned(), to.to_owned()))
}

/// `createTree(nodes, edges)`: the plan tree `{ nodes, edges }`, or the error text the
/// TypeScript throws for the first bad node or edge. Each edge is checked against the ones
/// already accepted, so a violation names the culprit edge.
pub fn create_tree(nodes: &[Json], edges: &[Json]) -> Result<Json, String> {
	let mut ids: HashSet<&str> = HashSet::new();
	for node in nodes {
		assert_valid_node(node)?;
		let id = node["id"].as_str().unwrap_or_default();
		if !ids.insert(id) {
			return Err(format!("Duplicate node id \"{id}\" \u{2014} node ids must be unique."));
		}
	}
	let mut accepted: Vec<(String, String)> = Vec::new();
	for edge in edges {
		let pair = assert_valid_edge(edge, &ids, &accepted)?;
		accepted.push(pair);
	}
	let mut out = Obj::new();
	out.insert("nodes", nodes.to_vec());
	out.insert(
		"edges",
		accepted
			.into_iter()
			.map(|(from, to)| {
				let mut e = Obj::new();
				e.insert("from", from);
				e.insert("to", to);
				Json::Obj(e)
			})
			.collect::<Json>(),
	);
	Ok(Json::Obj(out))
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;

	fn nodes() -> Vec<Json> {
		vec![json!({ "id": "a", "title": "A", "summary": "s" }), json!({ "id": "b", "title": "B" }), json!({ "id": "c", "title": "C" })]
	}

	#[test]
	fn builds_a_tree_and_keeps_extra_node_fields() {
		let tree = create_tree(&nodes(), &[json!({ "from": "a", "to": "b", "x": 1 }), json!({ "from": "b", "to": "c" })]).unwrap();
		assert_eq!(stringify(&tree), r#"{"nodes":[{"id":"a","title":"A","summary":"s"},{"id":"b","title":"B"},{"id":"c","title":"C"}],"edges":[{"from":"a","to":"b"},{"from":"b","to":"c"}]}"#);
	}

	#[test]
	fn every_failure_names_what_is_wrong() {
		let bad = |nodes: Vec<Json>, edges: Vec<Json>| create_tree(&nodes, &edges).unwrap_err();
		assert!(bad(vec![json!({ "id": " ", "title": "x" })], vec![]).starts_with("Every node needs a non-empty `id`"));
		assert_eq!(bad(vec![json!({ "id": "a", "title": "" })], vec![]), "Node \"a\" needs a non-empty `title`.");
		assert_eq!(bad(vec![json!({ "id": "a", "title": "x" }), json!({ "id": "a", "title": "y" })], vec![]), "Duplicate node id \"a\" \u{2014} node ids must be unique.");
		assert_eq!(bad(nodes(), vec![json!({ "from": "a", "to": "zz" })]), "Edge `to` references unknown node id \"zz\" \u{2014} it is not in the tree.");
		assert_eq!(bad(nodes(), vec![json!({ "to": "a" })]), "Edge `from` references unknown node id \"undefined\" \u{2014} it is not in the tree.");
		assert!(bad(nodes(), vec![json!({ "from": "a", "to": "a" })]).ends_with("is a self-loop \u{2014} a node can't require itself."));
		assert!(bad(nodes(), vec![json!({ "from": "a", "to": "b" }), json!({ "from": "a", "to": "b" })]).contains("already exists"));
		let cycle = bad(nodes(), vec![json!({ "from": "a", "to": "b" }), json!({ "from": "b", "to": "c" }), json!({ "from": "c", "to": "a" })]);
		assert!(cycle.starts_with("Edge \"c\" \u{2192} \"a\" would create a cycle: \"a\" already leads"));
	}
}
