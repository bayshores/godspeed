//! A mock's end (mock-end.ts), by End mock or by its clock, and the request for its grades. A
//! mock whose time ran out while nobody was looking is ended the next time it or its prep is
//! read, so it never shows as running, takes answers or holds back the next mock past its time.

use std::sync::Arc;

use gs_agent::subagents::mock_writer::{MockRequest, grade_mock};
use gs_base::events::EventKind;
use gs_base::locks::LockKey;
use gs_base::{clock, time};
use gs_core::mocks::mock::{MockLanguage, MockState, end_mock, is_answered, mock_state, seconds_left};
use gs_core::mocks::mock_requests::grade_request_text;
use gs_engine::turn::models::agent_engine;
use gs_json::{Json, Obj, js_number, json};

use super::mock_runner::run_examples;
use super::mock_runs::{mock_run_key, start_run};
use crate::App;

/// How long past its time a running mock still takes the page's last save.
const LATE_SAVE_MS: i64 = 10_000;

pub fn mock_label(mock: &Json) -> String {
	format!("Mock {}", js_number(mock["n"].as_f64().unwrap_or(f64::NAN)))
}

pub(crate) fn changed(app: &App, space_id: &str) {
	app.events.emit(EventKind::PrepChanged, json!({ "spaceId": space_id }));
}

/// The mock with its grades set (a field it has keeps its place).
fn with_grades_field(mock: &Json, grades: Json) -> Json {
	let mut out = mock.as_obj().cloned().unwrap_or_default();
	out.insert("grades", grades);
	Json::Obj(out)
}

/// Asks the teacher for an ended mock's grades. With nothing answered there is nothing to ask.
pub fn ask_grades(app: &Arc<App>, space_id: &str, mock: &Json) -> Result<(), String> {
	let Some(prep) = app.stores.spaces.get_space(space_id).map(|record| record["prep"].clone()).filter(Json::truthy) else { return Ok(()) };
	let answered: Vec<Json> = mock["questions"].as_arr().into_iter().flatten().filter(|q| is_answered(&mock["answers"][q["id"].str_or_empty()])).cloned().collect();
	if answered.is_empty() {
		app.stores.mocks.write_mock(space_id, &with_grades_field(mock, Json::Obj(Obj::new())))?;
		changed(app, space_id);
		return Ok(());
	}
	let (task_app, id, mock) = (app.clone(), space_id.to_owned(), mock.clone());
	start_run(app, space_id, &mock_run_key(space_id, mock["id"].str_or_empty()), move |signal| async move {
		let mut runs = Obj::new();
		for q in &answered {
			// Deleted meanwhile: the learner's programs need not run.
			if signal.is_aborted() {
				return Ok(());
			}
			let answer = &mock["answers"][q["id"].str_or_empty()];
			if let (Some("code"), Some(language)) = (q["kind"].as_str(), MockLanguage::parse(&answer["language"])) {
				let run = run_examples(&task_app.paths.tmp, q, answer["text"].str_or_empty(), language, Some(&signal)).await?;
				runs.insert(q["id"].str_or_empty(), run);
			}
		}
		let prompt = grade_request_text(prep["goal"].str_or_empty(), &mock, &Json::Obj(runs));
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

/// Ends a running mock and asks for its grades: the mock as it is now.
pub fn finish(app: &Arc<App>, space_id: &str, mock: &Json) -> Result<Json, String> {
	let _guard = app.locks.lock(LockKey::Space(space_id));
	// Never later than its time ran out.
	let started = mock["startedAt"].as_str().and_then(time::parse_date).ok_or("RangeError: Invalid time value")?;
	let latest = started as f64 + mock["format"]["minutes"].as_f64().unwrap_or(f64::NAN) * 60_000.0;
	let end = (clock::now_ms() as f64).min(latest);
	if !end.is_finite() {
		return Err("RangeError: Invalid time value".to_owned());
	}
	let ended = end_mock(mock, &time::iso(end as i64));
	app.stores.mocks.write_mock(space_id, &ended)?;
	changed(app, space_id);
	ask_grades(app, space_id, &ended)?;
	// With nothing answered it is graded already.
	Ok(app.stores.mocks.read_mock(space_id, mock["id"].str_or_empty())?.unwrap_or(ended))
}

/// A running mock whose time ran out, past the last save's grace.
pub fn is_over(mock: &Json) -> bool {
	mock_state(mock) == MockState::Running && seconds_left(mock, (clock::now_ms() - LATE_SAVE_MS) as f64) == 0.0
}

/// The mock, ended first when its time ran out.
pub fn end_if_over(app: &Arc<App>, space_id: &str, mock: Json) -> Result<Json, String> {
	if is_over(&mock) { finish(app, space_id, &mock) } else { Ok(mock) }
}

/// The prep's mocks, oldest first, each ended first when its time ran out.
pub fn current_mocks(app: &Arc<App>, space_id: &str) -> Vec<Json> {
	let mocks = app.stores.mocks.list_mocks(space_id).unwrap_or_default();
	mocks
		.into_iter()
		.map(|mock| match end_if_over(app, space_id, mock.clone()) {
			Ok(now) => now,
			Err(error) => {
				eprintln!("[mocks] couldn't end {}: {error}", mock["id"].str_or_empty());
				mock
			}
		})
		.collect()
}
