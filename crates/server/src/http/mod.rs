//! The HTTP layer: what Next did before and around the route files. Every request first goes
//! through `front` (path clean-up, the desktop access check, bad encodings), then to a route, and
//! anything no route answers goes to the UI files.

pub mod access;
pub mod events;
pub mod form;
mod login;
pub mod paths;
pub mod reply;
pub mod route;
pub mod ui;

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Request, State};
use axum::http::{HeaderValue, Uri, header};
use axum::middleware::Next;
use axum::response::Response;
use gs_json::json;
use gs_services::App;

use access::Access;
use paths::Target;
use route::ApiRoute;

/// The port the server listens on: $PORT, else Next's 3000.
pub fn port() -> u16 {
	std::env::var("PORT").ok().and_then(|p| p.parse::<u16>().ok()).unwrap_or(3000)
}

/// Every route; main.rs wraps this in `front` with the same `access`.
pub fn server(app: Arc<App>, access: &Access) -> Router {
	let cookie = access.login_cookie();
	Router::new()
		.merge(crate::routes::api())
		.route("/api/events", ApiRoute::new().get(events::stream).into_route())
		.route("/api/desktop/login", ApiRoute::new().get(move |State(app): State<Arc<App>>, uri: Uri| login::login(app, uri, cookie.clone())).into_route())
		.route("/pdfjs/{*file}", ApiRoute::new().get(ui::pdfjs).into_route())
		.fallback(ApiRoute::new().get(ui::page).into_route())
		.layer(DefaultBodyLimit::disable())
		.with_state(app)
}

/// Runs before routing (the caller wraps the router in it, so a cleaned path is what routes see).
pub async fn front(State(access): State<Access>, mut req: Request, next: Next) -> Response {
	let target = req.uri().path_and_query().map_or("/", |pq| pq.as_str()).to_string();
	let (path, query) = match paths::normalize(&target) {
		Target::Redirect(to) => return redirect(&to),
		Target::Route { path, query } => (path, query),
	};
	if !access.allows(&path, req.headers()) {
		// Next took the whole body before its proxy refused; a refusal mid-upload resets the client.
		reply::read_body(req.into_body()).await;
		return refused();
	}
	if paths::decoded_segments(&path).is_none() {
		return bad_encoding();
	}
	if let Ok(uri) = format!("{path}{query}").parse::<Uri>() {
		*req.uri_mut() = uri;
	}
	next.run(req).await
}

/// The access check's refusal, which the login route gives too.
fn refused() -> Response {
	reply::json_no_store(403, &json!({ "error": "Desktop API access requires the trusted godspeed window." }))
}

/// Next's 308 for a path it cleans up: the new path as the body, no type.
fn redirect(to: &str) -> Response {
	let mut res = reply::empty(308);
	*res.body_mut() = Body::from(to.to_string());
	if let Ok(location) = HeaderValue::from_str(to) {
		res.headers_mut().insert(header::LOCATION, location);
	}
	res
}

/// Next's own 500 page when a path segment will not decode.
fn bad_encoding() -> Response {
	let mut res = reply::text(500, "Internal Server Error");
	let headers = res.headers_mut();
	headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/plain"));
	headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, no-cache, no-store, max-age=0, must-revalidate"));
	res
}
