//! An agent started in one of the app's terminals sends that terminal's id. Once the shell says
//! the terminal ended, its requests are refused and a wait it had open ends with the same words.

use std::sync::Arc;

use axum::http::{HeaderMap, HeaderValue, Method};
use gs_base::config::Paths;
use gs_base::{fsx, ids};
use gs_server::mcp::handle_mcp_request;
use gs_services::App;
use http_body_util::BodyExt;

const TOKEN: &str = "abababababababababababababababababababababababababababababababab";
const TERMINAL: &str = "0123456789abcdef0123456789abcdef";
const CLOSED: &str = "This terminal was closed in godspeed.";

fn app() -> Arc<App> {
	let dir = std::env::temp_dir().join(format!("gs-mcp-terminals-{}", ids::uuid()));
	let data = dir.join("data");
	std::fs::create_dir_all(&data).unwrap();
	fsx::write_atomic(&data.join("mcp-token"), TOKEN.as_bytes(), Some(0o600)).unwrap();
	App::new(Paths::new(data, dir.join("home"), dir.join("tmp"), dir), None)
}

/// A wait_for_work call as the waiter sends it, from `terminal` when given.
async fn wait(app: &Arc<App>, terminal: Option<&str>) -> (u16, String) {
	let mut headers = HeaderMap::new();
	headers.insert("host", HeaderValue::from_static("127.0.0.1:48065"));
	headers.insert("authorization", HeaderValue::from_str(&format!("Bearer {TOKEN}")).unwrap());
	headers.insert("content-type", HeaderValue::from_static("application/json"));
	headers.insert("accept", HeaderValue::from_static("application/json, text/event-stream"));
	if let Some(id) = terminal {
		headers.insert("x-godspeed-terminal", HeaderValue::from_str(id).unwrap());
	}
	let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"wait_for_work","arguments":{"timeout_seconds":1}}}"#;
	let res = handle_mcp_request(app, &Method::POST, &headers, body.as_bytes()).await;
	let status = res.status().as_u16();
	(status, String::from_utf8(res.into_body().collect().await.unwrap().to_bytes().to_vec()).unwrap())
}

#[tokio::test]
async fn an_ended_terminals_agent_is_refused_at_the_door_and_in_its_wait() {
	let app = app();
	let (status, body) = wait(&app, Some(TERMINAL)).await;
	assert_eq!((status, body.as_str()), (403, r#"{"error":"This terminal was closed in godspeed."}"#), "no live terminal has this id");
	for odd in ["ABCDEF0123456789ABCDEF0123456789", "0123", "not an id at all, 32 chars long!"] {
		assert_eq!(wait(&app, Some(odd)).await.0, 403, "{odd}");
	}
	let (status, body) = wait(&app, None).await;
	assert_eq!(status, 200, "an outside agent is served as before: {body}");
	assert!(!body.contains(CLOSED));

	app.bridge.set_live_terminals(vec![TERMINAL.to_owned()]);
	let open = tokio::spawn({
		let app = app.clone();
		async move { wait(&app, Some(TERMINAL)).await }
	});
	gs_base::clock::sleep(50).await;
	let access = gs_server::mcp::mcp_access_status(&app).unwrap();
	assert_eq!(access["terminals"], gs_json::json!([{ "id": TERMINAL, "here": true }]));
	assert_eq!(access["outsideHere"], gs_json::Json::Bool(true));
	app.bridge.set_live_terminals(Vec::new());
	let (status, body) = open.await.unwrap();
	assert_eq!(status, 200);
	assert!(body.contains(r#""isError":true"#) && body.contains(CLOSED), "{body}");
}
