//! Chain helpers and the birth-session clusters.

use std::collections::HashMap;

use gs_core::graph::chains::{chains_for_selection, format_chain_line, resolve_target_id};
use gs_core::graph::clusters::MIN_CLUSTER_SIZE;
use gs_core::graph::graph::get_graph;
use gs_core::graph::session_clusters::{BirthSessionCluster, attach_imp_to_communities, birth_session_of, birth_session_partition, imp_cluster_key};
use gs_json::{Json, json};

use crate::ledgers::Ledgers;

fn clusters_json(clusters: &[BirthSessionCluster]) -> Json {
	clusters.iter().map(|c| json!({ "id": c.id, "members": c.members })).collect()
}

fn lines(v: &Json) -> &[Json] {
	v.as_arr().unwrap()
}

pub fn run(op: &str, input: &Json) -> Json {
	match op {
		"chains_selection" => Json::from(chains_for_selection(lines(&input["nodes"]), lines(&input["chains"]))),
		"resolve_target" => {
			let nodes = lines(&input["nodes"]);
			lines(&input["targets"]).iter().map(|t| Json::from(resolve_target_id(t.as_str().unwrap(), nodes))).collect()
		}
		"format_chain_line" => {
			let names: HashMap<String, String> = input["names"].as_obj().unwrap().iter().map(|(id, name)| (id.clone(), name.as_str().unwrap().to_owned())).collect();
			lines(&input["chains"])
				.iter()
				.map(|c| {
					let premises: Vec<&str> = lines(&c["premises"]).iter().map(|p| p.as_str().unwrap()).collect();
					Json::from(format_chain_line(&premises, c["conclusion"].as_str().unwrap(), &names))
				})
				.collect()
		}
		"session_clusters" => by_hand(input),
		"session_clusters_ledgers" => from_ledgers(input),
		other => panic!("not a cluster op: {other}"),
	}
}

fn by_hand(input: &Json) -> Json {
	let (nodes, chains, births) = (lines(&input["nodes"]), lines(&input["chains"]), &input["births"]);
	let attach = |min_size: usize| {
		let mut communities: Vec<BirthSessionCluster> = birth_session_partition(nodes).into_iter().filter(|c| c.members.len() >= min_size).collect();
		attach_imp_to_communities(&mut communities, nodes, chains);
		clusters_json(&communities)
	};
	json!({
		"partition": clusters_json(&birth_session_partition(nodes)),
		"impKeys": chains.iter().map(|c| Json::from(imp_cluster_key(c, |id| births[id].as_str()))).collect::<Json>(),
		"attachedAll": attach(1),
		"attachedBig": attach(2),
	})
}

fn from_ledgers(input: &Json) -> Json {
	let ledgers = Ledgers::load(&input["ledgers"]);
	let graph = get_graph(&ledgers.store()).unwrap();
	let partition = birth_session_partition(&ledgers.part("nodes"));
	let mut attached: Vec<BirthSessionCluster> = birth_session_partition(&ledgers.part("nodes")).into_iter().filter(|c| c.members.len() >= MIN_CLUSTER_SIZE).collect();
	attach_imp_to_communities(&mut attached, &graph.nodes, &graph.chains);
	let birth: HashMap<&str, Option<&str>> = graph.nodes.iter().map(|n| (n["id"].as_str().unwrap(), birth_session_of(n))).collect();
	json!({
		"partition": clusters_json(&partition),
		"impKeys": graph.chains.iter().map(|c| Json::from(imp_cluster_key(c, |id| birth.get(id).copied().flatten()))).collect::<Json>(),
		"attached": clusters_json(&attached),
	})
}
