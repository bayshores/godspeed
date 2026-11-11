//! Deleting a lesson's, a notes file's or one fact's traces from the ledgers.

use gs_core::graph::graph_deletion::{ChatDeleteMode, delete_chat_traces, delete_node_traces, delete_source_traces};
use gs_json::{Json, json};

use crate::ledgers::Ledgers;

fn error(message: String) -> Json {
	json!({ "error": message })
}

fn chat_step(store: &crate::store::MemStore, step: &Json) -> Json {
	let id = step["id"].as_str().unwrap();
	let result = if step["kind"].as_str() == Some("source") {
		delete_source_traces(store, id)
	} else {
		let mode = match step["mode"].as_str() {
			Some("preserve-graph") => ChatDeleteMode::PreserveGraph,
			Some("delete-nodes") => ChatDeleteMode::DeleteNodes,
			other => panic!("unknown mode {other:?}"),
		};
		delete_chat_traces(store, id, mode)
	};
	result.map_or_else(error, |stats| stats.to_json())
}

pub fn run(op: &str, input: &Json) -> Json {
	let store = Ledgers::load(&input["ledgers"]).store();
	let results: Json = if op == "delete_chats" {
		input["steps"].as_arr().unwrap().iter().map(|step| chat_step(&store, step)).collect()
	} else {
		input["ids"]
			.as_arr()
			.unwrap()
			.iter()
			.map(|id| match delete_node_traces(&store, id.as_str().unwrap()) {
				Ok(Some(stats)) => json!({ "chainsRemoved": stats.chains_removed }),
				Ok(None) => Json::Null,
				Err(message) => error(message),
			})
			.collect()
	};
	json!({ "results": results, "rewrites": store.rewrite_log(), "ledgers": store.marks() })
}
