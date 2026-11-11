//! The destructive operations on the append-only
//! graph ledgers. Pure over the store port, deterministic and idempotent; the caller owns the
//! cross-store choreography (chat record, jobs, extraction wind-down) and holds the graph's lock,
//! since each deletion reads and then replaces whole ledgers.
//!
//! A node lives while any surviving reference remains (a provenance point from another chat or
//! source, or a chain another source still asserts). The create line of a surviving node keeps
//! its identity (name, statement, createdAt) but loses the deleted session's phrasings and points.

use std::collections::HashSet;

use gs_json::{Json, json};

use super::ledger_lines::{strs, touches};
use super::ports::{GraphStore, LedgerRewrite};

/// Whether the graph keeps what a deleted chat taught.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ChatDeleteMode {
	/// Only the chat's extraction bookkeeping (coverage and checkpoint rows) dies.
	PreserveGraph,
	/// Every trace of the chat leaves the ledgers, and orphaned nodes die.
	DeleteNodes,
}

/// What one deletion removed from the ledgers.
#[derive(Default, Debug, PartialEq, Eq)]
pub struct ChatDeletionStats {
	/// Distinct nodes that died entirely (all their lines).
	pub nodes_removed: usize,
	/// Chain assertion lines removed.
	pub chains_removed: usize,
	pub coverage_removed: usize,
	pub checkpoints_removed: usize,
}

impl ChatDeletionStats {
	pub fn to_json(&self) -> Json {
		json!({
			"nodesRemoved": self.nodes_removed,
			"chainsRemoved": self.chains_removed,
			"coverageRemoved": self.coverage_removed,
			"checkpointsRemoved": self.checkpoints_removed,
		})
	}
}

/// What one single-node (or single-argument) deletion removed.
#[derive(Debug, PartialEq, Eq)]
pub struct NodeDeletionStats {
	/// Chain assertion lines removed (every chain referencing the node).
	pub chains_removed: usize,
}

/// Whether a line holds a point from some other source.
fn survives(line: &Json, chat_id: &str) -> bool {
	line["provenance"].as_arr().into_iter().flatten().any(|pt| pt["chatId"].as_str() != Some(chat_id))
}

/// The line's points that are not this chat's.
fn points_without(line: &Json, chat_id: &str) -> Vec<Json> {
	line["provenance"].as_arr().into_iter().flatten().filter(|pt| pt["chatId"].as_str() != Some(chat_id)).cloned().collect()
}

fn point_count(line: &Json) -> usize {
	line["provenance"].as_arr().map_or(0, Vec::len)
}

/// A copy of the line with some fields replaced in place (object spread keeps key positions).
fn with_fields(line: &Json, fields: impl IntoIterator<Item = (&'static str, Json)>) -> Json {
	let mut out = line.clone();
	if let Some(obj) = out.as_obj_mut() {
		for (key, value) in fields {
			obj.insert(key, value);
		}
	}
	out
}

/// The chain's conclusion followed by its premises.
fn members_of(chain: &Json) -> Vec<&str> {
	let mut ids: Vec<&str> = chain["conclusion"].as_str().into_iter().collect();
	ids.extend(strs(&chain["premises"]));
	ids
}

/// Removes one chat's traces from the graph ledgers. Idempotent: a second run finds nothing and
/// returns zero stats.
pub fn delete_chat_traces(store: &dyn GraphStore, chat_id: &str, mode: ChatDeleteMode) -> Result<ChatDeletionStats, String> {
	// The bookkeeping rows die in both modes.
	let all_coverage = store.read_coverage()?;
	let all_checkpoints = store.read_checkpoints()?;
	let keep = |rows: &[Json]| -> Vec<Json> { rows.iter().filter(|row| row["chatId"].as_str() != Some(chat_id)).cloned().collect() };
	let (coverage, checkpoints) = (keep(&all_coverage), keep(&all_checkpoints));
	let mut stats = ChatDeletionStats { coverage_removed: all_coverage.len() - coverage.len(), checkpoints_removed: all_checkpoints.len() - checkpoints.len(), ..ChatDeletionStats::default() };
	let bookkeeping = || LedgerRewrite { coverage: Some(coverage.clone()), checkpoints: Some(checkpoints.clone()), ..LedgerRewrite::default() };
	let bookkeeping_changed = stats.coverage_removed > 0 || stats.checkpoints_removed > 0;

	let node_lines = if mode == ChatDeleteMode::DeleteNodes { store.read_nodes()? } else { Vec::new() };
	let chain_lines = if mode == ChatDeleteMode::DeleteNodes { store.read_chains()? } else { Vec::new() };
	// A chat that never touched the graph needs no node or chain rewrite, which keeps the graph
	// revision still.
	let touched = node_lines.iter().chain(&chain_lines).any(|line| touches(line, chat_id));
	if !touched {
		if bookkeeping_changed {
			store.rewrite_ledgers(bookkeeping())?;
		}
		return Ok(stats);
	}

	// 1. Survival. A node this deletion never touches stays.
	let node_ids: HashSet<&str> = node_lines.iter().filter_map(|line| line["id"].as_str()).collect();
	let mut touched_nodes: HashSet<&str> = HashSet::new();
	for line in &node_lines {
		if touches(line, chat_id) {
			touched_nodes.extend(line["id"].as_str());
		}
	}
	for line in chain_lines.iter().filter(|line| touches(line, chat_id)) {
		touched_nodes.extend(members_of(line));
	}
	let mut live: HashSet<&str> = node_ids.iter().copied().filter(|id| !touched_nodes.contains(id)).collect();
	for line in node_lines.iter().filter(|line| survives(line, chat_id)) {
		live.extend(line["id"].as_str());
	}
	for line in chain_lines.iter().filter(|line| survives(line, chat_id)) {
		live.extend(members_of(line).into_iter().filter(|id| node_ids.contains(id)));
	}

	// 2. Node lines, one extraction run's append each.
	let mut out_nodes: Vec<Json> = Vec::new();
	let mut seen_ids: HashSet<&str> = HashSet::new();
	for line in &node_lines {
		let Some(id) = line["id"].as_str().filter(|id| live.contains(id)) else { continue };
		let first = seen_ids.insert(id);
		let points = points_without(line, chat_id);
		if points.len() == point_count(line) {
			out_nodes.push(line.clone());
		} else if !points.is_empty() {
			out_nodes.push(with_fields(line, [("provenance", Json::from(points))]));
		} else if first {
			out_nodes.push(with_fields(line, [("provenance", json!([])), ("aliases", json!([]))]));
		}
		// else: the deleted chat's link line dies with its phrasings.
	}

	// 3. Chains: strip the chat's points. An assertion dies when this deletion empties its
	//    provenance or kills any member; a chain naming nodes that never existed is foreign data.
	let dead_nodes: HashSet<&str> = node_ids.iter().copied().filter(|id| !live.contains(id)).collect();
	let mut out_chains: Vec<Json> = Vec::new();
	for line in &chain_lines {
		if members_of(line).iter().any(|id| dead_nodes.contains(id)) {
			continue;
		}
		let points = points_without(line, chat_id);
		if point_count(line) > 0 && points.is_empty() {
			continue;
		}
		out_chains.push(if points.len() == point_count(line) { line.clone() } else { with_fields(line, [("provenance", Json::from(points))]) });
	}

	stats.nodes_removed = dead_nodes.len();
	stats.chains_removed = chain_lines.len() - out_chains.len();
	store.rewrite_ledgers(LedgerRewrite { nodes: Some(out_nodes), chains: Some(out_chains), coverage: Some(coverage), checkpoints: Some(checkpoints) })?;
	Ok(stats)
}

/// Removes one imported-notes source's traces: the file twin of a chat's delete-nodes. The source
/// record goes too.
pub fn delete_source_traces(store: &dyn GraphStore, source_id: &str) -> Result<ChatDeletionStats, String> {
	if !source_id.starts_with("src_") {
		return Err(format!("Not a notes source id: {source_id}"));
	}
	let stats = delete_chat_traces(store, source_id, ChatDeleteMode::DeleteNodes)?;
	store.remove_source(source_id)?;
	Ok(stats)
}

/// Full death for one node by id (or one argument by its arg_ id): every line of the node and
/// every chain that names it die, whatever session asserted them. None when nothing matches.
pub fn delete_node_traces(store: &dyn GraphStore, node_id: &str) -> Result<Option<NodeDeletionStats>, String> {
	let chain_lines = store.read_chains()?;

	// An arg_ id names a chain: its lines die and the member propositions survive.
	if node_id.starts_with("arg_") {
		let out_chains: Vec<Json> = chain_lines.iter().filter(|line| line["id"].as_str() != Some(node_id)).cloned().collect();
		if out_chains.len() == chain_lines.len() {
			return Ok(None);
		}
		let removed = chain_lines.len() - out_chains.len();
		store.rewrite_ledgers(LedgerRewrite { chains: Some(out_chains), ..LedgerRewrite::default() })?;
		return Ok(Some(NodeDeletionStats { chains_removed: removed }));
	}

	let node_lines = store.read_nodes()?;
	let out_nodes: Vec<Json> = node_lines.iter().filter(|line| line["id"].as_str() != Some(node_id)).cloned().collect();
	if out_nodes.len() == node_lines.len() {
		return Ok(None);
	}
	let out_chains: Vec<Json> = chain_lines.iter().filter(|line| !members_of(line).contains(&node_id)).cloned().collect();
	let removed = chain_lines.len() - out_chains.len();
	// Only the touched ledgers: the node's own file always moves, chains only when rows dropped.
	let chains = (removed > 0).then_some(out_chains);
	store.rewrite_ledgers(LedgerRewrite { nodes: Some(out_nodes), chains, ..LedgerRewrite::default() })?;
	Ok(Some(NodeDeletionStats { chains_removed: removed }))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::graph::memory::{Memory, chain, node};

	fn store() -> Memory {
		let memory = Memory::with(
			vec![node("n_a", "Alpha", &["c1"]), node("n_b", "Beta", &["c1", "c2"]), node("n_c", "Gamma", &["c2"])],
			vec![chain("arg_1", &["n_a", "n_b"], "n_c", &["c1"]), chain("arg_2", &["n_b"], "n_c", &["c2"])],
		);
		{
			let mut ledgers = memory.ledgers.lock().unwrap();
			ledgers.coverage = vec![json!({ "chatId": "c1", "fp": "x" }), json!({ "chatId": "c2", "fp": "y" })];
			ledgers.checkpoints = vec![json!({ "chatId": "c1" })];
			ledgers.sources = vec![json!({ "id": "src_f", "filePath": "a.pdf" })];
		}
		memory
	}

	fn stats(nodes: usize, chains: usize, coverage: usize, checkpoints: usize) -> ChatDeletionStats {
		ChatDeletionStats { nodes_removed: nodes, chains_removed: chains, coverage_removed: coverage, checkpoints_removed: checkpoints }
	}

	#[test]
	fn preserving_the_graph_drops_only_the_bookkeeping() {
		let memory = store();
		assert_eq!(delete_chat_traces(&memory, "c1", ChatDeleteMode::PreserveGraph).unwrap(), stats(0, 0, 1, 1));
		assert_eq!(memory.read_nodes().unwrap().len(), 3);
		assert_eq!(*memory.rewrites.lock().unwrap(), [vec!["coverage", "checkpoints"]]);
	}

	#[test]
	fn deleting_nodes_keeps_what_another_lesson_still_holds() {
		let memory = store();
		assert_eq!(delete_chat_traces(&memory, "c1", ChatDeleteMode::DeleteNodes).unwrap(), stats(1, 1, 1, 1));
		let nodes = memory.read_nodes().unwrap();
		assert_eq!(nodes.iter().map(|n| n["id"].as_str().unwrap()).collect::<Vec<_>>(), ["n_b", "n_c"]);
		assert_eq!(nodes[0]["provenance"], json!([{ "chatId": "c2", "messageId": "" }]));
		assert_eq!(memory.chains().iter().map(|c| c["id"].as_str().unwrap()).collect::<Vec<_>>(), ["arg_2"]);
		// A second run finds nothing.
		assert_eq!(delete_chat_traces(&memory, "c1", ChatDeleteMode::DeleteNodes).unwrap(), stats(0, 0, 0, 0));
		assert_eq!(memory.rewrites.lock().unwrap().len(), 1);
	}

	#[test]
	fn a_notes_source_goes_with_its_record() {
		let memory = store();
		assert!(delete_source_traces(&memory, "c1").unwrap_err().contains("Not a notes source id: c1"));
		assert_eq!(delete_source_traces(&memory, "src_f").unwrap(), stats(0, 0, 0, 0));
		assert!(memory.read_sources().unwrap().is_empty());
	}

	#[test]
	fn one_node_takes_every_chain_naming_it() {
		let memory = store();
		assert_eq!(delete_node_traces(&memory, "n_zzz").unwrap(), None);
		assert_eq!(delete_node_traces(&memory, "arg_zzz").unwrap(), None);
		assert!(memory.rewrites.lock().unwrap().is_empty());
		assert_eq!(delete_node_traces(&memory, "arg_1").unwrap(), Some(NodeDeletionStats { chains_removed: 1 }));
		assert_eq!(delete_node_traces(&memory, "n_b").unwrap(), Some(NodeDeletionStats { chains_removed: 1 }));
		assert_eq!(*memory.rewrites.lock().unwrap(), [vec!["chains"], vec!["nodes", "chains"]]);
		assert!(memory.chains().is_empty());
	}
}
