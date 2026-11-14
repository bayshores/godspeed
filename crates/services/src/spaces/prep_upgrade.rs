//! Runs the one-time upgrade of spaces saved as preps (`gs_core::spaces::prep_upgrade`) at
//! startup, before anything else reads or writes them. Per space: the files, then the mocks, then
//! one record write that drops `prep`. A stop between steps repeats the same writes next time.

use gs_base::locks::LockKey;
use gs_base::{fsx, time};
use gs_core::spaces::prep_upgrade::{PrepUpgrade, prep_upgrade, upgraded_mock, upgraded_record};

use crate::App;

/// Upgrades every space that still has a prep; how many were.
pub fn upgrade_old_preps(app: &App) -> usize {
	let mut upgraded = 0;
	for record in app.stores.spaces.list_space_records() {
		let id = record["id"].str_or_empty();
		match upgrade_space(app, id) {
			Ok(true) => upgraded += 1,
			Ok(false) => {}
			Err(error) => eprintln!("[spaces] couldn't upgrade the prep of {id}: {error}"),
		}
	}
	upgraded
}

fn upgrade_space(app: &App, id: &str) -> Result<bool, String> {
	let _guard = app.locks.lock(LockKey::Space(id));
	let Some(upgrade) = app.stores.spaces.get_space(id).as_ref().and_then(prep_upgrade) else { return Ok(false) };
	write_files(app, id, &upgrade)?;
	tie_mocks(app, id, &upgrade.deadline_id)?;
	app.stores.spaces.rewrite_space(id, |record| upgraded_record(record, &upgrade, &time::iso_now()))?;
	Ok(true)
}

fn write_files(app: &App, id: &str, upgrade: &PrepUpgrade) -> Result<(), String> {
	let dir = app.stores.spaces.files_dir(id)?;
	for file in &upgrade.files {
		let path = dir.join(&file.id).join(file.name);
		fsx::write_text_atomic(&path, &file.text).map_err(|err| fsx::node_error_message(&err, "open", &path))?;
	}
	Ok(())
}

fn tie_mocks(app: &App, id: &str, deadline_id: &str) -> Result<(), String> {
	for mock in app.stores.mocks.list_mocks(id)? {
		app.stores.mocks.write_mock(id, &upgraded_mock(&mock, deadline_id))?;
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use gs_json::{Json, json};

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	/// A space saved by 0.6.5 with a prep and one graded format 1 mock.
	fn old_prep_space(app: &App, date: Option<&str>) -> String {
		let id = app.stores.spaces.create_space(&json!({ "name": "Larkspur onsite" })).unwrap()["id"].str_or_empty().to_owned();
		let mut prep = json!({
			"goal": "Larkspur backend onsite",
			"about": "Two coding rounds.",
			"sources": [],
			"topics": [{ "id": "pt_a", "name": "Rate limiting", "why": "Round 2 asks for one." }],
			"mock": { "questions": 2, "minutes": 30 },
		});
		if let Some(date) = date {
			prep.as_obj_mut().unwrap().insert("date", date);
		}
		app.stores.spaces.rewrite_space(&id, |r| {
			let mut next = r.clone();
			next.as_obj_mut().unwrap().insert("prep", prep);
			next
		}).unwrap();
		let mock = json!({
			"version": 1, "id": "mock_0000abcd", "n": 1, "format": { "questions": 1, "minutes": 30 }, "createdAt": "2026-11-01T10:00:00.000Z",
			"questions": [{ "id": "q1", "topicId": "pt_a", "title": "A limiter", "statement": "Sketch one.", "kind": "text" }],
			"answers": { "q1": { "text": "A token bucket.", "seconds": 300, "submitted": true } },
			"startedAt": "2026-11-01T10:01:00.000Z", "endedAt": "2026-11-01T10:20:00.000Z",
			"grades": { "q1": { "verdict": "right", "feedback": "Yes." } },
		});
		fsx::write_text_atomic(&app.paths.spaces.join(&id).join("mocks/mock_0000abcd.json"), &gs_json::stringify(&mock)).unwrap();
		id
	}

	fn deadline_ids(app: &App, id: &str) -> Vec<Json> {
		app.stores.spaces.get_space(id).unwrap()["deadlines"].as_arr().unwrap().iter().map(|d| d["id"].clone()).collect()
	}

	#[test]
	fn an_upgrade_stopped_before_the_record_write_ends_the_same_on_the_next_start() {
		let root = scratch_dir("prep-upgrade-partial");
		let app = test_app(&root);
		let id = old_prep_space(&app, Some("2026-11-24"));
		let upgrade = prep_upgrade(&app.stores.spaces.get_space(&id).unwrap()).unwrap();
		write_files(&app, &id, &upgrade).unwrap();
		tie_mocks(&app, &id, &upgrade.deadline_id).unwrap();
		assert!(app.stores.spaces.get_space(&id).unwrap().get("prep").is_some(), "stopped here: the prep is still there");

		assert_eq!(upgrade_old_preps(&app), 1);
		assert_eq!(upgrade_old_preps(&app), 0, "nothing left to upgrade");
		let record = app.stores.spaces.get_space(&id).unwrap();
		assert_eq!(deadline_ids(&app, &id), [json!(upgrade.deadline_id)], "one deadline");
		let files: Vec<Json> = record["files"].as_arr().unwrap().iter().map(|f| f["id"].clone()).collect();
		assert_eq!(files, upgrade.files.iter().map(|f| json!(f.id)).collect::<Vec<_>>(), "the same file ids, listed once");
		assert_eq!(record["deadlines"][0]["aboutFileId"], json!(upgrade.files[0].id));
		let dir = app.stores.spaces.files_dir(&id).unwrap();
		assert_eq!(std::fs::read_to_string(dir.join(&upgrade.files[0].id).join("What it's like.md")).unwrap(), "Two coding rounds.\n");
		let mock = app.stores.mocks.read_mock(&id, "mock_0000abcd").unwrap().unwrap();
		let keys: Vec<&str> = mock.as_obj().unwrap().keys().map(String::as_str).take(3).collect();
		assert_eq!((keys, mock["deadlineId"].clone()), (vec!["id", "deadlineId", "n"], json!(upgrade.deadline_id)), "tied once");
		assert_eq!(mock["grades"]["q1"]["verdict"], json!("right"), "its score stays");
	}

	#[test]
	fn a_space_renamed_before_the_upgrade_keeps_its_prep_until_then() {
		let root = scratch_dir("prep-upgrade-rename");
		let app = test_app(&root);
		let id = old_prep_space(&app, None);
		app.stores.spaces.update_space(&id, &json!({ "name": "Larkspur loop" })).unwrap();
		assert_eq!(app.stores.spaces.get_space(&id).unwrap()["prep"]["goal"], json!("Larkspur backend onsite"), "another write keeps it");
		assert_eq!(upgrade_old_preps(&app), 1);
		let record = app.stores.spaces.get_space(&id).unwrap();
		assert_eq!(record["deadlines"], json!([]));
		assert_eq!(record["waitingDeadline"]["name"], json!("Larkspur loop"), "with no day, it waits for one");
		assert_eq!(record["description"], json!("Larkspur backend onsite"));
		let waiting = record["waitingDeadline"]["id"].str_or_empty().to_owned();
		assert_eq!(app.stores.mocks.read_mock(&id, "mock_0000abcd").unwrap().unwrap()["deadlineId"], json!(waiting));
	}
}
