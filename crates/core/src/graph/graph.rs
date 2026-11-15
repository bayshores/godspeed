//! The merger (`merge`, `simplify`) and the reads below.
//! The ledgers are the stored truth; everything here derives from them on every read.

use std::collections::{HashMap, HashSet};

use gs_json::{Json, Obj, json};

pub use super::merge::{MergeSource, merge_findings};
pub use super::simplify::simplify_chains;

use super::chains::format_chain_line;
use super::clusters::MIN_CLUSTER_SIZE;
use super::ledger_lines::{chain_key_of, union_points};
use super::ordered::OrderedMap;
use super::ports::{GraphDeps, GraphStore};
use super::session_clusters::{BirthSessionCluster, attach_imp_to_communities, birth_session_partition};

/// The merged stored truth: propositions and chains. No derived implication nodes.
pub struct DerivedGraph {
	pub nodes: Vec<Json>,
	pub chains: Vec<Json>,
}

/// The whole graph from the ledgers. Node lines may repeat an id: the first line defines name,
/// statement and createdAt; later statements and aliases join `aliases` and provenance unions.
/// Chain lines are assertions merged by (premises, conclusion) with unioned provenance; the first
/// line's id, premises and createdAt are the chain's identity.
pub fn get_graph(store: &dyn GraphStore) -> Result<DerivedGraph, String> {
	let mut by_id: OrderedMap<Json> = OrderedMap::default();
	for line in store.read_nodes()? {
		let Some(id) = line["id"].as_str().map(str::to_owned) else { continue };
		let Some(existing) = by_id.get_mut(&id) else {
			by_id.insert(&id, line);
			continue;
		};
		// A later line's statement is a phrasing, not a replacement.
		let phrasings = std::iter::once(&line["statement"]).chain(line["aliases"].items().iter()).filter_map(Json::as_str);
		let mut fresh: Vec<&str> = Vec::new();
		for phrasing in phrasings {
			let held = existing["aliases"].items().iter().any(|a| a.as_str() == Some(phrasing)) || fresh.contains(&phrasing);
			if !phrasing.is_empty() && existing["statement"].as_str() != Some(phrasing) && !held {
				fresh.push(phrasing);
			}
		}
		if let Some(aliases) = existing.get_mut("aliases").and_then(Json::as_arr_mut) {
			aliases.extend(fresh.into_iter().map(Json::from));
		}
		union_points(existing, &line);
	}

	let mut chains: Vec<Json> = Vec::new();
	let mut index_of: HashMap<String, usize> = HashMap::new();
	for line in store.read_chains()? {
		let key = chain_key_of(&line);
		match index_of.get(&key) {
			Some(&i) => union_points(&mut chains[i], &line),
			None => {
				index_of.insert(key, chains.len());
				chains.push(line);
			}
		}
	}
	Ok(DerivedGraph { nodes: by_id.into_entries().into_iter().map(|(_, node)| node).collect(), chains })
}

/// What the canvas renders: propositions plus one implication node per multi-premise chain, with
/// untyped arrows.
pub struct DerivedView {
	pub nodes: Vec<Json>,
	pub edges: Vec<Json>,
	pub logical_edges: Vec<Json>,
	pub imp_links: Vec<Json>,
}

fn edge(from: &str, to: &str) -> Json {
	json!({ "from": from, "to": to })
}

/// A single-premise chain collapses to one direct arrow; a multi-premise chain mints an
/// implication node (id = the chain's id) with arrows premise to node and node to conclusion.
/// `logical_edges` contract every chain to premise-to-conclusion arrows over proposition ids.
/// Chains with a missing member drop here.
pub fn derive_view(graph: &DerivedGraph) -> DerivedView {
	let names: HashMap<String, String> = graph.nodes.iter().filter_map(|n| Some((n["id"].as_str()?.to_owned(), n["name"].as_str()?.to_owned()))).collect();
	let live: HashSet<&str> = graph.nodes.iter().filter_map(|n| n["id"].as_str()).collect();
	let mut imp_nodes = Vec::new();
	let mut edges = Vec::new();
	let mut imp_links = Vec::new();
	let mut logical_edges = Vec::new();
	let mut logical_seen: HashSet<(&str, &str)> = HashSet::new();
	for chain in &graph.chains {
		let premises = chain["premises"].strs();
		let Some(conclusion) = chain["conclusion"].as_str().filter(|c| live.contains(c)) else { continue };
		if !premises.iter().all(|p| live.contains(p)) {
			continue;
		}
		for &premise in &premises {
			if logical_seen.insert((premise, conclusion)) {
				logical_edges.push(edge(premise, conclusion));
			}
		}
		if let [only] = premises[..] {
			edges.push(edge(only, conclusion));
			continue;
		}
		let id = &chain["id"];
		imp_nodes.push(json!({
			"id": id,
			"name": "\u{27F9}",
			"statement": format_chain_line(&premises, conclusion, &names),
			"aliases": [],
			"createdAt": chain["createdAt"],
			"provenance": chain["provenance"],
		}));
		imp_links.push(json!({ "id": id, "premises": premises, "conclusion": conclusion }));
		for &premise in &premises {
			edges.push(json!({ "from": premise, "to": id }));
		}
		edges.push(json!({ "from": id, "to": conclusion }));
	}
	let mut nodes = graph.nodes.clone();
	nodes.extend(imp_nodes);
	DerivedView { nodes, edges, logical_edges, imp_links }
}

/// The (title or file path) label of each source id, from the chat list and the notes sources.
fn field_by_id<'a>(rows: &'a [Json], key: &str) -> HashMap<&'a str, &'a Json> {
	rows.iter().filter_map(|row| Some((row["id"].as_str()?, row.get(key)?))).collect()
}

/// Everything the home graph view needs, in one fetch.
pub fn graph_snapshot(deps: &GraphDeps) -> Result<Json, String> {
	let graph = get_graph(deps.graph_store)?;
	let view = derive_view(&graph);

	let mut node_chats: OrderedMap<Vec<String>> = OrderedMap::default();
	for node in &view.nodes {
		let Some(id) = node["id"].as_str() else { continue };
		for chat_id in node["provenance"].items().iter().filter_map(|pt| pt["chatId"].as_str()) {
			let chats = node_chats.get_or_insert_with(id, Vec::new);
			if !chats.iter().any(|c| c == chat_id) {
				chats.push(chat_id.to_owned());
			}
		}
	}
	// Every source the graph can point back at: real chats (title) and imported notes (path).
	let mut source_ids: Vec<&str> = Vec::new();
	let mut seen: HashSet<&str> = HashSet::new();
	for (_, chats) in node_chats.iter() {
		for id in chats {
			if seen.insert(id) {
				source_ids.push(id);
			}
		}
	}
	let chats = deps.chat_store.list_chats();
	let sources = deps.graph_store.read_sources()?;
	let chat_titles = field_by_id(&chats, "title");
	let source_paths = field_by_id(&sources, "filePath");
	let (mut sessions, mut file_sources) = (Obj::new(), Obj::new());
	for id in source_ids {
		if let Some(title) = chat_titles.get(id) {
			sessions.insert(id, (*title).clone());
		} else if let Some(path) = source_paths.get(id) {
			file_sources.insert(id, (*path).clone());
		}
	}

	let mut node_sessions = Obj::new();
	for (node_id, chats) in node_chats.iter() {
		let ids: Vec<&String> = chats.iter().filter(|id| sessions.contains_key(id) || file_sources.contains_key(id)).collect();
		if !ids.is_empty() {
			node_sessions.insert(node_id, ids);
		}
	}

	// Birth-session clusters: the session that created a region's propositions, named by its
	// title or path. A region needs MIN_CLUSTER_SIZE propositions for a hull.
	let mut clusters: Vec<BirthSessionCluster> = birth_session_partition(&graph.nodes).into_iter().filter(|c| c.members.len() >= MIN_CLUSTER_SIZE).collect();
	// Imp nodes join after the size filter, so a bundle never resurrects a small region.
	attach_imp_to_communities(&mut clusters, &graph.nodes, &graph.chains);
	let clusters: Vec<Json> = clusters
		.into_iter()
		.map(|c| {
			let label = sessions.get(&c.id).or_else(|| file_sources.get(&c.id)).cloned().unwrap_or(Json::Null);
			json!({ "id": c.id, "label": label, "members": c.members })
		})
		.collect();

	let mut out = Obj::new();
	out.insert("nodes", view.nodes);
	out.insert("propositions", graph.nodes);
	out.insert("edges", view.edges);
	out.insert("logicalEdges", view.logical_edges);
	out.insert("impLinks", view.imp_links);
	out.insert("chains", graph.chains);
	out.insert("sessions", sessions);
	out.insert("fileSources", file_sources);
	out.insert("nodeSessions", node_sessions);
	out.insert("clusters", clusters);
	Ok(Json::from(out))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::graph::memory::{Chats, Memory, chain, node};

	#[test]
	fn repeated_lines_merge_into_the_first_one() {
		let again = json!({ "id": "n_a", "name": "Alpha", "statement": "Alpha again.", "aliases": ["Alpha prime", "Alpha holds.", "Alpha again."], "createdAt": "2026-02-01T00:00:00.000Z", "provenance": [{ "chatId": "c2", "messageId": "" }, { "chatId": "c1", "messageId": "" }] });
		let memory = Memory::with(
			vec![node("n_a", "Alpha", &["c1"]), again, json!({ "name": "no id" })],
			vec![chain("arg_1", &["n_a", "n_b"], "n_c", &["c1"]), chain("arg_2", &["n_b", "n_a"], "n_c", &["c2"])],
		);
		let graph = get_graph(&memory).unwrap();
		assert_eq!(graph.nodes.len(), 1);
		assert_eq!(graph.nodes[0]["statement"], Json::from("Alpha holds."));
		assert_eq!(graph.nodes[0]["aliases"], json!(["Alpha again.", "Alpha prime"]));
		assert_eq!(graph.nodes[0]["provenance"], json!([{ "chatId": "c1", "messageId": "" }, { "chatId": "c2", "messageId": "" }]));
		assert_eq!(graph.nodes[0]["createdAt"], Json::from("2026-01-01T00:00:00.000Z"));
		assert_eq!(graph.chains.len(), 1);
		assert_eq!(graph.chains[0]["id"], Json::from("arg_1"));
		assert_eq!(graph.chains[0]["provenance"].as_arr().unwrap().len(), 2);
	}

	#[test]
	fn the_view_mints_an_implication_node_only_for_several_premises() {
		let nodes = vec![node("a", "Alpha", &["c1"]), node("b", "Beta", &["c1"]), node("c", "Gamma", &["c1"])];
		let chains = vec![chain("arg_1", &["b", "a"], "c", &["c1"]), chain("arg_2", &["a"], "c", &["c1"]), chain("arg_3", &["a", "zz"], "c", &["c1"])];
		let view = derive_view(&get_graph(&Memory::with(nodes, chains)).unwrap());
		assert_eq!(view.nodes.len(), 4);
		assert_eq!(view.nodes[3]["statement"], Json::from("Alpha, Beta \u{2192} Gamma"));
		assert_eq!(view.imp_links, vec![json!({ "id": "arg_1", "premises": ["b", "a"], "conclusion": "c" })]);
		assert_eq!(view.edges, vec![edge("b", "arg_1"), edge("a", "arg_1"), edge("arg_1", "c"), edge("a", "c")]);
		assert_eq!(view.logical_edges, vec![edge("b", "c"), edge("a", "c")]);
	}

	fn world() -> (Memory, Chats) {
		let nodes = vec![node("n_b", "B", &["c1"]), node("n_a", "A", &["c1"]), node("n_c", "C", &["c1"]), node("n_d", "D", &["src_f"]), node("n_e", "E", &["gone"])];
		let memory = Memory::with(nodes, vec![]);
		memory.ledgers.lock().unwrap().sources = vec![json!({ "id": "src_f", "filePath": "notes/a.pdf", "importedAt": "2026-01-02T00:00:00.000Z" })];
		(memory, Chats(vec![json!({ "id": "c1", "title": "First lesson", "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-03T00:00:00.000Z" })]))
	}

	#[test]
	fn the_snapshot_labels_sessions_and_clusters_big_regions() {
		let (memory, chats) = world();
		let snapshot = graph_snapshot(&GraphDeps { chat_store: &chats, graph_store: &memory }).unwrap();
		assert_eq!(snapshot["sessions"], json!({ "c1": "First lesson" }));
		assert_eq!(snapshot["fileSources"], json!({ "src_f": "notes/a.pdf" }));
		assert_eq!(snapshot["nodeSessions"]["n_a"], json!(["c1"]));
		assert!(snapshot["nodeSessions"]["n_e"].is_null());
		assert_eq!(snapshot["clusters"], json!([{ "id": "c1", "label": "First lesson", "members": ["n_a", "n_b", "n_c"] }]));
	}
}
