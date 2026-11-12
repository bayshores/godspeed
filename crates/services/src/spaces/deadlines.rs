//! A space's deadlines, added by the learner (Edit space) or an outside agent from the syllabus
//! (MCP add_space_deadline). The store validates; these map its refusals.

use std::sync::Arc;

use gs_base::locale;
use gs_core::contracts::space::compare_deadlines;
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

/// Every deadline not yet done, across every space that is not archived, soonest due first, each
/// with its space id and name (Home).
pub fn list_open_deadlines(app: &App) -> Vec<Json> {
	let mut out = Vec::new();
	for record in app.stores.spaces.list_space_records() {
		if record["archived"].truthy() {
			continue;
		}
		for d in record["deadlines"].as_arr().into_iter().flatten() {
			if d["done"].truthy() {
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

/// A deadline with its space (deadline ids are unique across spaces): `{ spaceId, deadline }`.
pub fn deadline_with_space(app: &App, deadline_id: &str) -> Option<Json> {
	app.stores.spaces.list_space_records().into_iter().find_map(|record| {
		let deadline = record["deadlines"].as_arr()?.iter().find(|d| d["id"].as_str() == Some(deadline_id))?;
		Some(json!({ "spaceId": record["id"], "deadline": deadline }))
	})
}
