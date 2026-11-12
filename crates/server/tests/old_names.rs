//! Data saved under the names from before spaces moves over just before the first request that
//! reaches an /api route, as Node moved it when a route first loaded the store modules: not at
//! start-up and not on a request no route answers.

use std::path::Path;
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::{fsx, ids};
use gs_server::http::access::Access;
use gs_services::App;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

fn put(file: &Path, text: &str) {
	fsx::write_text_atomic(file, text).unwrap();
}

/// The status line of a GET.
async fn status(port: u16, path: &str) -> String {
	let mut conn = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
	conn.write_all(format!("GET {path} HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\n\r\n").as_bytes()).await.unwrap();
	let mut answer = String::new();
	conn.read_to_string(&mut answer).await.unwrap();
	answer.lines().next().unwrap_or_default().to_owned()
}

#[tokio::test]
async fn the_first_api_route_moves_the_old_names() {
	let dir = std::env::temp_dir().join(format!("gs-old-names-{}", ids::uuid()));
	let data = dir.join("data");
	put(&data.join("classes/cls_old1/class.json"), "{}");
	put(&data.join("prompts/shared/12-class-context.md"), "mine\n");
	let app = App::new(Paths::new(data.clone(), dir.join("home"), dir.join("tmp"), dir.clone()), None);
	let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
	let port = listener.local_addr().unwrap().port();
	tokio::spawn(axum::serve(listener, gs_server::http::server(Arc::clone(&app), &Access::default())).into_future());

	assert_eq!(status(port, "/api/classes").await, "HTTP/1.1 404 Not Found");
	assert!(data.join("classes").exists() && data.join("prompts/shared/12-class-context.md").exists(), "a 404 moves nothing");

	assert_eq!(status(port, "/api/agent-notes").await, "HTTP/1.1 200 OK");
	assert!(!data.join("classes").exists());
	assert!(data.join("spaces/cls_old1/class.json").exists());
	assert_eq!(std::fs::read_to_string(data.join("prompts/shared/12-space-context.md")).unwrap(), "mine\n");
}
