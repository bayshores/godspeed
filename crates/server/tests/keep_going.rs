//! The lesson event routes. POST /api/chats/{id}/keep-going: Keep going at a stop. 404 for an
//! unknown lesson, 400 for a malformed input or (no turn running) a call that carries no stop, and
//! 200 saying whether the next topic's stored opener now shows and whether a turn was running.
//! POST /api/chats/{id}/kept: drop a kept sentence's analogy or phrase, or bring it back, even
//! during a turn.

use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::ids;
use gs_json::{Json, json, parse};
use gs_server::http::access::Access;
use gs_services::App;
use gs_services::turns::turn_liveness::{begin_turn, end_turn};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

async fn serve() -> (Arc<App>, u16) {
	let dir = std::env::temp_dir().join(format!("gs-keep-going-{}", ids::uuid()));
	std::fs::create_dir_all(dir.join("data")).unwrap();
	let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir), None);
	let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
	let port = listener.local_addr().unwrap().port();
	tokio::spawn(axum::serve(listener, gs_server::http::server(app.clone(), &Access::default())).into_future());
	(app, port)
}

/// The status and JSON body of a POST.
async fn post(port: u16, path: &str, body: &str) -> (u16, Json) {
	let mut conn = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
	let head = format!("POST {path} HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n", body.len());
	conn.write_all(format!("{head}{body}").as_bytes()).await.unwrap();
	let mut got = String::new();
	conn.read_to_string(&mut got).await.unwrap();
	let (head, body) = got.split_once("\r\n\r\n").unwrap();
	(head[9..12].parse().unwrap(), parse(body).unwrap())
}

/// Regularization ended on the conclude `c1`, and topic_done stored Cross-validation's opener.
fn stopped() -> Vec<Json> {
	let stop = json!({ "kind": "topic", "nodeId": "reg", "activeMinutes": 30, "at": "2026-11-18T21:48:00.000Z" });
	let opener = json!({ "lead": "One split can mislead you.", "quiz": { "type": "predict", "nodeId": "cv", "question": "How much can the score move?" } });
	vec![
		json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "c1", "name": "conclude", "arguments": { "outcome": "solved" } }], "timestamp": 1 }),
		json!({ "role": "toolResult", "toolCallId": "c1", "toolName": "conclude", "details": { "stop": stop }, "isError": false, "timestamp": 1 }),
		json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "t1", "name": "topic_done", "arguments": { "nodeId": "reg", "opener": opener } }], "timestamp": 2 }),
		json!({ "role": "toolResult", "toolCallId": "t1", "toolName": "topic_done", "details": { "part": "topic_done", "v": 1, "lead": "One split can mislead you." }, "isError": false, "timestamp": 2 }),
	]
}

#[tokio::test]
async fn keep_going_answers_each_case() {
	let (app, port) = serve().await;
	let chat_id = app.stores.chats.create_chat("Study for Midterm", Some("study"), None, None).unwrap()["id"].as_str().unwrap().to_owned();
	app.stores.chats.save_messages(&chat_id, &stopped()).unwrap();
	let path = format!("/api/chats/{chat_id}/keep-going");

	assert_eq!(post(port, "/api/chats/chat_gone/keep-going", r#"{"input":{"stopOf":"c1"}}"#).await, (404, json!({ "error": "Unknown chat" })));
	assert_eq!(post(port, &path, r#"{"input":{}}"#).await, (400, json!({ "error": "input must be { stopOf: string }" })));
	assert_eq!(post(port, &path, r#"{"input":{"stopOf":"t1"}}"#).await, (400, json!({ "error": "No stop on that call" })));
	assert_eq!(post(port, &path, r#"{"input":{"stopOf":"c1"}}"#).await, (200, json!({ "ok": true, "opener": true, "running": false })));
	let record = app.stores.chats.get_chat(&chat_id).unwrap();
	assert_eq!(record["messages"].as_arr().unwrap().last().unwrap()["customType"], json!("keep-going"));

	assert!(begin_turn(&app, &chat_id));
	assert_eq!(post(port, &path, r#"{"input":{"stopOf":"c9"}}"#).await, (200, json!({ "ok": true, "opener": false, "running": true })), "during a turn: stored unchecked");
	end_turn(&app, &chat_id);
}

#[tokio::test]
async fn kept_drops_and_brings_back_a_part_of_a_kept_sentence() {
	let (app, port) = serve().await;
	let chat_id = app.stores.chats.create_chat("Study for Midterm", Some("study"), None, None).unwrap()["id"].as_str().unwrap().to_owned();
	let keep = json!({ "text": "Lambda prices large weights.", "fits": "The leash fits one part.", "stops": "It stops at new data." });
	app.stores.chats.save_messages(&chat_id, &[
		json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "q5", "name": "quiz", "arguments": { "nodeId": "reg", "keep": keep } }], "timestamp": 1 }),
		json!({ "role": "custom", "customType": "keep-check", "content": "", "details": { "quizCallId": "q5", "keep": "shown", "fits": true, "phrase": false }, "timestamp": 1 }),
		json!({ "role": "toolResult", "toolCallId": "q5", "toolName": "quiz", "details": { "kind": "quiz", "correct": true }, "isError": false, "timestamp": 2 }),
	]).unwrap();
	let path = format!("/api/chats/{chat_id}/kept");
	let malformed = json!({ "error": "input must be { of: string, part: \"analogy\" | \"phrase\", back?: true }" });

	assert_eq!(post(port, "/api/chats/chat_gone/kept", r#"{"input":{"of":"q5","part":"analogy"}}"#).await, (404, json!({ "error": "Unknown chat" })));
	assert_eq!(post(port, &path, r#"{"input":{"of":"q5"}}"#).await, (400, malformed.clone()));
	assert_eq!(post(port, &path, r#"{"input":{"of":"q5","part":"analogy","back":false}}"#).await, (400, malformed));
	assert_eq!(post(port, &path, r#"{"input":{"of":"q5","part":"phrase"}}"#).await, (400, json!({ "error": "No kept sentence with that part on that call" })), "it has no phrase");
	assert!(begin_turn(&app, &chat_id));
	assert_eq!(post(port, &path, r#"{"input":{"of":"q5","part":"analogy"}}"#).await, (200, json!({ "ok": true })), "during a turn");
	end_turn(&app, &chat_id);
	assert_eq!(post(port, &path, r#"{"input":{"of":"q5","part":"analogy","back":true}}"#).await, (200, json!({ "ok": true })));
	let record = app.stores.chats.get_chat(&chat_id).unwrap();
	let drops: Vec<&Json> = record["messages"].as_arr().unwrap().iter().filter(|m| m["customType"].as_str() == Some("analogy-drop")).map(|m| &m["details"]).collect();
	assert_eq!((drops.len(), drops[0].get("back"), &drops[1]["back"]), (2, None, &json!(true)));
}
