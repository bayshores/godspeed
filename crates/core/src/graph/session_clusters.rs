//! Ported from src/shared/core/session-clusters.ts.
//!
//! `birth_session_of` was written with the foundations because other packages call it.

use std::collections::{HashMap, HashSet};

use gs_json::Json;

use super::ledger_lines::strs;
use super::ordered::{OrderedMap, cmp16};

/// The lesson a fact was first said in (its first provenance point's chat), if any.
pub fn birth_session_of(node: &Json) -> Option<&str> {
	node["provenance"][0]["chatId"].as_str()
}

/// One birth-session cluster: the session id (a chat or a notes source "src_...") and the sorted
/// ids of the nodes born in it.
pub struct BirthSessionCluster {
	pub id: String,
	pub members: Vec<String>,
}

/// Groups nodes by birth session (the first line of an id defines it; nodes with no provenance
/// belong to none): biggest group first, ties by session id, members sorted.
pub fn birth_session_partition(nodes: &[Json]) -> Vec<BirthSessionCluster> {
	let mut members: OrderedMap<Vec<String>> = OrderedMap::default();
	let mut seen: HashSet<&str> = HashSet::new();
	for node in nodes {
		let Some(id) = node["id"].as_str() else { continue };
		if !seen.insert(id) {
			continue;
		}
		if let Some(birth) = birth_session_of(node) {
			members.get_or_insert_with(birth, Vec::new).push(id.to_owned());
		}
	}
	let mut clusters: Vec<BirthSessionCluster> = members
		.into_entries()
		.into_iter()
		.map(|(id, mut list)| {
			list.sort_by(|a, b| cmp16(a, b));
			BirthSessionCluster { id, members: list }
		})
		.collect();
	clusters.sort_by(|a, b| b.members.len().cmp(&a.members.len()).then_with(|| cmp16(&a.id, &b.id)));
	clusters
}

/// The cluster a derived implication node takes: the majority of its premises' birth sessions,
/// ties to the chain's own birth (its first provenance point), then to the first session by id.
pub fn imp_cluster_key<'a>(chain: &Json, birth_of: impl Fn(&str) -> Option<&'a str>) -> Option<String> {
	let mut counts: OrderedMap<usize> = OrderedMap::default();
	for premise in strs(&chain["premises"]) {
		if let Some(birth) = birth_of(premise) {
			*counts.get_or_insert_with(birth, || 0) += 1;
		}
	}
	let own = chain["provenance"][0]["chatId"].as_str();
	let max = counts.iter().map(|(_, n)| *n).max();
	let mut winners: Vec<&str> = counts.iter().filter(|(_, n)| Some(**n) == max).map(|(key, _)| key).collect();
	match winners.len() {
		0 => own.map(str::to_owned),
		1 => Some(winners[0].to_owned()),
		_ => {
			winners.sort_by(|a, b| cmp16(a, b));
			Some(own.unwrap_or(winners[0]).to_owned())
		}
	}
}

/// Adds each multi-premise, fully live chain's id to its home cluster's members (single-premise
/// chains draw as plain arrows and mint no node), then re-sorts every cluster's members. A chain
/// whose home cluster is not in the list stays unclustered.
pub fn attach_imp_to_communities(communities: &mut [BirthSessionCluster], propositions: &[Json], chains: &[Json]) {
	let birth_by_id: HashMap<&str, Option<&str>> = propositions.iter().filter_map(|n| n["id"].as_str().map(|id| (id, birth_session_of(n)))).collect();
	for chain in chains {
		let premises = strs(&chain["premises"]);
		let Some(conclusion) = chain["conclusion"].as_str() else { continue };
		if premises.len() < 2 || !birth_by_id.contains_key(conclusion) || !premises.iter().all(|p| birth_by_id.contains_key(p)) {
			continue;
		}
		let key = imp_cluster_key(chain, |id| birth_by_id.get(id).copied().flatten());
		let community = key.and_then(|key| communities.iter_mut().find(|c| c.id == key));
		if let (Some(community), Some(id)) = (community, chain["id"].as_str()) {
			community.members.push(id.to_owned());
		}
	}
	for community in communities.iter_mut() {
		community.members.sort_by(|a, b| cmp16(a, b));
	}
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn node(id: &str, chat: Option<&str>) -> Json {
		let provenance = chat.map_or_else(|| json!([]), |c| json!([{ "chatId": c, "messageId": "" }]));
		json!({ "id": id, "provenance": provenance })
	}

	#[test]
	fn partition_groups_by_birth_and_orders_by_size_then_id() {
		let nodes = [node("n3", Some("b")), node("n1", Some("a")), node("n2", Some("b")), node("n1", Some("b")), node("n4", None), node("n5", Some("c"))];
		let got = birth_session_partition(&nodes);
		let shape: Vec<(&str, Vec<&str>)> = got.iter().map(|c| (c.id.as_str(), c.members.iter().map(String::as_str).collect())).collect();
		assert_eq!(shape, [("b", vec!["n2", "n3"]), ("a", vec!["n1"]), ("c", vec!["n5"])]);
	}

	#[test]
	fn imp_nodes_follow_the_premise_majority_then_the_chain_birth() {
		let births: HashMap<&str, &str> = [("p1", "a"), ("p2", "a"), ("p3", "b"), ("p4", "b")].into();
		let birth_of = |id: &str| births.get(id).copied();
		let majority = json!({ "premises": ["p1", "p2", "p3"], "provenance": [{ "chatId": "z", "messageId": "" }] });
		assert_eq!(imp_cluster_key(&majority, birth_of).as_deref(), Some("a"));
		let tie = json!({ "premises": ["p1", "p3"], "provenance": [{ "chatId": "z", "messageId": "" }] });
		assert_eq!(imp_cluster_key(&tie, birth_of).as_deref(), Some("z"));
		let tie_no_own = json!({ "premises": ["p3", "p1"], "provenance": [] });
		assert_eq!(imp_cluster_key(&tie_no_own, birth_of).as_deref(), Some("a"));
		let unknown = json!({ "premises": ["q"], "provenance": [{ "chatId": "z", "messageId": "" }] });
		assert_eq!(imp_cluster_key(&unknown, birth_of).as_deref(), Some("z"));
	}

	#[test]
	fn attaching_adds_multi_premise_chains_to_listed_clusters() {
		let props = [node("p1", Some("a")), node("p2", Some("a")), node("p3", Some("a"))];
		let chains = [
			json!({ "id": "arg_2", "premises": ["p1", "p2"], "conclusion": "p3", "provenance": [] }),
			json!({ "id": "arg_1", "premises": ["p1"], "conclusion": "p3", "provenance": [] }),
			json!({ "id": "arg_0", "premises": ["p1", "gone"], "conclusion": "p3", "provenance": [] }),
		];
		let mut clusters = vec![BirthSessionCluster { id: "a".into(), members: vec!["p1".into(), "p2".into(), "p3".into()] }];
		attach_imp_to_communities(&mut clusters, &props, &chains);
		assert_eq!(clusters[0].members, ["arg_2", "p1", "p2", "p3"]);
	}
}
