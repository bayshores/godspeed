//! What a `space.json` reads as (checked field by
//! field, anything odd left out) and the space list's summary lines.

use std::collections::HashSet;

use gs_json::{Json, Obj, json};

use super::new_files::is_recent_change;
use super::space_deadlines::{id_list, squash, with_files};
use super::space_work::{is_first_round, is_waiting_file};
use crate::contracts::space::{CURRENT_SPACE_VERSION, clean_signature, compare_deadlines, is_deadline_kind, is_space_color, is_space_icon};
use gs_base::text::cmp16;
use crate::mocks::prep::parse_prep;
use crate::records::teaching_areas::sanitize_rules;

fn is_str(v: &Json) -> bool {
	v.as_str().is_some()
}

fn is_space_file(v: &Json) -> bool {
	is_str(&v["id"])
		&& matches!(v["origin"].as_str(), Some("copied" | "linked"))
		&& is_str(&v["name"])
		&& is_str(&v["path"])
		&& matches!(v["kind"].as_str(), Some("study" | "info"))
		&& is_str(&v["contentFp"])
		&& is_str(&v["status"])
		&& is_str(&v["addedAt"])
}

fn is_space_deadline(v: &Json) -> bool {
	is_str(&v["id"])
		&& is_deadline_kind(&v["kind"])
		&& is_str(&v["name"])
		&& is_str(&v["date"])
		&& v.get("time").is_none_or(is_str)
		&& id_list(&v["fileIds"]).is_some()
		&& v["done"].as_bool().is_some()
}

fn is_homework_problem(v: &Json) -> bool {
	is_str(&v["number"]) && is_str(&v["title"]) && is_str(&v["text"]) && v.get("page").is_none_or(|p| matches!(p, Json::Num(_))) && v["done"].as_bool().is_some()
}

fn clean_problem(p: &Json) -> Json {
	let mut out = Obj::new();
	for key in ["number", "title", "text"] {
		out.insert(key, p[key].clone());
	}
	if let Some(page) = p.get("page") {
		out.insert("page", page.clone());
	}
	out.insert("done", p["done"].clone());
	Json::Obj(out)
}

/// A v3 deadline as saved.
fn read_deadline(d: &Json) -> Json {
	let mut out = Obj::new();
	for key in ["id", "kind", "name", "date"] {
		out.insert(key, d[key].clone());
	}
	if let Some(time) = d.get("time") {
		out.insert("time", time.clone());
	}
	out.insert("fileIds", d["fileIds"].clone());
	if id_list(&d["leftOutIds"]).is_some_and(|l| !l.is_empty()) {
		out.insert("leftOutIds", d["leftOutIds"].clone());
	}
	if d["source"].as_str().is_some_and(|s| !s.is_empty()) {
		out.insert("source", d["source"].clone());
	}
	if is_str(&d["assignmentFileId"]) {
		out.insert("assignmentFileId", d["assignmentFileId"].clone());
	}
	if let Some(problems) = d["problems"].as_arr().filter(|p| p.iter().any(is_homework_problem)) {
		out.insert("problems", Json::Arr(problems.iter().filter(|p| is_homework_problem(p)).map(clean_problem).collect()));
	}
	out.insert("done", d["done"].clone());
	if d["done"].as_bool() == Some(true) && is_str(&d["doneAt"]) {
		out.insert("doneAt", d["doneAt"].clone());
	}
	Json::Obj(out)
}

/// The record's deadlines: v3 `deadlines`, or an older record's `exams` upgraded (kind "exam",
/// not done, same id). None when it has neither.
fn read_deadlines(parsed: &Json) -> Option<Vec<Json>> {
	if let Some(list) = parsed["deadlines"].as_arr() {
		return Some(list.iter().filter(|d| is_space_deadline(d)).map(read_deadline).collect());
	}
	let exams = parsed["exams"].as_arr()?;
	let is_exam = |e: &&Json| is_str(&e["id"]) && is_str(&e["name"]) && is_str(&e["date"]) && id_list(&e["fileIds"]).is_some();
	Some(
		exams
			.iter()
			.filter(is_exam)
			.map(|e| {
				let mut out = Obj::new();
				out.insert("id", e["id"].clone());
				out.insert("kind", "exam");
				out.insert("name", e["name"].clone());
				out.insert("date", e["date"].clone());
				out.insert("fileIds", e["fileIds"].clone());
				out.insert("done", false);
				Json::Obj(out)
			})
			.collect(),
	)
}

/// Removed files still in the Recent changes window (older ones drop out here; the next write
/// persists that).
fn recent_removed(list: &Json, now: i64) -> Vec<Json> {
	let valid = |r: &&Json| is_str(&r["id"]) && is_str(&r["name"]) && is_str(&r["at"]);
	let recent = |r: &&Json| is_recent_change(r["at"].as_str().unwrap_or(""), now);
	let rebuilt = |r: &Json| {
		let mut out = Obj::new();
		for key in ["id", "name", "at"] {
			out.insert(key, r[key].clone());
		}
		Json::Obj(out)
	};
	list.as_arr().into_iter().flatten().filter(valid).filter(recent).map(rebuilt).collect()
}

/// A record's deadline without its assignment file once that file is gone.
fn known_assignment(mut d: Json, file_ids: &HashSet<&str>) -> Json {
	if d["assignmentFileId"].as_str().is_some_and(|f| !file_ids.contains(f))
		&& let Some(obj) = d.as_obj_mut()
	{
		obj.remove("assignmentFileId");
	}
	d
}

/// A saved round of the teacher's work, field by field, or None when it is not one.
fn read_work(v: &Json) -> Option<Json> {
	if v.as_obj().is_none() || !is_str(&v["startedAt"]) || id_list(&v["fileIds"]).is_none() || id_list(&v["deadlineIds"]).is_none() {
		return None;
	}
	let mut out = Obj::new();
	out.insert("startedAt", v["startedAt"].clone());
	if is_str(&v["endedAt"]) {
		out.insert("endedAt", v["endedAt"].clone());
	}
	out.insert("fileIds", v["fileIds"].clone());
	out.insert("deadlineIds", v["deadlineIds"].clone());
	Some(Json::Obj(out))
}

/// The space record a parsed `space.json` stands for, or None when it lacks an id, name or time.
/// `now` decides which removed files are still recent; a record without a color takes
/// `fresh_color()` (the store then saves it at once).
pub fn read_space_record(parsed: &Json, now: i64, fresh_color: impl FnOnce() -> i64) -> Option<Json> {
	let (id, name) = (parsed["id"].as_str()?, parsed["name"].as_str()?);
	let (created_at, updated_at) = (parsed["createdAt"].as_str()?, parsed["updatedAt"].as_str()?);
	let files: Vec<Json> = parsed["files"].as_arr().into_iter().flatten().filter(|f| is_space_file(f)).cloned().collect();
	let removed = recent_removed(&parsed["removedFiles"], now);
	// A removed file drops out of every deadline that covered it; the next write persists that.
	let known: HashSet<&str> = files.iter().filter_map(|f| f["id"].as_str()).collect();
	let keep_known = |ids: Vec<String>| ids.into_iter().filter(|f| known.contains(f.as_str())).collect::<Vec<_>>();
	let deadlines = read_deadlines(parsed).map(|list| {
		let mut cleaned: Vec<Json> = list
			.into_iter()
			.map(|d| {
				let file_ids = keep_known(id_list(&d["fileIds"]).unwrap_or_default());
				let left_out = id_list(&d["leftOutIds"]).map(keep_known);
				with_files(known_assignment(d, &known), file_ids, left_out, false)
			})
			.collect();
		cleaned.sort_by(compare_deadlines);
		cleaned
	});
	let rules = sanitize_rules(&parsed["rules"]);

	let mut out = Obj::new();
	out.insert("id", id);
	out.insert("name", name);
	out.insert("description", parsed["description"].as_str().unwrap_or(""));
	out.insert("createdAt", created_at);
	out.insert("updatedAt", updated_at);
	out.insert("archived", parsed["archived"].as_bool() == Some(true));
	if is_str(&parsed["linkedFolder"]) {
		out.insert("linkedFolder", parsed["linkedFolder"].clone());
	}
	out.insert("files", Json::Arr(files));
	if !removed.is_empty() {
		out.insert("removedFiles", Json::Arr(removed));
	}
	if let Some(deadlines) = deadlines {
		out.insert("deadlines", Json::Arr(deadlines));
	}
	if let Some(signature) = clean_signature(&parsed["signature"]) {
		out.insert("signature", signature);
	}
	if is_space_icon(&parsed["icon"]) {
		out.insert("icon", parsed["icon"].clone());
	}
	out.insert("color", if is_space_color(&parsed["color"]) { parsed["color"].clone() } else { Json::from(fresh_color()) });
	let note = &parsed["note"];
	if is_str(&note["text"]) && is_str(&note["at"]) {
		let mut n = Obj::new();
		n.insert("text", note["text"].clone());
		n.insert("at", note["at"].clone());
		out.insert("note", Json::Obj(n));
	}
	if !rules.is_empty() {
		out.insert("rules", rules);
	}
	if let Some(work) = read_work(&parsed["lastWork"]) {
		out.insert("lastWork", work);
	}
	if let Some(prep) = parse_prep(&parsed["prep"]) {
		out.insert("prep", prep);
	}
	if matches!(parsed["version"], Json::Num(_)) {
		out.insert("version", parsed["version"].clone());
	}
	Some(Json::Obj(out))
}

/// Whether a record was written by a newer build than this one (it reads as absent then, so a
/// later write never rewrites what this build doesn't understand).
pub fn newer_version(parsed: &Json) -> Option<f64> {
	parsed["version"].as_f64().filter(|v| *v > CURRENT_SPACE_VERSION as f64)
}

/// The newest `addedAt` among the files `pick` says yes to.
fn newest(files: &[Json], pick: impl Fn(&Json) -> bool) -> Option<&str> {
	files.iter().fold(None, |at: Option<&str>, f| {
		let added = f["addedAt"].as_str().unwrap_or("");
		if pick(f) && at.is_none_or(|a| a.is_empty() || cmp16(added, a).is_gt()) { Some(added) } else { at }
	})
}

/// A space name as stored: one line of at most 120 characters, never empty.
pub fn clean_name(name: &str) -> String {
	let clean = squash(name, 120);
	if clean.is_empty() { "Untitled space".to_owned() } else { clean }
}

/// A space's line in the space list.
pub fn summarize(record: &Json) -> Json {
	let files = record["files"].as_arr().map_or(&[][..], Vec::as_slice);
	let last_found = newest(files, |f| f["foundByScan"].as_bool() == Some(true)).filter(|s| !s.is_empty());
	let last_folder_file = newest(files, |f| f["origin"].as_str() == Some("linked")).filter(|s| !s.is_empty());
	let mut out = Obj::new();
	for key in ["id", "name", "description", "createdAt", "updatedAt", "archived"] {
		out.insert(key, record[key].clone());
	}
	if record["linkedFolder"].truthy() {
		out.insert("linkedFolder", record["linkedFolder"].clone());
	}
	out.insert("fileCount", files.len());
	if let Some(at) = last_found {
		out.insert("lastFoundAt", at);
	}
	if let Some(at) = last_folder_file {
		out.insert("lastFolderFileAt", at);
	}
	for key in ["signature", "icon"] {
		if record[key].truthy() {
			out.insert(key, record[key].clone());
		}
	}
	out.insert("color", record["color"].clone());
	if record["note"].truthy() {
		out.insert("note", record["note"].clone());
	}
	let files_left = files.iter().filter(|f| is_waiting_file(f)).count();
	out.insert("filesLeft", files_left);
	if files_left > 0 && is_first_round(files, record.get("lastWork")) {
		out.insert("building", true);
	}
	// The open round's files finished so far, for "6 of 17 files".
	let files_read = record.get("lastWork").filter(|work| !work["endedAt"].truthy()).and_then(|work| work["fileIds"].as_arr()).map_or(0, Vec::len);
	if files_left > 0 && files_read > 0 {
		out.insert("filesRead", files_read);
	}
	if let Some(prep) = record.get("prep") {
		out.insert("prep", if prep["date"].truthy() { json!({ "date": prep["date"].clone() }) } else { json!({}) });
	}
	Json::Obj(out)
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;

	fn file(id: &str, origin: &str, added: &str) -> Json {
		json!({ "id": id, "origin": origin, "name": format!("{id}.pdf"), "path": id, "kind": "study", "contentFp": "x", "status": "ready", "addedAt": added })
	}

	#[test]
	fn a_record_reads_with_its_fields_in_a_fixed_order() {
		let parsed = json!({
			"version": 6, "updatedAt": "u", "createdAt": "c", "name": "CSE 21", "id": "cls_a", "icon": "cpu", "rules": [" be brief ", "be brief"],
			"files": [file("f1", "linked", "2026-10-01T00:00:00.000Z"), { "id": "bad" }],
			"deadlines": [
				{ "id": "d2", "kind": "exam", "name": "B", "date": "2026-11-02", "fileIds": ["f1", "gone"], "leftOutIds": ["gone"], "assignmentFileId": "gone", "done": false },
				{ "id": "d1", "kind": "quiz", "name": "A", "date": "2026-11-01", "time": "10:00", "fileIds": [], "done": true, "doneAt": "t" },
				{ "id": "d3", "kind": "nope", "name": "C", "date": "2026-11-01", "fileIds": [], "done": false },
			],
		});
		let record = read_space_record(&parsed, 0, || 3).unwrap();
		let keys: Vec<&String> = record.as_obj().unwrap().keys().collect();
		assert_eq!(keys, ["id", "name", "description", "createdAt", "updatedAt", "archived", "files", "deadlines", "icon", "color", "rules", "version"]);
		assert_eq!(record["color"], Json::from(3));
		assert_eq!(
			stringify(&record["deadlines"]),
			r#"[{"id":"d1","kind":"quiz","name":"A","date":"2026-11-01","time":"10:00","fileIds":[],"done":true,"doneAt":"t"},{"id":"d2","kind":"exam","name":"B","date":"2026-11-02","fileIds":["f1"],"done":false}]"#
		);
		assert_eq!(stringify(&record["rules"]), r#"["be brief"]"#);
		assert_eq!(record["files"].as_arr().unwrap().len(), 1);
	}

	#[test]
	fn names_are_one_short_line() {
		assert_eq!(clean_name("  CSE \n 21  "), "CSE 21");
		assert_eq!(clean_name(" \t "), "Untitled space");
		assert_eq!(clean_name(&"x".repeat(130)).len(), 120);
	}

	#[test]
	fn old_exams_become_exam_deadlines() {
		let parsed = json!({ "id": "cls_a", "name": "n", "createdAt": "c", "updatedAt": "u", "exams": [{ "id": "e1", "name": "Final", "date": "2026-12-01", "fileIds": [] }, { "id": 1 }] });
		let record = read_space_record(&parsed, 0, || 3).unwrap();
		assert_eq!(stringify(&record["deadlines"]), r#"[{"id":"e1","kind":"exam","name":"Final","date":"2026-12-01","fileIds":[],"done":false}]"#);
	}

	#[test]
	fn a_record_without_its_basics_does_not_read() {
		assert!(read_space_record(&json!({ "id": "cls_a", "name": "n", "createdAt": "c" }), 0, || 1).is_none());
		assert!(read_space_record(&json!([]), 0, || 1).is_none());
		assert_eq!(newer_version(&json!({ "version": 11 })), Some(11.0));
		assert_eq!(newer_version(&json!({ "version": 10 })), None);
	}

	#[test]
	fn removed_files_expire_after_two_weeks() {
		let now = gs_base::time::parse_date("2026-11-10T00:00:00Z").unwrap();
		let parsed = json!({
			"id": "cls_a", "name": "n", "createdAt": "c", "updatedAt": "u",
			"removedFiles": [{ "id": "a", "name": "a", "at": "2026-11-01T00:00:00.000Z", "extra": 1 }, { "id": "b", "name": "b", "at": "2026-10-01T00:00:00.000Z" }, { "id": "c" }],
		});
		let record = read_space_record(&parsed, now, || 3).unwrap();
		assert_eq!(stringify(&record["removedFiles"]), r#"[{"id":"a","name":"a","at":"2026-11-01T00:00:00.000Z"}]"#);
	}

	#[test]
	fn the_summary_names_the_newest_found_and_folder_files() {
		let mut found = file("f2", "linked", "2026-10-05T00:00:00.000Z");
		found.as_obj_mut().unwrap().insert("foundByScan", true);
		let record = json!({
			"id": "cls_a", "name": "n", "description": "", "createdAt": "c", "updatedAt": "u", "archived": false, "linkedFolder": "/x",
			"files": [file("f1", "copied", "2026-10-09T00:00:00.000Z"), found, file("f3", "linked", "2026-10-02T00:00:00.000Z")],
			"icon": "cpu", "color": 2,
		});
		assert_eq!(
			stringify(&summarize(&record)),
			r#"{"id":"cls_a","name":"n","description":"","createdAt":"c","updatedAt":"u","archived":false,"linkedFolder":"/x","fileCount":3,"lastFoundAt":"2026-10-05T00:00:00.000Z","lastFolderFileAt":"2026-10-05T00:00:00.000Z","icon":"cpu","color":2,"filesLeft":0}"#
		);
	}

	#[test]
	fn a_saved_color_and_round_of_work_are_kept() {
		let parsed = json!({
			"id": "cls_a", "name": "n", "createdAt": "c", "updatedAt": "u", "color": 6,
			"lastWork": { "deadlineIds": [], "fileIds": ["f1"], "startedAt": "s", "extra": 1 },
		});
		let record = read_space_record(&parsed, 0, || panic!("a colored record keeps its color")).unwrap();
		assert_eq!(record["color"], Json::from(6));
		assert_eq!(stringify(&record["lastWork"]), r#"{"startedAt":"s","fileIds":["f1"],"deadlineIds":[]}"#);
		let broken = json!({ "id": "cls_a", "name": "n", "createdAt": "c", "updatedAt": "u", "color": 9, "lastWork": { "startedAt": "s", "fileIds": [1], "deadlineIds": [] } });
		let record = read_space_record(&broken, 0, || 4).unwrap();
		assert_eq!(record["color"], Json::from(4));
		assert!(record.get("lastWork").is_none());
	}

	#[test]
	fn a_space_being_built_counts_the_files_left() {
		let mut waiting = file("f2", "copied", "t");
		waiting.as_obj_mut().unwrap().insert("status", "pending");
		let mut record = json!({ "id": "cls_a", "name": "n", "description": "", "createdAt": "c", "updatedAt": "u", "archived": false, "files": [waiting.clone()], "color": 1 });
		let summary = summarize(&record);
		assert_eq!((summary["filesLeft"].clone(), summary["building"].clone()), (Json::from(1), Json::from(true)));
		// A file read before this round: the teacher is adding to the space, not building it.
		record.as_obj_mut().unwrap().insert("files", json!([file("f1", "copied", "t"), waiting]));
		record.as_obj_mut().unwrap().insert("lastWork", json!({ "startedAt": "s", "fileIds": [], "deadlineIds": [] }));
		assert!(summarize(&record).get("building").is_none());
		assert!(summarize(&record).get("filesRead").is_none());
		record.as_obj_mut().unwrap().insert("lastWork", json!({ "startedAt": "s", "fileIds": ["f1"], "deadlineIds": [] }));
		assert_eq!(summarize(&record)["filesRead"], Json::from(1));
	}
}
