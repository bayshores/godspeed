//! GET /api/desktop/login?token=<hex>: how the desktop window gets in. The shell hands the
//! server a one-time token over the line protocol, then opens this URL in its window; the answer
//! sets the cookie the access check asks for. Page scripts never see the cookie, and the token is
//! spent.

use std::sync::Arc;

use axum::http::{HeaderValue, Uri, header};
use axum::response::Response;
use gs_services::App;

use super::paths::{param, search_params};
use super::reply;

pub async fn login(app: Arc<App>, uri: Uri, cookie: Option<HeaderValue>) -> Response {
	let params = search_params(uri.query().unwrap_or_default());
	let token = param(&params, "token").unwrap_or_default();
	let (Some(shell), Some(cookie)) = (&app.shell, cookie) else { return super::refused() };
	if !shell.take_login(token) {
		return super::refused();
	}
	let mut res = reply::no_store(reply::empty(303));
	res.headers_mut().insert(header::LOCATION, HeaderValue::from_static("/"));
	res.headers_mut().insert(header::SET_COOKIE, cookie);
	res
}
