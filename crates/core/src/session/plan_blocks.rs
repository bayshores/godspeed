//! Ported from src/shared/core/plan-blocks.ts: the plan renders in flow once, at authoring, as a
//! frozen snapshot marker right after the turn that carried the successful plan_init call. Its
//! statuses are true at that instant; position afterwards derives live from the transcript.

use std::collections::HashSet;

use gs_base::time::iso_now;
use gs_json::{Json, Obj};

use super::plan::{derive_plan_statuses_lh, derived_node_status};
use crate::messages::native_messages::new_plan_block_message;

/// These fields of a record; a missing one stays missing, as `undefined` does in JSON.
fn pick(record: &Json, keys: &[&str]) -> Obj {
	keys.iter().filter_map(|&k| record.get(k).map(|v| (k, v.clone()))).collect()
}

/// The snapshot payload: statuses derived at emission time from the transcript's question calls
/// (results feed nothing). The block never re-derives.
fn snapshot(tree: &Json, messages: &[Json]) -> Json {
	let statuses = derive_plan_statuses_lh(tree, messages);
	let nodes: Json = tree["nodes"]
		.as_arr()
		.into_iter()
		.flatten()
		.map(|n| {
			let mut node = pick(n, &["id", "title"]);
			node.insert("status", derived_node_status(&statuses, n["id"].as_str().unwrap_or_default()));
			Json::Obj(node)
		})
		.collect();
	let edges: Json = tree["edges"].as_arr().into_iter().flatten().map(|e| Json::Obj(pick(e, &["from", "to"]))).collect();
	let mut out = Obj::new();
	out.insert("kind", "full");
	out.insert("at", iso_now());
	out.insert("current", statuses.current.map_or(Json::Null, Json::Str));
	out.insert("nodes", nodes);
	out.insert("edges", edges);
	Json::Obj(out)
}

/// The record's plan-block markers, keyed by the plan_init call they present: the set that makes
/// emission idempotent.
fn emitted_plan_block_calls(messages: &[Json]) -> HashSet<&str> {
	messages
		.iter()
		.filter(|m| m["role"].as_str() == Some("custom") && m["customType"].as_str() == Some("plan-block"))
		.filter_map(|m| m["details"]["planCallId"].as_str())
		.collect()
}

/// `planBlocksFor`: one plan-block marker per turn, for the turn's last successful plan_init call
/// that the record has not already emitted (a same-turn rewrite presents once; a later turn's
/// rewrite gets its own block). `tree` is the record's current tree, saved during the turn;
/// `transcript` is the full native transcript the status derivation reads.
pub fn plan_blocks_for(record: &[Json], new_messages: &[Json], tree: Option<&Json>, transcript: &[Json]) -> Vec<Json> {
	let Some(tree) = tree.filter(|t| t["nodes"].as_arr().is_some_and(|n| !n.is_empty())) else { return Vec::new() };
	let emitted = emitted_plan_block_calls(record);
	let last = new_messages
		.iter()
		.filter(|m| m["role"].as_str() == Some("toolResult") && m["toolName"].as_str() == Some("plan_init"))
		.filter(|m| m["details"]["ok"] == Json::Bool(true))
		.map(|m| m.get("toolCallId"))
		.rfind(|id| !id.and_then(Json::as_str).is_some_and(|id| emitted.contains(id)));
	last.map(|call_id| plan_block_marker(call_id, snapshot(tree, transcript))).into_iter().collect()
}

/// The marker for a call id as the result carried it: a result without one presents a block
/// without `planCallId`, and a non-string id is kept as it is.
fn plan_block_marker(call_id: Option<&Json>, block: Json) -> Json {
	let mut marker = new_plan_block_message("", block);
	if let Some(details) = marker.get_mut("details").and_then(Json::as_obj_mut) {
		match call_id {
			Some(id) => details.insert("planCallId", id.clone()),
			None => details.remove("planCallId"),
		};
	}
	marker
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn plan_result(call: &str, ok: bool) -> Json {
		json!({ "role": "toolResult", "toolName": "plan_init", "toolCallId": call, "details": { "ok": ok } })
	}

	#[test]
	fn the_turns_last_new_plan_init_is_presented_once() {
		let tree = json!({ "nodes": [{ "id": "a", "title": "A" }, { "id": "b", "title": "B" }], "edges": [{ "from": "a", "to": "b" }] });
		let marker = json!({ "role": "custom", "customType": "plan-block", "details": { "planCallId": "p2" } });
		let new = [plan_result("p1", true), plan_result("p2", true), plan_result("p3", false)];
		let blocks = plan_blocks_for(&[], &new, Some(&tree), &[]);
		assert_eq!(blocks.len(), 1);
		assert_eq!(blocks[0]["details"]["planCallId"].as_str(), Some("p2"));
		let block = &blocks[0]["details"]["block"];
		assert_eq!(block["kind"].as_str(), Some("full"));
		assert!(block["current"].is_null());
		assert_eq!(block["nodes"][1]["status"].as_str(), Some("upcoming"));
		assert_eq!(block["edges"][0]["to"].as_str(), Some("b"));
		let again = plan_blocks_for(&[marker], &new, Some(&tree), &[]);
		assert_eq!(again[0]["details"]["planCallId"].as_str(), Some("p1"));
		assert!(plan_blocks_for(&[], &new, Some(&json!({ "nodes": [], "edges": [] })), &[]).is_empty());
		assert!(plan_blocks_for(&[], &new, None, &[]).is_empty());
	}

	#[test]
	fn a_result_without_a_string_call_id_still_presents() {
		let tree = json!({ "nodes": [{ "id": "a", "title": "A" }], "edges": [] });
		let bare = json!({ "role": "toolResult", "toolName": "plan_init", "details": { "ok": true } });
		let numbered = json!({ "role": "toolResult", "toolName": "plan_init", "toolCallId": 5, "details": { "ok": true } });
		assert!(plan_blocks_for(&[], &[bare], Some(&tree), &[])[0]["details"].get("planCallId").is_none());
		assert_eq!(plan_blocks_for(&[], &[numbered], Some(&tree), &[])[0]["details"]["planCallId"].as_i64(), Some(5));
	}
}
