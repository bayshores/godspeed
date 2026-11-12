//! A running turn's stream pings while it has nothing to send. WebKit can hold the last bytes of
//! a fetch body until more arrive on it, so without the ping a tool call that runs on hid the
//! frames that announced it.

use gs_base::config::Paths;
use gs_base::{clock, ids};
use gs_json::parse;
use gs_server::http::access::Access;
use gs_services::App;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

async fn serve() -> u16 {
	let dir = std::env::temp_dir().join(format!("gs-turn-stream-{}", ids::uuid()));
	std::fs::create_dir_all(dir.join("data")).unwrap();
	let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir), None);
	let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
	let port = listener.local_addr().unwrap().port();
	tokio::spawn(axum::serve(listener, gs_server::http::server(app, &Access::default())).into_future());
	port
}

async fn send(port: u16, method: &str, path: &str, body: &str) -> TcpStream {
	let mut conn = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
	let head = format!("{method} {path} HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n", body.len());
	conn.write_all(format!("{head}{body}").as_bytes()).await.unwrap();
	conn
}

/// A JSON answer's body.
async fn post_json(port: u16, path: &str, body: &str) -> gs_json::Json {
	let mut conn = send(port, "POST", path, body).await;
	let mut got = String::new();
	conn.read_to_string(&mut got).await.unwrap();
	let (head, body) = got.split_once("\r\n\r\n").unwrap();
	assert!(head.starts_with("HTTP/1.1 200 OK\r\n"), "{got}");
	parse(body).unwrap()
}

/// Reads until `text` has arrived; fails when nothing more comes for two seconds.
async fn read_until(conn: &mut TcpStream, text: &str) -> String {
	let mut got = String::new();
	let mut buf = vec![0; 4096];
	while !got.contains(text) {
		tokio::select! {
			n = conn.read(&mut buf) => {
				let n = n.unwrap();
				assert!(n > 0, "the stream ended before {text:?}: {got:?}");
				got.push_str(&String::from_utf8_lossy(&buf[..n]));
			}
			() = clock::sleep(2000) => panic!("no {text:?} after {got:?}"),
		}
	}
	got
}

#[tokio::test]
async fn a_quiet_turn_stream_pings() {
	let port = serve().await;
	let chat = post_json(port, "/api/chats", r#"{"title":"Binary search"}"#).await;
	let id = chat["id"].as_str().unwrap();
	// The turn now waits for an outside agent, so its stream goes quiet after turn_start.
	let sent = post_json(port, "/api/chat", &format!(r#"{{"chatId":"{id}","input":{{"type":"text","text":"Teach me."}}}}"#)).await;
	assert_eq!(sent["ok"].as_bool(), Some(true), "{sent:?}");

	let mut stream = send(port, "GET", &format!("/api/chats/{id}/stream"), "").await;
	read_until(&mut stream, r#"data: {"type":"turn_start"}"#).await;
	clock::advance(250);
	read_until(&mut stream, ": ping\n\n").await;
}
