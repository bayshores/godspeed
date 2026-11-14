//! A mock's end (mock-end.ts), by End mock or by its time limit, and the request for its grades.
//! A timed mock whose time ran out while nobody was looking is ended the next time it or its
//! deadline's mocks are read, so it never shows as running, takes answers or holds back the next
//! mock past its time. A paused mock is never ended that way: its time is not running.

use std::collections::HashMap;
use std::sync::Arc;

use gs_agent::subagents::mock_writer::{MockRequest, grade_mock};
use gs_base::locks::LockKey;
use gs_base::{clock, time};
use gs_core::mocks::mock::{MockLanguage, MockState, end_mock, is_answered, mock_state, seconds_left};
use gs_core::mocks::mock_requests::grade_request_text;
use gs_engine::turn::models::agent_engine;
use gs_json::{Json, Obj, js_number};

use super::mock_runner::run_examples;
use super::mock_runs::{changed, mock_run_key, start_run};
use crate::App;
use crate::graph::progress::progress_for;

/// How long past its time a running mock still takes the page's last save.
const LATE_SAVE_MS: i64 = 10_000;

pub fn mock_label(mock: &Json) -> String {
	format!("Mock {}", js_number(mock["n"].as_f64().unwrap_or(f64::NAN)))
}

/// The mock with its grades set (a field it has keeps its place).
fn with_grades_field(mock: &Json, grades: Json) -> Json {
	let mut out = mock.as_obj().cloned().unwrap_or_default();
	out.insert("grades", grades);
	Json::Obj(out)
}

/// The deadline a mock belongs to (`{name, kind}` as the requests name it); None once it is gone.
pub fn deadline_of(app: &App, space_id: &str, mock: &Json) -> Option<Json> {
	let record = app.stores.spaces.get_space(space_id)?;
	record["deadlines"].as_arr()?.iter().find(|d| d["id"] == mock["deadlineId"]).cloned()
}

/// Every fact statement of the space's graph, by id.
pub fn fact_statements(app: &App, space_id: &str) -> Result<HashMap<String, String>, String> {
	let Some(progress) = progress_for(app, space_id, None)? else { return Ok(HashMap::new()) };
	Ok(progress["facts"].as_arr().into_iter().flatten().filter_map(|f| Some((f["id"].as_str()?.to_owned(), f["statement"].str_or_empty().to_owned()))).collect())
}

/// Asks the teacher for an ended mock's grades. With nothing answered there is nothing to ask.
pub fn ask_grades(app: &Arc<App>, space_id: &str, mock: &Json) -> Result<(), String> {
	let Some(deadline) = deadline_of(app, space_id, mock) else { return Ok(()) };
	let answered: Vec<Json> = mock["questions"].as_arr().into_iter().flatten().filter(|q| is_answered(&mock["answers"][q["id"].str_or_empty()])).cloned().collect();
	if answered.is_empty() {
		app.stores.mocks.write_mock(space_id, &with_grades_field(mock, Json::Obj(Obj::new())))?;
		changed(app, space_id);
		return Ok(());
	}
	let facts = fact_statements(app, space_id)?;
	let (task_app, id, mock) = (app.clone(), space_id.to_owned(), mock.clone());
	start_run(app, space_id, &mock_run_key(space_id, mock["id"].str_or_empty()), move |signal| async move {
		let mut runs = Obj::new();
		for q in &answered {
			// Removed meanwhile: the learner's programs need not run.
			if signal.is_aborted() {
				return Ok(());
			}
			let answer = &mock["answers"][q["id"].str_or_empty()];
			if let (Some("code"), Some(language)) = (q["kind"].as_str(), MockLanguage::parse(&answer["language"])) {
				let run = run_examples(&task_app.paths.tmp, q, answer["text"].str_or_empty(), language, Some(&signal)).await?;
				runs.insert(q["id"].str_or_empty(), run);
			}
		}
		let prompt = grade_request_text(&deadline, &mock, &Json::Obj(runs), &facts);
		let request = MockRequest { label: mock_label(&mock), prompt, engine: agent_engine(&task_app.bridge), signal };
		let graded = grade_mock(&task_app.bridge, request, &mock).await.map_err(|e| e.to_string())?;
		let _guard = task_app.locks.lock(LockKey::Space(&id));
		if task_app.stores.mocks.read_mock(&id, mock["id"].str_or_empty())?.is_some() {
			task_app.stores.mocks.write_mock(&id, &graded)?;
		}
		Ok(())
	});
	Ok(())
}

/// Ends a running or paused mock and asks for its grades: the mock as it is now, None once it is
/// removed. Read again under the lock, so a copy read before it is never written back: a mock
/// removed meanwhile stays removed, and one ended meanwhile keeps its grades.
pub fn finish(app: &Arc<App>, space_id: &str, seen: &Json) -> Result<Option<Json>, String> {
	let _guard = app.locks.lock(LockKey::Space(space_id));
	let Some(mock) = app.stores.mocks.read_mock(space_id, seen["id"].str_or_empty())? else { return Ok(None) };
	if !matches!(mock_state(&mock), MockState::Running | MockState::Paused) {
		return Ok(Some(mock));
	}
	let now = clock::now_ms();
	// A running timed mock never ends later than its time ran out.
	let end = match (mock_state(&mock), mock["endsAt"].as_str().and_then(time::parse_date)) {
		(MockState::Running, Some(ends)) => now.min(ends),
		_ => now,
	};
	let ended = end_mock(&mock, end);
	app.stores.mocks.write_mock(space_id, &ended)?;
	changed(app, space_id);
	ask_grades(app, space_id, &ended)?;
	// With nothing answered it is graded already.
	Ok(Some(app.stores.mocks.read_mock(space_id, mock["id"].str_or_empty())?.unwrap_or(ended)))
}

/// A running timed mock whose time ran out, past the last save's grace. A paused one never is.
pub fn is_over(mock: &Json) -> bool {
	mock_state(mock) == MockState::Running && seconds_left(mock, (clock::now_ms() - LATE_SAVE_MS) as f64) == Some(0.0)
}

/// The mock, ended first when its time ran out; None once it is removed.
pub fn end_if_over(app: &Arc<App>, space_id: &str, mock: Json) -> Result<Option<Json>, String> {
	if is_over(&mock) { finish(app, space_id, &mock) } else { Ok(Some(mock)) }
}

/// The space's mocks by number, each ended first when its time ran out.
pub fn current_mocks(app: &Arc<App>, space_id: &str) -> Vec<Json> {
	let mocks = app.stores.mocks.list_mocks(space_id).unwrap_or_default();
	mocks
		.into_iter()
		.filter_map(|mock| match end_if_over(app, space_id, mock.clone()) {
			Ok(now) => now,
			Err(error) => {
				eprintln!("[mocks] couldn't end {}: {error}", mock["id"].str_or_empty());
				Some(mock)
			}
		})
		.collect()
}
