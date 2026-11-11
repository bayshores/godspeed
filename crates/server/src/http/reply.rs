//! Answers and request bodies the way Next's route handlers make and read them.

use std::fmt::Display;

use axum::body::Body;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use bytes::{Bytes, BytesMut};
use gs_json::Json;
use http_body_util::BodyExt;

/// Next buffers a request body for src/proxy.ts and cuts it here (`proxyClientMaxBodySize`), so a
/// route then reads only this much.
const BODY_LIMIT: usize = 210 * 1024 * 1024;

fn with_type(status: u16, body: impl Into<Body>, content_type: &'static str) -> Response {
	let mut res = Response::new(body.into());
	*res.status_mut() = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
	res.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
	res
}

/// `Response.json(body, { status })`.
pub fn json(status: u16, body: &Json) -> Response {
	with_type(status, gs_json::stringify(body), "application/json")
}

/// `Response.json` with `Cache-Control: no-store`.
pub fn json_no_store(status: u16, body: &Json) -> Response {
	no_store(json(status, body))
}

/// `new Response(text, { status })`.
pub fn text(status: u16, body: impl Into<String>) -> Response {
	with_type(status, body.into(), "text/plain;charset=UTF-8")
}

/// `new Response(null, { status })`.
pub fn empty(status: u16) -> Response {
	let mut res = Response::new(Body::empty());
	*res.status_mut() = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
	res
}

pub fn no_store(mut res: Response) -> Response {
	res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
	res
}

/// The catch-all's 404 for a file or /api path nothing answers.
pub fn not_found() -> Response {
	no_store(text(404, "Not found"))
}

/// An error a TS route did not catch: Next logs it and answers an empty 500. Handlers return
/// `Result<Response, Unhandled>` and use `?` where the TS code would throw.
#[derive(Debug)]
pub struct Unhandled;

impl<E: Display> From<E> for Unhandled {
	fn from(err: E) -> Unhandled {
		eprintln!("route error: {err}");
		Unhandled
	}
}

impl IntoResponse for Unhandled {
	fn into_response(self) -> Response {
		empty(500)
	}
}

/// The whole body, cut at `BODY_LIMIT` (the rest is read and dropped). A body that breaks off
/// gives what arrived.
pub async fn read_body(body: Body) -> Bytes {
	let mut body = body;
	let mut out = BytesMut::new();
	while let Some(Ok(frame)) = body.frame().await {
		if let Ok(data) = frame.into_data() {
			let room = BODY_LIMIT.saturating_sub(out.len());
			out.extend_from_slice(&data[..data.len().min(room)]);
		}
	}
	out.freeze()
}

/// `TextDecoder` (what `req.text()` uses): a leading BOM dropped, bad bytes as U+FFFD.
pub fn body_text(bytes: &[u8]) -> String {
	let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
	String::from_utf8_lossy(bytes).into_owned()
}

/// `await req.json()`, None where it would throw.
pub async fn json_body(body: Body) -> Option<Json> {
	gs_json::parse(&body_text(&read_body(body).await)).ok()
}

/// `(await req.json().catch(() => ({})))` read for its fields: `{}` when the body is not JSON, and
/// a throw (500) for `null`, whose fields cannot be read.
pub async fn fields(body: Body) -> Result<Json, Unhandled> {
	match json_body(body).await {
		None => Ok(gs_json::json!({})),
		Some(Json::Null) => Err(Unhandled::from("body is null")),
		Some(body) => Ok(body),
	}
}

/// `{ error }` with `status`.
pub fn error(status: u16, message: &str) -> Response {
	json(status, &gs_json::json!({ "error": message }))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[tokio::test]
	async fn bodies_read_like_next() {
		assert_eq!(json_body(Body::from("\u{feff}{\"a\":1}")).await, Some(gs_json::json!({ "a": 1 })));
		assert_eq!(json_body(Body::from("{\"a\":")).await, None);
		assert_eq!(body_text(b"a\xffb"), "a\u{fffd}b");
		let res = not_found();
		assert_eq!(res.status(), 404);
		assert_eq!(res.headers()[header::CONTENT_TYPE], "text/plain;charset=UTF-8");
		assert_eq!(res.headers()[header::CACHE_CONTROL], "no-store");
	}
}
