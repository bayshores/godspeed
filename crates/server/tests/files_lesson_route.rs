//! POST /api/chats with fileIds refuses a .tex that is a PDF's source with the same sentence as
//! start_lesson, and starts the lesson on the PDF.

use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::ids;
use gs_server::http::access::Access;
use gs_services::App;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

async fn post(port: u16, body: &str) -> String {
	let mut conn = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
	let head = format!("POST /api/chats HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len());
	conn.write_all(format!("{head}{body}").as_bytes()).await.unwrap();
	let mut answer = String::new();
	conn.read_to_string(&mut answer).await.unwrap();
	answer
}

#[tokio::test]
async fn a_paired_tex_is_refused_and_its_pdf_starts() {
	let dir = std::env::temp_dir().join(format!("gs-files-lesson-route-{}", ids::uuid()));
	std::fs::create_dir_all(dir.join("data")).unwrap();
	let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.clone()), None);
	let space_id = app.stores.spaces.create_space(&gs_json::json!({ "name": "Calculus" })).unwrap()["id"].str_or_empty().to_owned();
	let file = |id: &str, name: &str| gs_json::json!({ "id": id, "origin": "copied", "name": name, "path": format!("{id}/{name}"), "kind": "study", "contentFp": "x", "status": "ready", "addedAt": "t" });
	let mut tex = file("f_tex", "HW 3.tex");
	tex.set("pdfId", "f_pdf");
	app.stores.spaces.save_files(&space_id, vec![file("f_pdf", "HW 3.pdf"), tex], &[]).unwrap();
	let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
	let port = listener.local_addr().unwrap().port();
	tokio::spawn(axum::serve(listener, gs_server::http::server(Arc::clone(&app), &Access::default())).into_future());

	let refused = post(port, r#"{"fileIds":["f_tex"]}"#).await;
	assert!(refused.starts_with("HTTP/1.1 400 "), "{refused}");
	assert!(refused.ends_with(r#"{"error":"HW 3.tex is the source of HW 3.pdf. Start the lesson on the PDF, file id f_pdf."}"#), "{refused}");
	let started = post(port, r#"{"fileIds":["f_pdf"]}"#).await;
	assert!(started.starts_with("HTTP/1.1 200 ") && started.contains(r#""title":"HW 3""#), "{started}");
}
