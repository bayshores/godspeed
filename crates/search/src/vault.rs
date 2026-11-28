//! A keyword index over the notes of the learner's Obsidian vault, for the teacher's vault
//! search. It lives in memory only and never touches a graph. It indexes the entries it is given;
//! walking the vault and reading its files is the services' job.

use std::collections::HashMap;

use crate::chunks::SNIPPET_CHARS;
use crate::keyword::{KeywordIndex, keyword_index, keyword_ranking};

/// Text kept per note, so a big vault stays small in memory (about 20 MB at 5,000 notes).
pub const MAX_NOTE_CHARS: usize = 4_000;

/// Whose note it is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultOwner {
	/// godspeed writes it (`godspeed: <topic id>`).
	Godspeed,
	/// The learner's own note handed to godspeed (`godspeed: keep`).
	Kept,
	/// The learner's own note.
	Learner,
}

/// One note to index.
pub struct VaultEntry {
	/// Relative to the vault, with `/`.
	pub path: String,
	/// The file name without `.md`.
	pub title: String,
	/// The note under its frontmatter.
	pub text: String,
	pub owner: VaultOwner,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VaultHit {
	pub name: String,
	pub path: String,
	pub owner: VaultOwner,
	/// The first 200 characters of the note's text, on one line.
	pub snippet: String,
}

pub struct VaultIndex {
	hits: HashMap<String, VaultHit>,
	words: KeywordIndex,
}

/// A note's text cut to its first `n` characters.
pub fn first_chars(text: &str, n: usize) -> String {
	text.chars().take(n).collect()
}

impl VaultIndex {
	/// The index of `entries`. A later entry with the same path replaces an earlier one.
	#[expect(clippy::expect_used, reason = "the texts are a map keyed by path, so no path comes twice")]
	pub fn new(entries: Vec<VaultEntry>) -> VaultIndex {
		let mut hits = HashMap::with_capacity(entries.len());
		let mut texts: HashMap<String, String> = HashMap::with_capacity(entries.len());
		for entry in entries {
			let body = entry.text.trim();
			let snippet = first_chars(&body.split_whitespace().collect::<Vec<_>>().join(" "), SNIPPET_CHARS as usize);
			texts.insert(entry.path.clone(), format!("{}\n{}", entry.title, first_chars(body, MAX_NOTE_CHARS)));
			hits.insert(entry.path.clone(), VaultHit { name: entry.title, path: entry.path, owner: entry.owner, snippet });
		}
		let words = keyword_index(texts.iter().map(|(path, text)| (path.as_str(), text.as_str()))).expect("paths are distinct");
		VaultIndex { hits, words }
	}

	pub fn len(&self) -> usize {
		self.hits.len()
	}

	pub fn is_empty(&self) -> bool {
		self.hits.is_empty()
	}

	/// Up to `n` notes for the query, best first. A search that matches nothing finds nothing; no
	/// score is cut off.
	pub fn search(&self, query: &str, n: usize) -> Vec<VaultHit> {
		keyword_ranking(&self.words, query, n).iter().filter_map(|path| self.hits.get(path)).cloned().collect()
	}

	/// The note at `path` (relative to the vault), if it was indexed.
	pub fn note(&self, path: &str) -> Option<&VaultHit> {
		self.hits.get(path)
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn entry(path: &str, text: &str, owner: VaultOwner) -> VaultEntry {
		let title = path.rsplit('/').next().unwrap().trim_end_matches(".md").to_owned();
		VaultEntry { path: path.to_owned(), title, text: text.to_owned(), owner }
	}

	#[test]
	fn notes_are_found_by_their_name_or_text_with_owner_and_snippet() {
		let index = VaultIndex::new(vec![
			entry("CSE 21/Binary search.md", "Halve the range each step.\n\nIt needs sorted input.\n", VaultOwner::Godspeed),
			entry("Mine.md", "Pigeonhole principle, my words.", VaultOwner::Kept),
			entry("Loose.md", "Pigeonhole again.", VaultOwner::Learner),
		]);
		assert_eq!(index.len(), 3);
		let hits = index.search("binary search", 10);
		assert_eq!(hits.len(), 1);
		assert_eq!((hits[0].name.as_str(), hits[0].path.as_str(), hits[0].owner), ("Binary search", "CSE 21/Binary search.md", VaultOwner::Godspeed));
		assert_eq!(hits[0].snippet, "Halve the range each step. It needs sorted input.");
		let owners: Vec<(String, VaultOwner)> = index.search("pigeonhole", 10).into_iter().map(|h| (h.name, h.owner)).collect();
		assert_eq!(owners.len(), 2);
		assert!(owners.contains(&("Mine".to_owned(), VaultOwner::Kept)));
		assert!(owners.contains(&("Loose".to_owned(), VaultOwner::Learner)));
		assert!(index.search("zebra", 10).is_empty());
	}

	#[test]
	fn a_snippet_is_at_most_200_characters() {
		let index = VaultIndex::new(vec![entry("Long.md", &"é".repeat(500), VaultOwner::Learner)]);
		assert_eq!(index.note("Long.md").unwrap().snippet.chars().count(), 200);
	}

	#[test]
	fn only_the_first_4000_characters_of_a_note_are_ranked() {
		let text = format!("{} needle", "word ".repeat(1_000));
		let index = VaultIndex::new(vec![entry("Big.md", &text, VaultOwner::Learner)]);
		assert!(index.search("needle", 5).is_empty());
		assert_eq!(index.search("word", 5).len(), 1);
	}

	#[test]
	fn an_empty_index_finds_nothing() {
		let index = VaultIndex::new(Vec::new());
		assert!(index.is_empty());
		assert!(index.search("anything", 5).is_empty());
		assert!(index.note("A.md").is_none());
	}
}
