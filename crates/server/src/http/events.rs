//! GET /api/events (src/backend/server/events-stream.ts): one SSE stream per open window over the
//! event bus. Frames carry only the event name and a small payload; the window then fetches what
//! changed. A `: ping` comment goes out every 25 s. The stream ends when the window goes away
//! (its queue is dropped with the body) or the server stops.

use std::convert::Infallible;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderValue, header};
use axum::response::Response;
use bytes::Bytes;
use gs_base::{clock, shutdown};
use gs_services::App;

const PING_MS: i64 = 25_000;

pub async fn stream(State(app): State<Arc<App>>) -> Response {
	// Subscribed before answering, so no event can fall in between.
	let rx = app.events.subscribe();
	let frames = futures_util::stream::unfold((rx, clock::now_ms() + PING_MS), |(mut rx, due)| async move {
		tokio::select! {
			event = rx.recv() => event.map(|e| (Ok::<_, Infallible>(Bytes::from(e.sse_frame())), (rx, due))),
			() = clock::sleep_until(due) => Some((Ok(Bytes::from_static(b": ping\n\n")), (rx, due + PING_MS))),
			() = shutdown::wait() => None,
		}
	});
	let mut res = Response::new(Body::from_stream(frames));
	let headers = res.headers_mut();
	headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/event-stream"));
	headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache, no-transform"));
	headers.insert("x-accel-buffering", HeaderValue::from_static("no"));
	res
}
