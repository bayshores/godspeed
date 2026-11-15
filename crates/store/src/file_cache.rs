//! Parsed file contents kept while the file's modified time and size are unchanged, so a read
//! does not parse a whole file again.

use std::borrow::Borrow;
use std::collections::HashMap;
use std::hash::Hash;
use std::path::Path;
use std::time::SystemTime;

use parking_lot::Mutex;

struct Entry<T> {
	version: (Option<SystemTime>, u64),
	value: T,
}

pub(crate) struct FileCache<K, T> {
	entries: Mutex<HashMap<K, Entry<T>>>,
}

impl<K: Hash + Eq, T: Clone> FileCache<K, T> {
	pub(crate) fn new() -> FileCache<K, T> {
		FileCache { entries: Mutex::new(HashMap::new()) }
	}

	/// `file`'s parsed value for `key`: the kept one while the file is unchanged, else `parse`'s,
	/// which is then kept. None when the file is missing, or when `parse` gives none (not kept).
	pub(crate) fn load<Q>(&self, key: &Q, file: &Path, parse: impl FnOnce() -> Option<T>) -> Option<T>
	where
		K: Borrow<Q>,
		Q: Hash + Eq + ToOwned<Owned = K> + ?Sized,
	{
		let Ok(meta) = std::fs::metadata(file) else {
			self.remove(key);
			return None;
		};
		let version = (meta.modified().ok(), meta.len());
		if let Some(hit) = self.entries.lock().get(key).filter(|hit| hit.version == version) {
			return Some(hit.value.clone());
		}
		let value = parse()?;
		self.entries.lock().insert(key.to_owned(), Entry { version, value: value.clone() });
		Some(value)
	}

	pub(crate) fn remove<Q: Hash + Eq + ?Sized>(&self, key: &Q)
	where
		K: Borrow<Q>,
	{
		self.entries.lock().remove(key);
	}

	/// Keeps only the entries whose key `keep` says yes to.
	pub(crate) fn retain_keys(&self, mut keep: impl FnMut(&K) -> bool) {
		self.entries.lock().retain(|key, _| keep(key));
	}
}
