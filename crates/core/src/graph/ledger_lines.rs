//! Helpers over ledger lines (`Json` nodes and chains) that several graph modules share.

use gs_base::text::cmp16;
use gs_json::Json;

/// A chain's merge key: sorted premises + conclusion, the identity a re-stated argument merges
/// under.
pub(crate) fn chain_key(premises: &[&str], conclusion: &str) -> String {
	let mut sorted = premises.to_vec();
	sorted.sort_by(|a, b| cmp16(a, b));
	format!("{}>{conclusion}", sorted.join("+"))
}

pub(crate) fn chain_key_of(line: &Json) -> String {
	chain_key(&line["premises"].strs(), line["conclusion"].str_or_empty())
}

fn same_point(a: &Json, b: &Json) -> bool {
	a["chatId"] == b["chatId"] && a["messageId"] == b["messageId"]
}

/// True when one of the line's provenance points is in this chat (or notes source).
pub fn touches(line: &Json, chat_id: &str) -> bool {
	line["provenance"].items().iter().any(|pt| pt["chatId"].as_str() == Some(chat_id))
}

/// Adds the points of `incoming` that `target` does not hold yet, in order.
pub(crate) fn union_points(target: &mut Json, incoming: &Json) {
	let fresh: Vec<Json> = {
		let mut held: Vec<&Json> = target["provenance"].items().iter().collect();
		let mut fresh = Vec::new();
		for pt in incoming["provenance"].items().iter() {
			if !held.iter().any(|q| same_point(q, pt)) {
				held.push(pt);
				fresh.push(pt.clone());
			}
		}
		fresh
	};
	if let Some(points) = target.get_mut("provenance").and_then(Json::as_arr_mut) {
		points.extend(fresh);
	}
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn keys_sort_the_premises() {
		assert_eq!(chain_key(&["b", "a"], "c"), "a+b>c");
		assert_eq!(chain_key_of(&json!({ "premises": ["z", "y"], "conclusion": "x" })), "y+z>x");
	}

	#[test]
	fn unions_skip_points_already_held() {
		let mut a = json!({ "provenance": [{ "chatId": "c1", "messageId": "m" }] });
		let b = json!({ "provenance": [{ "chatId": "c1", "messageId": "m" }, { "chatId": "c1", "messageId": "" }, { "chatId": "c1", "messageId": "" }] });
		union_points(&mut a, &b);
		assert_eq!(a["provenance"].as_arr().unwrap().len(), 2);
		assert!(touches(&a, "c1") && !touches(&a, "c2"));
	}
}
