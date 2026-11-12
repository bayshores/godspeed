//! The graph reads and single-node deletion (server/graph.ts): the home view, its cost pill, the
//! revision stamp, and deleting one node with everything that names it.

use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use gs_agent::extraction::extraction_runs::RunKind;
use gs_agent::extraction::ledgers::ScopedGraph;
use gs_base::config::GraphFiles;
use gs_base::locks::LockKey;
use gs_core::graph::graph::graph_snapshot;
use gs_core::graph::graph_deletion::{ChatDeleteMode, ChatDeletionStats, delete_chat_traces, delete_node_traces};
use gs_core::graph::ports::{GraphDeps, GraphStore};
use gs_core::session::cost_summary::graph_cost_summary;
use gs_json::{Json, json};

use super::extraction_runs::runs;
use crate::App;

/// One scope's graph ledgers: None is "No space", a space id its own graph.
pub fn graph_store_for<'a>(app: &'a App, scope: Option<&'a str>) -> Box<dyn GraphStore + 'a> {
	Box::new(ScopedGraph::new(&app.stores.graphs, scope))
}

/// A lesson's facts and bookkeeping leave the scope's graph. The rewrite replaces whole ledgers
/// from what it read, so it holds the graph's lock: a merge appending meanwhile would be erased.
pub fn delete_chat_from_graph(app: &App, scope: Option<&str>, chat_id: &str, mode: ChatDeleteMode) -> Result<ChatDeletionStats, String> {
	let _held = app.locks.lock(LockKey::Graph(scope));
	delete_chat_traces(graph_store_for(app, scope).as_ref(), chat_id, mode)
}

/// Everything the graph view shows for one scope. A pure read: only extraction writes graphs.
pub fn graph_view(app: &App, scope: Option<&str>) -> Result<Json, String> {
	graph_snapshot(&GraphDeps { chat_store: app.stores.chats.as_ref(), graph_store: graph_store_for(app, scope).as_ref() })
}

/// The cost pill: what the graph pipeline spent, from the scope's lessons and imported notes.
pub fn graph_costs(app: &App, scope: Option<&str>) -> Result<Json, String> {
	let chats: Vec<Json> = app
		.stores
		.chats
		.list_chats()
		.iter()
		// A graph's costs are its own space's lessons only.
		.filter(|summary| summary["spaceId"].as_str() == scope)
		.filter_map(|summary| {
			let id = summary["id"].as_str()?;
			let record = app.stores.chats.get_chat(id)?;
			record["extractions"].as_arr().filter(|runs| !runs.is_empty())?;
			let title = record.get("title").filter(|t| !t.is_null()).cloned().unwrap_or_else(|| Json::from(id));
			Some(json!({ "title": title, "extractions": record["extractions"] }))
		})
		.collect();
	let sources: Vec<Json> = graph_store_for(app, scope)
		.read_sources()?
		.iter()
		.filter(|s| s["extractions"].as_arr().is_some_and(|runs| !runs.is_empty()))
		.map(|s| json!({ "filePath": s["filePath"], "extractions": s["extractions"] }))
		.collect();
	Ok(graph_cost_summary(&json!({ "chats": chats, "sources": sources })))
}

fn graph_dir_for(app: &App, scope: Option<&str>) -> Option<PathBuf> {
	match scope {
		None => Some(app.paths.graph.clone()),
		Some(space_id) => app.stores.spaces.graph_dir(space_id).ok(),
	}
}

/// The newest modified time (ms) of the scope's ledgers: it moves on any graph write and never on
/// a read. Deletions return it so the view knows to read again.
pub fn graph_revision(app: &App, scope: Option<&str>) -> f64 {
	let Some(dir) = graph_dir_for(app, scope) else { return 0.0 };
	let files = GraphFiles::new(&dir);
	[&files.nodes, &files.chains, &files.sessions, &files.coverage, &files.topics]
		.into_iter()
		.filter_map(|file| std::fs::metadata(file).and_then(|meta| meta.modified()).ok())
		.filter_map(|modified| modified.duration_since(UNIX_EPOCH).ok())
		.map(|d| d.as_secs() as f64 * 1e3 + f64::from(d.subsec_nanos()) / 1e6)
		.fold(0.0, f64::max)
}

/// Why a node deletion was refused: the status, a code and the message.
pub struct NodeDeleteRefusal {
	pub status: u16,
	pub code: &'static str,
	pub error: &'static str,
}

/// Deletes one node (or one `arg_` chain) and every chain naming it, in one ledger rewrite.
/// Refused while any extraction is registered: a run in flight could re-add to the dying node.
/// Topic grouping only reads facts, so it never blocks. `Ok(Ok({ stats, graphRevision }))`.
pub fn delete_graph_node(app: &App, node_id: &str, scope: Option<&str>) -> Result<Result<Json, NodeDeleteRefusal>, String> {
	if runs(app).statuses().iter().any(|run| run.kind != RunKind::Topics) {
		return Ok(Err(NodeDeleteRefusal {
			status: 409,
			code: "extraction_running",
			error: "Godspeed is still adding to your graph. Try again when Background jobs in the teacher's panel is empty.",
		}));
	}
	let deleted = {
		let _held = app.locks.lock(LockKey::Graph(scope));
		delete_node_traces(graph_store_for(app, scope).as_ref(), node_id)?
	};
	let Some(stats) = deleted else {
		return Ok(Err(NodeDeleteRefusal { status: 404, code: "not_found", error: "No such node" }));
	};
	Ok(Ok(json!({ "stats": { "chainsRemoved": stats.chains_removed }, "graphRevision": graph_revision(app, scope) })))
}
