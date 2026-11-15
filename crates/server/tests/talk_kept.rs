//! An older build's Talk chat is the learner's: DELETE /api/chats/{id} refuses it like a lesson
//! that is not there, in either mode, a message to it is refused, and no route that writes a
//! lesson changes the record or its folder.

use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::{fsx, ids};
use gs_server::http::access::Access;
use gs_services::App;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

async fn delete(port: u16, path: &str) -> String {
	request(port, "DELETE", path, "").await
}

async fn request(port: u16, method: &str, path: &str, body: &str) -> String {
	let mut conn = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
	let head = format!("{method} {path} HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len());
	conn.write_all(format!("{head}{body}").as_bytes()).await.unwrap();
	let mut answer = String::new();
	conn.read_to_string(&mut answer).await.unwrap();
	answer
}

#[tokio::test]
async fn no_route_writes_or_deletes_the_old_talk_chat() {
	let dir = std::env::temp_dir().join(format!("gs-talk-kept-{}", ids::uuid()));
	std::fs::create_dir_all(dir.join("data")).unwrap();
	let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.clone()), None);
	let record = app.paths.chats.join("chat_talk.json");
	let talk = r#"{"id":"chat_talk","title":"Talk","createdAt":"2026-11-01T10:00:00.000Z","updatedAt":"2026-11-01T10:00:00.000Z","kind":"talk","messages":[{"id":"m1","role":"user","content":"hi"}]}"#;
	fsx::write_text_atomic(&record, talk).unwrap();
	fsx::write_atomic(&app.paths.chats.join("chat_talk/0123456789ab-Notes.pdf"), b"%PDF-1.4 made up", None).unwrap();
	let before = std::fs::read(&record).unwrap();
	let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
	let port = listener.local_addr().unwrap().port();
	tokio::spawn(axum::serve(listener, gs_server::http::server(Arc::clone(&app), &Access::default())).into_future());

	for mode in ["preserve-graph", "delete-nodes"] {
		let answer = delete(port, &format!("/api/chats/chat_talk?mode={mode}")).await;
		assert!(answer.starts_with("HTTP/1.1 404 "), "{answer}");
		assert!(answer.ends_with(r#"{"error":"No such lesson","code":"not_found"}"#), "{answer}");
	}
	let sent = request(port, "POST", "/api/chat", r#"{"chatId":"chat_talk","input":{"type":"text","text":"hi"}}"#).await;
	assert!(sent.starts_with("HTTP/1.1 404 ") && sent.ends_with(r#"{"error":"Talk was replaced by your agent's screen"}"#), "{sent}");
	let writes = [
		("PUT", "/api/chats/chat_talk", r#"{"title":"Mine"}"#),
		("PUT", "/api/chats/chat_talk/space", r#"{"spaceId":"sp_1"}"#),
		("POST", "/api/chats/chat_talk/dismiss", r#"{"toolCallId":"t1"}"#),
		("POST", "/api/chats/chat_talk/keep-going", r#"{"at":"m1"}"#),
		("POST", "/api/chats/chat_talk/kept", r#"{"id":"m1"}"#),
		("POST", "/api/chats/chat_talk/review", "{}"),
		("POST", "/api/chats/chat_talk/steer", r#"{"text":"hi"}"#),
		("POST", "/api/chats/chat_talk/artifact-ui", r#"{"chatId":"chat_talk","toolCallId":"t1","state":{}}"#),
		("POST", "/api/talk", "{}"),
		("DELETE", "/api/talk", ""),
	];
	for (method, path, body) in writes {
		let answer = request(port, method, path, body).await;
		assert!(!answer.starts_with("HTTP/1.1 2"), "{method} {path}: {answer}");
	}
	assert_eq!(std::fs::read(&record).unwrap(), before);
	assert_eq!(std::fs::read_dir(app.paths.chats.join("chat_talk")).unwrap().count(), 1);
	assert!(app.paths.chats.join("chat_talk/0123456789ab-Notes.pdf").exists());

	let lesson = app.stores.chats.create_chat("Fractions", None, None, None).unwrap()["id"].as_str().unwrap().to_owned();
	assert!(delete(port, &format!("/api/chats/{lesson}?mode=preserve-graph")).await.starts_with("HTTP/1.1 200 "), "a lesson still deletes");
	std::fs::remove_dir_all(dir).unwrap();
}
