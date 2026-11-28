//! `Json` through serde, and the `json!` macro, which builds a `Json` from serde_json's syntax.

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

/// Builds a `Json` with serde_json's `json!` syntax; keys keep the written order.
#[macro_export]
macro_rules! json {
	($($tt:tt)+) => {
		$crate::serde_bridge::from_value($crate::__serde_json::json!($($tt)+))
	};
}

#[cfg(test)]
mod tests {
	use crate::{parse, stringify};

	#[test]
	fn json_macro_keeps_order_and_embeds_values() {
		let inner = parse(r#"{"z":1,"a":2}"#).unwrap();
		let half = parse(r#""\ud800""#).unwrap();
		let v = json!({ "b": 1, "a": [true, null, 1.5], "inner": inner, "half": half, "2": "two" });
		assert_eq!(stringify(&v), r#"{"2":"two","b":1,"a":[true,null,1.5],"inner":{"z":1,"a":2},"half":"\ud800"}"#);
	}
}
