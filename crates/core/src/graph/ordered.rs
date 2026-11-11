//! A JavaScript `Map`: it iterates in insertion order.

use std::collections::HashMap;

/// A `Map<string, V>`: lookups by key, iteration in the order keys were first set.
pub struct OrderedMap<V> {
	entries: Vec<(String, V)>,
	index: HashMap<String, usize>,
}

impl<V> Default for OrderedMap<V> {
	fn default() -> Self {
		OrderedMap { entries: Vec::new(), index: HashMap::new() }
	}
}

impl<V> OrderedMap<V> {
	pub fn get_mut(&mut self, key: &str) -> Option<&mut V> {
		let i = *self.index.get(key)?;
		Some(&mut self.entries[i].1)
	}

	/// `map.set(key, value)`: an existing key keeps its place.
	pub fn insert(&mut self, key: &str, value: V) {
		match self.index.get(key) {
			Some(&i) => self.entries[i].1 = value,
			None => {
				self.index.insert(key.to_owned(), self.entries.len());
				self.entries.push((key.to_owned(), value));
			}
		}
	}

	/// The value under `key`, set to `make()` first when the key is new.
	pub fn get_or_insert_with(&mut self, key: &str, make: impl FnOnce() -> V) -> &mut V {
		let i = match self.index.get(key) {
			Some(&i) => i,
			None => {
				self.index.insert(key.to_owned(), self.entries.len());
				self.entries.push((key.to_owned(), make()));
				self.entries.len() - 1
			}
		};
		&mut self.entries[i].1
	}

	pub fn iter(&self) -> impl Iterator<Item = (&str, &V)> {
		self.entries.iter().map(|(k, v)| (k.as_str(), v))
	}

	pub fn into_entries(self) -> Vec<(String, V)> {
		self.entries
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn maps_iterate_in_first_insertion_order() {
		let mut m = OrderedMap::default();
		m.insert("b", 1);
		m.insert("a", 2);
		m.insert("b", 3);
		*m.get_or_insert_with("c", || 0) += 5;
		assert_eq!(m.iter().collect::<Vec<_>>(), [("b", &3), ("a", &2), ("c", &5)]);
		assert_eq!(m.into_entries().len(), 3);
	}
}
