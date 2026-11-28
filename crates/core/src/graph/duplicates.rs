//! The duplicate check on an extractor's submit: which new propositions may restate a fact the
//! graph already holds. A shared name or a near-equal embedding flags one; the extractor decides.

use gs_json::Json;

/// The cosine between two "name: statement" texts at or above which a new proposition is flagged.
const DUPLICATE_SCORE: f32 = 0.92;

/// Candidates shown per flagged proposition.
const MAX_CANDIDATES: usize = 3;

/// Existing fact ids nearest a new proposition, with their cosines, best first.
pub type Nearest = Vec<(String, f32)>;

/// A proposition or merged node as the check reads it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Fact<'a> {
	pub id: &'a str,
	pub name: &'a str,
	pub statement: &'a str,
}

impl<'a> Fact<'a> {
	pub fn of(value: &'a Json) -> Fact<'a> {
		Fact { id: value["id"].str_or_empty(), name: value["name"].str_or_empty(), statement: value["statement"].str_or_empty() }
	}
}

/// A new proposition and the existing facts it may restate, best first.
#[derive(Debug, PartialEq)]
pub struct Duplicate<'a> {
	pub new: Fact<'a>,
	pub candidates: Vec<Fact<'a>>,
}

fn normalized_name(name: &str) -> String {
	name.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// The flagged propositions of `new`. `scores[i]` holds the best existing fact ids for `new[i]`
/// with their cosines, best first. Same-name facts come first, best scored first.
pub fn find_duplicates<'a>(new: &[Fact<'a>], existing: &[Fact<'a>], scores: &[Nearest]) -> Vec<Duplicate<'a>> {
	let no_scores = Vec::new();
	new.iter()
		.enumerate()
		.filter_map(|(i, fact)| {
			let scored = scores.get(i).unwrap_or(&no_scores);
			let score_of = |id: &str| scored.iter().find(|(s, _)| s == id).map_or(f32::NEG_INFINITY, |(_, score)| *score);
			let name = normalized_name(fact.name);
			let mut candidates: Vec<Fact<'a>> = if name.is_empty() { Vec::new() } else { existing.iter().filter(|e| normalized_name(e.name) == name).copied().collect() };
			candidates.sort_by(|a, b| score_of(b.id).total_cmp(&score_of(a.id)));
			for (id, score) in scored {
				if *score < DUPLICATE_SCORE || candidates.iter().any(|c| c.id == id) {
					continue;
				}
				if let Some(e) = existing.iter().find(|e| e.id == id) {
					candidates.push(*e);
				}
			}
			candidates.truncate(MAX_CANDIDATES);
			(!candidates.is_empty()).then_some(Duplicate { new: *fact, candidates })
		})
		.collect()
}

#[cfg(test)]
mod tests {
	use super::*;

	fn fact<'a>(id: &'a str, name: &'a str) -> Fact<'a> {
		Fact { id, name, statement: "s" }
	}

	fn scored(pairs: &[(&str, f32)]) -> Nearest {
		pairs.iter().map(|(id, s)| ((*id).to_owned(), *s)).collect()
	}

	fn ids<'a>(found: &[Duplicate<'a>]) -> Vec<(&'a str, Vec<&'a str>)> {
		found.iter().map(|d| (d.new.id, d.candidates.iter().map(|c| c.id).collect())).collect()
	}

	#[test]
	fn the_same_name_is_flagged_whatever_the_score() {
		let existing = [fact("n_1", "Merge  Sort "), fact("n_2", "Heap")];
		let found = find_duplicates(&[fact("p1", "merge sort")], &existing, &[scored(&[("n_1", 0.3)])]);
		assert_eq!(ids(&found), vec![("p1", vec!["n_1"])]);
	}

	#[test]
	fn a_score_at_the_threshold_is_flagged_and_below_it_is_not() {
		let existing = [fact("n_1", "Merging"), fact("n_2", "Heap")];
		let new = [fact("p1", "Merge step"), fact("p2", "Sift up")];
		let found = find_duplicates(&new, &existing, &[scored(&[("n_1", DUPLICATE_SCORE)]), scored(&[("n_2", 0.919)])]);
		assert_eq!(ids(&found), vec![("p1", vec!["n_1"])]);
	}

	#[test]
	fn at_most_three_candidates_with_same_name_ones_first() {
		let existing = [fact("n_1", "Heap"), fact("n_2", "Heaps"), fact("n_3", "Priority queue"), fact("n_4", "Heap"), fact("n_5", "Tree")];
		let scores = scored(&[("n_2", 0.99), ("n_4", 0.97), ("n_3", 0.95), ("n_5", 0.93)]);
		let found = find_duplicates(&[fact("p1", "heap")], &existing, &[scores]);
		assert_eq!(ids(&found), vec![("p1", vec!["n_4", "n_1", "n_2"])]);
	}

	#[test]
	fn nothing_flagged_is_empty() {
		let existing = [fact("n_1", "Heap")];
		assert!(find_duplicates(&[fact("p1", "Graph")], &existing, &[scored(&[("n_1", 0.5)])]).is_empty());
		assert!(find_duplicates(&[fact("p1", " ")], &[fact("n_1", "")], &[]).is_empty());
	}
}
