//! The ledger reads: merged graph, canvas view, snapshot and chain simplification.

use gs_core::graph::graph::{derive_view, get_graph, graph_snapshot, simplify_chains};
use gs_core::graph::ports::GraphDeps;
use gs_json::{Json, json};

use crate::ledgers::Ledgers;

pub fn run(op: &str, input: &Json) -> Json {
	if op == "simplify" && input.get("lines").is_some() {
		return Json::from(simplify_chains(input["lines"].as_arr().unwrap()));
	}
	let ledgers = Ledgers::load(&input["ledgers"]);
	let (store, chats) = (ledgers.store(), ledgers.chats());
	let deps = GraphDeps { chat_store: &chats, graph_store: &store };
	match op {
		"get_graph" => {
			let g = get_graph(&store).unwrap();
			json!({ "nodes": g.nodes, "chains": g.chains })
		}
		"derive_view" => {
			let view = derive_view(&get_graph(&store).unwrap());
			json!({ "nodes": view.nodes, "edges": view.edges, "logicalEdges": view.logical_edges, "impLinks": view.imp_links })
		}
		"snapshot" => graph_snapshot(&deps).unwrap(),
		"simplify" => Json::from(simplify_chains(&ledgers.part("chains"))),
		other => panic!("not a read op: {other}"),
	}
}
