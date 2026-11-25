//! The setup card's routes for the picked agent: /api/agent/health, /api/agent/login,
//! /api/agent/login/code, /api/agent/login/cancel and /api/agent/models.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::State;
use axum::response::Response;
use gs_json::json;
use gs_services::App;
use gs_services::app::agent_health::health_view;
use gs_services::app::agent_login::{LoginError, cancel_login, send_login_code, start_login};
use gs_services::app::agent_models::agent_models;

use crate::http::reply::{self, Unhandled, error, fields};
use crate::http::route::ApiRoute;

pub fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/agent/health", ApiRoute::new().get(health).into_route())
		.route("/api/agent/login", ApiRoute::new().post(login).into_route())
		.route("/api/agent/login/code", ApiRoute::new().post(login_code).into_route())
		.route("/api/agent/login/cancel", ApiRoute::new().post(login_cancel).into_route())
		.route("/api/agent/models", ApiRoute::new().get(models).into_route())
}

async fn health(State(app): State<Arc<App>>) -> Response {
	reply::json_no_store(200, &health_view(&app))
}

fn refused(err: &LoginError) -> Response {
	reply::no_store(error(err.status(), err.message()))
}

/// `{url}`: the page the learner signs in on.
async fn login(State(app): State<Arc<App>>) -> Response {
	match start_login(&app).await {
		Ok(url) => reply::json_no_store(200, &json!({ "url": url })),
		Err(err) => refused(&err),
	}
}

/// `{code}`: the code Claude Code's sign-in page showed.
async fn login_code(State(app): State<Arc<App>>, body: Body) -> Result<Response, Unhandled> {
	let body = fields(body).await?;
	let Some(code) = body["code"].as_str() else { return Ok(error(400, "code must be a string")) };
	Ok(match send_login_code(&app, code).await {
		Ok(()) => reply::no_store(reply::ok()),
		Err(err) => refused(&err),
	})
}

async fn login_cancel(State(app): State<Arc<App>>) -> Response {
	match cancel_login(&app).await {
		Ok(()) => reply::no_store(reply::ok()),
		Err(err) => refused(&err),
	}
}

/// `{agent, models: [{id, name, default}]}`.
async fn models(State(app): State<Arc<App>>) -> Response {
	match agent_models(&app).await {
		Ok(models) => reply::json_no_store(200, &models),
		Err(message) => reply::no_store(error(500, &message)),
	}
}
