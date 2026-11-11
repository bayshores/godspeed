//! The chain-simplification pass of src/shared/core/graph.ts (`simplifyChains`).

use std::collections::{HashMap, HashSet};

use gs_base::locale;
use gs_json::Json;

use super::ledger_lines::{chain_key_of, strs};

/// One logical chain: the first line of its key stands.
struct Logical<'a> {
	key: &'a str,
	premises: Vec<&'a str>,
	conclusion: &'a str,
	created_at: &'a str,
}

/// Drops each chain whose premises already derive its conclusion through the chains still kept
/// (`[A,B] => X` plus `[X,C] => Y` makes `[A,B,C] => Y` redundant). Lines with the same
/// (premises, conclusion) are one chain: kept or dropped together, every provenance line with it.
pub fn simplify_chains(lines: &[Json]) -> Vec<Json> {
	if lines.len() < 2 {
		return lines.to_vec();
	}
	let keys: Vec<String> = lines.iter().map(chain_key_of).collect();

	let mut chains: Vec<Logical> = Vec::new();
	let mut seen: HashSet<&str> = HashSet::new();
	for (line, key) in lines.iter().zip(&keys) {
		if !seen.insert(key) {
			continue;
		}
		let mut premises: Vec<&str> = Vec::new();
		for premise in strs(&line["premises"]) {
			if !premises.contains(&premise) {
				premises.push(premise);
			}
		}
		chains.push(Logical { key, premises, conclusion: line["conclusion"].as_str().unwrap_or(""), created_at: line["createdAt"].as_str().unwrap_or("") });
	}
	// premise id -> the chains that need it, in chain order
	let mut used_by: HashMap<&str, Vec<usize>> = HashMap::new();
	for (i, chain) in chains.iter().enumerate() {
		for premise in &chain.premises {
			used_by.entry(premise).or_default().push(i);
		}
	}

	// Forward closure from the candidate's premises over the kept chains other than itself.
	// Skipping dropped chains keeps every dropped conclusion derivable, even through cycles.
	let derivable = |candidate: usize, dropped: &HashSet<usize>| -> bool {
		let Logical { premises, conclusion, .. } = &chains[candidate];
		let mut known: HashSet<&str> = premises.iter().copied().collect();
		let mut unmet: HashMap<usize, usize> = HashMap::new();
		let mut queue: Vec<&str> = premises.clone();
		while let Some(next) = queue.pop() {
			for &i in used_by.get(next).into_iter().flatten() {
				if i == candidate || dropped.contains(&i) {
					continue;
				}
				let chain = &chains[i];
				let left = unmet.get(&i).copied().unwrap_or(chain.premises.len()) - 1;
				unmet.insert(i, left);
				if left > 0 || known.contains(chain.conclusion) {
					continue;
				}
				if chain.conclusion == *conclusion {
					return true;
				}
				known.insert(chain.conclusion);
				queue.push(chain.conclusion);
			}
		}
		false
	};

	// Most premises, then newest, go first, so the leanest, earliest derivation stands.
	let mut order: Vec<usize> = (0..chains.len()).collect();
	order.sort_by(|&a, &b| {
		let (ca, cb) = (&chains[a], &chains[b]);
		cb.premises.len().cmp(&ca.premises.len()).then_with(|| locale::compare(cb.created_at, ca.created_at)).then_with(|| locale::compare(cb.key, ca.key))
	});
	let mut dropped: HashSet<usize> = HashSet::new();
	for i in order {
		if derivable(i, &dropped) {
			dropped.insert(i);
		}
	}
	if dropped.is_empty() {
		return lines.to_vec();
	}
	let dropped_keys: HashSet<&str> = dropped.iter().map(|&i| chains[i].key).collect();
	lines.iter().zip(&keys).filter(|(_, key)| !dropped_keys.contains(key.as_str())).map(|(line, _)| line.clone()).collect()
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn chain(id: &str, premises: &[&str], conclusion: &str, at: &str) -> Json {
		json!({ "id": id, "premises": premises, "conclusion": conclusion, "createdAt": at, "provenance": [{ "chatId": id, "messageId": "" }] })
	}

	fn ids(lines: &[Json]) -> Vec<&str> {
		lines.iter().map(|l| l["id"].as_str().unwrap()).collect()
	}

	#[test]
	fn a_chain_derivable_through_others_drops_with_all_its_lines() {
		let lines = [
			chain("a", &["A", "B"], "X", "2026-01-01"),
			chain("b", &["X", "C"], "Y", "2026-01-02"),
			chain("c", &["A", "B", "C"], "Y", "2026-01-03"),
			chain("c2", &["C", "B", "A"], "Y", "2026-01-04"),
		];
		assert_eq!(ids(&simplify_chains(&lines)), ["a", "b"]);
	}

	#[test]
	fn nothing_derivable_keeps_every_line() {
		let lines = [chain("a", &["A"], "X", "1"), chain("b", &["B"], "Y", "2")];
		assert_eq!(simplify_chains(&lines), lines);
		assert_eq!(simplify_chains(&lines[..1]), lines[..1]);
	}

	#[test]
	fn cycles_keep_a_derivation_of_each_conclusion() {
		let lines = [chain("a", &["A"], "B", "1"), chain("b", &["B"], "A", "2"), chain("c", &["A"], "B", "3")];
		assert_eq!(ids(&simplify_chains(&lines)), ["a", "b", "c"]);
		let loop3 = [chain("a", &["A"], "B", "1"), chain("b", &["B"], "C", "2"), chain("c", &["A"], "C", "3")];
		assert_eq!(ids(&simplify_chains(&loop3)), ["a", "b"]);
	}
}
