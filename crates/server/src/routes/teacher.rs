//! /api/teacher-work (the teacher's round of work, for Follow's slip), /api/turns (how many turns
//! run now) and /api/window-page (the window says which page it shows, which the agent's
//! open_page compares with).

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::State;
use axum::response::Response;
use gs_core::contracts::space::parse_space_scope;
use gs_json::json;
use gs_services::App;
use gs_services::app::window_page::{WindowPage, set_window_page};
use gs_services::turns::turn_liveness::turns_running;
use gs_services::turns::turn_work::teacher_work;

use crate::http::reply::{self, Unhandled, error, fields};
use crate::http::route::ApiRoute;

pub(crate) fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/teacher-work", ApiRoute::new().get(round).into_route())
		.route("/api/turns", ApiRoute::new().get(turns).into_route())
		.route("/api/window-page", ApiRoute::new().put(window_page).into_route())
}

async fn round(State(app): State<Arc<App>>) -> Response {
	reply::json_no_store(200, &teacher_work(&app))
}

/// `{running}`: the lessons' and the teacher panel chats' turns running now.
async fn turns(State(app): State<Arc<App>>) -> Response {
	reply::json_no_store(200, &json!({ "running": turns_running(&app) }))
}

/// PUT `{ path: "/space/files" | null, space: "spc_1" | null }`: path null once the window is gone.
async fn window_page(State(app): State<Arc<App>>, body: Body) -> Result<Response, Unhandled> {
	let body = fields(body).await?;
	let page = match body["path"].as_str() {
		None => None,
		Some(path) if path.starts_with('/') => {
			let Some(space_id) = parse_space_scope(body["space"].as_str()) else { return Ok(error(400, "bad space")) };
			Some(WindowPage { path: path.to_owned(), space_id })
		}
		Some(_) => return Ok(error(400, "path must be an app path")),
	};
	set_window_page(&app, page);
	Ok(reply::ok())
}
