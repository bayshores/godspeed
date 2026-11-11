//! GET /api/events sends no response head until its first frame, as Next did: the page's
//! EventSource must not open (and resync) before something happens.

use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::events::EventKind;
use gs_base::{clock, ids};
use gs_json::json;
use gs_services::App;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

async fn serve() -> (Arc<App>, u16) {
	let dir = std::env::temp_dir().join(format!("gs-events-{}", ids::uuid()));
	std::fs::create_dir_all(dir.join("data")).unwrap();
	let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir));
	let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
	let port = listener.local_addr().unwrap().port();
	tokio::spawn(axum::serve(listener, gs_server::http::server(app.clone())).into_future());
	(app, port)
}

async fn open(port: u16, method: &str) -> TcpStream {
	let mut conn = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
	conn.write_all(format!("{method} /api/events HTTP/1.1\r\nhost: 127.0.0.1\r\naccept: text/event-stream\r\n\r\n").as_bytes()).await.unwrap();
	conn
}

/// What arrives within `ms` (empty when nothing does).
async fn read_for(conn: &mut TcpStream, ms: i64) -> String {
	let mut buf = vec![0; 4096];
	tokio::select! {
		n = conn.read(&mut buf) => String::from_utf8_lossy(&buf[..n.unwrap()]).into_owned(),
		() = clock::sleep(ms) => String::new(),
	}
}

/// Reads until `text` has arrived (the head and the frame may come in separate packets).
async fn read_until(conn: &mut TcpStream, text: &str) -> String {
	let mut got = String::new();
	while !got.contains(text) {
		let more = read_for(conn, 2000).await;
		assert!(!more.is_empty(), "no {text:?} after {got:?}");
		got.push_str(&more);
	}
	got
}

#[tokio::test]
async fn the_head_waits_for_the_first_event_or_ping() {
	let (app, port) = serve().await;

	let mut by_event = open(port, "GET").await;
	assert_eq!(read_for(&mut by_event, 300).await, "");
	app.events.emit(EventKind::ChatsChanged, json!({}));
	let got = read_until(&mut by_event, "event: chats-changed\ndata: {}\n\n").await;
	assert!(got.starts_with("HTTP/1.1 200 OK\r\n"), "{got}");
	assert!(got.contains("content-type: text/event-stream\r\n"), "{got}");

	let mut by_ping = open(port, "GET").await;
	assert_eq!(read_for(&mut by_ping, 300).await, "");
	clock::advance(25_000);
	let got = read_until(&mut by_ping, ": ping\n\n").await;
	assert!(got.starts_with("HTTP/1.1 200 OK\r\n"), "{got}");
}

#[tokio::test]
async fn a_head_is_answered_at_once() {
	let (_app, port) = serve().await;
	let mut conn = open(port, "HEAD").await;
	let got = read_until(&mut conn, "\r\n\r\n").await;
	assert!(got.starts_with("HTTP/1.1 200 OK\r\n"), "{got}");
	assert!(got.contains("content-type: text/event-stream\r\n"), "{got}");
}
