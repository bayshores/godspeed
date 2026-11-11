//! The JSON value: what `JSON.parse` gives and `JSON.stringify` takes. Numbers are f64 like
//! JavaScript's; objects keep JavaScript's key order (object.rs); strings may carry lone
//! surrogates as stand-ins (lone.rs).

use std::ops::Index;

use crate::Obj;

#[derive(Clone, Debug, Default, PartialEq)]
pub enum Json {
	#[default]
	Null,
	Bool(bool),
	Num(f64),
	Str(String),
	Arr(Vec<Json>),
	Obj(Obj),
}

static NULL: Json = Json::Null;

/// Largest integer an f64 holds exactly (`Number.MAX_SAFE_INTEGER`).
const MAX_SAFE: f64 = 9_007_199_254_740_991.0;

impl Json {
	pub fn is_null(&self) -> bool {
		matches!(self, Json::Null)
	}

	pub fn as_bool(&self) -> Option<bool> {
		match self {
			Json::Bool(b) => Some(*b),
			_ => None,
		}
	}

	pub fn as_f64(&self) -> Option<f64> {
		match self {
			Json::Num(n) => Some(*n),
			_ => None,
		}
	}

	/// The number when it is a whole number JavaScript holds exactly.
	pub fn as_i64(&self) -> Option<i64> {
		match self {
			Json::Num(n) if n.fract() == 0.0 && n.abs() <= MAX_SAFE => Some(*n as i64),
			_ => None,
		}
	}

	pub fn as_str(&self) -> Option<&str> {
		match self {
			Json::Str(s) => Some(s),
			_ => None,
		}
	}

	/// The string, or "" for any other value.
	pub fn str_or_empty(&self) -> &str {
		self.as_str().unwrap_or("")
	}

	pub fn as_arr(&self) -> Option<&Vec<Json>> {
		match self {
			Json::Arr(a) => Some(a),
			_ => None,
		}
	}

	pub fn as_arr_mut(&mut self) -> Option<&mut Vec<Json>> {
		match self {
			Json::Arr(a) => Some(a),
			_ => None,
		}
	}

	pub fn as_obj(&self) -> Option<&Obj> {
		match self {
			Json::Obj(o) => Some(o),
			_ => None,
		}
	}

	pub fn as_obj_mut(&mut self) -> Option<&mut Obj> {
		match self {
			Json::Obj(o) => Some(o),
			_ => None,
		}
	}

	/// `obj[key]` for an object; None for a missing key or a value that is not an object.
	pub fn get(&self, key: &str) -> Option<&Json> {
		self.as_obj().and_then(|o| o.get(key))
	}

	pub fn get_mut(&mut self, key: &str) -> Option<&mut Json> {
		self.as_obj_mut().and_then(|o| o.get_mut(key))
	}

	/// JavaScript truthiness: false for null, false, 0, NaN and "".
	pub fn truthy(&self) -> bool {
		match self {
			Json::Null => false,
			Json::Bool(b) => *b,
			Json::Num(n) => *n != 0.0 && !n.is_nan(),
			Json::Str(s) => !s.is_empty(),
			Json::Arr(_) | Json::Obj(_) => true,
		}
	}
}

/// `value["key"]`: Null when absent, like serde_json, so chains read like the TypeScript.
impl Index<&str> for Json {
	type Output = Json;
	fn index(&self, key: &str) -> &Json {
		self.get(key).unwrap_or(&NULL)
	}
}

/// `value[i]`: Null when out of range or not an array.
impl Index<usize> for Json {
	type Output = Json;
	fn index(&self, i: usize) -> &Json {
		self.as_arr().and_then(|a| a.get(i)).unwrap_or(&NULL)
	}
}

impl From<bool> for Json {
	fn from(b: bool) -> Json {
		Json::Bool(b)
	}
}

impl From<f64> for Json {
	fn from(n: f64) -> Json {
		Json::Num(n)
	}
}

macro_rules! from_int {
	($($t:ty),*) => {$(
		impl From<$t> for Json {
			fn from(n: $t) -> Json {
				Json::Num(n as f64)
			}
		}
	)*};
}
from_int!(i32, i64, u32, u64, usize);

impl From<&str> for Json {
	fn from(s: &str) -> Json {
		Json::Str(s.to_owned())
	}
}

impl From<String> for Json {
	fn from(s: String) -> Json {
		Json::Str(s)
	}
}

impl From<&String> for Json {
	fn from(s: &String) -> Json {
		Json::Str(s.clone())
	}
}

impl From<Obj> for Json {
	fn from(o: Obj) -> Json {
		Json::Obj(o)
	}
}

impl<T: Into<Json>> From<Vec<T>> for Json {
	fn from(v: Vec<T>) -> Json {
		Json::Arr(v.into_iter().map(Into::into).collect())
	}
}

/// None is null, as `JSON.stringify` writes `undefined` inside arrays.
impl<T: Into<Json>> From<Option<T>> for Json {
	fn from(v: Option<T>) -> Json {
		v.map_or(Json::Null, Into::into)
	}
}

impl<T: Into<Json>> FromIterator<T> for Json {
	fn from_iter<I: IntoIterator<Item = T>>(iter: I) -> Json {
		Json::Arr(iter.into_iter().map(Into::into).collect())
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn index_and_accessors_read_like_javascript() {
		let v = crate::parse(r#"{"a":{"b":[1,2.5,"x"]},"n":null}"#).unwrap();
		assert_eq!(v["a"]["b"][1].as_f64(), Some(2.5));
		assert_eq!(v["a"]["b"][0].as_i64(), Some(1));
		assert_eq!(v["a"]["b"][1].as_i64(), None);
		assert!(v["missing"]["deeper"].is_null());
		assert!(v["n"].is_null());
		assert_eq!(v["a"]["b"][2].as_str(), Some("x"));
		assert_eq!(v["a"]["b"][9], Json::Null);
		assert!(!Json::Num(f64::NAN).truthy());
		assert!(Json::Arr(vec![]).truthy());
		assert!(!Json::from("").truthy());
	}
}
