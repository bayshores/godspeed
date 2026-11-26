//! The teacher panel's chats over HTTP: the list of talk chats apart from the lessons, a new chat
//! named by its first message, the turns running, a chat's model, and the earlier words of a chat
//! carried over from an older build's terminal.

use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::{fsx, ids};
use gs_json::{Json, json, parse, stringify};
use gs_server::http::access::Access;
use gs_services::App;
use gs_services::turns::turn_liveness::{begin_turn, end_turn};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const SESSION: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";

async fn call(port: u16, method: &str, path: &str, body: &str) -> (u16, Json) {
	let mut conn = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
	let head = format!("{method} {path} HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len());
	conn.write_all(format!("{head}{body}").as_bytes()).await.unwrap();
	let mut answer = String::new();
	conn.read_to_string(&mut answer).await.unwrap();
	let status = answer.split(' ').nth(1).unwrap().parse().unwrap();
	let body = answer.split("\r\n\r\n").nth(1).unwrap_or("");
	(status, parse(body).unwrap_or(Json::Null))
}

#[tokio::test]
async fn talk_chats_are_listed_made_given_a_model_and_read_with_their_earlier_words() {
	let dir = std::env::temp_dir().join(format!("gs-talk-routes-{}", ids::uuid()));
	std::fs::create_dir_all(dir.join("data")).unwrap();
	let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.clone()), None);
	let lesson = app.stores.chats.create_chat("Fractions", None, None, None, &[]).unwrap()["id"].str_or_empty().to_owned();
	let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
	let port = listener.local_addr().unwrap().port();
	gs_base::tasks::spawn("test", axum::serve(listener, gs_server::http::server(Arc::clone(&app), &Access::default())).into_future());

	let (code, made) = call(port, "POST", "/api/chats", r#"{"kind":"talk","text":"What is due this week?\nAnd next week?"}"#).await;
	assert_eq!((code, made["title"].as_str()), (200, Some("What is due this week?")), "{made:?}");
	let talk = made["id"].str_or_empty().to_owned();

	let (code, listed) = call(port, "GET", "/api/chats?kind=talk", "").await;
	let ids: Vec<&str> = listed["chats"].items().iter().filter_map(|c| c["id"].as_str()).collect();
	assert_eq!((code, ids), (200, vec![talk.as_str()]), "the lesson is not a talk chat");
	assert_eq!(listed["chats"][0]["running"], json!(false));
	let (_, lessons) = call(port, "GET", "/api/chats", "").await;
	let ids: Vec<&str> = lessons["chats"].items().iter().filter_map(|c| c["id"].as_str()).collect();
	assert_eq!(ids, [lesson.as_str()], "and a talk chat is not a lesson");

	assert_eq!(call(port, "GET", "/api/turns", "").await, (200, json!({ "running": 0 })));
	assert!(begin_turn(&app, &lesson) && begin_turn(&app, &talk));
	assert_eq!(call(port, "GET", "/api/turns", "").await, (200, json!({ "running": 2 })), "a lesson's turn and a panel chat's");
	end_turn(&app, &lesson);
	end_turn(&app, &talk);

	let (code, _) = call(port, "PATCH", &format!("/api/chats/{talk}"), r#"{"model":"claude-sonnet-5-5"}"#).await;
	assert_eq!(code, 200);
	assert_eq!(app.stores.chats.get_chat(&talk).unwrap()["model"], json!("claude-sonnet-5-5"));
	let (_, listed) = call(port, "GET", "/api/chats?kind=talk", "").await;
	assert_eq!(listed["chats"][0]["model"], json!("claude-sonnet-5-5"));
	let (code, refused) = call(port, "PATCH", &format!("/api/chats/{talk}"), r#"{"model":"two\nlines"}"#).await;
	assert_eq!(code, 400, "{refused:?}");
	let (code, refused) = call(port, "PATCH", &format!("/api/chats/{lesson}"), r#"{"model":"claude-sonnet-5-5"}"#).await;
	assert_eq!(code, 400, "a lesson's model is not set here: {refused:?}");
	assert!(app.stores.chats.get_chat(&lesson).unwrap()["model"].is_null());

	let fields = json!({ "agentSession": { "agent": "claude", "id": SESSION, "promptHash": null, "seen": null }, "terminalChat": SESSION });
	let old = app.stores.chats.import_talk_chat("Limits proof", "2026-11-01T10:00:00.000Z", &fields).unwrap()["id"].str_or_empty().to_owned();
	let folder: String = app.paths.default_agent_folder.to_string_lossy().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
	let said = [
		json!({ "type": "user", "message": { "role": "user", "content": "Prove the limit." }, "timestamp": "2026-11-01T10:00:00.000Z" }),
		json!({ "type": "assistant", "message": { "role": "assistant", "content": [{ "type": "text", "text": "Take epsilon." }] }, "timestamp": "2026-11-01T10:00:05.000Z" }),
	];
	let file = app.paths.home.join(".claude/projects").join(folder).join(format!("{SESSION}.jsonl"));
	fsx::write_text_atomic(&file, &said.iter().map(stringify).collect::<Vec<_>>().join("\n")).unwrap();
	let (code, read) = call(port, "GET", &format!("/api/chats/{old}"), "").await;
	assert_eq!(code, 200);
	assert_eq!(read["earlier"], json!([{ "role": "user", "text": "Prove the limit." }, { "role": "assistant", "text": "Take epsilon." }]));
	let (_, read) = call(port, "GET", &format!("/api/chats/{talk}"), "").await;
	assert!(read["earlier"].is_null(), "a chat made here has none");
	std::fs::remove_dir_all(dir).unwrap();
}
