//! /api/jobs (one lesson's background jobs, for its transcript), /api/activity (the dock's feed)
//! and /api/activity/abort (the dock's END for a job, an extraction or a turn).

use std::sync::{Arc, LazyLock};

use axum::Router;
use axum::body::Body;
use axum::extract::State;
use axum::http::Uri;
use axum::response::Response;
use gs_base::re::Re;
use gs_json::{Json, json};
use gs_services::App;
use gs_services::graph::extraction_runs::abort_extraction;
use gs_services::jobs::jobs::{abort_job, list_jobs};
use gs_services::jobs::observability::activity_feed;
use gs_services::turns::turn_liveness::is_turn_running;
use gs_services::turns::turn_runs::abort_turn;

use crate::http::paths::{param, search_params};
use crate::http::reply::{Unhandled, error, json, json_body};
use crate::http::route::ApiRoute;

pub fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/jobs", ApiRoute::new().get(get_jobs).into_route())
		.route("/api/activity", ApiRoute::new().get(get_activity).into_route())
		.route("/api/activity/abort", ApiRoute::new().post(post_abort).into_route())
}

async fn get_jobs(State(app): State<Arc<App>>, uri: Uri) -> Response {
	static CHAT_ID: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[A-Za-z0-9_-]+$", ""));
	let params = search_params(uri.query().unwrap_or_default());
	let Some(chat_id) = param(&params, "chatId").filter(|id| !id.is_empty()) else {
		return error(400, "chatId query parameter is required");
	};
	if !CHAT_ID.test(chat_id) {
		return error(400, "Invalid chatId");
	}
	let jobs: Vec<Json> = list_jobs(&app, chat_id).iter().map(|job| (**job).clone()).collect();
	json(200, &json!({ "jobs": jobs, "turnInFlight": is_turn_running(&app, chat_id) }))
}

async fn get_activity(State(app): State<Arc<App>>) -> Response {
	json(200, &activity_feed(&app))
}

async fn post_abort(State(app): State<Arc<App>>, body: Body) -> Result<Response, Unhandled> {
	static ID: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[A-Za-z0-9:_-]+$", ""));
	let Some(body) = json_body(body).await else { return Ok(error(400, "Invalid JSON body")) };
	let kind = body["kind"].as_str().filter(|k| matches!(*k, "job" | "extraction" | "turn"));
	let id = body["id"].as_str().filter(|id| !id.is_empty());
	let (Some(kind), Some(id)) = (kind, id) else {
		return Ok(error(400, r#"Body must be {kind: "job"|"extraction"|"turn", id: string}"#));
	};
	if !ID.test(id) {
		return Ok(error(400, "Invalid id"));
	}
	let ok = json!({ "ok": true });
	Ok(match kind {
		"job" => match abort_job(&app, id)? {
			Ok(()) => json(200, &ok),
			Err(refusal) => {
				let status = if refusal == gs_services::jobs::jobs::AbortRefusal::NotFound { 404 } else { 409 };
				json(status, &json!({ "ok": false, "reason": refusal.reason() }))
			}
		},
		"turn" if abort_turn(&app, id) => json(200, &ok),
		"turn" => json(409, &json!({ "ok": false, "reason": "not_running" })),
		_ => {
			// Idempotent: nothing in flight is the same outcome for the dock.
			abort_extraction(&app, id);
			json(200, &ok)
		}
	})
}
