//! How a space's deadlines are checked, built and
//! changed. The store adds the space record, the lock and the write.

use std::collections::HashSet;
use std::sync::LazyLock;

use gs_base::re::Re;
use gs_base::text;
use gs_json::{Json, Obj, stringify};

use crate::contracts::space::{SpaceDeadlineError, MAX_HOMEWORK_PROBLEMS, is_calendar_date, is_clock_time, is_deadline_kind};

fn refuse(code: &'static str, message: String) -> SpaceDeadlineError {
	SpaceDeadlineError { code, message }
}

/// `JSON.stringify(value)` as it prints in a message: a missing value is `undefined`.
fn shown(value: Option<&Json>) -> String {
	value.map_or_else(|| "undefined".to_owned(), stringify)
}

/// Trimmed, whitespace runs one space, cut to `max` UTF-16 units.
pub(super) fn squash(raw: &str, max: i64) -> String {
	static SPACES: LazyLock<Re> = LazyLock::new(|| Re::new(r"\s+", "g"));
	text::slice16(&SPACES.replace(text::trim(raw), " "), 0, Some(max))
}

/// A list whose entries are all strings.
pub(super) fn id_list(v: &Json) -> Option<Vec<String>> {
	v.as_arr()?.iter().map(|s| s.as_str().map(str::to_owned)).collect()
}

fn deadline_name(name: Option<&Json>) -> Result<String, SpaceDeadlineError> {
	let clean = name.and_then(Json::as_str).map_or_else(String::new, |n| squash(n, 120));
	if clean.is_empty() {
		return Err(refuse("bad_name", "A deadline needs a name".to_owned()));
	}
	Ok(clean)
}

fn deadline_kind(kind: Option<&Json>) -> Result<String, SpaceDeadlineError> {
	match kind {
		Some(k) if is_deadline_kind(k) => Ok(k.as_str().unwrap_or_default().to_owned()),
		_ => Err(refuse("bad_kind", format!("The kind must be exam, homework, quiz or project (got {})", shown(kind)))),
	}
}

fn deadline_date(date: Option<&Json>) -> Result<String, SpaceDeadlineError> {
	match date {
		Some(d) if is_calendar_date(d) => Ok(d.as_str().unwrap_or_default().to_owned()),
		_ => Err(refuse("bad_date", format!("The date must be a calendar date written YYYY-MM-DD (got {})", shown(date)))),
	}
}

fn deadline_time(time: Option<&Json>) -> Result<String, SpaceDeadlineError> {
	match time {
		Some(t) if is_clock_time(t) => Ok(t.as_str().unwrap_or_default().to_owned()),
		_ => Err(refuse("bad_time", format!("The time must be a 24-hour time written HH:MM (got {})", shown(time)))),
	}
}

/// The ids, each once, when every one is a file of the space.
fn deadline_files(known: &HashSet<String>, ids: Option<&Json>) -> Result<Vec<String>, SpaceDeadlineError> {
	let Some(ids) = ids.and_then(id_list) else { return Err(refuse("unknown_file", "file ids must be a list of space file ids".to_owned())) };
	let unknown: Vec<&str> = ids.iter().filter(|f| !known.contains(*f)).map(String::as_str).collect();
	if !unknown.is_empty() {
		return Err(refuse("unknown_file", format!("Not files of this space: {}", unknown.join(", "))));
	}
	let mut seen = HashSet::new();
	Ok(ids.into_iter().filter(|f| seen.insert(f.clone())).collect())
}

/// The source note, or None when it is empty.
fn deadline_source(source: Option<&Json>) -> Result<Option<String>, SpaceDeadlineError> {
	let Some(source) = source.and_then(Json::as_str) else { return Err(refuse("bad_source", "The source must be text".to_owned())) };
	Ok(Some(squash(source, 300)).filter(|s| !s.is_empty()))
}

fn deadline_assignment(known: &HashSet<String>, file_id: Option<&Json>) -> Result<String, SpaceDeadlineError> {
	match file_id.and_then(Json::as_str) {
		Some(id) if known.contains(id) => Ok(id.to_owned()),
		_ => Err(refuse("unknown_file", format!("Not a file of this space: {}", shown(file_id)))),
	}
}

/// A problem list as the store keeps it: numbers unique, text trimmed.
fn deadline_problems(problems: Option<&Json>) -> Result<Vec<Json>, SpaceDeadlineError> {
	let list = problems.and_then(Json::as_arr).filter(|p| p.len() <= MAX_HOMEWORK_PROBLEMS);
	let Some(list) = list else { return Err(refuse("bad_problems", format!("The problems must be a list of at most {MAX_HOMEWORK_PROBLEMS}"))) };
	let mut seen = HashSet::new();
	let mut out = Vec::new();
	for (i, p) in list.iter().enumerate() {
		if !matches!(p, Json::Obj(_) | Json::Arr(_)) {
			return Err(refuse("bad_problems", format!("Problem {} is not an object", i + 1)));
		}
		let number = p["number"].as_str().map_or_else(String::new, |n| text::slice16(text::trim(n), 0, Some(20)));
		let title = p["title"].as_str().map_or_else(String::new, |t| squash(t, 120));
		let body = p["text"].as_str().map_or_else(String::new, |t| text::slice16(text::trim(t), 0, Some(8000)));
		if number.is_empty() || body.is_empty() {
			return Err(refuse("bad_problems", format!("Problem {} needs a number and its text", i + 1)));
		}
		if !seen.insert(number.clone()) {
			return Err(refuse("bad_problems", format!("Two problems are numbered {number}")));
		}
		let mut problem = Obj::new();
		problem.insert("number", number.clone());
		problem.insert("title", if title.is_empty() { number } else { title });
		problem.insert("text", body);
		if let Some(page) = p["page"].as_f64().filter(|n| n.fract() == 0.0 && *n > 0.0) {
			problem.insert("page", page);
		}
		problem.insert("done", p["done"].as_bool() == Some(true));
		out.push(Json::Obj(problem));
	}
	Ok(out)
}

/// The deadline with these covered and left-out files; a file is never both (`left_out_wins`
/// says which list was just set).
pub(super) fn with_files(mut d: Json, file_ids: Vec<String>, left_out: Option<Vec<String>>, left_out_wins: bool) -> Json {
	let left_out = left_out.unwrap_or_default();
	let covered: Vec<String> = if left_out_wins { file_ids.into_iter().filter(|f| !left_out.contains(f)).collect() } else { file_ids };
	let left: Vec<String> = left_out.into_iter().filter(|f| left_out_wins || !covered.contains(f)).collect();
	if let Some(obj) = d.as_obj_mut() {
		obj.remove("leftOutIds");
		obj.insert("fileIds", covered);
		if !left.is_empty() {
			obj.insert("leftOutIds", left);
		}
	}
	d
}

/// The ids of a space record's files.
pub fn file_ids_of(record: &Json) -> HashSet<String> {
	record["files"].as_arr().into_iter().flatten().filter_map(|f| f["id"].as_str().map(str::to_owned)).collect()
}

/// A new deadline from `init`: `id` is its new id, `known` the space's file ids.
pub fn new_deadline(known: &HashSet<String>, init: &Json, id: String) -> Result<Json, SpaceDeadlineError> {
	let time = init.get("time").map(|t| deadline_time(Some(t))).transpose()?;
	let source = init.get("source").map(|s| deadline_source(Some(s))).transpose()?.flatten();
	let assignment = init.get("assignmentFileId").map(|f| deadline_assignment(known, Some(f))).transpose()?;
	let mut base = Obj::new();
	base.insert("id", id);
	base.insert("kind", deadline_kind(init.get("kind"))?);
	base.insert("name", deadline_name(init.get("name"))?);
	base.insert("date", deadline_date(init.get("date"))?);
	if let Some(time) = time {
		base.insert("time", time);
	}
	base.insert("fileIds", Json::Arr(Vec::new()));
	if let Some(source) = source {
		base.insert("source", source);
	}
	if let Some(assignment) = assignment {
		base.insert("assignmentFileId", assignment);
	}
	base.insert("done", false);
	let file_ids = match init.get("fileIds") {
		None | Some(Json::Null) => Vec::new(),
		ids => deadline_files(known, ids)?,
	};
	let left_out = init.get("leftOutIds").map(|l| deadline_files(known, Some(l))).transpose()?;
	Ok(with_files(Json::Obj(base), file_ids, left_out, false))
}

/// The deadline `prev` with `patch` applied. `now` stamps a newly ticked deadline.
pub fn changed_deadline(known: &HashSet<String>, prev: &Json, patch: &Json, now: &str) -> Result<Json, SpaceDeadlineError> {
	// A cleared field is `null` in the patch; a missing one keeps what the deadline had.
	let time = match patch.get("time") {
		None => prev.get("time").cloned(),
		Some(Json::Null) => None,
		Some(t) => Some(Json::from(deadline_time(Some(t))?)),
	};
	let source = match patch.get("source") {
		None => prev.get("source").cloned(),
		Some(Json::Null) => None,
		Some(s) => deadline_source(Some(s))?.map(Json::from),
	};
	let assignment = match patch.get("assignmentFileId") {
		None => prev.get("assignmentFileId").cloned(),
		Some(Json::Null) => None,
		Some(f) => Some(Json::from(deadline_assignment(known, Some(f))?)),
	};
	let problems = match patch.get("problems") {
		Some(p) => Some(deadline_problems(Some(p))?),
		None => prev["problems"].as_arr().cloned(),
	};
	let prev_done = prev["done"].as_bool() == Some(true);
	let done = patch["done"].as_bool().unwrap_or(prev_done);
	// Ticking stamps the time; unticking clears it; leaving it alone keeps it.
	let done_at = if !done {
		None
	} else if patch["done"].as_bool() == Some(true) && !prev_done {
		Some(Json::from(now))
	} else {
		prev.get("doneAt").cloned()
	};

	let mut base = Obj::new();
	base.insert("id", prev["id"].clone());
	base.insert("kind", patch.get("kind").map_or_else(|| Ok(prev["kind"].clone()), |k| deadline_kind(Some(k)).map(Json::from))?);
	base.insert("name", patch.get("name").map_or_else(|| Ok(prev["name"].clone()), |n| deadline_name(Some(n)).map(Json::from))?);
	base.insert("date", patch.get("date").map_or_else(|| Ok(prev["date"].clone()), |d| deadline_date(Some(d)).map(Json::from))?);
	if let Some(time) = time {
		base.insert("time", time);
	}
	base.insert("fileIds", Json::Arr(Vec::new()));
	if let Some(source) = source {
		base.insert("source", source);
	}
	if let Some(assignment) = assignment {
		base.insert("assignmentFileId", assignment);
	}
	if let Some(problems) = problems.filter(|p| !p.is_empty()) {
		base.insert("problems", Json::Arr(problems));
	}
	base.insert("done", done);
	if let Some(done_at) = done_at {
		base.insert("doneAt", done_at);
	}
	let file_ids = match patch.get("fileIds") {
		Some(ids) => deadline_files(known, Some(ids))?,
		None => id_list(&prev["fileIds"]).unwrap_or_default(),
	};
	let left_out = match patch.get("leftOutIds") {
		Some(ids) => Some(deadline_files(known, Some(ids))?),
		None => id_list(&prev["leftOutIds"]),
	};
	let left_out_wins = patch.get("leftOutIds").is_some() && patch.get("fileIds").is_none();
	Ok(with_files(Json::Obj(base), file_ids, left_out, left_out_wins))
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn known() -> HashSet<String> {
		["f1", "f2", "f3"].iter().map(|s| (*s).to_owned()).collect()
	}

	fn code(r: Result<Json, SpaceDeadlineError>) -> (&'static str, String) {
		let e = r.unwrap_err();
		(e.code, e.message)
	}

	#[test]
	fn a_new_deadline_is_checked_in_order_and_built_in_a_fixed_shape() {
		let init = json!({ "kind": "quiz", "name": "  Quiz   1 ", "date": "2026-11-03", "time": "09:30", "fileIds": ["f1", "f1", "f2"], "leftOutIds": ["f2", "f3"], "source": " syllabus ", "assignmentFileId": "f3" });
		let d = new_deadline(&known(), &init, "ddl_x".into()).unwrap();
		assert_eq!(
			stringify(&d),
			r#"{"id":"ddl_x","kind":"quiz","name":"Quiz 1","date":"2026-11-03","time":"09:30","fileIds":["f1","f2"],"source":"syllabus","assignmentFileId":"f3","done":false,"leftOutIds":["f3"]}"#
		);
		assert_eq!(code(new_deadline(&known(), &json!({ "kind": "x", "name": "", "date": "no", "time": "25:00" }), "i".into())), ("bad_time", "The time must be a 24-hour time written HH:MM (got \"25:00\")".to_owned()));
		assert_eq!(code(new_deadline(&known(), &json!({ "name": "n", "date": "2026-11-03" }), "i".into())).1, "The kind must be exam, homework, quiz or project (got undefined)");
		assert_eq!(code(new_deadline(&known(), &json!({ "kind": "exam", "name": " ", "date": "2026-11-03" }), "i".into())), ("bad_name", "A deadline needs a name".to_owned()));
		assert_eq!(code(new_deadline(&known(), &json!({ "kind": "exam", "name": "n", "date": "2026-02-30" }), "i".into())).0, "bad_date");
		assert_eq!(code(new_deadline(&known(), &json!({ "kind": "exam", "name": "n", "date": "2026-11-03", "fileIds": ["zz", "yy"] }), "i".into())).1, "Not files of this space: zz, yy");
		assert_eq!(code(new_deadline(&known(), &json!({ "kind": "exam", "name": "n", "date": "2026-11-03", "fileIds": "f1" }), "i".into())).1, "file ids must be a list of space file ids");
		assert_eq!(code(new_deadline(&known(), &json!({ "kind": "exam", "name": "n", "date": "2026-11-03", "source": 3 }), "i".into())), ("bad_source", "The source must be text".to_owned()));
		assert_eq!(code(new_deadline(&known(), &json!({ "kind": "exam", "name": "n", "date": "2026-11-03", "assignmentFileId": "zz" }), "i".into())).1, "Not a file of this space: \"zz\"");
	}

	#[test]
	fn a_change_keeps_what_it_does_not_name_and_stamps_a_ticked_deadline() {
		let prev = json!({ "id": "d", "kind": "exam", "name": "Mid", "date": "2026-11-02", "time": "10:00", "fileIds": ["f1"], "leftOutIds": ["f2"], "source": "s", "done": false });
		let ticked = changed_deadline(&known(), &prev, &json!({ "done": true }), "NOW").unwrap();
		assert_eq!(stringify(&ticked), r#"{"id":"d","kind":"exam","name":"Mid","date":"2026-11-02","time":"10:00","fileIds":["f1"],"source":"s","done":true,"doneAt":"NOW","leftOutIds":["f2"]}"#);
		let again = changed_deadline(&known(), &ticked, &json!({ "done": true }), "LATER").unwrap();
		assert_eq!(again["doneAt"], Json::from("NOW"));
		let unticked = changed_deadline(&known(), &ticked, &json!({ "done": false, "time": null, "source": null }), "T").unwrap();
		assert_eq!(stringify(&unticked), r#"{"id":"d","kind":"exam","name":"Mid","date":"2026-11-02","fileIds":["f1"],"done":false,"leftOutIds":["f2"]}"#);
	}

	#[test]
	fn naming_a_file_left_out_takes_it_off_the_covered_list() {
		let prev = json!({ "id": "d", "kind": "exam", "name": "Mid", "date": "2026-11-02", "fileIds": ["f1", "f2"], "done": false });
		let out = changed_deadline(&known(), &prev, &json!({ "leftOutIds": ["f2", "f3"] }), "T").unwrap();
		assert_eq!(stringify(&out["fileIds"]), r#"["f1"]"#);
		assert_eq!(stringify(&out["leftOutIds"]), r#"["f2","f3"]"#);
		let both = changed_deadline(&known(), &prev, &json!({ "leftOutIds": ["f2"], "fileIds": ["f2", "f3"] }), "T").unwrap();
		assert_eq!(stringify(&both["fileIds"]), r#"["f2","f3"]"#);
		assert!(both.get("leftOutIds").is_none());
	}

	#[test]
	fn problems_are_cleaned_and_refused_when_wrong() {
		let prev = json!({ "id": "d", "kind": "homework", "name": "HW", "date": "2026-11-02", "fileIds": [], "done": false });
		let patch = json!({ "problems": [{ "number": " 1 ", "text": " Show it. ", "page": 3, "done": true }, { "number": "2", "title": "  Two  parts ", "text": "x", "page": 1.5 }] });
		let out = changed_deadline(&known(), &prev, &patch, "T").unwrap();
		assert_eq!(
			stringify(&out["problems"]),
			r#"[{"number":"1","title":"1","text":"Show it.","page":3,"done":true},{"number":"2","title":"Two parts","text":"x","done":false}]"#
		);
		let bad = |p: Json| code(changed_deadline(&known(), &prev, &json!({ "problems": p }), "T")).1;
		assert_eq!(bad(json!("x")), "The problems must be a list of at most 60");
		assert_eq!(bad(json!([1])), "Problem 1 is not an object");
		assert_eq!(bad(json!([{ "number": "1" }])), "Problem 1 needs a number and its text");
		assert_eq!(bad(json!([{ "number": "1", "text": "a" }, { "number": "1", "text": "b" }])), "Two problems are numbered 1");
	}
}
