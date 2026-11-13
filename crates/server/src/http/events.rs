//! GET /api/events: one SSE stream per open window over the
//! event bus. Frames carry only the event name and a small payload; the window then fetches what
//! changed. A `: ping` comment goes out every 25 s; no quick ping after quiet like the turn
//! stream's, since WebKit holds back the last bytes of fetch bodies but hands an EventSource every
//! event at once. The stream ends when the window goes away
//! (its queue is dropped with the body) or the server stops.

use std::convert::Infallible;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderValue, Method, header};
use axum::response::Response;
use bytes::Bytes;
use futures_util::StreamExt;
use gs_base::events::Event;
use gs_base::{clock, shutdown};
use gs_services::App;
use tokio::sync::mpsc::UnboundedReceiver;

const PING_MS: i64 = 25_000;

pub async fn stream(State(app): State<Arc<App>>, method: Method) -> Response {
	// Subscribed before answering, so no event can fall in between.
	let mut rx = app.events.subscribe();
	let mut due = clock::now_ms() + PING_MS;
	// Next sends the response head with the first frame, so the page's EventSource opens (and runs
	// its resync) only then; answering earlier would make every window refetch at load. A HEAD has
	// no body, and Next answers it at once.
	let first = if method == Method::HEAD { None } else { next_frame(&mut rx, &mut due).await };
	let rest = futures_util::stream::unfold((rx, due), |(mut rx, mut due)| async move { next_frame(&mut rx, &mut due).await.map(|frame| (frame, (rx, due))) });
	let frames = futures_util::stream::iter(first).chain(rest).map(Ok::<_, Infallible>);
	let mut res = Response::new(Body::from_stream(frames));
	let headers = res.headers_mut();
	headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/event-stream"));
	headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache, no-transform"));
	headers.insert("x-accel-buffering", HeaderValue::from_static("no"));
	res
}

/// The next event or ping; None once the server stops.
async fn next_frame(rx: &mut UnboundedReceiver<Event>, due: &mut i64) -> Option<Bytes> {
	tokio::select! {
		event = rx.recv() => event.map(|e| Bytes::from(e.sse_frame())),
		() = clock::sleep_until(*due) => {
			*due += PING_MS;
			Some(Bytes::from_static(b": ping\n\n"))
		}
		() = shutdown::wait() => None,
	}
}
