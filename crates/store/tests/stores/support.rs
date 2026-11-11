use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use gs_base::config::Paths;
use gs_base::events::Events;
use gs_base::locks::Locks;
use gs_base::{fsx, hash};
use gs_json::{parse, stringify_pretty};

static COUNTER: AtomicUsize = AtomicUsize::new(0);

/// A fresh, empty data folder for one test.
pub struct Lab {
	pub paths: Paths,
	pub locks: Locks,
	pub events: Events,
}

impl Lab {
	pub fn new(name: &str) -> Lab {
		let root = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("{name}-{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed)));
		let _ = std::fs::remove_dir_all(&root);
		std::fs::create_dir_all(root.join("data")).unwrap();
		let paths = Paths::new(root.join("data"), root.join("home"), root.join("tmp"), root.join("resources"));
		Lab { paths, locks: Locks::new(), events: Events::new() }
	}

	pub fn file(&self, rel: &str) -> PathBuf {
		self.paths.data.join(rel)
	}

	pub fn put(&self, rel: &str, text: &str) {
		fsx::write_text_atomic(&self.file(rel), text).unwrap();
	}

	pub fn get(&self, rel: &str) -> String {
		std::fs::read_to_string(self.file(rel)).unwrap()
	}

	pub fn exists(&self, rel: &str) -> bool {
		self.file(rel).exists()
	}

	/// Sorted file names in a folder of the data folder.
	pub fn names(&self, rel: &str) -> Vec<String> {
		let mut names: Vec<String> = std::fs::read_dir(self.file(rel)).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
		names.sort();
		names
	}

	/// What `sha256` of a file looks like in the contract recordings: its first 16 hex digits.
	pub fn hash(&self, rel: &str) -> String {
		hash::sha256_hex(&std::fs::read(self.file(rel)).unwrap())[..16].to_owned()
	}

	/// Like `hash`, with ids and dates swapped for the placeholders the recordings show.
	pub fn hash_normalized(&self, rel: &str, swaps: &[(&str, &str)]) -> String {
		let text = swaps.iter().fold(self.get(rel), |text, (from, to)| text.replace(from, to));
		hash::sha256_hex(text.as_bytes())[..16].to_owned()
	}

	/// The text of every file in the data folder whose name starts with `prefix`.
	pub fn aside(&self, prefix: &str) -> Vec<String> {
		self.names(".").into_iter().filter(|n| n.starts_with(prefix)).map(|n| self.get(&n)).collect()
	}

	/// Copies a file or folder of the seed data into the data folder. False when the copy is not on
	/// this machine, so the test can skip.
	pub fn copy_seed(&self, rel: &str) -> bool {
		let Some(from) = seed(rel) else { return false };
		copy(&from, &self.file(rel));
		true
	}
}

/// A path inside the read-only copy of real app data kept outside the repo.
pub fn seed(rel: &str) -> Option<PathBuf> {
	let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../rewrite-lab/seed-data").join(rel);
	if path.exists() {
		Some(path)
	} else {
		eprintln!("skipped: no seed data at {}", path.display());
		None
	}
}

fn copy(from: &Path, to: &Path) {
	if from.is_dir() {
		std::fs::create_dir_all(to).unwrap();
		for entry in std::fs::read_dir(from).unwrap().flatten() {
			copy(&entry.path(), &to.join(entry.file_name()));
		}
	} else {
		std::fs::create_dir_all(to.parent().unwrap()).unwrap();
		std::fs::copy(from, to).unwrap();
	}
}

/// JSON text laid out the way `JSON.stringify(value, null, "\t")` does.
pub fn tabbed(json: &str) -> String {
	stringify_pretty(&parse(json).unwrap(), "\t")
}
