//! /api/spaces/{id}/deadlines/{deadline_id}/request: what the deadline page asks the learner's
//! agent to do on a deadline, and how that request stands. /api/spaces/{id}/checks/{run}/undo
//! undoes a space check, and /api/deadlines/{space id}/{id}/not-yet answers Home's overdue ask.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::response::Response;
use gs_core::spaces::deadline_requests::RequestKind;
use gs_services::App;
use gs_services::spaces::deadline_requests::{deadline_request_view, not_yet, request_deadline};
use gs_services::spaces::space_checks::undo_check;

use crate::http::reply::{self, Unhandled, error, fields};
use crate::http::route::ApiRoute;

pub fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/spaces/{id}/deadlines/{deadline_id}/request", ApiRoute::new().get(view).post(start).into_route())
		.route("/api/spaces/{id}/checks/{run}/undo", ApiRoute::new().post(undo).into_route())
		.route("/api/deadlines/{id}/{deadline_id}/not-yet", ApiRoute::new().post(later).into_route())
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
