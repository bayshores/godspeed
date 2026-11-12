//! A fact's mark, a topic's facts to fix first, and how much of each study file came up in a
//! lesson (progress.ts: facts, files).

use std::collections::{HashMap, HashSet};

use gs_base::locale;
use gs_json::{Json, Obj};

use crate::graph::session_clusters::birth_session_of;

/// A fact's mark: its latest answer's outcome, or None when untested.
fn fact_mark(fact: &Json) -> Option<&str> {
	super::items(&fact["answers"]).last().and_then(|a| a["outcome"].as_str())
}

/// Latest answer wrong first, then "I don't know", then right, then untested.
fn mark_order(mark: Option<&str>) -> u8 {
	match mark {
		Some("wrong") => 0,
		Some("dontKnow") => 1,
		Some("right") => 2,
		_ => 3,
	}
}

/// A topic's facts, the ones to fix first; ties by name.
pub fn topic_facts<'a>(facts: &'a [Json], topic: &Json) -> Vec<&'a Json> {
	let members: HashSet<&str> = super::items(&topic["members"]).iter().filter_map(Json::as_str).collect();
	let mut out: Vec<&Json> = facts.iter().filter(|f| f["id"].as_str().is_some_and(|id| members.contains(id))).collect();
	out.sort_by(|a, b| {
		mark_order(fact_mark(a)).cmp(&mark_order(fact_mark(b))).then_with(|| locale::compare(a["name"].as_str().unwrap_or(""), b["name"].as_str().unwrap_or("")))
	});
	out
}

/// A provenance point from a lesson (not a notes or file source).
pub fn from_lesson(point: &Json) -> bool {
	!point["chatId"].as_str().unwrap_or("").starts_with("src_")
}

/// Coverage for every study file, in the space's file order: `{ fileId, name, facts, inLessons,
/// share }`.
pub fn file_coverage(files: &[Json], facts: &[Json]) -> Vec<Json> {
	let mut by_source: HashMap<&str, (usize, usize)> = HashMap::new();
	for fact in facts {
		let Some(born) = birth_session_of(fact).filter(|b| !b.is_empty()) else { continue };
		let entry = by_source.entry(born).or_default();
		entry.0 += 1;
		if super::items(&fact["provenance"]).iter().any(from_lesson) {
			entry.1 += 1;
		}
	}
	files
		.iter()
		.filter(|f| f["kind"].as_str() == Some("study"))
		.map(|f| {
			let (facts, in_lessons) = f["sourceId"].as_str().and_then(|s| by_source.get(s)).copied().unwrap_or_default();
			let mut o = Obj::new();
			o.insert("fileId", f["id"].clone());
			o.insert("name", f["name"].clone());
			o.insert("facts", facts);
			o.insert("inLessons", in_lessons);
			o.insert("share", (facts > 0).then(|| in_lessons as f64 / facts as f64));
			Json::Obj(o)
		})
		.collect()
}

/// "Next up": the earliest study file that has facts but none of them came up in a lesson yet.
pub fn next_up_file(coverage: &[Json]) -> Option<&Json> {
	coverage.iter().find(|f| f["facts"].as_f64().is_some_and(|n| n > 0.0) && f["inLessons"].as_f64() == Some(0.0))
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;

	#[test]
	fn topic_facts_put_misses_first_then_name() {
		let facts = [
			json!({ "id": "a", "name": "Zed", "answers": [{ "outcome": "right" }] }),
			json!({ "id": "b", "name": "Bee", "answers": [] }),
			json!({ "id": "c", "name": "Cee", "answers": [{ "outcome": "right" }, { "outcome": "wrong" }] }),
			json!({ "id": "d", "name": "Dee", "answers": [{ "outcome": "dontKnow" }] }),
			json!({ "id": "e", "name": "Elsewhere", "answers": [] }),
			json!({ "id": "f", "name": "Aye", "answers": [{ "outcome": "right" }] }),
		];
		let topic = json!({ "members": ["a", "b", "c", "d", "f"] });
		let ids: Vec<_> = topic_facts(&facts, &topic).iter().map(|f| f["id"].as_str().unwrap()).collect();
		assert_eq!(ids, ["c", "d", "f", "a", "b"]);
	}

	#[test]
	fn coverage_counts_lessons_and_picks_the_next_file() {
		let facts = [
			json!({ "id": "1", "provenance": [{ "chatId": "src_a" }, { "chatId": "chat1" }] }),
			json!({ "id": "2", "provenance": [{ "chatId": "src_a" }] }),
			json!({ "id": "3", "provenance": [{ "chatId": "src_b" }] }),
			json!({ "id": "4", "provenance": [] }),
		];
		let files = [
			json!({ "id": "f1", "name": "A", "kind": "study", "sourceId": "src_a" }),
			json!({ "id": "f2", "name": "Info", "kind": "info", "sourceId": "src_i" }),
			json!({ "id": "f3", "name": "B", "kind": "study", "sourceId": "src_b" }),
			json!({ "id": "f4", "name": "C", "kind": "study", "sourceId": "src_c" }),
		];
		let cov = file_coverage(&files, &facts);
		assert_eq!(stringify(&Json::from(cov.clone())), r#"[{"fileId":"f1","name":"A","facts":2,"inLessons":1,"share":0.5},{"fileId":"f3","name":"B","facts":1,"inLessons":0,"share":0},{"fileId":"f4","name":"C","facts":0,"inLessons":0,"share":null}]"#);
		assert_eq!(next_up_file(&cov).map(|f| f["fileId"].as_str().unwrap()), Some("f3"));
	}
}
