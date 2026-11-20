//! The graph reads and single-node deletion (server/graph.ts): the home view, its cost pill, the
//! revision stamp, the graph search, and deleting one node with everything that names it.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use gs_agent::extraction::extraction_runs::RunKind;
use gs_agent::extraction::ledgers::ScopedGraph;
use gs_base::config::GraphFiles;
use gs_base::locks::LockKey;
use gs_base::{fsx, locale, text};
use gs_core::graph::chains::format_chain_line;
use gs_core::graph::graph::{get_graph, graph_snapshot};
use gs_core::graph::graph_deletion::{ChatDeleteMode, ChatDeletionStats, delete_chat_traces, delete_node_traces};
use gs_core::graph::ports::{GraphDeps, GraphStore};
use gs_core::session::cost_summary::graph_cost_summary;
use gs_core::study::progress::{fact_from, fact_mark};
use gs_json::{Json, json};

use super::extraction_runs::runs;
use super::progress::progress_for;
use crate::App;

/// A fact's `asked` in the graph search when no answer of his counts for it.
const NEVER_ASKED: &str = "never";

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

/// One scope's facts for `query` (newest first without one), at most `limit`, each with where it
/// comes from and the learner's latest answer on it, and the chains whose conclusion or a premise
/// is among them, at most `limit` too.
pub async fn search_graph(app: &App, scope: Option<&str>, query: Option<&str>, limit: usize) -> Result<Json, String> {
	let graph = get_graph(graph_store_for(app, scope).as_ref())?;
	let found: Vec<&Json> = match query.filter(|q| !text::trim(q).is_empty()) {
		Some(query) => {
			let by_id: HashMap<&str, &Json> = graph.nodes.iter().map(|n| (n["id"].str_or_empty(), n)).collect();
			let ids = app.search.search_facts(scope, &graph.nodes, query, limit).await?;
			ids.iter().filter_map(|id| by_id.get(id.as_str()).copied()).collect()
		}
		None => {
			let mut newest: Vec<&Json> = graph.nodes.iter().collect();
			newest.sort_by(|a, b| locale::compare(b["createdAt"].str_or_empty(), a["createdAt"].str_or_empty()));
			newest.truncate(limit);
			newest
		}
	};
	let picked: HashSet<&str> = found.iter().filter_map(|n| n["id"].as_str()).collect();
	let names: HashMap<String, String> = graph.nodes.iter().filter_map(|n| Some((n["id"].as_str()?.to_owned(), n["name"].as_str()?.to_owned()))).collect();
	let chains: Vec<String> = graph
		.chains
		.iter()
		.filter_map(|c| {
			let premises: Vec<&str> = c["premises"].items().iter().filter_map(Json::as_str).collect();
			let conclusion = c["conclusion"].str_or_empty();
			(picked.contains(conclusion) || premises.iter().any(|p| picked.contains(p))).then(|| format_chain_line(&premises, conclusion, &names))
		})
		.take(limit)
		.collect();
	// The graph holds what files and lessons say, not what he knows: his answers say that.
	let progress = if found.is_empty() { None } else { Some(progress_for(app, scope, None)?.ok_or("No such space")?) };
	let rows: HashMap<&str, &Json> = progress.iter().flat_map(|p| p["facts"].items()).filter_map(|f| Some((f["id"].as_str()?, f))).collect();
	let facts: Vec<Json> = found
		.iter()
		.map(|n| {
			let asked = rows.get(n["id"].str_or_empty()).and_then(|row| fact_mark(row)).unwrap_or(NEVER_ASKED);
			json!({ "id": n["id"], "name": n["name"], "statement": n["statement"], "from": fact_from(n), "asked": asked })
		})
		.collect();
	Ok(json!({ "totalFacts": graph.nodes.len(), "facts": facts, "chains": chains }))
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
		.filter_map(|file| std::fs::metadata(file).ok())
		.map(|meta| fsx::modified_ms(&meta))
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
			error: "Godspeed is still adding to your graph. Try again when nothing is left under Running in the background in the teacher's Activity.",
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

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	fn node(id: &str, at: &str) -> Json {
		json!({ "id": id, "name": id.to_uppercase(), "statement": format!("{id} holds."), "aliases": [], "createdAt": at, "provenance": [] })
	}

	#[tokio::test]
	async fn search_without_a_query_gives_the_newest_facts_and_caps_the_chains() {
		let root = scratch_dir("search-graph");
		let app = test_app(&root);
		let empty = json!({ "totalFacts": 0, "facts": [], "chains": [] });
		assert_eq!(search_graph(&app, None, None, 8).await.unwrap(), empty);
		assert_eq!(search_graph(&app, None, Some("limits"), 8).await.unwrap(), empty);

		let store = graph_store_for(&app, None);
		for (id, at) in [("a", "2026-01-01T00:00:00.000Z"), ("c", "2026-01-03T00:00:00.000Z"), ("b", "2026-01-02T00:00:00.000Z"), ("d", "2025-12-31T00:00:00.000Z")] {
			store.append_node(&node(id, at)).unwrap();
		}
		// arg_3 touches neither picked fact; arg_4 does but is past the cap.
		for (id, premises, conclusion) in [("arg_1", vec!["b", "a"], "c"), ("arg_2", vec!["a"], "b"), ("arg_3", vec!["d"], "a"), ("arg_4", vec!["c"], "a")] {
			store.append_chain(&json!({ "id": id, "premises": premises, "conclusion": conclusion, "createdAt": "2026-01-04T00:00:00.000Z", "provenance": [] })).unwrap();
		}
		let found = search_graph(&app, None, None, 2).await.unwrap();
		assert_eq!(found["totalFacts"], json!(4));
		let fact = |id: &str| json!({ "id": id, "name": id.to_uppercase(), "statement": format!("{id} holds."), "from": "files", "asked": "never" });
		assert_eq!(found["facts"], json!([fact("c"), fact("b")]));
		assert_eq!(found["chains"], json!(["A, B → C", "A → B"]));
		assert_eq!(search_graph(&app, None, Some("  "), 2).await.unwrap(), found);
	}

	#[tokio::test]
	async fn a_found_fact_says_where_it_comes_from_and_his_latest_answer_on_it() {
		let root = scratch_dir("search-graph-marks");
		let app = test_app(&root);
		let chat = app.stores.chats.create_chat("Limits", Some("study"), None, None).unwrap();
		let chat_id = chat["id"].as_str().unwrap();
		app.stores.chats
			.save_messages(chat_id, &[
				json!({ "role": "assistant", "id": "m1", "content": [{ "type": "toolCall", "id": "q1", "name": "quiz", "arguments": { "type": "check", "nodeId": "limits", "question": "Does it converge?" } }], "timestamp": 1 }),
				json!({ "role": "toolResult", "toolCallId": "q1", "toolName": "quiz", "details": { "kind": "quiz", "correct": false }, "isError": false, "timestamp": 2 }),
			])
			.unwrap();
		let store = graph_store_for(&app, None);
		let mut asked = node("asked", "2026-01-02T00:00:00.000Z");
		asked.as_obj_mut().unwrap().insert("provenance", json!([{ "chatId": "src_notes", "messageId": "" }, { "chatId": chat_id, "messageId": "m1" }]));
		store.append_node(&asked).unwrap();
		let mut read = node("read", "2026-01-01T00:00:00.000Z");
		read.as_obj_mut().unwrap().insert("provenance", json!([{ "chatId": "src_notes", "messageId": "" }]));
		store.append_node(&read).unwrap();
		let found = search_graph(&app, None, None, 8).await.unwrap();
		let marks: Vec<(&str, &str, &str)> = found["facts"].items().iter().map(|f| (f["id"].str_or_empty(), f["from"].str_or_empty(), f["asked"].str_or_empty())).collect();
		assert_eq!(marks, [("asked", "both", "wrong"), ("read", "files", "never")], "a fact only read in a file is not one he holds");
	}
}
