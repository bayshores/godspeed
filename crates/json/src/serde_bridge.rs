//! Typed Rust values to and from `Json` through serde, and the `json!` macro. A struct's fields
//! come out in declaration order, so declare them in the order the TypeScript object literal
//! lists them. Records read from disk and written back stay `Json` instead (unknown keys and
//! their places survive).

use serde::de::DeserializeOwned;
use serde::ser::{Serialize, SerializeMap, SerializeSeq, Serializer};

use crate::{Json, Obj};

impl Serialize for Json {
	fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
		match self {
			Json::Null => s.serialize_unit(),
			Json::Bool(b) => s.serialize_bool(*b),
			Json::Num(n) => s.serialize_f64(*n),
			Json::Str(t) => s.serialize_str(t),
			Json::Arr(items) => {
				let mut seq = s.serialize_seq(Some(items.len()))?;
				for item in items {
					seq.serialize_element(item)?;
				}
				seq.end()
			}
			Json::Obj(obj) => {
				let mut map = s.serialize_map(Some(obj.len()))?;
				for (k, v) in obj {
					map.serialize_entry(k, v)?;
				}
				map.end()
			}
		}
	}
}

/// A typed value as `Json`.
pub fn to_json<T: Serialize + ?Sized>(value: &T) -> Json {
	from_value(serde_json::to_value(value).expect("serializing to a JSON value cannot fail for data types"))
}

/// A typed value read from `Json` (fails like a serde_json read on a shape mismatch).
pub fn from_json<T: DeserializeOwned>(value: &Json) -> Result<T, serde_json::Error> {
	serde_json::from_value(to_value(value))
}

#[doc(hidden)]
pub fn from_value(value: serde_json::Value) -> Json {
	match value {
		serde_json::Value::Null => Json::Null,
		serde_json::Value::Bool(b) => Json::Bool(b),
		serde_json::Value::Number(n) => Json::Num(n.as_f64().unwrap_or(f64::NAN)),
		serde_json::Value::String(s) => Json::Str(s),
		serde_json::Value::Array(items) => Json::Arr(items.into_iter().map(from_value).collect()),
		serde_json::Value::Object(map) => Json::Obj(map.into_iter().map(|(k, v)| (k, from_value(v))).collect::<Obj>()),
	}
}

fn to_value(value: &Json) -> serde_json::Value {
	match value {
		Json::Null => serde_json::Value::Null,
		Json::Bool(b) => serde_json::Value::Bool(*b),
		Json::Num(n) => integral(*n).or_else(|| serde_json::Number::from_f64(*n)).map_or(serde_json::Value::Null, serde_json::Value::Number),
		Json::Str(s) => serde_json::Value::String(s.clone()),
		Json::Arr(items) => serde_json::Value::Array(items.iter().map(to_value).collect()),
		Json::Obj(obj) => serde_json::Value::Object(obj.iter().map(|(k, v)| (k.clone(), to_value(v))).collect()),
	}
}

/// Whole numbers go to serde as integers, so `u32` and `i64` fields read them.
fn integral(n: f64) -> Option<serde_json::Number> {
	(n.fract() == 0.0 && n.abs() < 9.007_199_254_740_992e15).then(|| serde_json::Number::from(n as i64))
}

/// Builds a `Json` with serde_json's `json!` syntax; keys keep the written order.
#[macro_export]
macro_rules! json {
	($($tt:tt)+) => {
		$crate::serde_bridge::from_value($crate::__serde_json::json!($($tt)+))
	};
}

#[cfg(test)]
mod tests {
	use serde::{Deserialize, Serialize};

	use super::*;
	use crate::{parse, stringify};

	#[derive(Serialize, Deserialize, Debug, PartialEq)]
	#[serde(rename_all = "camelCase")]
	struct Note {
		id: String,
		text: String,
		#[serde(skip_serializing_if = "Option::is_none")]
		class_id: Option<String>,
		created_at: String,
		count: u32,
	}

	#[test]
	fn typed_values_keep_field_order_and_skip_absent() {
		let note = Note { id: "note_1".into(), text: "hi".into(), class_id: None, created_at: "t".into(), count: 3 };
		assert_eq!(stringify(&to_json(&note)), r#"{"id":"note_1","text":"hi","createdAt":"t","count":3}"#);
		let back: Note = from_json(&parse(r#"{"count":3,"createdAt":"t","text":"hi","id":"note_1","extra":1}"#).unwrap()).unwrap();
		assert_eq!(back, note);
	}

	#[test]
	fn json_macro_keeps_order_and_embeds_values() {
		let inner = parse(r#"{"z":1,"a":2}"#).unwrap();
		let half = parse(r#""\ud800""#).unwrap();
		let v = json!({ "b": 1, "a": [true, null, 1.5], "inner": inner, "half": half, "2": "two" });
		assert_eq!(stringify(&v), r#"{"2":"two","b":1,"a":[true,null,1.5],"inner":{"z":1,"a":2},"half":"\ud800"}"#);
	}
}
