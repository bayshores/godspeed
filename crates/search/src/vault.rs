//! A keyword index over the Markdown notes in the learner's Obsidian vault, for the teacher's
//! vault search. It lives in memory only and never touches a graph. `rescan` rereads only the
//! files whose time or size changed; the app calls it every minute, as it does for a linked folder.

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use gs_base::fsx;
use gs_core::vault::frontmatter::{Doc, Owner};
use gs_files::walk::walk_markdown;

use crate::keyword::{KeywordIndex, keyword_index, keyword_ranking};

/// The most notes read; a bigger vault is indexed in folder order up to this many.
pub const MAX_VAULT_NOTES: usize = 5_000;
const SNIPPET_CHARS: usize = 200;
/// Text kept per note for ranking, so a huge file cannot fill memory.
const MAX_NOTE_CHARS: usize = 10_000;

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

#[derive(Debug, Clone, PartialEq)]
pub struct VaultHit {
	/// The file name without `.md`.
	pub name: String,
	/// Relative to the vault, with `/`.
	pub path: String,
	pub owner: VaultOwner,
	/// The first 200 characters of the note under its frontmatter.
	pub snippet: String,
}

struct Entry {
	modified: Option<SystemTime>,
	size: u64,
	hit: VaultHit,
	/// The name and the note's text, what the search ranks on.
	text: String,
}

pub struct VaultIndex {
	root: PathBuf,
	entries: HashMap<String, Entry>,
	words: KeywordIndex,
	/// The vault holds more notes than `MAX_VAULT_NOTES`.
	pub capped: bool,
}

fn owner_of(doc: &Doc) -> VaultOwner {
	match doc.owner() {
		Some(Owner::Topic(_)) => VaultOwner::Godspeed,
		Some(Owner::Keep) => VaultOwner::Kept,
		None => VaultOwner::Learner,
	}
}

fn first_chars(text: &str, n: usize) -> String {
	text.chars().take(n).collect()
}

fn read_entry(root: &Path, rel: &str) -> io::Result<Entry> {
	let file = root.join(rel);
	let meta = std::fs::metadata(&file)?;
	let doc = Doc::parse(&fsx::read_text(&file)?);
	let name = rel.rsplit('/').next().unwrap_or(rel).trim_end_matches(".md").to_owned();
	let body = doc.body.trim();
	let text = format!("{name}\n{}", first_chars(body, MAX_NOTE_CHARS));
	let snippet = first_chars(&body.split_whitespace().collect::<Vec<_>>().join(" "), SNIPPET_CHARS);
	Ok(Entry { modified: meta.modified().ok(), size: meta.len(), hit: VaultHit { name, path: rel.to_owned(), owner: owner_of(&doc), snippet }, text })
}

fn rank_words(entries: &HashMap<String, Entry>) -> KeywordIndex {
	keyword_index(entries.iter().map(|(path, e)| (path.as_str(), e.text.as_str()))).expect("paths are distinct")
}

impl VaultIndex {
	/// The index of the vault at `root`; Err when the folder cannot be read.
	pub fn open(root: &Path) -> io::Result<VaultIndex> {
		let mut index = VaultIndex { root: root.to_owned(), entries: HashMap::new(), words: rank_words(&HashMap::new()), capped: false };
		index.rescan()?;
		Ok(index)
	}

	/// Looks at the vault again and rereads only new files and files whose time or size changed.
	/// Returns whether anything changed. A note that cannot be read is left out; Err only when
	/// the vault folder itself cannot be read, and the old index stays.
	pub fn rescan(&mut self) -> io::Result<bool> {
		let walk = walk_markdown(&self.root, MAX_VAULT_NOTES)?;
		let mut changed = walk.capped != self.capped;
		self.capped = walk.capped;
		let mut next: HashMap<String, Entry> = HashMap::with_capacity(walk.files.len());
		for rel in walk.files {
			let meta = std::fs::metadata(self.root.join(&rel)).ok();
			let same = match (self.entries.get(&rel), &meta) {
				(Some(old), Some(meta)) => old.size == meta.len() && old.modified == meta.modified().ok(),
				_ => false,
			};
			if same {
				next.insert(rel.clone(), self.entries.remove(&rel).expect("checked above"));
				continue;
			}
			if let Ok(entry) = read_entry(&self.root, &rel) {
				changed = true;
				next.insert(rel, entry);
			}
		}
		if !self.entries.is_empty() {
			// Whatever is left was removed (or became unreadable).
			changed = true;
		}
		self.entries = next;
		if changed {
			self.words = rank_words(&self.entries);
		}
		Ok(changed)
	}

	pub fn len(&self) -> usize {
		self.entries.len()
	}

	pub fn is_empty(&self) -> bool {
		self.entries.is_empty()
	}

	/// Up to `n` notes for the query, best first. A search that matches nothing finds nothing; no
	/// score is cut off.
	pub fn search(&self, query: &str, n: usize) -> Vec<VaultHit> {
		keyword_ranking(&self.words, query, n).iter().filter_map(|path| self.entries.get(path)).map(|e| e.hit.clone()).collect()
	}

	/// The note at `path` (relative to the vault), if it was read.
	pub fn note(&self, path: &str) -> Option<&VaultHit> {
		self.entries.get(path).map(|e| &e.hit)
	}
}

#[cfg(test)]
mod tests {
	use std::fs;

	use super::*;

	struct Vault(PathBuf);

	impl Vault {
		fn new() -> Vault {
			let dir = std::env::temp_dir().join(format!("gs-vault-index-{}", gs_base::ids::uuid()));
			fs::create_dir_all(&dir).unwrap();
			Vault(dir)
		}

		fn write(&self, rel: &str, text: &str) {
			let file = self.0.join(rel);
			fs::create_dir_all(file.parent().unwrap()).unwrap();
			fsx::write_text_atomic(&file, text).unwrap();
		}
	}

	impl Drop for Vault {
		fn drop(&mut self) {
			let _ = fs::remove_dir_all(&self.0);
		}
	}

	#[test]
	fn notes_are_found_by_their_name_or_text_with_owner_and_snippet() {
		let vault = Vault::new();
		vault.write("CSE 21/Binary search.md", "---\ngodspeed: tpc_1\nclass: CSE 21\n---\nHalve the range each step.\n\nIt needs sorted input.\n");
		vault.write("Mine.md", "---\ngodspeed: keep\n---\nPigeonhole principle, my words.\n");
		vault.write("Loose.md", "Pigeonhole again, no frontmatter at all.\n");
		vault.write("notes.txt", "pigeonhole but not markdown");
		let index = VaultIndex::open(&vault.0).unwrap();
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
		let vault = Vault::new();
		vault.write("Long.md", &format!("---\nx: 1\n---\n{}", "é".repeat(500)));
		let index = VaultIndex::open(&vault.0).unwrap();
		assert_eq!(index.note("Long.md").unwrap().snippet.chars().count(), 200);
	}

	#[test]
	fn a_vault_of_more_than_the_cap_is_read_up_to_the_cap() {
		let vault = Vault::new();
		for i in 0..MAX_VAULT_NOTES + 3 {
			fs::File::create(vault.0.join(format!("n{i:05}.md"))).unwrap();
		}
		let index = VaultIndex::open(&vault.0).unwrap();
		assert_eq!(index.len(), MAX_VAULT_NOTES);
		assert!(index.capped);
	}

	#[test]
	fn a_rescan_rereads_only_what_changed() {
		let vault = Vault::new();
		vault.write("A.md", "alpha text");
		vault.write("B.md", "beta text");
		let mut index = VaultIndex::open(&vault.0).unwrap();
		assert!(!index.rescan().unwrap(), "nothing changed");
		// A file whose time and size are kept is not reread, so a swapped same-size body stays unseen.
		let a = vault.0.join("A.md");
		let before = fs::metadata(&a).unwrap().modified().unwrap();
		let mut file = fs::File::options().write(true).truncate(true).open(&a).unwrap();
		std::io::Write::write_all(&mut file, b"omega text").unwrap();
		file.set_modified(before).unwrap();
		assert!(!index.rescan().unwrap());
		assert!(index.search("omega", 5).is_empty());
		assert_eq!(index.search("alpha", 5).len(), 1);
		// A new size is reread, a new file is added, a removed file is dropped.
		vault.write("A.md", "omega text longer now");
		vault.write("C.md", "gamma text");
		fs::remove_file(vault.0.join("B.md")).unwrap();
		assert!(index.rescan().unwrap());
		assert_eq!(index.search("omega", 5).len(), 1);
		assert!(index.search("alpha", 5).is_empty());
		assert!(index.search("beta", 5).is_empty());
		assert_eq!(index.search("gamma", 5).len(), 1);
		assert_eq!(index.len(), 2);
	}

	#[test]
	fn a_missing_vault_is_an_error_and_a_lost_one_keeps_the_old_index() {
		let gone = std::env::temp_dir().join(format!("gs-vault-gone-{}", gs_base::ids::uuid()));
		assert!(VaultIndex::open(&gone).is_err());
		let vault = Vault::new();
		vault.write("A.md", "alpha");
		let mut index = VaultIndex::open(&vault.0).unwrap();
		fs::remove_dir_all(&vault.0).unwrap();
		assert!(index.rescan().is_err());
		assert_eq!(index.len(), 1);
	}
}
