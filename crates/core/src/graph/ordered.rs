//! JavaScript ordering: strings compare by UTF-16 unit, and a `Map` iterates in insertion order.

use std::cmp::Ordering;
use std::collections::HashMap;

use gs_json::lone;

/// `a < b` and the default `sort()` order of JS strings. It differs from Rust's byte order for
/// characters above U+FFFF, which sort between U+D7FF and U+E000 in UTF-16.
pub fn cmp16(a: &str, b: &str) -> Ordering {
	if a.is_ascii() && b.is_ascii() { a.cmp(b) } else { lone::to_utf16(a).cmp(&lone::to_utf16(b)) }
}

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
	fn utf16_order_puts_astral_before_the_top_of_the_bmp() {
		assert_eq!(cmp16("\u{1F600}", "\u{FF5E}"), Ordering::Less);
		assert!("\u{1F600}" > "\u{FF5E}");
		assert_eq!(cmp16("a", "b"), Ordering::Less);
		assert_eq!(cmp16("B", "a"), Ordering::Less);
	}

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
