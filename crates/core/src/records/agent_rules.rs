//! Ported from src/shared/core/agent-rules.ts: which teaching rules an agent saved, and where
//! each lives (`{ area }` for a teaching area's list, `{ classId }` for one class's list).
//! The rules themselves stay in those lists; this record only marks which ones an agent wrote.

use gs_json::{Json, Obj};

use super::teaching_areas::TEACHING_AREAS;
use crate::contracts::class::is_class_id;

/// A rule location from untrusted input, or None.
pub fn parse_where(raw: &Json) -> Option<Json> {
	raw.as_obj()?;
	let mut out = Obj::new();
	if let Some(area) = raw["area"].as_str().filter(|a| TEACHING_AREAS.iter().any(|t| t.id == *a)) {
		out.insert("area", area);
	} else if let Some(class_id) = raw["classId"].as_str().filter(|c| is_class_id(c)) {
		out.insert("classId", class_id);
	} else {
		return None;
	}
	Some(Json::Obj(out))
}

pub fn same_where(a: &Json, b: &Json) -> bool {
	match (a.get("area"), b.get("area")) {
		(Some(x), Some(y)) => x == y,
		(Some(_), None) => false,
		(None, _) => b.get("classId").is_some() && a["classId"] == b["classId"],
	}
}

/// The saved-rules file's list, made safe to use: `{ where, text, at }` each.
pub fn parse_saved_rules(raw: &Json) -> Vec<Json> {
	let Some(list) = raw["rules"].as_arr() else { return Vec::new() };
	list.iter()
		.filter_map(|entry| {
			let place = parse_where(&entry["where"])?;
			let (rule, at) = (entry["text"].as_str().filter(|t| !t.is_empty())?, entry["at"].as_str()?);
			let mut out = Obj::new();
			out.insert("where", place);
			out.insert("text", rule);
			out.insert("at", at);
			Some(Json::Obj(out))
		})
		.collect()
}

/// Who the rule is for, after "Saved a rule for": "every lesson" or the class name.
pub fn rule_for(place: &Json, class_name: Option<&str>) -> String {
	if place.get("classId").is_some() { class_name.unwrap_or("this class").to_owned() } else { "every lesson".to_owned() }
}

/// Where a rule lives, in words: "Every lesson, under Lesson flow" or "Lessons in CSE 21".
pub fn where_label(place: &Json, class_name: Option<&str>) -> String {
	if place.get("classId").is_some() {
		return format!("Lessons in {}", class_name.unwrap_or("this class"));
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
		assert_eq!(stringify(&parse_where(&json!({ "area": "voice", "classId": "cls_a" })).unwrap()), r#"{"area":"voice"}"#);
		assert_eq!(stringify(&parse_where(&json!({ "area": "nope", "classId": "cls_a" })).unwrap()), r#"{"classId":"cls_a"}"#);
		assert!(parse_where(&json!({ "classId": "bad" })).is_none());
		assert!(parse_where(&json!("voice")).is_none());
		let (voice, class_a) = (json!({ "area": "voice" }), json!({ "classId": "cls_a" }));
		assert!(same_where(&voice, &json!({ "area": "voice" })) && same_where(&class_a, &json!({ "classId": "cls_a" })));
		assert!(!same_where(&voice, &class_a) && !same_where(&class_a, &voice) && !same_where(&class_a, &json!({ "classId": "cls_b" })));
	}

	#[test]
	fn saved_rules_and_labels() {
		let raw = json!({ "rules": [{ "where": { "area": "teaching" }, "text": "A", "at": "t" }, { "where": { "area": "teaching" }, "text": "", "at": "t" }, { "where": {}, "text": "B", "at": "t" }] });
		assert_eq!(stringify(&json!(parse_saved_rules(&raw))), r#"[{"where":{"area":"teaching"},"text":"A","at":"t"}]"#);
		let (area, class) = (json!({ "area": "teaching" }), json!({ "classId": "cls_a" }));
		assert_eq!(rule_for(&area, None), "every lesson");
		assert_eq!(rule_for(&class, Some("CSE 21")), "CSE 21");
		assert_eq!(rule_for(&class, None), "this class");
		assert_eq!(where_label(&area, None), "Every lesson, under Lesson flow");
		assert_eq!(where_label(&class, Some("CSE 21")), "Lessons in CSE 21");
	}
}
