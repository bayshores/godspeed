//! Which teaching rules an agent saved, and where
//! each lives (`{ area }` for a teaching area's list, `{ spaceId }` for one space's list).
//! The rules themselves stay in those lists; this record only marks which ones an agent wrote.

use gs_json::{Json, Obj, json};

use super::teaching_areas::TEACHING_AREAS;
use crate::contracts::space::is_space_id;

/// A rule location from untrusted input, or None.
pub fn parse_where(raw: &Json) -> Option<Json> {
	raw.as_obj()?;
	let mut out = Obj::new();
	if let Some(area) = raw["area"].as_str().filter(|a| TEACHING_AREAS.iter().any(|t| t.id == *a)) {
		out.insert("area", area);
	} else if let Some(space_id) = raw["spaceId"].as_str().filter(|c| is_space_id(c)) {
		out.insert("spaceId", space_id);
	} else {
		return None;
	}
	Some(Json::Obj(out))
}

pub fn same_where(a: &Json, b: &Json) -> bool {
	match (a.get("area"), b.get("area")) {
		(Some(x), Some(y)) => x == y,
		(Some(_), None) => false,
		(None, _) => b.get("spaceId").is_some() && a["spaceId"] == b["spaceId"],
	}
}

/// The saved-rules file's list, made safe to use: `{ where, text, at }` each. `where.classId` is
/// the field's name before the rename.
pub fn parse_saved_rules(raw: &Json) -> Vec<Json> {
	let Some(list) = raw["rules"].as_arr() else { return Vec::new() };
	list.iter()
		.filter_map(|entry| {
			let place = parse_where(&entry["where"]).or_else(|| parse_where(&json!({ "spaceId": entry["where"]["classId"].clone() })))?;
			let (rule, at) = (entry["text"].as_str().filter(|t| !t.is_empty())?, entry["at"].as_str()?);
			let mut out = Obj::new();
			out.insert("where", place);
			out.insert("text", rule);
			out.insert("at", at);
			Some(Json::Obj(out))
		})
		.collect()
}

/// Who the rule is for, after "Saved a rule for": "every lesson" or the space name.
pub fn rule_for(place: &Json, space_name: Option<&str>) -> String {
	if place.get("spaceId").is_some() { space_name.unwrap_or("this space").to_owned() } else { "every lesson".to_owned() }
}

/// Where a rule lives, in words: "Every lesson, under Lesson flow" or "Lessons in Algebra".
pub fn where_label(place: &Json, space_name: Option<&str>) -> String {
	if place.get("spaceId").is_some() {
		return format!("Lessons in {}", space_name.unwrap_or("this space"));
	}
	let label = TEACHING_AREAS.iter().find(|a| place["area"].as_str() == Some(a.id)).map_or("Teaching", |a| a.label);
	format!("Every lesson, under {label}")
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;

	#[test]
	fn locations_parse_and_compare() {
		assert_eq!(stringify(&parse_where(&json!({ "area": "voice", "spaceId": "cls_a" })).unwrap()), r#"{"area":"voice"}"#);
		assert_eq!(stringify(&parse_where(&json!({ "area": "nope", "spaceId": "cls_a" })).unwrap()), r#"{"spaceId":"cls_a"}"#);
		assert!(parse_where(&json!({ "spaceId": "bad" })).is_none());
		assert!(parse_where(&json!("voice")).is_none());
		let (voice, space_a) = (json!({ "area": "voice" }), json!({ "spaceId": "cls_a" }));
		assert!(same_where(&voice, &json!({ "area": "voice" })) && same_where(&space_a, &json!({ "spaceId": "cls_a" })));
		assert!(!same_where(&voice, &space_a) && !same_where(&space_a, &voice) && !same_where(&space_a, &json!({ "spaceId": "cls_b" })));
	}

	#[test]
	fn saved_rules_and_labels() {
		let raw = json!({ "rules": [{ "where": { "area": "teaching" }, "text": "A", "at": "t" }, { "where": { "area": "teaching" }, "text": "", "at": "t" }, { "where": {}, "text": "B", "at": "t" }] });
		assert_eq!(stringify(&json!(parse_saved_rules(&raw))), r#"[{"where":{"area":"teaching"},"text":"A","at":"t"}]"#);
		let old = json!({ "rules": [{ "where": { "classId": "cls_a" }, "text": "A", "at": "t" }, { "where": { "spaceId": "spc_b", "classId": "cls_a" }, "text": "B", "at": "t" }, { "where": { "classId": "bad" }, "text": "C", "at": "t" }] });
		assert_eq!(stringify(&json!(parse_saved_rules(&old))), r#"[{"where":{"spaceId":"cls_a"},"text":"A","at":"t"},{"where":{"spaceId":"spc_b"},"text":"B","at":"t"}]"#);
		let (area, space) = (json!({ "area": "teaching" }), json!({ "spaceId": "cls_a" }));
		assert_eq!(rule_for(&area, None), "every lesson");
		assert_eq!(rule_for(&space, Some("Algebra")), "Algebra");
		assert_eq!(rule_for(&space, None), "this space");
		assert_eq!(where_label(&area, None), "Every lesson, under Lesson flow");
		assert_eq!(where_label(&space, Some("Algebra")), "Lessons in Algebra");
	}
}
