//! A space's deadlines, added by the learner (Edit space) or an outside agent from the syllabus
//! (MCP add_space_deadline). The store validates; these map its refusals.

use std::sync::Arc;

use gs_base::{locale, time};
use gs_core::contracts::space::compare_deadlines;
use gs_core::spaces::today_note::local_day;
use gs_json::{Json, json};
use gs_store::spaces::SpaceError;

use super::{SpaceFailure, SpaceOutcome, fail, no_space};
use crate::App;

fn deadline_failure(err: SpaceError) -> SpaceFailure {
	match err {
		SpaceError::Deadline(e) => SpaceFailure { status: if e.code == "deadline_not_found" { 404 } else { 400 }, code: e.code.to_owned(), error: e.message },
		SpaceError::Other(message) => SpaceFailure::thrown(message),
	}
}

pub fn list_space_deadlines(app: &App, space_id: &str) -> SpaceOutcome<Json> {
	let Some(record) = app.stores.spaces.get_space(space_id) else { return no_space() };
	Ok(if record["deadlines"].is_null() { json!([]) } else { record["deadlines"].clone() })
}

/// `init` holds `kind`, `name`, `date` and optionally `time`, `fileIds`, `leftOutIds`, `source`
/// and `assignmentFileId`.
pub fn add_space_deadline(app: &App, space_id: &str, init: &Json) -> SpaceOutcome<Json> {
	if app.stores.spaces.get_space(space_id).is_none() {
		return no_space();
	}
	app.stores.spaces.add_deadline(space_id, init).map_err(deadline_failure)
}

pub fn update_space_deadline(app: &Arc<App>, space_id: &str, deadline_id: &str, patch: &Json) -> SpaceOutcome<Json> {
	if app.stores.spaces.get_space(space_id).is_none() {
		return no_space();
	}
	app.stores.spaces.update_deadline(space_id, deadline_id, patch).map_err(deadline_failure)
}

pub fn remove_space_deadline(app: &App, space_id: &str, deadline_id: &str) -> SpaceOutcome<()> {
	if app.stores.spaces.get_space(space_id).is_none() {
		return no_space();
	}
	match app.stores.spaces.remove_deadline(space_id, deadline_id) {
		Ok(true) => {}
		Ok(false) => return fail(404, "deadline_not_found", format!("No deadline \"{deadline_id}\" in this space")),
		Err(err) => return Err(SpaceFailure::thrown(err)),
	}
	app.stores.cheat_sheets.remove_cheat_sheet(space_id, deadline_id).map_err(SpaceFailure::thrown)
}

/// The deadlines `keep` picks from every space that is not archived, soonest due first, each with
/// its space id and name.
fn deadlines_where(app: &App, keep: impl Fn(&Json) -> bool) -> Vec<Json> {
	let mut out = Vec::new();
	for record in app.stores.spaces.list_space_records() {
		if record["archived"].truthy() {
			continue;
		}
		for d in record["deadlines"].as_arr().into_iter().flatten() {
			if !keep(d) {
				continue;
			}
			let mut open = d.clone();
			if let Some(obj) = open.as_obj_mut() {
				obj.insert("spaceId", record["id"].clone());
				obj.insert("spaceName", record["name"].clone());
			}
			out.push(open);
		}
	}
	out.sort_by(|a, b| compare_deadlines(a, b).then_with(|| locale::compare(a["spaceName"].as_str().unwrap_or(""), b["spaceName"].as_str().unwrap_or(""))));
	out
}

/// Every deadline not yet done (Today).
pub fn list_open_deadlines(app: &App) -> Vec<Json> {
	deadlines_where(app, |d| !d["done"].truthy())
}

/// The deadlines ticked done on `day` (a local day, YYYY-MM-DD): Today keeps them, stamped, until
/// the day ends.
pub fn list_deadlines_done_on(app: &App, day: &str) -> Vec<Json> {
	let done_on = |at: &Json| at.as_str().and_then(time::parse_date).is_some_and(|ms| local_day(ms) == day);
	deadlines_where(app, |d| d["done"].truthy() && d["doneAt"].truthy() && done_on(&d["doneAt"]))
}

/// A deadline with its space (deadline ids are unique across spaces): `{ spaceId, deadline }`.
pub fn deadline_with_space(app: &App, deadline_id: &str) -> Option<Json> {
	app.stores.spaces.list_space_records().into_iter().find_map(|record| {
		let deadline = record["deadlines"].as_arr()?.iter().find(|d| d["id"].as_str() == Some(deadline_id))?;
		Some(json!({ "spaceId": record["id"], "deadline": deadline }))
	})
}

#[cfg(test)]
mod tests {
	use gs_base::clock;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn today_lists_open_deadlines_and_those_ticked_done_today() {
		let root = scratch_dir("deadlines-done-today");
		let app = test_app(&root);
		let space = app.stores.spaces.create_space(&json!({ "name": "Algebra" })).unwrap();
		let id = space["id"].as_str().unwrap();
		let add = |name: &str| add_space_deadline(&app, id, &json!({ "kind": "quiz", "name": name, "date": "2026-11-20" })).unwrap();
		let (open, done) = (add("Quiz 1"), add("Quiz 2"));
		update_space_deadline(&app, id, done["id"].as_str().unwrap(), &json!({ "done": true })).unwrap();
		let names = |list: Vec<Json>| list.iter().map(|d| d["name"].as_str().unwrap().to_owned()).collect::<Vec<_>>();
		assert_eq!(names(list_open_deadlines(&app)), [open["name"].as_str().unwrap()]);
		let today = local_day(clock::now_ms());
		let done_today = list_deadlines_done_on(&app, &today);
		assert_eq!(names(done_today.clone()), ["Quiz 2"]);
		assert_eq!(done_today[0]["spaceName"].as_str(), Some("Algebra"));
		assert!(list_deadlines_done_on(&app, "2000-01-01").is_empty());
		app.stores.spaces.update_space(id, &json!({ "archived": true })).unwrap();
		assert!(list_deadlines_done_on(&app, &today).is_empty() && list_open_deadlines(&app).is_empty());
	}
}
