//! /api/mcp (the MCP endpoint for outside agents), /api/mcp/line (a line the learner typed to an
//! agent, for the page on screen), /api/mcp/agent-event (it stopped or needs the learner),
//! /api/mcp-access (Settings → Connection: the token, who is connected, rotating the token) and
//! /api/teacher-work (the teacher's round of work, for Follow's slip). The agents' routes check the
//! token themselves; the other two are for the desktop window only, like every other /api route.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, Method};
use axum::response::Response;
use gs_json::{Json, json};
use gs_services::App;

use crate::http::reply::{self, Unhandled, json_body, read_body};
use crate::http::route::ApiRoute;
use crate::mcp;

pub fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/mcp", ApiRoute::new().get(endpoint).post(endpoint).delete(endpoint).into_route())
		.route("/api/mcp/line", ApiRoute::new().post(line).into_route())
		.route("/api/mcp/agent-event", ApiRoute::new().post(agent_event).into_route())
		.route("/api/mcp-access", ApiRoute::new().get(access).post(rotate).into_route())
		.route("/api/teacher-work", ApiRoute::new().get(teacher_work).into_route())
}

async fn endpoint(State(app): State<Arc<App>>, method: Method, headers: HeaderMap, body: Body) -> Response {
	let raw = read_body(body).await;
	mcp::handle_mcp_request(&app, &method, &headers, &raw).await
}

async fn agent_event(State(app): State<Arc<App>>, headers: HeaderMap, body: Body) -> Response {
	mcp::handle_agent_event(&app, &headers, json_body(body).await)
}

async fn line(State(app): State<Arc<App>>, headers: HeaderMap, body: Body) -> Response {
	mcp::handle_terminal_line(&app, &headers, json_body(body).await).await
}

/// The status with the endpoint's address. Node built it from its own host and port, never
/// from the request's Host header.
fn view(app: &App) -> Result<Json, String> {
	let mut status = mcp::mcp_access_status(app)?;
	if let Some(fields) = status.as_obj_mut() {
		fields.insert("url", format!("http://127.0.0.1:{}/api/mcp", crate::http::port()));
	}
	Ok(status)
}

async fn access(State(app): State<Arc<App>>) -> Result<Response, Unhandled> {
	Ok(reply::json_no_store(200, &view(&app)?))
}

async fn teacher_work(State(app): State<Arc<App>>) -> Response {
	reply::json_no_store(200, &app.terminals.teacher_work(gs_base::clock::now_ms()))
}

async fn rotate(State(app): State<Arc<App>>, body: Body) -> Result<Response, Unhandled> {
	let body = json_body(body).await.unwrap_or_else(|| json!({}));
	// `null.action` throws in the TS.
	if body.is_null() {
		return Err(Unhandled);
	}
	if body["action"].as_str() != Some("rotate") {
		return Ok(reply::json(400, &json!({ "error": "action must be \"rotate\"" })));
	}
	app.stores.mcp_token.write_new_mcp_token()?;
	Ok(reply::json_no_store(200, &view(&app)?))
}
