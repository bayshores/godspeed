//! JavaScript's `String(x)` for a JSON value, for messages that interpolate untrusted fields.

use gs_json::{Json, js_number};

/// `String(value)`; None is a missing property, which JavaScript prints as "undefined".
pub(super) fn js_string(value: Option<&Json>) -> String {
	match value {
		None => "undefined".to_owned(),
		Some(Json::Null) => "null".to_owned(),
		Some(Json::Bool(b)) => b.to_string(),
		Some(Json::Num(n)) => js_number(*n),
		Some(Json::Str(s)) => s.clone(),
		// Array.prototype.toString joins with commas and prints null as nothing.
		Some(Json::Arr(items)) => items.iter().map(|i| if i.is_null() { String::new() } else { js_string(Some(i)) }).collect::<Vec<_>>().join(","),
		Some(Json::Obj(_)) => "[object Object]".to_owned(),
	}
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn prints_like_string() {
		assert_eq!(js_string(None), "undefined");
		assert_eq!(js_string(Some(&json!([1, null, [2, "x"], true]))), "1,,2,x,true");
		assert_eq!(js_string(Some(&json!({ "a": 1 }))), "[object Object]");
		assert_eq!(js_string(Some(&json!(1.5))), "1.5");
	}
}
