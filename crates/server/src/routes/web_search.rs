//! /api/web-search (the Web search card in Settings → Connection: the key's last four characters and this month's
//! searches) and /api/web-search/key (save a key Tavily accepts, or remove it). For the desktop
//! window only, like every other /api route.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::State;
use axum::response::Response;
use gs_services::App;
use gs_services::app::web_search::{KeyError, remove_search_key, save_search_key, web_search_view};

use crate::http::reply::{self, Unhandled, error, fields};
use crate::http::route::ApiRoute;

pub fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/web-search", ApiRoute::new().get(view).into_route())
		.route("/api/web-search/key", ApiRoute::new().put(save_key).delete(remove_key).into_route())
}

async fn view(State(app): State<Arc<App>>) -> Response {
	reply::json_no_store(200, &web_search_view(&app).await)
}

async fn save_key(State(app): State<Arc<App>>, body: Body) -> Result<Response, Unhandled> {
	let body = fields(body).await?;
	let Some(key) = body["key"].as_str() else {
		return Ok(error(400, "key must be a string"));
	};
	match save_search_key(&app, key).await {
		Ok(view) => Ok(reply::json_no_store(200, &view)),
		Err(KeyError::Refused(message)) => Ok(error(400, &message)),
		Err(KeyError::Disk(message)) => Err(Unhandled::from(message)),
	}
}

async fn remove_key(State(app): State<Arc<App>>) -> Result<Response, Unhandled> {
	Ok(reply::json_no_store(200, &remove_search_key(&app)?))
}
