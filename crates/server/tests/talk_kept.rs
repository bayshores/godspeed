//! An older build's Talk chat is the learner's: DELETE /api/chats/{id} refuses it like a lesson
//! that is not there, in either mode, and the record and its folder stay as they were.

use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::{fsx, ids};
use gs_json::json;
use gs_server::http::access::Access;
use gs_services::App;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

async fn delete(port: u16, path: &str) -> String {
	let mut conn = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
	conn.write_all(format!("DELETE {path} HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\n\r\n").as_bytes()).await.unwrap();
	let mut answer = String::new();
	conn.read_to_string(&mut answer).await.unwrap();
	answer
}

#[tokio::test]
async fn the_talk_chat_cannot_be_deleted_as_a_lesson() {
	let dir = std::env::temp_dir().join(format!("gs-talk-kept-{}", ids::uuid()));
	std::fs::create_dir_all(dir.join("data")).unwrap();
	let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.clone()), None);
	app.stores.chats.create_chat("Talk", Some("talk"), None, None).unwrap();
	app.stores.chats.save_messages("chat_talk", &[json!({ "id": "m1", "role": "user", "content": "hi" })]).unwrap();
	let record = app.paths.chats.join("chat_talk.json");
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
	assert_eq!(std::fs::read(&record).unwrap(), before);
	assert!(app.paths.chats.join("chat_talk/0123456789ab-Notes.pdf").exists());

	let lesson = app.stores.chats.create_chat("Fractions", None, None, None).unwrap()["id"].as_str().unwrap().to_owned();
	assert!(delete(port, &format!("/api/chats/{lesson}?mode=preserve-graph")).await.starts_with("HTTP/1.1 200 "), "a lesson still deletes");
	std::fs::remove_dir_all(dir).unwrap();
}
