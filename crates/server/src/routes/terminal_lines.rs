//! /api/talk-page (the window says which page it shows, and whether it takes the learner's
//! terminal lines) and /api/terminal-lines/{id} (the window says whether that page sent a line).

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::response::Response;
use gs_core::contracts::space::parse_space_scope;
use gs_engine::bridge::WindowPage;
use gs_services::App;
use gs_services::app::terminal_lines::confirm_terminal_line;

use crate::http::reply::{self, Unhandled, error, fields};
use crate::http::route::ApiRoute;

/// The pages that take lines, as the hook's answer names them to the learner.
const PAGES: [&str; 2] = ["lesson", "cheat sheet"];

pub fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/talk-page", ApiRoute::new().put(talk_page).into_route())
		.route("/api/terminal-lines/{id}", ApiRoute::new().post(confirm).into_route())
}

/// PUT `{ page: "lesson" | "cheat sheet" | null, path: "/space/files" | null, space: "spc_1" | null }`:
/// path null once the window is gone.
async fn talk_page(State(app): State<Arc<App>>, body: Body) -> Result<Response, Unhandled> {
	let body = fields(body).await?;
	let page = match body["page"].as_str() {
		Some(page) if PAGES.contains(&page) => Some(page.to_owned()),
		Some(_) => return Ok(error(400, "page must be \"lesson\", \"cheat sheet\" or null")),
		None => None,
	};
	let window = match body["path"].as_str() {
		None => None,
		Some(path) if path.starts_with('/') => {
			let Some(space_id) = parse_space_scope(body["space"].as_str()) else { return Ok(error(400, "bad space")) };
			Some(WindowPage { path: path.to_owned(), space_id })
		}
		Some(_) => return Ok(error(400, "path must be an app path")),
	};
	let was = app.bridge.window_page().map(|w| w.path);
	let now = window.as_ref().map(|w| w.path.clone());
	app.bridge.set_talk_page(page, window);
	gs_services::vault::lesson_left(&app, was.as_deref(), now.as_deref());
	Ok(reply::ok())
}

/// POST `{ sent: boolean }`; 404 when no line waits under that id.
async fn confirm(State(app): State<Arc<App>>, Path(id): Path<u64>, body: Body) -> Result<Response, Unhandled> {
	let body = fields(body).await?;
	if confirm_terminal_line(&app, id, body["sent"].as_bool() == Some(true)) { Ok(reply::ok()) } else { Ok(error(404, "No line waits under that id")) }
}
