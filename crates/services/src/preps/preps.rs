//! The one writer of a space's prep sheet and the request behind it.
//!
//! A prep is a space with a `prep` on its record. Making one saves the learner's words (and any
//! files they attached, as space info) and asks the teacher for the sheet: one background work
//! item on the single-submit seam (the prep writer), so it stays out of Talk and the lessons. One
//! request at a time per prep. The learner (on its page) and the teacher (in Talk) can change the
//! sheet, and the learner can ask for it again. Each change goes out as "prep-changed"; the page
//! fetches the view again.

use std::collections::HashSet;
use std::sync::Arc;

use gs_agent::subagents::prep_writer::{SheetRequest, write_prep_sheet};
use gs_base::events::EventKind;
use gs_base::locks::LockKey;
use gs_base::{clock, ids, time};
use gs_core::preps::mock::{mock_answers, mock_summary};
use gs_core::preps::prep::{RequestFile, goal_name, new_prep, prep_request_text, prep_topic_progress, with_edits, with_sheet};
use gs_core::spaces::today_note::local_day;
use gs_engine::turn::models::agent_engine;
use gs_json::{Json, Obj, json};

use super::mock_end::current_mocks;
use super::prep_runs::{is_running, mock_run_key, run_error, start_run};
use crate::App;
use crate::graph::progress::space_answers;
use crate::spaces::space_card::space_file_path;
use crate::spaces::{add_copied_file, copied_file_problem};

/// Why a call did not finish: a refusal the route answers with its status, or a throw (the
/// route's empty 500).
#[derive(Debug, PartialEq)]
pub enum Stop {
	Refuse(u16, String),
	Throw(String),
}

impl From<String> for Stop {
	fn from(message: String) -> Stop {
		Stop::Throw(message)
	}
}

pub type Outcome<T> = Result<T, Stop>;

pub fn fail<T>(status: u16, error: impl Into<String>) -> Outcome<T> {
	Err(Stop::Refuse(status, error.into()))
}

pub fn done() -> Outcome<()> {
	Ok(())
}

fn changed(app: &App, space_id: &str) {
	app.events.emit(EventKind::PrepChanged, json!({ "spaceId": space_id }));
}

fn new_topic_id() -> String {
	ids::uuid_hex("pt", 8)
}

fn items(v: &Json) -> &[Json] {
	v.as_arr().map_or(&[], Vec::as_slice)
}

/// A space that is a prep (its whole record), or the 404 for one that isn't.
pub fn prep_of(app: &App, space_id: &str) -> Outcome<Json> {
	match app.stores.spaces.get_space(space_id) {
		Some(record) if record["prep"].truthy() => Ok(record),
		_ => fail(404, "No such prep"),
	}
}

/// A file the learner attached to a new prep.
pub struct NewFile {
	pub name: String,
	pub bytes: Vec<u8>,
}

/// Makes a prep from the learner's words and asks the teacher for its sheet; its space id. Attached
/// files become its space info; one godspeed can't read refuses the whole request, before anything
/// is made.
pub fn create_prep(app: &Arc<App>, goal: &str, date: Option<&str>, files: &[NewFile]) -> Outcome<String> {
	let Some(prep) = new_prep(goal, date) else { return fail(400, "Say what you are preparing for.") };
	if let Some(problem) = files.iter().find_map(|f| copied_file_problem(&f.name, &f.bytes)) {
		return fail(400, problem);
	}
	let name = goal_name(prep["goal"].as_str().unwrap_or(""));
	let record = app.stores.spaces.create_space(&json!({ "name": name, "prep": prep }))?;
	let space_id = record["id"].as_str().unwrap_or("").to_owned();
	for file in files {
		if let Err(failure) = add_copied_file(app, &space_id, &file.name, &file.bytes, "info")
			&& failure.is_thrown()
		{
			return Err(Stop::Throw(failure.error));
		}
	}
	let _ = start_write(app, &space_id);
	Ok(space_id)
}

/// A prep as its page shows it: `{spaceId, name, prep, topics, mocks, writing, error?}`, the
/// sheet's topics in its order each with its track record, and its mocks oldest first.
pub fn prep_view(app: &Arc<App>, space_id: &str) -> Outcome<Json> {
	let record = prep_of(app, space_id)?;
	let error = run_error(app, space_id);
	let mocks = current_mocks(app, space_id);
	let mut answers = space_answers(app, space_id);
	answers.extend(mocks.iter().flat_map(mock_answers));
	let summaries: Vec<Json> = mocks
		.iter()
		.map(|m| {
			let key = mock_run_key(space_id, m["id"].as_str().unwrap_or(""));
			mock_summary(m, is_running(app, &key), run_error(app, &key).as_deref())
		})
		.collect();
	let mut view = Obj::new();
	view.insert("spaceId", space_id);
	view.insert("name", record["name"].clone());
	view.insert("prep", record["prep"].clone());
	view.insert("topics", prep_topic_progress(items(&record["prep"]["topics"]), &answers));
	view.insert("mocks", summaries);
	view.insert("writing", is_running(app, space_id));
	if let Some(error) = error {
		view.insert("error", error);
	}
	Ok(Json::Obj(view))
}

/// Asks the teacher to write the sheet (again). Refused while it is being written.
pub fn start_write(app: &Arc<App>, space_id: &str) -> Outcome<()> {
	// The check and the start under one lock: two clicks start one request.
	let _guard = app.locks.lock(LockKey::Space(space_id));
	let record = prep_of(app, space_id)?;
	if is_running(app, space_id) {
		return fail(409, "Your agent is still writing this sheet.");
	}
	let prep = &record["prep"];
	let files: Vec<RequestFile> = items(&record["files"]).iter().filter_map(|f| Some(RequestFile { name: f["name"].as_str().unwrap_or("").to_owned(), path: space_file_path(app, &record, f)? })).collect();
	let goal = prep["goal"].as_str().unwrap_or("").to_owned();
	let prompt = prep_request_text(&goal, prep["date"].as_str().filter(|d| !d.is_empty()), &local_day(clock::now_ms()), &files, items(&prep["topics"]));
	let (task_app, id) = (app.clone(), space_id.to_owned());
	start_run(app, space_id, space_id, move |signal| async move {
		let request = SheetRequest { goal, prompt, engine: agent_engine(&task_app.bridge), signal };
		let sheet = write_prep_sheet(&task_app.bridge, request).await.map_err(|e| e.to_string())?;
		keep_sheet(&task_app, &id, &sheet)
	});
	done()
}

/// Puts a written sheet on the prep as it is now: the learner may have changed the day or
/// deleted the prep meanwhile.
fn keep_sheet(app: &Arc<App>, space_id: &str, sheet: &Json) -> Result<(), String> {
	let _guard = app.locks.lock(LockKey::Space(space_id));
	let Ok(now) = prep_view(app, space_id) else { return Ok(()) };
	let answered: HashSet<String> = items(&now["topics"]).iter().filter(|t| t["answered"].as_f64().is_some_and(|n| n > 0.0)).filter_map(|t| t["id"].as_str().map(str::to_owned)).collect();
	let (prep, name) = with_sheet(&now["prep"], sheet, &time::iso_now(), &mut new_topic_id, &answered);
	app.stores.spaces.update_space(space_id, &json!({ "prep": prep, "name": name }))?;
	Ok(())
}

/// Changes the sheet: the learner on its page, or the teacher in Talk. `edits` as core
/// `with_edits` takes them.
pub fn change_prep(app: &App, space_id: &str, edits: &Json) -> Outcome<()> {
	let _guard = app.locks.lock(LockKey::Space(space_id));
	let record = prep_of(app, space_id)?;
	if is_running(app, space_id) {
		return fail(409, "Your agent is still writing this sheet. Change it once it is done.");
	}
	let next = match with_edits(&record["prep"], edits, &mut new_topic_id) {
		Ok(next) => next,
		Err(problem) => return fail(400, problem),
	};
	app.stores.spaces.update_space(space_id, &json!({ "prep": next }))?;
	changed(app, space_id);
	done()
}

#[cfg(test)]
#[path = "preps_tests.rs"]
mod tests;
