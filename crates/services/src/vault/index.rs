//! The learner's vault as godspeed reads it: every Markdown note under the vault folder (at most
//! `MAX_VAULT_NOTES`), kept in memory with what a search and the note writer need. A rescan
//! rereads only files whose time or size changed.

use std::collections::{HashMap, HashSet};
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use gs_base::fsx;
use gs_core::vault::frontmatter::{Doc, Owner};
use gs_core::vault::note_keys::{SPACE_KEY, STANDING_KEY};
use gs_files::walk::walk_markdown;
use gs_search::vault::{MAX_NOTE_CHARS, VaultEntry, VaultHit, VaultIndex, VaultOwner, first_chars};

/// The most notes read; a bigger vault is read in folder order up to this many.
pub const MAX_VAULT_NOTES: usize = 5_000;

/// What the reader keeps of one note.
pub struct Note {
	modified: Option<SystemTime>,
	size: u64,
	/// The file name without `.md`.
	pub name: String,
	/// The text under the frontmatter, cut to what the search ranks on.
	text: String,
	pub owner: Option<Owner>,
	/// The `class` and `confidence` keys, for godspeed's notes.
	pub space: Option<String>,
	pub standing: Option<String>,
}

pub struct VaultReader {
	root: PathBuf,
	notes: HashMap<String, Note>,
	/// The vault holds more notes than `MAX_VAULT_NOTES`.
	pub capped: bool,
	/// Built when a search needs it and dropped when a note changes.
	index: Option<VaultIndex>,
}

fn read_note(root: &Path, rel: &str) -> io::Result<Note> {
	let file = root.join(rel);
	let meta = std::fs::metadata(&file)?;
	let doc = Doc::parse(&fsx::read_text(&file)?);
	let name = rel.rsplit('/').next().unwrap_or(rel).trim_end_matches(".md").to_owned();
	Ok(Note { modified: meta.modified().ok(), size: meta.len(), name, text: first_chars(doc.body.trim(), MAX_NOTE_CHARS), owner: doc.owner(), space: doc.scalar(SPACE_KEY), standing: doc.scalar(STANDING_KEY) })
}

fn owner_of(note: &Note) -> VaultOwner {
	match note.owner {
		Some(Owner::Topic(_)) => VaultOwner::Godspeed,
		Some(Owner::Keep) => VaultOwner::Kept,
		None => VaultOwner::Learner,
	}
}

impl VaultReader {
	/// Reads the vault at `root`; Err when the folder cannot be read.
	pub fn open(root: &Path) -> io::Result<VaultReader> {
		let mut reader = VaultReader { root: root.to_owned(), notes: HashMap::new(), capped: false, index: None };
		reader.rescan()?;
		Ok(reader)
	}

	pub fn root(&self) -> &Path {
		&self.root
	}

	pub fn len(&self) -> usize {
		self.notes.len()
	}

	/// Looks at the vault again and rereads only new files and files whose time or size changed.
	/// Returns whether anything changed. A note that cannot be read is left out; Err only when the
	/// vault folder itself cannot be read, and the old notes stay.
	pub fn rescan(&mut self) -> io::Result<bool> {
		let walk = walk_markdown(&self.root, MAX_VAULT_NOTES)?;
		let mut changed = walk.capped != self.capped;
		self.capped = walk.capped;
		let mut next: HashMap<String, Note> = HashMap::with_capacity(walk.files.len());
		for rel in walk.files {
			let meta = std::fs::metadata(self.root.join(&rel)).ok();
			let same = match (self.notes.get(&rel), &meta) {
				(Some(old), Some(meta)) => old.size == meta.len() && old.modified == meta.modified().ok(),
				_ => false,
			};
			if same {
				next.insert(rel.clone(), self.notes.remove(&rel).expect("checked above"));
			} else if let Ok(note) = read_note(&self.root, &rel) {
				changed = true;
				next.insert(rel, note);
			}
		}
		// Whatever is left was removed or became unreadable.
		changed |= !self.notes.is_empty();
		self.notes = next;
		if changed {
			self.index = None;
		}
		Ok(changed)
	}

	/// Rereads one file after godspeed wrote it, so the next search and key lookup see it.
	pub fn reread(&mut self, rel: &str) {
		match read_note(&self.root, rel) {
			Ok(note) => self.notes.insert(rel.to_owned(), note),
			Err(_) => self.notes.remove(rel),
		};
		self.index = None;
	}

	pub fn note(&self, path: &str) -> Option<&Note> {
		self.notes.get(path)
	}

	/// The path of the note whose `godspeed` key is `topic_id`; the first in path order when a
	/// learner copied one.
	pub fn path_of_topic(&self, topic_id: &str) -> Option<&str> {
		self.notes_with(|n| n.owner == Some(Owner::Topic(topic_id.to_owned()))).into_iter().next()
	}

	/// The notes handed over with `godspeed: keep`, in path order.
	pub fn kept_paths(&self) -> Vec<&str> {
		self.notes_with(|n| n.owner == Some(Owner::Keep))
	}

	/// The notes named `name` (any case), in path order.
	pub fn paths_named(&self, name: &str) -> Vec<&str> {
		let lower = name.to_lowercase();
		self.notes_with(|n| n.name.to_lowercase() == lower)
	}

	/// The note names, lowercase.
	pub fn names(&self) -> HashSet<String> {
		self.notes.values().map(|n| n.name.to_lowercase()).collect()
	}

	/// The file names (`name.md`), lowercase, for choosing a new note's name vault-wide.
	pub fn file_names(&self) -> HashSet<String> {
		self.notes.values().map(|n| format!("{}.md", n.name.to_lowercase())).collect()
	}

	fn notes_with(&self, keep: impl Fn(&Note) -> bool) -> Vec<&str> {
		let mut paths: Vec<&str> = self.notes.iter().filter(|(_, n)| keep(n)).map(|(p, _)| p.as_str()).collect();
		paths.sort_unstable();
		paths
	}

	/// Up to `n` notes for the query, best first.
	pub fn search(&mut self, query: &str, n: usize) -> Vec<VaultHit> {
		let notes = &self.notes;
		let index = self.index.get_or_insert_with(|| {
			VaultIndex::new(notes.iter().map(|(path, note)| VaultEntry { path: path.clone(), title: note.name.clone(), text: note.text.clone(), owner: owner_of(note) }).collect())
		});
		index.search(query, n)
	}
}

#[cfg(test)]
mod tests {
	use std::fs;

	use super::*;

	pub struct Vault(pub PathBuf);

	impl Vault {
		pub fn new() -> Vault {
			let dir = std::env::temp_dir().join(format!("gs-vault-reader-{}", gs_base::ids::uuid()));
			fs::create_dir_all(&dir).unwrap();
			Vault(dir)
		}

		pub fn write(&self, rel: &str, text: &str) {
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
	fn notes_are_read_with_their_owner_and_found_by_search() {
		let vault = Vault::new();
		vault.write("CSE 21/Binary search.md", "---\ngodspeed: tpc_1\nclass: CSE 21\nconfidence: ok\n---\nHalve the range each step.\n");
		vault.write("Mine.md", "---\ngodspeed: keep\n---\nPigeonhole principle.\n");
		vault.write("Loose.md", "Pigeonhole again.\n");
		vault.write("notes.txt", "pigeonhole but not markdown");
		let mut reader = VaultReader::open(&vault.0).unwrap();
		assert_eq!(reader.len(), 3);
		let note = reader.note("CSE 21/Binary search.md").unwrap();
		assert_eq!((note.space.as_deref(), note.standing.as_deref()), (Some("CSE 21"), Some("ok")));
		assert_eq!(reader.path_of_topic("tpc_1"), Some("CSE 21/Binary search.md"));
		assert_eq!(reader.kept_paths(), ["Mine.md"]);
		assert_eq!(reader.paths_named("loose"), ["Loose.md"]);
		let hits = reader.search("pigeonhole", 10);
		assert_eq!(hits.len(), 2);
		assert!(hits.iter().any(|h| h.name == "Mine" && h.owner == VaultOwner::Kept));
	}

	#[test]
	fn a_vault_of_more_than_the_cap_is_read_up_to_the_cap() {
		let vault = Vault::new();
		for i in 0..MAX_VAULT_NOTES + 3 {
			fs::File::create(vault.0.join(format!("n{i:05}.md"))).unwrap();
		}
		let reader = VaultReader::open(&vault.0).unwrap();
		assert_eq!(reader.len(), MAX_VAULT_NOTES);
		assert!(reader.capped);
	}

	#[test]
	fn a_rescan_rereads_only_what_changed() {
		let vault = Vault::new();
		vault.write("A.md", "alpha text");
		vault.write("B.md", "beta text");
		let mut reader = VaultReader::open(&vault.0).unwrap();
		assert!(!reader.rescan().unwrap(), "nothing changed");
		// A file whose time and size are kept is not reread, so a swapped same-size body stays unseen.
		let a = vault.0.join("A.md");
		let before = fs::metadata(&a).unwrap().modified().unwrap();
		let mut file = fs::File::options().write(true).truncate(true).open(&a).unwrap();
		std::io::Write::write_all(&mut file, b"omega text").unwrap();
		file.set_modified(before).unwrap();
		assert!(!reader.rescan().unwrap());
		assert!(reader.search("omega", 5).is_empty());
		assert_eq!(reader.search("alpha", 5).len(), 1);
		// A new size is reread, a new file is added, a removed file is dropped.
		vault.write("A.md", "omega text longer now");
		vault.write("C.md", "gamma text");
		fs::remove_file(vault.0.join("B.md")).unwrap();
		assert!(reader.rescan().unwrap());
		assert_eq!(reader.search("omega", 5).len(), 1);
		assert!(reader.search("alpha", 5).is_empty());
		assert!(reader.search("beta", 5).is_empty());
		assert_eq!(reader.search("gamma", 5).len(), 1);
		assert_eq!(reader.len(), 2);
	}

	#[test]
	fn a_missing_vault_is_an_error_and_a_lost_one_keeps_the_old_notes() {
		let gone = std::env::temp_dir().join(format!("gs-vault-gone-{}", gs_base::ids::uuid()));
		assert!(VaultReader::open(&gone).is_err());
		let vault = Vault::new();
		vault.write("A.md", "alpha");
		let mut reader = VaultReader::open(&vault.0).unwrap();
		fs::remove_dir_all(&vault.0).unwrap();
		assert!(reader.rescan().is_err());
		assert_eq!(reader.len(), 1);
	}

	#[test]
	fn a_note_written_by_godspeed_is_seen_after_a_reread() {
		let vault = Vault::new();
		vault.write("A.md", "alpha");
		let mut reader = VaultReader::open(&vault.0).unwrap();
		vault.write("Sub/B.md", "---\ngodspeed: tpc_9\n---\nbeta");
		reader.reread("Sub/B.md");
		assert_eq!(reader.path_of_topic("tpc_9"), Some("Sub/B.md"));
		assert_eq!(reader.search("beta", 5).len(), 1);
		fs::remove_file(vault.0.join("Sub/B.md")).unwrap();
		reader.reread("Sub/B.md");
		assert_eq!(reader.path_of_topic("tpc_9"), None);
	}
}
