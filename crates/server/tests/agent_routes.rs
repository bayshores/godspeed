//! The setup card's routes over HTTP, on the stand-in agent a test build runs: the checks, the
//! models, the model each agent's new lessons start on, and the sign-in and update routes'
//! refusals.

use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::{clock, ids};
use gs_json::{Json, parse, stringify};
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

async fn serve() -> u16 {
	let dir = std::env::temp_dir().join(format!("gs-agent-routes-{}", ids::uuid()));
	std::fs::create_dir_all(dir.join("data")).unwrap();
	let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.clone()), None);
	let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
	let port = listener.local_addr().unwrap().port();
	gs_base::tasks::spawn("test", axum::serve(listener, gs_server::http::server(Arc::clone(&app), &Access::default())).into_future());
	port
}

/// GET /api/agent/health once its check has ended.
async fn checked(port: u16) -> Json {
	for _ in 0..500 {
		let (_, view) = call(port, "GET", "/api/agent/health", "").await;
		if view["checking"] == Json::Bool(false) {
			return view;
		}
		clock::sleep(10).await;
	}
	panic!("the check never ended");
}

#[tokio::test]
async fn the_card_reads_the_checks_and_models_and_saves_a_model() {
	let port = serve().await;
	let view = checked(port).await;
	assert_eq!(
		stringify(&view),
		r#"{"agent":"claude","checking":false,"ownCommand":false,"checks":[{"check":"installed","state":"passed","fact":null},{"check":"node","state":"passed","fact":null},{"check":"upToDate","state":"passed","fact":null},{"check":"loggedIn","state":"passed","fact":null}],"failing":null,"login":null,"update":null}"#
	);
	let (code, models) = call(port, "GET", "/api/agent/models", "").await;
	assert_eq!((code, stringify(&models)), (200, r#"{"agent":"claude","models":[{"id":"default","name":"Default (recommended)","default":true},{"id":"sonnet","name":"Sonnet 5.5","default":false}]}"#.to_owned()));

	let (code, folder) = call(port, "PATCH", "/api/agent-folder", r#"{"model":{"claude":"sonnet"}}"#).await;
	assert_eq!((code, stringify(&folder["model"])), (200, r#"{"claude":"sonnet"}"#.to_owned()));
	let (code, refused) = call(port, "PATCH", "/api/agent-folder", r#"{"model":{"claude":7}}"#).await;
	assert_eq!((code, refused["error"].as_str()), (400, Some(r#"model must name "claude" or "codex", each with a model's name or null"#)));

	let (code, folder) = call(port, "PATCH", "/api/agent-folder", r#"{"agent":"codex"}"#).await;
	assert_eq!((code, folder["agent"].as_str()), (200, Some("codex")));
	let view = checked(port).await;
	assert_eq!((view["agent"].as_str(), view["checks"].items().len()), (Some("codex"), 3), "picking Codex checks Codex");
	let (_, models) = call(port, "GET", "/api/agent/models", "").await;
	assert_eq!(models["models"][0]["id"].as_str(), Some("gpt-6.1-sol"));
}

#[tokio::test]
async fn the_sign_in_routes_refuse_what_they_cannot_do() {
	let port = serve().await;
	let (code, refused) = call(port, "POST", "/api/agent/login/code", r#"{"code":"abc"}"#).await;
	assert_eq!((code, refused["error"].as_str()), (409, Some("No sign-in that takes this is running.")));
	let (code, _) = call(port, "POST", "/api/agent/login/code", r#"{"code":5}"#).await;
	assert_eq!(code, 400);
	let (code, _) = call(port, "POST", "/api/agent/login/cancel", "").await;
	assert_eq!(code, 409);
	// The stand-in agent has no sign-in of its own, so it fails, and the card says why.
	let (code, failed) = call(port, "POST", "/api/agent/login", "").await;
	assert_eq!((code, failed["error"].as_str()), (500, Some("the stand-in agent has no sign-in")));
	let (_, view) = call(port, "GET", "/api/agent/health", "").await;
	assert_eq!(view["login"]["failed"].as_str(), Some("the stand-in agent has no sign-in"));
}

#[tokio::test]
async fn the_update_route_says_why_no_update_can_start() {
	let port = serve().await;
	let (code, refused) = call(port, "POST", "/api/agent/update", "").await;
	assert_eq!((code, refused["error"].as_str()), (409, Some("the stand-in agent has no update")));
	let (_, view) = call(port, "GET", "/api/agent/health", "").await;
	assert_eq!(view["update"], Json::Null, "nothing ran, so the card shows no update");
}
