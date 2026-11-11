//! Keyword ranking as MiniSearch 7 does it for `new MiniSearch({ fields: ["text"], idField: "id" })`
//! searched with `combineWith: "OR"` (keywordIndex, keywordRanking in src/shared/core/search.ts):
//! words split at spaces and punctuation, lowercased, exact matches only, BM25+ with k 1.2, b 0.7,
//! d 0.5, summed over the query's words and multiplied by how many distinct words matched.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use gs_base::re::Re;

use crate::log::js_log;

const K: f64 = 1.2;
const B: f64 = 0.7;
const D: f64 = 0.5;

/// The index over (id, text) pairs.
pub struct KeywordIndex {
	ids: Vec<String>,
	/// Distinct raw words per document (before lowercasing, the empty word counted).
	lengths: Vec<f64>,
	/// The running average of `lengths`, rounded the way MiniSearch adds one document at a time.
	average: f64,
	/// Each word's documents in the order they were added, with how often it occurs.
	postings: HashMap<String, Vec<(usize, u32)>>,
}

fn tokenize(text: &str) -> Vec<String> {
	static SPACE_OR_PUNCTUATION: LazyLock<Re> = LazyLock::new(|| Re::new(r"[\n\r\p{Z}\p{P}]+", "u"));
	SPACE_OR_PUNCTUATION.split(text).into_iter().flatten().collect()
}

/// A keyword index over (id, text) pairs; a repeated id fails like MiniSearch's `add`.
pub fn keyword_index<'a>(docs: impl IntoIterator<Item = (&'a str, &'a str)>) -> Result<KeywordIndex, String> {
	let mut index = KeywordIndex { ids: Vec::new(), lengths: Vec::new(), average: 0.0, postings: HashMap::new() };
	let mut seen = HashSet::new();
	for (id, text) in docs {
		if !seen.insert(id) {
			return Err(format!("MiniSearch: duplicate ID {id}"));
		}
		let doc = index.ids.len();
		index.ids.push(id.to_owned());
		let tokens = tokenize(text);
		let length = tokens.iter().collect::<HashSet<_>>().len() as f64;
		let count = doc as f64;
		index.average = (index.average * count + length) / (count + 1.0);
		index.lengths.push(length);
		for token in tokens {
			let term = token.to_lowercase();
			if term.is_empty() {
				continue;
			}
			let posting = index.postings.entry(term).or_default();
			match posting.last_mut() {
				Some((d, n)) if *d == doc => *n += 1,
				_ => posting.push((doc, 1)),
			}
		}
	}
	Ok(index)
}

/// One document's running result: its score and the distinct query words that matched.
struct Hit {
	doc: usize,
	score: f64,
	words: Vec<String>,
}

impl KeywordIndex {
	/// `index.search(query, { combineWith: "OR" })` as (id, score), best first.
	pub fn search(&self, query: &str) -> Vec<(&str, f64)> {
		let mut hits: Vec<Hit> = Vec::new();
		let mut at: HashMap<usize, usize> = HashMap::new();
		for word in tokenize(query).iter().map(|t| t.to_lowercase()).filter(|t| !t.is_empty()) {
			let Some(posting) = self.postings.get(&word) else { continue };
			let idf = self.idf(posting.len() as f64);
			for &(doc, freq) in posting {
				let score = self.bm25(idf, f64::from(freq), self.lengths[doc]);
				match at.get(&doc) {
					Some(&i) => {
						let hit = &mut hits[i];
						hit.score += score;
						if !hit.words.contains(&word) {
							hit.words.push(word.clone());
						}
					}
					None => {
						at.insert(doc, hits.len());
						hits.push(Hit { doc, score, words: vec![word.clone()] });
					}
				}
			}
		}
		let mut out: Vec<(&str, f64)> = hits.iter().map(|h| (self.ids[h.doc].as_str(), h.score * h.words.len().max(1) as f64)).collect();
		out.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
		out
	}

	/// How rare a word is, from how many documents hold it.
	fn idf(&self, matching: f64) -> f64 {
		let total = self.ids.len() as f64;
		js_log(1.0 + (total - matching + 0.5) / (matching + 0.5))
	}

	fn bm25(&self, idf: f64, freq: f64, length: f64) -> f64 {
		idf * (D + freq * (K + 1.0) / (freq + K * (1.0 - B + B * length / self.average)))
	}
}

/// Ids in BM25+ order for the query's words (any word may match), at most `n`.
pub fn keyword_ranking(index: &KeywordIndex, query: &str, n: usize) -> Vec<String> {
	index.search(query).into_iter().take(n).map(|(id, _)| id.to_owned()).collect()
}

#[cfg(test)]
mod tests {
	use super::*;

	fn index(docs: &[(&'static str, &'static str)]) -> KeywordIndex {
		keyword_index(docs.iter().copied()).unwrap()
	}

	#[test]
	fn words_split_at_spaces_and_punctuation() {
		assert_eq!(tokenize(".Hi, there!"), vec!["", "Hi", "there", ""]);
		assert_eq!(tokenize(""), vec![""]);
	}

	#[test]
	fn more_matching_words_rank_higher() {
		let i = index(&[("a", "the cat sat"), ("b", "the cat and the hat"), ("c", "dogs")]);
		let ranked = keyword_ranking(&i, "Cat hat", 10);
		assert_eq!(ranked, vec!["b", "a"]);
		assert!(keyword_ranking(&i, "", 10).is_empty());
		assert!(keyword_ranking(&i, "zebra", 10).is_empty());
		assert_eq!(keyword_ranking(&i, "the", 1), vec!["b"]);
	}

	#[test]
	fn a_repeated_id_fails() {
		let err = keyword_index([("x", "a"), ("x", "b")]).err();
		assert_eq!(err.as_deref(), Some("MiniSearch: duplicate ID x"));
	}
}
