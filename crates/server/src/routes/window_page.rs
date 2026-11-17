//! /api/window-page: the window says which page it shows, so open_page can tell the agent the
//! learner is there already.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::State;
use axum::response::Response;
use gs_core::contracts::space::parse_space_scope;
use gs_services::App;
use gs_services::app::open_page::{Here, set_window_page};

use crate::http::reply::{self, Unhandled, error, fields};
use crate::http::route::ApiRoute;

pub fn routes() -> Router<Arc<App>> {
	Router::new().route("/api/window-page", ApiRoute::new().put(window_page).into_route())
}

/// PUT `{ path: "/space/files", space: "spc_1" | null }`, or `{ path: null }` when the page goes.
async fn window_page(State(app): State<Arc<App>>, body: Body) -> Result<Response, Unhandled> {
	let body = fields(body).await?;
	let Some(path) = body["path"].as_str() else {
		set_window_page(&app, None);
		return Ok(reply::ok());
	};
	if !path.starts_with('/') {
		return Ok(error(400, "path must be an app path"));
	}
	let Some(space_id) = parse_space_scope(body["space"].as_str()) else { return Ok(error(400, "bad space")) };
	set_window_page(&app, Some(Here { path: path.to_owned(), space_id }));
	Ok(reply::ok())
}
