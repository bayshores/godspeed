//! The prompt hook's line: with a lesson on screen and Enter just pressed in the teacher's
//! terminal, the window gets it and the hook hears "lesson"; anything else reaches the agent.

use std::sync::Arc;

use axum::http::{HeaderMap, HeaderValue};
use gs_base::config::Paths;
use gs_base::events::EventKind;
use gs_base::{clock, fsx, ids};
use gs_json::{Json, json};
use gs_server::mcp::handle_terminal_line;
use gs_services::App;
use gs_services::app::terminal_lines::confirm_terminal_line;
use http_body_util::BodyExt;

const TOKEN: &str = "abababababababababababababababababababababababababababababababab";
const TEACHER: &str = "0123456789abcdef0123456789abcdef";

fn app() -> Arc<App> {
	let dir = std::env::temp_dir().join(format!("gs-terminal-lines-{}", ids::uuid()));
	let data = dir.join("data");
	std::fs::create_dir_all(&data).unwrap();
	fsx::write_atomic(&data.join("mcp-token"), TOKEN.as_bytes(), Some(0o600)).unwrap();
	let app = App::new(Paths::new(data, dir.join("home"), dir.join("tmp"), dir), None);
	app.bridge.set_live_terminals(vec![TEACHER.to_owned()], Some(TEACHER.to_owned()));
	app
}

async fn send_line(app: &Arc<App>, token: &str, line: &str) -> (u16, Json) {
	let mut headers = HeaderMap::new();
	headers.insert("host", HeaderValue::from_static("127.0.0.1:48065"));
	headers.insert("authorization", HeaderValue::from_str(&format!("Bearer {token}")).unwrap());
	headers.insert("x-godspeed-terminal", HeaderValue::from_static(TEACHER));
	let res = handle_terminal_line(app, &headers, Some(json!({ "line": line }))).await;
	let status = res.status().as_u16();
	let body = res.into_body().collect().await.unwrap().to_bytes();
	(status, gs_json::parse(&String::from_utf8_lossy(&body)).unwrap())
}

#[tokio::test]
async fn a_line_for_the_lesson_on_screen_goes_to_the_window_and_the_hook_blocks_it() {
	let app = app();
	let mut events = app.events.subscribe();
	app.bridge.set_talk_page(Some("lesson".to_owned()), None);
	app.bridge.typed(TEACHER, clock::now_ms());

	// The window answers once it got the line.
	let window = gs_base::tasks::spawn("test", {
		let app = app.clone();
		async move {
			loop {
				let event = events.recv().await.unwrap();
				if event.kind == EventKind::TerminalLine {
					assert!(confirm_terminal_line(&app, event.payload["id"].as_f64().unwrap() as u64, true));
					return event.payload;
				}
			}
		}
	});
	let (status, body) = send_line(&app, TOKEN, "why is step 2 true?").await;
	assert_eq!((status, body), (200, json!({ "sent": "lesson" })));
	let event = window.await.unwrap();
	assert_eq!((event["text"].clone(), event["attachments"].clone()), (json!("why is step 2 true?"), json!([])));
	assert!(!app.bridge.take_typed(Some(TEACHER), clock::now_ms()), "the agent's wait doesn't hear of it");
}

#[tokio::test]
async fn a_line_reaches_the_agent_without_a_page_an_enter_or_the_window() {
	let app = app();
	assert_eq!(send_line(&app, "wrong", "hi").await.0, 401);

	// No page takes lines: the agent reads it.
	app.bridge.typed(TEACHER, clock::now_ms());
	assert_eq!(send_line(&app, TOKEN, "hi").await, (200, json!({ "sent": null })));

	// A page, but no Enter in the teacher's terminal (the agent's own background prompt).
	app.bridge.set_talk_page(Some("lesson".to_owned()), None);
	assert_eq!(send_line(&app, TOKEN, "## Memory Writing Agent").await, (200, json!({ "sent": null })));

	// The window never answers: after 3 s the agent reads it, and its wait hears of it.
	app.bridge.typed(TEACHER, clock::now_ms());
	assert_eq!(send_line(&app, TOKEN, "hi").await, (200, json!({ "sent": null })));
	assert!(app.bridge.take_typed(Some(TEACHER), clock::now_ms()));
}

#[tokio::test]
async fn the_window_hears_when_a_teacher_chat_starts_and_is_used() {
	let app = app();
	let mut events = app.events.subscribe();
	let mut heard = move || std::iter::from_fn(|| events.try_recv().ok()).filter(|e| e.kind == EventKind::TeacherChatsChanged).count();
	gs_services::app::teacher_chats::session_started(&app, Some(TEACHER), "0f8fad5b-d9cb-469f-a165-70867728950e", "claude");
	assert_eq!(heard(), 1, "a chat started");
	assert_eq!(gs_services::app::teacher_chats::shown(&app), json!([]), "not used yet");

	app.bridge.typed(TEACHER, clock::now_ms());
	assert_eq!(send_line(&app, TOKEN, "What's due?").await, (200, json!({ "sent": null })));
	assert_eq!(heard(), 1, "a line typed to it");
	assert_eq!(gs_services::app::teacher_chats::shown(&app)[0]["name"], json!("What's due?"));
	assert_eq!(gs_services::app::teacher_chats::shown(&app)[0]["open"], json!(true), "the teacher's terminal runs it");
	assert_eq!(gs_services::app::teacher_chats::shown(&app)[0]["lesson"], json!(null), "it taught no lesson yet");

	let lesson = app.stores.chats.create_chat("Study for Midterm", Some("study"), None, None, &[]).unwrap()["id"].as_str().unwrap().to_owned();
	gs_services::app::teacher_chats::taught(&app, Some(TEACHER), &lesson);
	assert_eq!(gs_services::app::teacher_chats::shown(&app)[0]["name"], json!("Study for Midterm"));
	assert_eq!(gs_services::app::teacher_chats::shown(&app)[0]["lesson"], json!(lesson), "the lesson it taught, to go back to");
	app.stores.chats.delete_chat(&lesson);
	assert_eq!(gs_services::app::teacher_chats::shown(&app)[0]["lesson"], json!(null), "a deleted lesson is not offered");

	app.bridge.set_live_terminals(vec![], None);
	assert_eq!(gs_services::app::teacher_chats::shown(&app)[0]["open"], json!(false), "the terminal ended");
}
