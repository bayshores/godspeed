//! The one writer of a prep's mocks (mocks.ts).
//!
//! A mock asks the teacher twice: for its questions when it is made, and for its grades when it
//! ends (the mock writer). In between the clock runs with no agent: answers are saved as the
//! learner types, and a code answer's examples run on this computer (`mock_runner`). Ending one
//! and its grades are in `mock_end`. One unfinished mock per prep. Every change goes out as
//! "prep-changed", except a saved answer: its page already has it.

use std::collections::HashSet;
use std::sync::Arc;

use gs_agent::subagents::mock_writer::{MockRequest, write_mock_questions};
use gs_base::locks::LockKey;
use gs_base::{ids, time};
use gs_core::preps::mock::{MockLanguage, MockState, MockView, mock_state, new_mock, start_mock, with_answer};
use gs_core::preps::mock_requests::mock_request_text;
use gs_engine::turn::models::agent_engine;
use gs_json::{Json, js_number, json};

use super::mock_end::{ask_grades, changed, current_mocks, end_if_over, finish, is_over, mock_label};
use super::mock_runner::run_examples;
use super::prep_runs::{cancel_run, is_running, mock_run_key, run_error, start_run};
use super::preps::{Outcome, Stop, done, fail, prep_of, prep_view};
use crate::App;

fn items(list: &Json) -> &[Json] {
	list.as_arr().map_or(&[], Vec::as_slice)
}

/// The saved mock of a prep, or the 404.
fn mock_of(app: &App, space_id: &str, mock_id: &str) -> Outcome<Json> {
	prep_of(app, space_id)?;
	match app.stores.mocks.read_mock(space_id, mock_id)? {
		Some(mock) => Ok(mock),
		None => fail(404, "No such mock"),
	}
}

/// Makes the prep's next mock and asks the teacher for its questions; the new mock's id.
pub fn create_mock(app: &Arc<App>, space_id: &str) -> Outcome<String> {
	let _guard = app.locks.lock(LockKey::Space(space_id));
	let record = prep_of(app, space_id)?;
	let format = &record["prep"]["mock"];
	if !format.truthy() {
		return fail(409, "The prep sheet doesn't say what a mock is yet. Write the sheet first.");
	}
	let mocks = current_mocks(app, space_id);
	if let Some(open) = mocks.iter().find(|m| mock_state(m) != MockState::Graded) {
		return fail(409, format!("Finish Mock {} first.", js_number(open["n"].as_f64().unwrap_or(f64::NAN))));
	}
	let n = mocks.iter().filter_map(|m| m["n"].as_f64()).fold(0.0, f64::max) + 1.0;
	let mock = new_mock(&ids::uuid_hex("mock", 8), n, format, &time::iso_now());
	app.stores.mocks.write_mock(space_id, &mock)?;
	ask_questions(app, space_id, &mock)?;
	Ok(mock["id"].str_or_empty().to_owned())
}

fn ask_questions(app: &Arc<App>, space_id: &str, mock: &Json) -> Result<(), String> {
	let Ok(view) = prep_view(app, space_id) else { return Ok(()) };
	let prep = &view["prep"];
	let topics = items(&view["topics"]);
	let asked: Vec<String> = app.stores.mocks.list_mocks(space_id)?.iter().flat_map(|m| items(&m["questions"]).iter().map(|q| q["title"].str_or_empty().to_owned()).collect::<Vec<_>>()).collect();
	let prompt = mock_request_text(prep["goal"].str_or_empty(), prep["about"].str_or_empty(), &mock["format"], topics, &asked);
	let topic_ids: HashSet<String> = topics.iter().filter_map(|t| t["id"].as_str().map(str::to_owned)).collect();
	let (task_app, id, mock) = (app.clone(), space_id.to_owned(), mock.clone());
	start_run(app, space_id, &mock_run_key(space_id, mock["id"].str_or_empty()), move |signal| async move {
		let request = MockRequest { label: mock_label(&mock), prompt, engine: agent_engine(&task_app.bridge), signal };
		let questions = write_mock_questions(&task_app.bridge, request, &mock["format"], topic_ids).await.map_err(|e| e.to_string())?;
		// The learner may have deleted the mock meanwhile.
		let _guard = task_app.locks.lock(LockKey::Space(&id));
		if let Some(now) = task_app.stores.mocks.read_mock(&id, mock["id"].str_or_empty())?
			&& mock_state(&now) == MockState::Writing
		{
			let mut written = now.as_obj().cloned().unwrap_or_default();
			written.insert("questions", questions);
			task_app.stores.mocks.write_mock(&id, &Json::Obj(written))?;
		}
		Ok(())
	});
	Ok(())
}

/// A mock as its own page shows it (core `MockView`), ended first when its time ran out.
pub fn mock_view(app: &Arc<App>, space_id: &str, mock_id: &str) -> Outcome<Json> {
	let _guard = app.locks.lock(LockKey::Space(space_id));
	let record = prep_of(app, space_id)?;
	let Some(saved) = app.stores.mocks.read_mock(space_id, mock_id)? else { return fail(404, "No such mock") };
	let mock = end_if_over(app, space_id, saved)?;
	let key = mock_run_key(space_id, mock_id);
	let view = MockView {
		space_id: space_id.to_owned(),
		prep_name: record["name"].clone(),
		mock,
		topics: items(&record["prep"]["topics"]).iter().map(|t| json!({ "id": t["id"], "name": t["name"] })).collect(),
		working: is_running(app, &key),
		error: run_error(app, &key),
	};
	Ok(view.to_json())
}

/// What the learner does on a mock's page.
pub enum MockAction {
	Start,
	/// `answer` is `{ text, language?, code, seconds, submitted }`.
	Answer { question_id: String, answer: Json },
	End,
	/// Ask the teacher again after a failed write or grading.
	Retry,
}

/// A running mock reached past its time: it ends now, and what came is refused.
fn time_is_up<T>(app: &Arc<App>, space_id: &str, mock: &Json) -> Outcome<T> {
	finish(app, space_id, mock)?;
	fail(409, "Time is up.")
}

pub fn change_mock(app: &Arc<App>, space_id: &str, mock_id: &str, change: MockAction) -> Outcome<()> {
	let _guard = app.locks.lock(LockKey::Space(space_id));
	let mock = mock_of(app, space_id, mock_id)?;
	let state = mock_state(&mock);
	match change {
		MockAction::Start => {
			if state != MockState::Ready {
				return fail(409, "This mock can't be started.");
			}
			app.stores.mocks.write_mock(space_id, &start_mock(&mock, &time::iso_now()))?;
			changed(app, space_id);
		}
		MockAction::Answer { question_id, answer } => {
			if state != MockState::Running {
				return fail(409, "This mock isn't running.");
			}
			if is_over(&mock) {
				return time_is_up(app, space_id, &mock);
			}
			app.stores.mocks.write_mock(space_id, &with_answer(&mock, &question_id, &answer))?;
		}
		MockAction::End => {
			if state != MockState::Running {
				return fail(409, "This mock isn't running.");
			}
			finish(app, space_id, &mock)?;
		}
		MockAction::Retry => {
			if is_running(app, &mock_run_key(space_id, mock_id)) {
				return fail(409, "Your agent is still working on this mock.");
			}
			match state {
				MockState::Writing => ask_questions(app, space_id, &mock)?,
				MockState::Grading => ask_grades(app, space_id, &mock)?,
				_ => return fail(409, "There is nothing to try again."),
			}
		}
	}
	done()
}

/// Removes a mock, stopping its request (and a grading's code runs).
pub fn delete_mock(app: &App, space_id: &str, mock_id: &str) -> Outcome<()> {
	let _guard = app.locks.lock(LockKey::Space(space_id));
	mock_of(app, space_id, mock_id)?;
	cancel_run(app, &mock_run_key(space_id, mock_id));
	app.stores.mocks.remove_mock(space_id, mock_id)?;
	changed(app, space_id);
	done()
}

/// Runs a code question's examples on the learner's code, while the mock runs: a run outcome.
/// Dropping the future (the request went away) stops the run.
pub async fn run_mock_examples(app: &Arc<App>, space_id: &str, mock_id: &str, question_id: &str, code: &str, language: &Json) -> Outcome<Json> {
	let (question, language) = {
		let _guard = app.locks.lock(LockKey::Space(space_id));
		let mock = mock_of(app, space_id, mock_id)?;
		if mock_state(&mock) != MockState::Running {
			return fail(409, "This mock isn't running.");
		}
		if is_over(&mock) {
			return time_is_up(app, space_id, &mock);
		}
		let question = items(&mock["questions"]).iter().find(|q| q["id"].as_str() == Some(question_id)).filter(|q| q["kind"].as_str() == Some("code")).cloned();
		let Some(question) = question else { return fail(404, "No such code question") };
		let Some(language) = MockLanguage::parse(language) else { return fail(400, "Pick JavaScript or Python.") };
		(question, language)
	};
	run_examples(&app.paths.tmp, &question, code, language, None).await.map_err(Stop::Throw)
}

#[cfg(test)]
#[path = "mocks_tests.rs"]
mod tests;
