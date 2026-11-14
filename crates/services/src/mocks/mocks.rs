//! The one writer of a space's mocks (mocks.ts).
//!
//! A mock belongs to one exam, quiz or interview deadline and asks the teacher twice: for its
//! questions when it is made (written from the deadline's facts and what it is like), and for its
//! grades when it ends (the mock writer). In between the learner takes it with no agent: answers
//! are saved as they type, a timed one can be paused (saves and runs are refused until it
//! resumes), and a code answer's examples run on this computer (`mock_runner`). Ending one and
//! its grades are in `mock_end`. One unfinished mock per deadline. Every change goes out as
//! "mocks-changed", except a saved answer: its page already has it.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use gs_agent::subagents::mock_writer::{MockRequest, write_mock_questions};
use gs_base::locks::LockKey;
use gs_base::{clock, ids, text, time};
use gs_core::mocks::mock::{MockLanguage, MockState, MockView, is_timed, mock_format, mock_state, mock_summary, new_mock, pause_mock, resume_mock, start_mock, takes_mocks, with_answer};
use gs_core::mocks::mock_requests::mock_request_text;
use gs_engine::turn::models::agent_engine;
use gs_json::{Json, js_number, json};

use super::mock_end::{ask_grades, current_mocks, deadline_of, end_if_over, finish, is_over, mock_label};
use super::mock_runner::run_examples;
use super::mock_runs::{cancel_run, changed, is_running, mock_run_key, run_error, start_run};
use super::{Outcome, Stop, fail};
use crate::App;
use crate::graph::progress::progress_for;
use crate::spaces::deadline_about;

/// The most of "what it is like" a questions request carries.
const ABOUT_MAX: i64 = 4000;
/// Facts per topic, and in all, a questions request names.
const FACTS_PER_TOPIC: usize = 5;
const FACTS_MAX: usize = 60;

fn items(list: &Json) -> &[Json] {
	list.as_arr().map_or(&[], Vec::as_slice)
}

fn done() -> Outcome<()> {
	Ok(())
}

/// The saved mock, or the 404.
fn mock_of(app: &App, space_id: &str, mock_id: &str) -> Outcome<Json> {
	match app.stores.mocks.read_mock(space_id, mock_id)? {
		Some(mock) => Ok(mock),
		None => fail(404, "No such mock"),
	}
}

/// The deadline's mocks by number, each ended first when its time ran out.
fn deadline_mocks(app: &Arc<App>, space_id: &str, deadline_id: &str) -> Vec<Json> {
	current_mocks(app, space_id).into_iter().filter(|m| m["deadlineId"].as_str() == Some(deadline_id)).collect()
}

fn summary(app: &App, space_id: &str, mock: &Json) -> Json {
	let key = mock_run_key(space_id, mock["id"].str_or_empty());
	mock_summary(mock, is_running(app, &key), run_error(app, &key).as_deref())
}

/// A space's mocks (one deadline's, when given) as rows, newest first.
pub fn list_mocks(app: &Arc<App>, space_id: &str, deadline_id: Option<&str>) -> Outcome<Vec<Json>> {
	if app.stores.spaces.get_space(space_id).is_none() {
		return fail(404, "No such space");
	}
	let mut mocks = current_mocks(app, space_id);
	mocks.retain(|m| deadline_id.is_none_or(|d| m["deadlineId"].as_str() == Some(d)));
	mocks.reverse();
	Ok(mocks.iter().map(|m| summary(app, space_id, m)).collect())
}

/// What a deadline's mock is written from: its topics, the ones that most need work first, each
/// with up to FACTS_PER_TOPIC facts (`{name, status, facts: [{id, statement}]}`, FACTS_MAX facts in
/// all).
fn deadline_topics(app: &App, space_id: &str, deadline_id: &str) -> Result<Vec<Json>, String> {
	let Some(progress) = progress_for(app, space_id, None)? else { return Ok(Vec::new()) };
	let Some(deadline) = items(&progress["deadlines"]).iter().find(|d| d["id"].as_str() == Some(deadline_id)) else { return Ok(Vec::new()) };
	let topics: HashMap<&str, &Json> = items(&progress["topics"]).iter().map(|t| (t["id"].str_or_empty(), t)).collect();
	let statements: HashMap<&str, &Json> = items(&progress["facts"]).iter().map(|f| (f["id"].str_or_empty(), &f["statement"])).collect();
	let mut left = FACTS_MAX;
	let mut out = Vec::new();
	for t in items(&deadline["topics"]) {
		let Some(topic) = topics.get(t["id"].str_or_empty()) else { continue };
		let facts: Vec<Json> = items(&topic["members"])
			.iter()
			.filter_map(|id| Some(json!({ "id": id, "statement": statements.get(id.as_str()?)? })))
			.take(FACTS_PER_TOPIC.min(left))
			.collect();
		if facts.is_empty() {
			continue;
		}
		left -= facts.len();
		out.push(json!({ "name": topic["name"], "status": topic["status"], "facts": facts }));
	}
	Ok(out)
}

/// Makes the deadline's next mock (`questions` 1 to 10, `minutes` 5 to 240 or None for no time
/// limit) and asks the teacher for its questions; the new mock's id.
pub fn create_mock(app: &Arc<App>, space_id: &str, deadline_id: &str, questions: &Json, minutes: Option<&Json>) -> Outcome<String> {
	let _guard = app.locks.lock(LockKey::Space(space_id));
	let Some(record) = app.stores.spaces.get_space(space_id) else { return fail(404, "No such space") };
	let Some(deadline) = items(&record["deadlines"]).iter().find(|d| d["id"].as_str() == Some(deadline_id)) else { return fail(404, "No such deadline") };
	if !takes_mocks(&deadline["kind"]) {
		return fail(400, "Mocks are for exams, quizzes and interviews.");
	}
	let format = match mock_format(questions, minutes) {
		Ok(format) => format,
		Err(problem) => return fail(400, problem),
	};
	let mocks = deadline_mocks(app, space_id, deadline_id);
	if let Some(open) = mocks.iter().find(|m| mock_state(m) != MockState::Graded) {
		return fail(409, format!("Finish Mock {} first.", js_number(open["n"].as_f64().unwrap_or(f64::NAN))));
	}
	if !deadline["aboutFileId"].truthy() && deadline_topics(app, space_id, deadline_id)?.is_empty() {
		return fail(409, "This deadline has no study facts and no \"What it's like\" yet.");
	}
	let n = mocks.iter().filter_map(|m| m["n"].as_f64()).fold(0.0, f64::max) + 1.0;
	let mock = new_mock(&ids::uuid_hex("mock", 8), deadline_id, n, &format, &time::iso_now());
	app.stores.mocks.write_mock(space_id, &mock)?;
	ask_questions(app, space_id, &mock)?;
	Ok(mock["id"].str_or_empty().to_owned())
}

fn ask_questions(app: &Arc<App>, space_id: &str, mock: &Json) -> Result<(), String> {
	let deadline_id = mock["deadlineId"].str_or_empty();
	let Some(deadline) = deadline_of(app, space_id, mock) else { return Ok(()) };
	let topics = deadline_topics(app, space_id, deadline_id)?;
	let about = deadline_about(app, space_id, deadline_id).map(|a| text::slice16(a["text"].str_or_empty(), 0, Some(ABOUT_MAX)));
	let asked: Vec<String> = app.stores.mocks.list_mocks(space_id)?.iter().filter(|m| m["deadlineId"].as_str() == Some(deadline_id)).flat_map(|m| items(&m["questions"]).iter().map(|q| q["title"].str_or_empty().to_owned()).collect::<Vec<_>>()).collect();
	let prompt = mock_request_text(&deadline, about.as_deref(), &mock["format"], &topics, &asked);
	let fact_ids: HashSet<String> = topics.iter().flat_map(|t| items(&t["facts"]).iter().filter_map(|f| f["id"].as_str().map(str::to_owned))).collect();
	let (task_app, id, mock) = (app.clone(), space_id.to_owned(), mock.clone());
	start_run(app, space_id, &mock_run_key(space_id, mock["id"].str_or_empty()), move |signal| async move {
		let from_about = fact_ids.is_empty();
		let request = MockRequest { label: mock_label(&mock), prompt, engine: agent_engine(&task_app.bridge), signal };
		let questions = write_mock_questions(&task_app.bridge, request, &mock["format"], fact_ids).await.map_err(|e| e.to_string())?;
		// The learner may have removed the mock meanwhile.
		let _guard = task_app.locks.lock(LockKey::Space(&id));
		if let Some(now) = task_app.stores.mocks.read_mock(&id, mock["id"].str_or_empty())?
			&& mock_state(&now) == MockState::Writing
		{
			let mut written = now.as_obj().cloned().unwrap_or_default();
			if from_about {
				written.insert("fromAbout", true);
			}
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
	let saved = mock_of(app, space_id, mock_id)?;
	let Some(mock) = end_if_over(app, space_id, saved)? else { return fail(404, "No such mock") };
	let key = mock_run_key(space_id, mock_id);
	let deadline_name = deadline_of(app, space_id, &mock).map_or(Json::Null, |d| d["name"].clone());
	let view = MockView { space_id: space_id.to_owned(), deadline_name, mock, working: is_running(app, &key), error: run_error(app, &key) };
	Ok(view.to_json())
}

/// What the learner does on a mock's page.
pub enum MockAction {
	Start,
	/// `answer` is `{ text, language?, code, seconds, submitted }`.
	Answer { question_id: String, answer: Json },
	Pause,
	Resume,
	End,
	/// Ask the teacher again after a failed write or grading.
	Retry,
}

/// A running mock reached past its time: it ends now, and what came is refused.
fn time_is_up<T>(app: &Arc<App>, space_id: &str, mock: &Json) -> Outcome<T> {
	finish(app, space_id, mock)?;
	fail(409, "Time is up.")
}

/// Answers and code runs need a running mock with time left.
fn taking(app: &Arc<App>, space_id: &str, mock: &Json) -> Outcome<()> {
	match mock_state(mock) {
		MockState::Paused => fail(409, "This mock is paused."),
		MockState::Running if is_over(mock) => time_is_up(app, space_id, mock),
		MockState::Running => done(),
		_ => fail(409, "This mock isn't running."),
	}
}

pub fn change_mock(app: &Arc<App>, space_id: &str, mock_id: &str, change: MockAction) -> Outcome<()> {
	let _guard = app.locks.lock(LockKey::Space(space_id));
	let mock = mock_of(app, space_id, mock_id)?;
	let state = mock_state(&mock);
	let now = clock::now_ms();
	match change {
		MockAction::Start => {
			if state != MockState::Ready {
				return fail(409, "This mock can't be started.");
			}
			app.stores.mocks.write_mock(space_id, &start_mock(&mock, now))?;
			changed(app, space_id);
		}
		MockAction::Answer { question_id, answer } => {
			taking(app, space_id, &mock)?;
			app.stores.mocks.write_mock(space_id, &with_answer(&mock, &question_id, &answer))?;
		}
		MockAction::Pause => {
			if !is_timed(&mock) {
				return fail(409, "This mock has no time limit.");
			}
			taking(app, space_id, &mock)?;
			app.stores.mocks.write_mock(space_id, &pause_mock(&mock, now))?;
			changed(app, space_id);
		}
		MockAction::Resume => {
			if state != MockState::Paused {
				return fail(409, "This mock isn't paused.");
			}
			app.stores.mocks.write_mock(space_id, &resume_mock(&mock, now))?;
			changed(app, space_id);
		}
		MockAction::End => {
			if !matches!(state, MockState::Running | MockState::Paused) {
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

/// Removes every mock of a removed deadline; how many there were.
pub fn remove_deadline_mocks(app: &App, space_id: &str, deadline_id: &str) -> Result<usize, String> {
	let _guard = app.locks.lock(LockKey::Space(space_id));
	let mocks: Vec<Json> = app.stores.mocks.list_mocks(space_id)?.into_iter().filter(|m| m["deadlineId"].as_str() == Some(deadline_id)).collect();
	for mock in &mocks {
		let mock_id = mock["id"].str_or_empty();
		cancel_run(app, &mock_run_key(space_id, mock_id));
		app.stores.mocks.remove_mock(space_id, mock_id)?;
	}
	if !mocks.is_empty() {
		changed(app, space_id);
	}
	Ok(mocks.len())
}

/// Every graded mock of a space as answers for the facts its questions test (core
/// `mock_answers`). Read without the space's lock: progress is read under a lesson's.
pub fn space_mock_answers(app: &App, space_id: &str) -> Vec<Json> {
	app.stores.mocks.list_mocks_unlocked(space_id).unwrap_or_default().iter().flat_map(gs_core::mocks::mock::mock_answers).collect()
}

/// Runs a code question's examples on the learner's code, while the mock runs: a run outcome.
/// Dropping the future (the request went away) stops the run.
pub async fn run_mock_examples(app: &Arc<App>, space_id: &str, mock_id: &str, question_id: &str, code: &str, language: &Json) -> Outcome<Json> {
	let (question, language) = {
		let _guard = app.locks.lock(LockKey::Space(space_id));
		let mock = mock_of(app, space_id, mock_id)?;
		taking(app, space_id, &mock)?;
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
