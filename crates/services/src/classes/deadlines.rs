//! A class's deadlines, added by the learner (Edit class) or an outside agent from the syllabus
//! (MCP add_class_deadline). The store validates; these map its refusals.

use std::sync::Arc;

use gs_base::locale;
use gs_core::contracts::class::compare_deadlines;
use gs_json::{Json, json};
use gs_store::classes::ClassError;

use super::{ClassFailure, ClassOutcome, fail, no_class};
use crate::App;

fn deadline_failure(err: ClassError) -> ClassFailure {
	match err {
		ClassError::Deadline(e) => ClassFailure { status: if e.code == "deadline_not_found" { 404 } else { 400 }, code: e.code.to_owned(), error: e.message },
		ClassError::Other(message) => ClassFailure::thrown(message),
	}
}

pub fn list_class_deadlines(app: &App, class_id: &str) -> ClassOutcome<Json> {
	let Some(record) = app.stores.classes.get_class(class_id) else { return no_class() };
	Ok(if record["deadlines"].is_null() { json!([]) } else { record["deadlines"].clone() })
}

/// `init` holds `kind`, `name`, `date` and optionally `time`, `fileIds`, `leftOutIds`, `source`
/// and `assignmentFileId`.
pub fn add_class_deadline(app: &App, class_id: &str, init: &Json) -> ClassOutcome<Json> {
	if app.stores.classes.get_class(class_id).is_none() {
		return no_class();
	}
	app.stores.classes.add_deadline(class_id, init).map_err(deadline_failure)
}

pub fn update_class_deadline(app: &Arc<App>, class_id: &str, deadline_id: &str, patch: &Json) -> ClassOutcome<Json> {
	if app.stores.classes.get_class(class_id).is_none() {
		return no_class();
	}
	app.stores.classes.update_deadline(class_id, deadline_id, patch).map_err(deadline_failure)
}

pub fn remove_class_deadline(app: &App, class_id: &str, deadline_id: &str) -> ClassOutcome<()> {
	if app.stores.classes.get_class(class_id).is_none() {
		return no_class();
	}
	match app.stores.classes.remove_deadline(class_id, deadline_id) {
		Ok(true) => {}
		Ok(false) => return fail(404, "deadline_not_found", format!("No deadline \"{deadline_id}\" in this class")),
		Err(err) => return Err(ClassFailure::thrown(err)),
	}
	app.stores.cheat_sheets.remove_cheat_sheet(class_id, deadline_id).map_err(ClassFailure::thrown)
}

/// Every deadline not yet done, across every class that is not archived, soonest due first, each
/// with its class id and name (Home).
pub fn list_open_deadlines(app: &App) -> Vec<Json> {
	let mut out = Vec::new();
	for record in app.stores.classes.list_class_records() {
		if record["archived"].truthy() {
			continue;
		}
		for d in record["deadlines"].as_arr().into_iter().flatten() {
			if d["done"].truthy() {
				continue;
			}
			let mut open = d.clone();
			if let Some(obj) = open.as_obj_mut() {
				obj.insert("classId", record["id"].clone());
				obj.insert("className", record["name"].clone());
			}
			out.push(open);
		}
	}
	out.sort_by(|a, b| compare_deadlines(a, b).then_with(|| locale::compare(a["className"].as_str().unwrap_or(""), b["className"].as_str().unwrap_or(""))));
	out
}

/// A deadline with its class (deadline ids are unique across classes): `{ classId, deadline }`.
pub fn deadline_with_class(app: &App, deadline_id: &str) -> Option<Json> {
	app.stores.classes.list_class_records().into_iter().find_map(|record| {
		let deadline = record["deadlines"].as_arr()?.iter().find(|d| d["id"].as_str() == Some(deadline_id))?;
		Some(json!({ "classId": record["id"], "deadline": deadline }))
	})
}
