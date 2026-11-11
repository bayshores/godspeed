//! Arrows between topics and the column each topic sits in (progress.ts).

use std::collections::{HashMap, HashSet};

use gs_base::locale;
use gs_json::{Json, json};

/// Learn `from` first, then `to`; `weight` is how many reasoning chains run from one into the other.
#[derive(Clone, Debug, PartialEq)]
pub struct TopicLink {
	pub from: String,
	pub to: String,
	pub weight: usize,
}

impl TopicLink {
	pub fn to_json(&self) -> Json {
		json!({ "from": self.from, "to": self.to, "weight": self.weight })
	}
}

/// A chain with a premise in topic A and its conclusion in topic B (A is not B) adds 1 to A to B
/// (once per chain). Cycles are broken by keeping the heaviest edges first (ties: from, then to,
/// in id order) and dropping any edge that would close a loop.
pub fn topic_links(chains: &[Json], topic_of_fact: &HashMap<String, String>) -> Vec<TopicLink> {
	let mut weights: Vec<TopicLink> = Vec::new();
	let mut at: HashMap<(String, String), usize> = HashMap::new();
	for chain in chains {
		let Some(to) = chain["conclusion"].as_str().and_then(|c| topic_of_fact.get(c)) else { continue };
		let mut froms: Vec<&String> = Vec::new();
		for premise in super::items(&chain["premises"]) {
			let Some(from) = premise.as_str().and_then(|p| topic_of_fact.get(p)) else { continue };
			if from != to && !froms.contains(&from) {
				froms.push(from);
			}
		}
		for from in froms {
			match at.get(&(from.clone(), to.clone())) {
				Some(&i) => weights[i].weight += 1,
				None => {
					at.insert((from.clone(), to.clone()), weights.len());
					weights.push(TopicLink { from: from.clone(), to: to.clone(), weight: 1 });
				}
			}
		}
	}
	weights.sort_by(|a, b| b.weight.cmp(&a.weight).then_with(|| locale::compare(&a.from, &b.from)).then_with(|| locale::compare(&a.to, &b.to)));
	let mut out: HashMap<&str, Vec<&str>> = HashMap::new();
	let mut kept: Vec<&TopicLink> = Vec::new();
	for link in &weights {
		if reaches(&out, &link.to, &link.from) {
			continue; // would close a loop
		}
		kept.push(link);
		out.entry(link.from.as_str()).or_default().push(link.to.as_str());
	}
	kept.into_iter().cloned().collect()
}

fn reaches(out: &HashMap<&str, Vec<&str>>, start: &str, goal: &str) -> bool {
	let mut stack = vec![start];
	let mut seen: HashSet<&str> = HashSet::new();
	while let Some(at) = stack.pop() {
		if at == goal {
			return true;
		}
		if seen.insert(at) {
			stack.extend(out.get(at).into_iter().flatten().copied());
		}
	}
	false
}

/// Column per topic: the longest path from a topic with no incoming arrow (the links must be
/// acyclic, which `topic_links` guarantees).
pub fn topic_columns(topic_ids: &[String], links: &[TopicLink]) -> HashMap<String, i64> {
	let mut incoming: HashMap<&str, Vec<&str>> = HashMap::new();
	for l in links {
		incoming.entry(l.to.as_str()).or_default().push(l.from.as_str());
	}
	let mut memo: HashMap<String, i64> = HashMap::new();
	let mut visiting: HashSet<String> = HashSet::new();
	for id in topic_ids {
		column(id, &incoming, &mut memo, &mut visiting);
	}
	memo
}

fn column(id: &str, incoming: &HashMap<&str, Vec<&str>>, memo: &mut HashMap<String, i64>, visiting: &mut HashSet<String>) -> i64 {
	if let Some(&known) = memo.get(id) {
		return known;
	}
	if !visiting.insert(id.to_owned()) {
		return 0; // defensive: never loops on bad input
	}
	let mut best = 0;
	for from in incoming.get(id).into_iter().flatten() {
		best = best.max(column(from, incoming, memo, visiting) + 1);
	}
	visiting.remove(id);
	memo.insert(id.to_owned(), best);
	best
}

#[cfg(test)]
mod tests {
	use super::*;

	fn topics(pairs: &[(&str, &str)]) -> HashMap<String, String> {
		pairs.iter().map(|(f, t)| ((*f).to_owned(), (*t).to_owned())).collect()
	}

	#[test]
	fn heavier_links_win_and_loops_are_cut() {
		let of = topics(&[("a1", "A"), ("a2", "A"), ("b1", "B"), ("c1", "C")]);
		let chains = [
			json!({ "premises": ["a1", "a2"], "conclusion": "b1" }),
			json!({ "premises": ["a1"], "conclusion": "b1" }),
			json!({ "premises": ["b1"], "conclusion": "a1" }),
			json!({ "premises": ["b1", "gone"], "conclusion": "c1" }),
		];
		let links = topic_links(&chains, &of);
		let text: Vec<_> = links.iter().map(|l| format!("{}>{}:{}", l.from, l.to, l.weight)).collect();
		assert_eq!(text, ["A>B:2", "B>C:1"]);
		let ids: Vec<String> = ["C", "B", "A"].map(String::from).to_vec();
		let cols = topic_columns(&ids, &links);
		assert_eq!((cols["A"], cols["B"], cols["C"]), (0, 1, 2));
	}

	#[test]
	fn a_cycle_in_the_links_does_not_loop() {
		let links = [TopicLink { from: "A".into(), to: "B".into(), weight: 1 }, TopicLink { from: "B".into(), to: "A".into(), weight: 1 }];
		let cols = topic_columns(&["A".to_owned()], &links);
		assert!(cols.contains_key("A"));
	}
}
