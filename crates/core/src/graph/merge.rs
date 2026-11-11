//! The merger of src/shared/core/graph.ts (`mergeFindings`): the deterministic last stage of
//! extraction. The model supplies the judgment calls; ids, timestamps and provenance are rebuilt
//! here, and the ledgers are only ever appended to (plus the chain-simplification rewrite).

use std::collections::{HashMap, HashSet};

use gs_base::{ids, time};
use gs_json::{Json, Obj, json};

use super::ledger_lines::{chain_key, chain_key_of, strs, touches};
use super::ports::{GraphStore, LedgerRewrite};
use super::simplify::simplify_chains;

/// What one merge run merges from: the batch's coverage entries (a chat), or none (a notes
/// import), where the whole-file checkpoint stamps `folded_at` instead.
pub struct MergeSource {
	pub folded_at: String,
	pub coverage: Option<Vec<Json>>,
}

/// The run's provenance point list: chat-level unless a message id is given.
fn point_of(chat_id: &str, message_id: Option<&str>) -> Json {
	json!([{ "chatId": chat_id, "messageId": message_id.unwrap_or("") }])
}

/// A new line for an idea that already has a node: its first line's name and statement, no
/// phrasings, so reads add nothing new.
fn credit_line(id: &str, node: &Json, now: &str, provenance: Json) -> Json {
	json!({ "id": id, "name": node["name"], "statement": node["statement"], "aliases": [], "createdAt": now, "provenance": provenance })
}

/// The items of an array of strings, repeats dropped, in first-seen order.
fn unique<'a>(items: impl Iterator<Item = &'a str>) -> Vec<&'a str> {
	let mut seen = HashSet::new();
	items.filter(|item| seen.insert(*item)).collect()
}

/// Merges one job's findings into the graph ledgers. `chat_id` is the job's source key: a chat,
/// or a notes source ("src_..."). Returns `{ nodes, chains[, droppedChains] }`: what was
/// appended, and the chains the simplification pass removed.
///
/// New propositions always create nodes; `reteaches` ids naming an existing node append a
/// provenance line for this source once; each question's tested ideas get a point at the
/// question's message; chains resolve their endpoints through this job's propositions or pass
/// existing node ids through, and an argument this chat already asserted is skipped.
///
/// The caller holds this graph's lock: the simplification pass replaces the whole chain ledger.
pub fn merge_findings(chat_id: &str, findings: &Json, ledgers: &dyn GraphStore, source: &MergeSource) -> Result<Json, String> {
	let (mut node_count, mut chain_count) = (0, 0);

	// 1. Resolution: this job's propositions -> new graph node ids.
	let nodes = ledgers.read_nodes()?;
	let mut existing_ids: HashSet<String> = nodes.iter().filter_map(|n| n["id"].as_str().map(str::to_owned)).collect();
	let mut mapping: HashMap<String, String> = HashMap::new();
	let mut created: HashMap<String, Json> = HashMap::new();
	let now = time::iso_now();

	for p in findings["propositions"].as_arr().into_iter().flatten() {
		let local = p["id"].as_str().unwrap_or("");
		if mapping.contains_key(local) {
			continue; // duplicate id within this submit: the first resolution stands
		}
		let id = ids::bytes_hex("n", 6);
		let node = json!({
			"id": id,
			"name": p["name"],
			"statement": p["statement"],
			"aliases": p["aliases"],
			"createdAt": now,
			"provenance": point_of(chat_id, p["messageId"].as_str()),
		});
		ledgers.append_node(&node)?;
		created.insert(id.clone(), node);
		node_count += 1;
		existing_ids.insert(id.clone());
		mapping.insert(local.to_owned(), id);
	}

	// 1b. Re-taught ideas: credit this source on the existing node once.
	let mut first_line: HashMap<&str, &Json> = HashMap::new();
	let mut credited: HashSet<&str> = HashSet::new();
	for line in &nodes {
		let Some(id) = line["id"].as_str() else { continue };
		first_line.entry(id).or_insert(line);
		if touches(line, chat_id) {
			credited.insert(id);
		}
	}
	for id in unique(strs(&findings["reteaches"]).into_iter()) {
		let Some(node) = first_line.get(id) else { continue };
		if credited.contains(id) {
			continue;
		}
		ledgers.append_node(&credit_line(id, node, &now, point_of(chat_id, None)))?;
	}

	// 1c. What each question tests: a point at the question's message on each idea, so the
	//     learner's answer counts for it.
	let mut anchored: HashSet<String> = HashSet::new();
	for line in nodes.iter().chain(created.values()) {
		for pt in line["provenance"].as_arr().into_iter().flatten().filter(|pt| pt["chatId"].as_str() == Some(chat_id)) {
			anchored.insert(format!("{} {}", line["id"].as_str().unwrap_or("undefined"), pt["messageId"].as_str().unwrap_or("undefined")));
		}
	}
	for test in findings["tests"].as_arr().into_iter().flatten() {
		let message_id = test["messageId"].as_str();
		for local in unique(strs(&test["ids"]).into_iter()) {
			let id = mapping.get(local).map(String::as_str).or_else(|| existing_ids.contains(local).then_some(local));
			let node = id.and_then(|id| first_line.get(id).copied().or_else(|| created.get(id)));
			let (Some(id), Some(node)) = (id.filter(|id| !id.is_empty()), node) else { continue };
			let anchor = format!("{id} {}", message_id.unwrap_or("undefined"));
			if !anchored.insert(anchor) {
				continue;
			}
			ledgers.append_node(&credit_line(id, node, &now, point_of(chat_id, message_id)))?;
		}
	}

	// 2. Chains. A known argument re-stated by another chat appends under the same arg_ id;
	//    provenance unions at read time.
	let mut asserted_by_chat: HashSet<String> = HashSet::new();
	let mut id_of_key: HashMap<String, String> = HashMap::new();
	for line in ledgers.read_chains()? {
		let key = chain_key_of(&line);
		if let Some(id) = line["id"].as_str() {
			id_of_key.entry(key.clone()).or_insert_with(|| id.to_owned());
		}
		if touches(&line, chat_id) {
			asserted_by_chat.insert(key);
		}
	}
	let resolve = |endpoint: &str| -> Option<String> { mapping.get(endpoint).cloned().or_else(|| existing_ids.contains(endpoint).then(|| endpoint.to_owned())) };
	for chain in findings["chains"].as_arr().into_iter().flatten() {
		let Some(conclusion) = chain["conclusion"].as_str().and_then(resolve) else { continue };
		// Two phrasings of one premise collapse; a premise equal to the conclusion is dropped.
		let mut premises: Vec<String> = Vec::new();
		for p in strs(&chain["premises"]).into_iter().filter_map(resolve) {
			if p != conclusion && !premises.contains(&p) {
				premises.push(p);
			}
		}
		if premises.is_empty() {
			continue; // a chain is an argument: bare propositions ride the node ledger alone
		}
		let key = chain_key(&premises.iter().map(String::as_str).collect::<Vec<_>>(), &conclusion);
		if asserted_by_chat.contains(&key) {
			continue;
		}
		let id = id_of_key.get(&key).cloned().unwrap_or_else(|| ids::bytes_hex("arg", 6));
		ledgers.append_chain(&json!({ "id": id, "premises": premises, "conclusion": conclusion, "createdAt": now, "provenance": point_of(chat_id, None) }))?;
		id_of_key.insert(key.clone(), id);
		asserted_by_chat.insert(key);
		chain_count += 1;
	}

	// 2b. Simplification over the whole chain ledger.
	let all_chains = ledgers.read_chains()?;
	let kept = simplify_chains(&all_chains);
	let dropped = all_chains.len() - kept.len();
	if dropped > 0 {
		ledgers.rewrite_ledgers(LedgerRewrite { chains: Some(kept), ..LedgerRewrite::default() })?;
	}

	// 3. Checkpoint, only now that every append succeeded.
	match &source.coverage {
		Some(entries) => entries.iter().try_for_each(|entry| ledgers.append_coverage(entry))?,
		None => ledgers.append_checkpoint(&json!({ "chatId": chat_id, "foldedAt": source.folded_at }))?,
	}
	let mut stats = Obj::new();
	stats.insert("nodes", node_count);
	stats.insert("chains", chain_count);
	if dropped > 0 {
		stats.insert("droppedChains", dropped);
	}
	Ok(Json::from(stats))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::graph::memory::{Memory, chain, node};

	fn at() -> String {
		"2026-02-01T00:00:00.000Z".to_owned()
	}

	fn findings() -> Json {
		json!({
			"propositions": [
				{ "id": "p1", "name": "Pi", "statement": "Pi holds.", "aliases": ["Pi again"], "messageId": "m1" },
				{ "id": "p1", "name": "Twin", "statement": "ignored", "aliases": [] },
				{ "id": "p2", "name": "Rho", "statement": "Rho holds.", "aliases": [] },
			],
			"reteaches": ["n_a", "n_a", "n_zz", "n_b"],
			"tests": [{ "messageId": "m2", "ids": ["p1", "n_b", "p1", "nope"] }],
			"chains": [
				{ "premises": ["p1", "n_a"], "conclusion": "p2" },
				{ "premises": ["p2"], "conclusion": "p2" },
				{ "premises": ["zz"], "conclusion": "p1" },
			],
		})
	}

	#[test]
	fn a_lesson_batch_adds_nodes_credits_and_one_chain() {
		let memory = Memory::with(vec![node("n_a", "Alpha", &["old"]), node("n_b", "Beta", &["new"])], vec![]);
		let entry = json!({ "chatId": "new", "fp": "f", "tokens": 3, "foldedAt": at() });
		let source = MergeSource { folded_at: at(), coverage: Some(vec![entry.clone()]) };
		let stats = merge_findings("new", &findings(), &memory, &source).unwrap();
		assert_eq!(stats, json!({ "nodes": 2, "chains": 1 }));

		let ledgers = memory.ledgers.lock().unwrap();
		// 2 old lines, 2 new nodes, n_a credited once (n_b already was), p1 and n_b pointed at m2.
		assert_eq!(ledgers.nodes.len(), 7);
		let p1 = &ledgers.nodes[2];
		assert!(p1["id"].as_str().unwrap().starts_with("n_") && p1["id"].as_str().unwrap().len() == 14);
		assert_eq!((p1["name"].as_str(), p1["provenance"][0]["messageId"].as_str()), (Some("Pi"), Some("m1")));
		assert_eq!(ledgers.nodes[4]["id"], Json::from("n_a"));
		assert_eq!(ledgers.nodes[6]["provenance"], json!([{ "chatId": "new", "messageId": "m2" }]));
		assert_eq!(ledgers.chains.len(), 1);
		assert!(ledgers.chains[0]["id"].as_str().unwrap().starts_with("arg_"));
		assert_eq!(ledgers.chains[0]["premises"][1], Json::from("n_a"));
		assert_eq!(ledgers.coverage, [entry]);
		assert!(ledgers.checkpoints.is_empty());
	}

	#[test]
	fn a_notes_import_stamps_a_checkpoint_and_restating_a_chain_is_skipped() {
		let memory = Memory::with(vec![node("n_a", "A", &["x"]), node("n_b", "B", &["x"]), node("n_c", "C", &["x"])], vec![]);
		let findings = json!({ "propositions": [], "reteaches": [], "chains": [{ "premises": ["n_a", "n_b"], "conclusion": "n_c" }] });
		let source = MergeSource { folded_at: at(), coverage: None };
		assert_eq!(merge_findings("src_1", &findings, &memory, &source).unwrap(), json!({ "nodes": 0, "chains": 1 }));
		assert_eq!(merge_findings("src_1", &findings, &memory, &source).unwrap(), json!({ "nodes": 0, "chains": 0 }));
		assert_eq!(memory.ledgers.lock().unwrap().checkpoints, [json!({ "chatId": "src_1", "foldedAt": at() }), json!({ "chatId": "src_1", "foldedAt": at() })]);
	}

	#[test]
	fn a_known_argument_keeps_its_id_and_a_redundant_one_is_dropped() {
		let nodes = vec![node("n_a", "A", &["x"]), node("n_b", "B", &["x"]), node("n_c", "C", &["x"])];
		let memory = Memory::with(nodes, vec![chain("arg_old", &["n_a", "n_b"], "n_c", &["x"])]);
		let findings = json!({ "propositions": [], "reteaches": [], "chains": [{ "premises": ["n_b", "n_a"], "conclusion": "n_c" }, { "premises": ["n_a"], "conclusion": "n_c" }] });
		let stats = merge_findings("y", &findings, &memory, &MergeSource { folded_at: at(), coverage: Some(vec![]) }).unwrap();
		assert_eq!(stats, json!({ "nodes": 0, "chains": 2, "droppedChains": 2 }));
		// The two-premise argument is derivable from the single one, so both of its lines go.
		let chains = memory.chains();
		assert_eq!(chains.len(), 1);
		assert_eq!(chains[0]["premises"], json!(["n_a"]));
		assert_eq!(*memory.rewrites.lock().unwrap(), [vec!["chains"]]);
	}
}
