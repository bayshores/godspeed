use std::collections::{HashMap, HashSet};

use gs_base::text::cmp16;
use gs_json::{Json, json};

use super::ledger_lines::strs;
use crate::messages::value_debris::strip_model_value_debris;

/// The stored chains filtered to a selection: a chain rides along iff its conclusion and every
/// premise are selected; a node in no surviving chain becomes a singleton chain (no premises).
/// Each chain is `{ id, premises, conclusion }`, sorted by id, premises sorted.
pub fn chains_for_selection(nodes: &[Json], chains: &[Json]) -> Vec<Json> {
	let selected: HashSet<&str> = nodes.iter().filter_map(|n| n["id"].as_str()).collect();
	let mut chained: HashSet<&str> = HashSet::new();
	let mut included: Vec<(String, Json)> = Vec::new();
	for chain in chains {
		let (Some(id), Some(conclusion)) = (chain["id"].as_str(), chain["conclusion"].as_str()) else { continue };
		let premises = strs(&chain["premises"]);
		if !selected.contains(conclusion) || !premises.iter().all(|p| selected.contains(p)) {
			continue;
		}
		let mut sorted = premises.clone();
		sorted.sort_by(|a, b| cmp16(a, b));
		included.push((id.to_owned(), json!({ "id": id, "premises": sorted, "conclusion": conclusion })));
		chained.insert(conclusion);
		chained.extend(premises);
	}
	for node in nodes {
		if let Some(id) = node["id"].as_str().filter(|id| !chained.contains(id)) {
			included.push((id.to_owned(), json!({ "id": id, "premises": [], "conclusion": id })));
		}
	}
	included.sort_by(|a, b| cmp16(&a.0, &b.0));
	included.into_iter().map(|(_, chain)| chain).collect()
}

/// Resolves one target string to a proposition id: id first (exact), then name (case-insensitive,
/// trimmed; the first node in store order when a name repeats). None when nothing matches.
pub fn resolve_target_id(target: &str, nodes: &[Json]) -> Option<String> {
	let t = strip_model_value_debris(target);
	if t.is_empty() {
		return None;
	}
	if nodes.iter().any(|n| n["id"].as_str() == Some(&t)) {
		return Some(t);
	}
	let lower = t.to_lowercase();
	nodes.iter().find(|n| n["name"].as_str().is_some_and(|name| strip_model_value_debris(name).to_lowercase() == lower)).and_then(|n| n["id"].as_str().map(str::to_owned))
}

/// A chain as one line of proposition names: "Premise one, Premise two → Conclusion", or
/// "Conclusion (no premises)". Unknown ids show raw; premises sort by id.
pub fn format_chain_line(premises: &[&str], conclusion: &str, names: &HashMap<String, String>) -> String {
	let name_of = |id: &str| names.get(id).map_or_else(|| id.to_owned(), Clone::clone);
	let mut sorted = premises.to_vec();
	sorted.sort_by(|a, b| cmp16(a, b));
	let listed = sorted.into_iter().map(name_of).collect::<Vec<_>>().join(", ");
	if listed.is_empty() { format!("{} (no premises)", name_of(conclusion)) } else { format!("{listed} → {}", name_of(conclusion)) }
}

#[cfg(test)]
mod tests {
	use super::*;

	fn node(id: &str, name: &str) -> Json {
		json!({ "id": id, "name": name })
	}

	#[test]
	fn selection_keeps_whole_chains_and_singletons() {
		let nodes = [node("c", "C"), node("a", "A"), node("b", "B"), node("z", "Z")];
		let chains = [json!({ "id": "arg_2", "premises": ["b", "a"], "conclusion": "c" }), json!({ "id": "arg_1", "premises": ["a", "q"], "conclusion": "c" })];
		let got = chains_for_selection(&nodes, &chains);
		let ids: Vec<&str> = got.iter().map(|c| c["id"].as_str().unwrap()).collect();
		assert_eq!(ids, ["arg_2", "z"]);
		assert_eq!(got[0]["premises"], json!(["a", "b"]));
		assert_eq!(got[1]["premises"], json!([]));
	}

	#[test]
	fn targets_resolve_by_id_then_name() {
		let nodes = [node("n_1", "Bayes' rule"), node("n_2", "bayes' RULE")];
		assert_eq!(resolve_target_id(" :n_2. ", &nodes).as_deref(), Some("n_2"));
		assert_eq!(resolve_target_id("`BAYES' rule`", &nodes).as_deref(), Some("n_1"));
		assert_eq!(resolve_target_id("nope", &nodes), None);
		assert_eq!(resolve_target_id("  ", &nodes), None);
	}

	#[test]
	fn lines_name_the_propositions() {
		let names: HashMap<String, String> = [("a".to_owned(), "Alpha".to_owned()), ("c".to_owned(), "Gamma".to_owned())].into();
		assert_eq!(format_chain_line(&["b", "a"], "c", &names), "Alpha, b → Gamma");
		assert_eq!(format_chain_line(&[], "c", &names), "Gamma (no premises)");
	}
}
