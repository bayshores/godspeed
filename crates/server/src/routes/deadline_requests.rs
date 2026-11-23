//! /api/spaces/{id}/deadlines/{deadline_id}/request: what the deadline page asks the learner's
//! agent to do on a deadline, and how that request stands. /api/spaces/{id}/checks/{run}/undo
//! undoes a space check, /api/deadlines/{space id}/{id}/not-yet answers Home's overdue ask and
//! /api/deadlines/{space id}/nothing-new waves off a space's gap.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::response::Response;
use gs_core::spaces::deadline_requests::RequestKind;
use gs_services::App;
use gs_services::spaces::deadline_requests::{deadline_request_view, not_yet, request_deadline};
use gs_services::spaces::gaps::answer_gap;
use gs_services::spaces::space_checks::undo_check;

use crate::http::reply::{self, Unhandled, error, fields};
use crate::http::route::ApiRoute;

pub fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/spaces/{id}/deadlines/{deadline_id}/request", ApiRoute::new().get(view).post(start).into_route())
		.route("/api/spaces/{id}/checks/{run}/undo", ApiRoute::new().post(undo).into_route())
		.route("/api/deadlines/{id}/{deadline_id}/not-yet", ApiRoute::new().post(later).into_route())
		.route("/api/deadlines/{id}/nothing-new", ApiRoute::new().post(nothing_new).into_route())
}

/// GET: `{ running: kind | null, failed: { kind, said } | { kind, error } | null }`.
async fn view(State(app): State<Arc<App>>, Path((id, deadline_id)): Path<(String, String)>) -> Response {
	reply::no_store(reply::json(200, &deadline_request_view(&app, &id, &deadline_id)))
}

/// POST `{ kind: "coverage" | "guide" | "about" }`: starts the request; 409 while one runs on it.
async fn start(State(app): State<Arc<App>>, Path((id, deadline_id)): Path<(String, String)>, body: Body) -> Result<Response, Unhandled> {
	let body = fields(body).await?;
	let Some(kind) = body["kind"].as_str().and_then(RequestKind::parse) else {
		return Ok(error(400, "kind must be \"coverage\", \"guide\" or \"about\""));
	};
	reply::answer(request_deadline(&app, &id, &deadline_id, kind), |()| reply::ok())
}

/// POST: undoes what the check changed and is still as it left it: `{ undone, changedSince,
/// inUse }`. 404 once the run is gone (undone already, too old, or the app restarted).
async fn undo(State(app): State<Arc<App>>, Path((id, run)): Path<(String, String)>) -> Result<Response, Unhandled> {
	reply::answer(undo_check(&app, &id, &run), |done| reply::json(200, &done))
}

/// POST: Not yet for an overdue deadline; Home never asks about it again.
async fn later(State(app): State<Arc<App>>, Path((id, deadline_id)): Path<(String, String)>) -> Result<Response, Unhandled> {
	reply::answer(not_yet(&app, &id, &deadline_id), |()| reply::ok())
}

/// POST `{ key }`: the learner waved off the space's gap with that key; it is not asked again.
async fn nothing_new(State(app): State<Arc<App>>, Path(id): Path<String>, body: Body) -> Result<Response, Unhandled> {
	let body = fields(body).await?;
	let Some(key) = body["key"].as_str() else { return Ok(error(400, "key must be a string")) };
	reply::answer(answer_gap(&app, &id, key), |()| reply::ok())
}

#[cfg(test)]
mod tests {
	use gs_core::study::deadline_plan::add_days;
	use gs_json::json;
	use gs_services::spaces::gaps::open_gaps;
	use http_body_util::BodyExt;

	use super::*;

	async fn read(res: Result<Response, Unhandled>) -> (u16, String) {
		let Ok(res) = res else { return (500, String::new()) };
		let status = res.status().as_u16();
		(status, String::from_utf8(res.into_body().collect().await.unwrap().to_bytes().to_vec()).unwrap())
	}

	#[tokio::test]
	async fn waving_off_a_gap_needs_its_key_and_stops_asking() {
		let root = std::env::temp_dir().join(format!("gs-gap-routes-{}", gs_base::ids::uuid()));
		for name in ["data", "home", "tmp", "res"] {
			std::fs::create_dir_all(root.join(name)).unwrap();
		}
		let app = App::new(gs_base::config::Paths::new(root.join("data"), root.join("home"), root.join("tmp"), root.join("res")), None);
		let now = gs_base::clock::now_ms();
		let today = gs_core::spaces::today_note::local_day(now);
		let id = app.stores.spaces.create_space(&json!({ "name": "CSE 29" })).unwrap()["id"].str_or_empty().to_owned();
		for (kind, name, days) in [("homework", "HW1", 9), ("exam", "Test 2", 2)] {
			app.stores.spaces.add_deadline(&id, &json!({ "kind": kind, "name": name, "date": add_days(&today, -days) })).unwrap();
		}
		let key = open_gaps(&app, now)[0].key.clone();
		let post = |space: &str, body: String| nothing_new(State(app.clone()), Path(space.to_owned()), Body::from(body));
		let bad_key = (400, r#"{"error":"key must be a string"}"#.to_owned());
		assert_eq!(read(post(&id, "{}".into()).await).await, bad_key);
		assert_eq!(read(post(&id, r#"{"key":7}"#.into()).await).await, bad_key);
		assert_eq!(read(post("spc_nope", gs_json::stringify(&json!({ "key": key }))).await).await, (404, r#"{"error":"Unknown space"}"#.to_owned()));
		assert_eq!(read(post(&id, r#"{"key":"spc_other:ddl:recent"}"#.into()).await).await, (404, r#"{"error":"Unknown gap"}"#.to_owned()));
		assert_eq!(open_gaps(&app, now).len(), 1, "a refused answer changes nothing");
		assert_eq!(read(post(&id, gs_json::stringify(&json!({ "key": key }))).await).await, (200, r#"{"ok":true}"#.to_owned()));
		assert!(open_gaps(&app, now).is_empty());
		let _ = std::fs::remove_dir_all(&root);
	}
}
