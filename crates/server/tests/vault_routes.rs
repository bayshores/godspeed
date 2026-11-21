//! /api/vault and a space's vault notes over HTTP: picking a vault, the status the Settings
//! group reads, a note's page on Progress, and the refusals.

use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::ids;
use gs_json::{Json, json, parse, stringify};
use gs_server::http::access::Access;
use gs_services::App;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

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
async fn a_vault_is_picked_read_back_unlinked_and_its_notes_listed() {
	let dir = std::env::temp_dir().join(format!("gs-vault-routes-{}", ids::uuid()));
	std::fs::create_dir_all(dir.join("data")).unwrap();
	let vault = dir.join("Notes");
	std::fs::create_dir_all(vault.join(".obsidian")).unwrap();
	let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.clone()), None);
	let space_id = app.stores.spaces.create_space(&json!({ "name": "CSE 21" })).unwrap()["id"].str_or_empty().to_owned();
	let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
	let port = listener.local_addr().unwrap().port();
	tokio::spawn(axum::serve(listener, gs_server::http::server(Arc::clone(&app), &Access::default())).into_future());

	let (code, status) = call(port, "GET", "/api/vault", "").await;
	assert_eq!((code, status["state"].as_str(), status["words"].as_str(), status["path"].is_null()), (200, Some("none"), Some("teacher"), true));

	let (code, status) = call(port, "PATCH", "/api/vault", &stringify(&json!({ "path": vault.to_string_lossy() }))).await;
	assert_eq!((code, status["state"].as_str(), status["obsidian"].as_bool(), status["notes"].as_i64()), (200, Some("ok"), Some(true), Some(0)));
	let (_, status) = call(port, "PATCH", "/api/vault", r#"{"words":"mine"}"#).await;
	assert_eq!((status["words"].as_str(), status["path"].as_str()), (Some("mine"), Some(vault.to_string_lossy().as_ref())), "one field at a time");

	let (code, refused) = call(port, "PATCH", "/api/vault", r#"{"color":"red"}"#).await;
	assert_eq!(code, 400, "{refused:?}");
	let (code, refused) = call(port, "PATCH", "/api/vault", &stringify(&json!({ "path": dir.join("nope").to_string_lossy() }))).await;
	assert_eq!((code, refused["error"].as_str()), (400, Some("That folder does not exist.")));

	let (code, notes) = call(port, "GET", &format!("/api/spaces/{space_id}/vault-notes"), "").await;
	assert_eq!((code, notes["notes"].items().len()), (200, 0));
	let (code, _) = call(port, "GET", "/api/spaces/space_nope/vault-notes", "").await;
	assert_eq!(code, 404);
	let (code, _) = call(port, "GET", "/api/spaces/..%2Fx/vault-notes", "").await;
	assert_eq!(code, 404);

	std::fs::remove_dir_all(&vault).unwrap();
	let (code, retried) = call(port, "POST", "/api/vault/retry", "").await;
	assert_eq!((code, retried["state"].as_str()), (200, Some("missing")));
	assert!(retried["message"].as_str().is_some());
	let (_, status) = call(port, "PATCH", "/api/vault", r#"{"path":null}"#).await;
	assert_eq!((status["state"].as_str(), status["path"].is_null()), (Some("none"), true));
	let _ = std::fs::remove_dir_all(&dir);
}
