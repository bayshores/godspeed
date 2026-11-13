//! Parity with Node for the knowledge-graph logic: tests/golden/graph.json (recorded from the Node server) holds `{ op, input,
//! expected }` per case. Each op replays on the input and must give `expected`, key order
//! included. Seed-data outputs are digests (`$sha`, `$len`) of the JSON text.

mod compare;
mod ledgers;
mod ops_clusters;
mod ops_coverage;
mod ops_deletion;
mod ops_merge;
mod ops_reads;
mod ops_topics;

use std::panic::{AssertUnwindSafe, catch_unwind};

use gs_json::{Json, parse};

fn replay(op: &str, input: &Json) -> Json {
	match op {
		"get_graph" | "derive_view" | "snapshot" | "session_index" | "simplify" => ops_reads::run(op, input),
		"resolve_topics" | "repair_topics" | "topic_names" => ops_topics::run(op, input),
		"chains_selection" | "resolve_target" | "format_chain_line" | "session_clusters" | "session_clusters_ledgers" => ops_clusters::run(op, input),
		"coverage" => ops_coverage::run(input),
		"delete_chats" | "delete_nodes" => ops_deletion::run(op, input),
		"merge" => ops_merge::run(input),
		other => panic!("unknown op {other}"),
	}
}

#[test]
fn graph_logic_matches_node() {
	let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/graph.json")).unwrap();
	let golden = parse(&text).unwrap();
	let cases = golden.as_arr().unwrap();
	assert!(cases.len() > 100, "only {} cases", cases.len());
	let mut failures = Vec::new();
	for case in cases {
		let name = case["name"].as_str().unwrap();
		let output = &case["output"];
		if let Some(error) = case["error"].as_str() {
			failures.push(format!("{name}: the TypeScript threw {error}"));
			continue;
		}
		let op = output["op"].as_str().unwrap();
		match catch_unwind(AssertUnwindSafe(|| replay(op, &output["input"]))) {
			Ok(got) => {
				if let Some(diff) = compare::diff(&output["expected"], &got) {
					failures.push(format!("{name}: {diff}"));
				}
			}
			Err(_) => failures.push(format!("{name}: the Rust side panicked")),
		}
	}
	assert!(failures.is_empty(), "{} of {} cases differ:\n{}", failures.len(), cases.len(), failures.iter().take(25).cloned().collect::<Vec<_>>().join("\n"));
}
