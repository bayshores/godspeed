//! The one-time upgrade of a space saved as a prep (0.6.5 and before) into a normal space: what it
//! was like becomes the info file "What it's like.md", its topics the study file "Study guide.md",
//! its day an interview deadline (or, with no day, the space's waiting deadline until the learner
//! gives one), its goal the description when that is empty, and its mocks belong to the deadline.
//!
//! The ids come from the space id, so an upgrade that stopped halfway (files and mocks written,
//! the record not yet) writes the same things again on the next start. The record keeps `prep`
//! until the last write, which drops it.

use std::collections::HashSet;

use gs_base::hash::sha256_text;
use gs_base::text::trim;
use gs_json::{Json, Obj};

use super::space_deadlines::{file_ids_of, new_deadline};
use crate::contracts::space::{compare_deadlines, is_calendar_date};

pub const ABOUT_FILE_NAME: &str = "What it's like.md";
pub const GUIDE_FILE_NAME: &str = "Study guide.md";

/// A file the upgrade writes into the space's own folder.
#[derive(Debug, PartialEq)]
pub struct UpgradeFile {
	pub id: String,
	pub name: &'static str,
	pub kind: &'static str,
	pub text: String,
}

/// What one old prep becomes.
#[derive(Debug, PartialEq)]
pub struct PrepUpgrade {
	/// The interview's id, also the waiting deadline's when the prep had no day.
	pub deadline_id: String,
	pub files: Vec<UpgradeFile>,
}

fn fixed_id(prefix: &str, space_id: &str, part: &str) -> String {
	format!("{prefix}_{}", &sha256_text(&format!("{space_id}:{part}"))[..12])
}

fn items(v: &Json) -> &[Json] {
	v.as_arr().map_or(&[], Vec::as_slice)
}

/// The old sheet's "what it is like" and its sources, as Markdown.
fn about_text(prep: &Json) -> Option<String> {
	let about = trim(prep["about"].str_or_empty());
	if about.is_empty() {
		return None;
	}
	let sources: Vec<String> = items(&prep["sources"])
		.iter()
		.filter_map(|s| {
			let url = s["url"].as_str()?;
			let title = Some(trim(s["title"].str_or_empty())).filter(|t| !t.is_empty()).unwrap_or(url);
			Some(format!("- [{title}]({url})"))
		})
		.collect();
	Some(if sources.is_empty() { format!("{about}\n") } else { format!("{about}\n\n## Sources\n\n{}\n", sources.join("\n")) })
}

/// The old sheet's topics, one heading each with the line on why it is there.
fn guide_text(prep: &Json) -> Option<String> {
	let topics: Vec<String> = items(&prep["topics"])
		.iter()
		.filter_map(|t| {
			let name = trim(t["name"].as_str()?);
			let why = trim(t["why"].str_or_empty());
			(!name.is_empty()).then(|| if why.is_empty() { format!("## {name}") } else { format!("## {name}\n\n{why}") })
		})
		.collect();
	if topics.is_empty() {
		return None;
	}
	Some(format!("# Study guide: {}\n\n{}\n", trim(prep["goal"].str_or_empty()), topics.join("\n\n")))
}

/// What the space's old prep becomes; None when the record has none.
pub fn prep_upgrade(record: &Json) -> Option<PrepUpgrade> {
	let prep = record.get("prep").filter(|p| p.as_obj().is_some())?;
	let space_id = record["id"].str_or_empty();
	let mut files = Vec::new();
	if let Some(text) = about_text(prep) {
		files.push(UpgradeFile { id: fixed_id("f", space_id, "about"), name: ABOUT_FILE_NAME, kind: "info", text });
	}
	if let Some(text) = guide_text(prep) {
		files.push(UpgradeFile { id: fixed_id("f", space_id, "guide"), name: GUIDE_FILE_NAME, kind: "study", text });
	}
	Some(PrepUpgrade { deadline_id: fixed_id("ddl", space_id, "deadline"), files })
}

/// A file entry for the record, waiting to be read.
fn file_entry(file: &UpgradeFile, now: &str) -> Json {
	let mut out = Obj::new();
	out.insert("id", file.id.as_str());
	out.insert("origin", "copied");
	out.insert("name", file.name);
	out.insert("path", format!("{}/{}", file.id, file.name));
	out.insert("kind", file.kind);
	out.insert("contentFp", "");
	out.insert("status", "pending");
	out.insert("addedAt", now);
	// godspeed wrote it, so the agent's add_space_file may change it.
	out.insert("written", true);
	Json::Obj(out)
}

/// The record as a normal space: the upgrade's files listed (once), the interview added (or
/// waiting for its day), the goal as the description when that is empty, and `prep` gone.
pub fn upgraded_record(record: &Json, upgrade: &PrepUpgrade, now: &str) -> Json {
	let mut out = record.as_obj().cloned().unwrap_or_default();
	let prep = out.remove("prep").unwrap_or(Json::Null);
	let mut files = items(&record["files"]).to_vec();
	let have: HashSet<String> = file_ids_of(record);
	files.extend(upgrade.files.iter().filter(|f| !have.contains(&f.id)).map(|f| file_entry(f, now)));
	out.insert("files", Json::Arr(files));
	let about = upgrade.files.iter().find(|f| f.name == ABOUT_FILE_NAME).map(|f| f.id.as_str());
	let guide: Vec<&str> = upgrade.files.iter().filter(|f| f.name == GUIDE_FILE_NAME).map(|f| f.id.as_str()).collect();
	let name = record["name"].str_or_empty();
	let mut deadlines = items(&record["deadlines"]).to_vec();
	if is_calendar_date(&prep["date"]) {
		if !deadlines.iter().any(|d| d["id"].as_str() == Some(upgrade.deadline_id.as_str())) {
			let mut init = Obj::new();
			init.insert("kind", "interview");
			init.insert("name", name);
			init.insert("date", prep["date"].clone());
			init.insert("fileIds", guide.clone());
			if let Some(about) = about {
				init.insert("aboutFileId", about);
			}
			let known: HashSet<String> = upgrade.files.iter().map(|f| f.id.clone()).collect();
			if let Ok(deadline) = new_deadline(&known, &Json::Obj(init), upgrade.deadline_id.clone()) {
				deadlines.push(deadline);
			}
		}
	} else {
		let mut waiting = Obj::new();
		waiting.insert("id", upgrade.deadline_id.as_str());
		waiting.insert("name", name);
		if let Some(about) = about {
			waiting.insert("aboutFileId", about);
		}
		waiting.insert("fileIds", guide);
		out.insert("waitingDeadline", Json::Obj(waiting));
	}
	deadlines.sort_by(compare_deadlines);
	out.insert("deadlines", Json::Arr(deadlines));
	let goal = trim(prep["goal"].str_or_empty());
	if trim(record["description"].str_or_empty()).is_empty() && !goal.is_empty() {
		out.insert("description", goal);
	}
	Json::Obj(out)
}

/// A mock of the old prep, tied to the deadline it became.
pub fn upgraded_mock(mock: &Json, deadline_id: &str) -> Json {
	let mut out = Obj::new();
	for (key, value) in mock.as_obj().into_iter().flatten().filter(|(key, _)| *key != "deadlineId") {
		out.insert(key.as_str(), value.clone());
		if key == "id" {
			out.insert("deadlineId", deadline_id);
		}
	}
	Json::Obj(out)
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;

	fn prep(date: Option<&str>) -> Json {
		let mut prep = json!({
			"goal": "Larkspur backend onsite",
			"about": " Two coding rounds and a system design round. ",
			"sources": [{ "title": "Larkspur careers", "url": "https://example.com/careers" }, { "title": "", "url": "https://example.com/blog" }],
			"topics": [{ "id": "pt_a", "name": "Rate limiting", "why": "Round 2 asks for one." }, { "id": "pt_b", "name": "Idempotency keys" }],
			"mock": { "questions": 3, "minutes": 45 },
		});
		if let Some(date) = date {
			prep.as_obj_mut().unwrap().insert("date", date);
		}
		prep
	}

	fn record(prep: Json) -> Json {
		json!({ "id": "spc_larkspur", "name": "Larkspur onsite", "description": "", "files": [], "deadlines": [], "prep": prep })
	}

	#[test]
	fn the_ids_come_from_the_space_and_the_sheet_becomes_two_files() {
		let upgrade = prep_upgrade(&record(prep(Some("2026-11-24")))).unwrap();
		assert_eq!(upgrade, prep_upgrade(&record(prep(None))).unwrap(), "the same every time");
		assert_eq!(upgrade.deadline_id, format!("ddl_{}", &sha256_text("spc_larkspur:deadline")[..12]));
		assert_eq!(upgrade.files.iter().map(|f| (f.name, f.kind)).collect::<Vec<_>>(), [(ABOUT_FILE_NAME, "info"), (GUIDE_FILE_NAME, "study")]);
		assert_eq!(upgrade.files[0].text, "Two coding rounds and a system design round.\n\n## Sources\n\n- [Larkspur careers](https://example.com/careers)\n- [https://example.com/blog](https://example.com/blog)\n");
		assert_eq!(upgrade.files[1].text, "# Study guide: Larkspur backend onsite\n\n## Rate limiting\n\nRound 2 asks for one.\n\n## Idempotency keys\n");
		assert_eq!(prep_upgrade(&json!({ "id": "spc_plain", "name": "Plain" })), None);
		let unwritten = prep_upgrade(&record(json!({ "goal": "A test", "about": "", "sources": [], "topics": [] }))).unwrap();
		assert!(unwritten.files.is_empty(), "a sheet never written gives no files");
	}

	#[test]
	fn a_prep_with_a_day_becomes_an_interview_deadline_and_a_normal_space() {
		let old = record(prep(Some("2026-11-24")));
		let upgrade = prep_upgrade(&old).unwrap();
		let new = upgraded_record(&old, &upgrade, "2026-11-13T10:00:00.000Z");
		assert!(new.get("prep").is_none());
		assert_eq!(new["description"], json!("Larkspur backend onsite"));
		let (about, guide) = (&upgrade.files[0].id, &upgrade.files[1].id);
		assert_eq!(
			stringify(&new["deadlines"]),
			format!(r#"[{{"id":"{}","kind":"interview","name":"Larkspur onsite","date":"2026-11-24","fileIds":["{guide}"],"aboutFileId":"{about}","done":false}}]"#, upgrade.deadline_id)
		);
		assert_eq!(
			stringify(&new["files"][0]),
			format!(r#"{{"id":"{about}","origin":"copied","name":"What it's like.md","path":"{about}/What it's like.md","kind":"info","contentFp":"","status":"pending","addedAt":"2026-11-13T10:00:00.000Z","written":true}}"#)
		);
		let mut again = new.clone();
		again.as_obj_mut().unwrap().insert("prep", prep(Some("2026-11-24")));
		assert_eq!(upgraded_record(&again, &upgrade, "later"), new, "files and the deadline it has are not added twice");
	}

	#[test]
	fn a_prep_with_no_day_waits_for_one_and_keeps_a_description_it_has() {
		let mut old = record(prep(None));
		old.as_obj_mut().unwrap().insert("description", "Mine");
		let upgrade = prep_upgrade(&old).unwrap();
		let new = upgraded_record(&old, &upgrade, "t");
		assert_eq!(new["deadlines"], json!([]));
		assert_eq!(new["waitingDeadline"], json!({ "id": upgrade.deadline_id, "name": "Larkspur onsite", "aboutFileId": upgrade.files[0].id, "fileIds": [upgrade.files[1].id] }));
		assert_eq!(new["description"], json!("Mine"));
	}

	#[test]
	fn a_mock_is_tied_to_the_deadline_right_after_its_id() {
		let mock = json!({ "id": "mock_0a1b2c3d", "n": 1, "deadlineId": "ddl_old" });
		assert_eq!(stringify(&upgraded_mock(&mock, "ddl_x")), r#"{"id":"mock_0a1b2c3d","deadlineId":"ddl_x","n":1}"#);
		assert_eq!(upgraded_mock(&upgraded_mock(&mock, "ddl_x"), "ddl_x"), upgraded_mock(&mock, "ddl_x"));
	}
}
