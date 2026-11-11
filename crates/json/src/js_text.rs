//! What a JavaScript template literal prints for a value (`${x}`), for text the agent reads.

use crate::{Json, js_number};

/// `String(n)`: unlike JSON, NaN and the infinities have names.
pub fn num_text(n: f64) -> String {
	if n.is_nan() {
		"NaN".to_owned()
	} else if n.is_infinite() {
		if n > 0.0 { "Infinity" } else { "-Infinity" }.to_owned()
	} else {
		js_number(n)
	}
}

/// `` `${v}` `` for a value that may be missing (None is `undefined`).
pub fn js_string(v: Option<&Json>) -> String {
	match v {
		None => "undefined".to_owned(),
		Some(Json::Null) => "null".to_owned(),
		Some(Json::Bool(b)) => b.to_string(),
		Some(Json::Num(n)) => num_text(*n),
		Some(Json::Str(s)) => s.clone(),
		Some(Json::Arr(items)) => items.iter().map(|i| or_empty(Some(i))).collect::<Vec<_>>().join(","),
		Some(Json::Obj(_)) => "[object Object]".to_owned(),
	}
}

/// What `Array.prototype.join` prints for an item, and a template for `v ?? ""`: nothing for
/// null or undefined.
pub fn or_empty(v: Option<&Json>) -> String {
	match v {
		None | Some(Json::Null) => String::new(),
		v => js_string(v),
	}
}

/// `` `${obj.key}` ``: the property of a record, `undefined` when it is missing.
pub fn field_text(record: &Json, key: &str) -> String {
	js_string(record.get(key))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::json;

	#[test]
	fn prints_like_a_template_literal() {
		let v = json!({ "a": [1, null, "x", [2, 3]], "n": null, "b": true, "f": 1.5, "o": {} });
		assert_eq!(field_text(&v, "a"), "1,,x,2,3");
		assert_eq!(field_text(&v, "n"), "null");
		assert_eq!(field_text(&v, "missing"), "undefined");
		assert_eq!(field_text(&v, "b"), "true");
		assert_eq!(field_text(&v, "f"), "1.5");
		assert_eq!(field_text(&v, "o"), "[object Object]");
		assert_eq!(num_text(f64::NAN), "NaN");
		assert_eq!(num_text(f64::NEG_INFINITY), "-Infinity");
		assert_eq!(num_text(-0.0), "0");
	}
}
