//! A JSON object with JavaScript's key order: keys that are array indices ("0", "7", "42") come
//! first in ascending order, every other key keeps the order it was first added in. Setting a key
//! that exists keeps its place, as assignment and object spread do in JavaScript.

use indexmap::IndexMap;

use crate::Json;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Obj {
	map: IndexMap<String, Json>,
	/// How many keys at the front are array indices.
	indices: usize,
}

/// The key's value as an array index: "0" or no leading zero, below 2^32 - 1.
fn array_index(key: &str) -> Option<u32> {
	let b = key.as_bytes();
	if b.is_empty() || b.len() > 10 || (b.len() > 1 && b[0] == b'0') || !b.iter().all(u8::is_ascii_digit) {
		return None;
	}
	let n: u64 = key.parse().ok()?;
	(n < u64::from(u32::MAX)).then_some(n as u32)
}

impl Obj {
	pub fn new() -> Obj {
		Obj::default()
	}

	pub fn len(&self) -> usize {
		self.map.len()
	}

	pub fn is_empty(&self) -> bool {
		self.map.is_empty()
	}

	pub fn get(&self, key: &str) -> Option<&Json> {
		self.map.get(key)
	}

	pub fn get_mut(&mut self, key: &str) -> Option<&mut Json> {
		self.map.get_mut(key)
	}

	pub fn contains_key(&self, key: &str) -> bool {
		self.map.contains_key(key)
	}

	/// Sets `key`, returning the old value. A new key goes where JavaScript would put it.
	pub fn insert(&mut self, key: impl Into<String>, value: impl Into<Json>) -> Option<Json> {
		let key = key.into();
		let value = value.into();
		if let Some(slot) = self.map.get_mut(&key) {
			return Some(std::mem::replace(slot, value));
		}
		match array_index(&key) {
			Some(n) => {
				let at = self.map.keys().take(self.indices).position(|k| array_index(k).is_some_and(|m| m > n)).unwrap_or(self.indices);
				self.map.shift_insert(at, key, value);
				self.indices += 1;
			}
			None => {
				self.map.insert(key, value);
			}
		}
		None
	}

	/// Removes `key` keeping the order of the rest (`delete obj.key`).
	pub fn remove(&mut self, key: &str) -> Option<Json> {
		let (at, _, value) = self.map.shift_remove_full(key)?;
		if at < self.indices {
			self.indices -= 1;
		}
		Some(value)
	}

	pub fn iter(&self) -> impl DoubleEndedIterator<Item = (&String, &Json)> + ExactSizeIterator {
		self.map.iter()
	}

	pub fn iter_mut(&mut self) -> impl DoubleEndedIterator<Item = (&String, &mut Json)> + ExactSizeIterator {
		self.map.iter_mut()
	}

	pub fn keys(&self) -> impl DoubleEndedIterator<Item = &String> + ExactSizeIterator {
		self.map.keys()
	}

	pub fn values(&self) -> impl DoubleEndedIterator<Item = &Json> + ExactSizeIterator {
		self.map.values()
	}

	/// Keeps the entries `keep` says yes to, in order.
	pub fn retain(&mut self, mut keep: impl FnMut(&String, &mut Json) -> bool) {
		self.map.retain(|k, v| keep(k, v));
		self.indices = self.map.keys().take_while(|k| array_index(k).is_some()).count();
	}
}

impl IntoIterator for Obj {
	type Item = (String, Json);
	type IntoIter = indexmap::map::IntoIter<String, Json>;
	fn into_iter(self) -> Self::IntoIter {
		self.map.into_iter()
	}
}

impl<'a> IntoIterator for &'a Obj {
	type Item = (&'a String, &'a Json);
	type IntoIter = indexmap::map::Iter<'a, String, Json>;
	fn into_iter(self) -> Self::IntoIter {
		self.map.iter()
	}
}

impl<K: Into<String>, V: Into<Json>> FromIterator<(K, V)> for Obj {
	fn from_iter<I: IntoIterator<Item = (K, V)>>(iter: I) -> Obj {
		let mut obj = Obj::new();
		for (k, v) in iter {
			obj.insert(k, v);
		}
		obj
	}
}

impl<K: Into<String>, V: Into<Json>> Extend<(K, V)> for Obj {
	fn extend<I: IntoIterator<Item = (K, V)>>(&mut self, iter: I) {
		for (k, v) in iter {
			self.insert(k, v);
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn keys(o: &Obj) -> Vec<&str> {
		o.keys().map(String::as_str).collect()
	}

	#[test]
	fn index_keys_go_first_in_number_order() {
		let o: Obj = [("b", 1), ("10", 2), ("a", 3), ("2", 4), ("01", 5), ("4294967295", 6), ("4294967294", 7)].into_iter().collect();
		assert_eq!(keys(&o), ["2", "10", "4294967294", "b", "a", "01", "4294967295"]);
	}

	#[test]
	fn assignment_keeps_the_place_and_delete_keeps_the_rest() {
		let mut o: Obj = [("a", 1), ("b", 2), ("c", 3)].into_iter().collect();
		o.insert("a", 9);
		assert_eq!(keys(&o), ["a", "b", "c"]);
		assert_eq!(o.get("a"), Some(&Json::Num(9.0)));
		o.remove("b");
		o.insert("b", 2);
		assert_eq!(keys(&o), ["a", "c", "b"]);
		o.insert("1", 0);
		o.insert("0", 0);
		o.remove("0");
		o.insert("5", 0);
		assert_eq!(keys(&o), ["1", "5", "a", "c", "b"]);
		o.retain(|k, _| k != "1");
		o.insert("3", 0);
		assert_eq!(keys(&o), ["3", "5", "a", "c", "b"]);
	}
}
