//! A lesson's desk (GET /api/chats/{id}/work), with the lesson on a stand-in agent (gs-runtime's
//! FakeAgent): the agent takes the desk when it starts on the turn, its godspeed tool calls are
//! steps with their call ids and work_plan is its plan, its own tools are steps too, a permission
//! question waits there, and none of it starts Follow's round. The list goes with the turn.

use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::{clock, ids};
use gs_core::messages::input_events::{ChatInput, TurnInput};
use gs_json::{Json, json};
use gs_runtime::fake::{FakeAgent, FakeStep};
use gs_services::App;
use gs_services::app::agents::use_runtime;
use gs_services::turns::turn_liveness::is_turn_running;
use gs_services::turns::turn_work::{lesson_work, teacher_work};
use gs_services::turns::{answer_approval, handle_chat_input};

/// An app over a fresh folder whose lessons run on `agent`.
fn app(agent: &FakeAgent) -> Arc<App> {
	let dir = std::env::temp_dir().join(format!("gs-lesson-work-{}", ids::uuid()));
	std::fs::create_dir_all(dir.join("data")).unwrap();
	let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir), None);
	use_runtime(&app, agent.runtime());
	app
}

/// A lesson in the space "CSE 29", with one file, whose first turn starts.
async fn lesson(app: &Arc<App>, title: &str) -> String {
	let space_id = app.stores.spaces.create_space(&json!({ "name": "CSE 29" })).unwrap()["id"].str_or_empty().to_owned();
	let file = json!({ "id": "f_0123456789ab", "origin": "copied", "name": "PA4.pdf", "path": "PA4.pdf", "kind": "info", "contentFp": "x", "status": "ready", "addedAt": "t" });
	app.stores.spaces.save_files(&space_id, vec![file], &[]).unwrap();
	let chat_id = app.stores.chats.create_chat(title, None, Some(&space_id), None, &[]).unwrap()["id"].str_or_empty().to_owned();
	let first = TurnInput::Chat(ChatInput::Text { text: format!("Teach me {title}."), attachments: None, about: None });
	assert!(handle_chat_input(app, &chat_id, first).await.ok());
	chat_id
}

fn work(app: &App, chat_id: &str) -> Json {
	lesson_work(app, chat_id).unwrap()
}

/// Follow's round of work as GET /api/teacher-work sends it: live or not.
fn round_live(app: &App) -> bool {
	teacher_work(app)["live"] == Json::Bool(true)
}

fn call(name: &str, args: Json) -> FakeStep {
	FakeStep::Tool { name: name.to_owned(), args }
}

/// The permission question the turn waits on.
async fn approval(app: &App, chat_id: &str) -> String {
	for _ in 0..500 {
		if let Some(id) = work(app, chat_id)["approvals"][0]["id"].as_str() {
			return id.to_owned();
		}
		clock::sleep(10).await;
	}
	panic!("no permission question came");
}

/// Waits for the lesson's turn to settle.
async fn settled(app: &App, chat_id: &str) {
	for _ in 0..500 {
		if !is_turn_running(app, chat_id) {
			return;
		}
		clock::sleep(10).await;
	}
	panic!("the turn never settled");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_agent_takes_its_lesson_s_desk_and_what_it_does_is_the_lesson_s_steps_never_a_round() {
	let agent = FakeAgent::default();
	let app = app(&agent);
	let plan = json!({ "items": ["Look at PA4", "Find the bug", "Explain it"], "done": 1 });
	agent.push(vec![
		call("read_space", json!({})),
		call("set_space_note", json!({ "text": "Pointers are next." })),
		FakeStep::OwnTool { name: "WebSearch".to_owned(), input: json!({ "query": "pointers in c" }) },
		call("work_plan", plan.clone()),
		FakeStep::Approval { tool: "Bash".to_owned(), input: json!({ "command": "ls" }) },
		FakeStep::Text("A pointer holds an address.".to_owned()),
	]);
	let chat_id = lesson(&app, "pointers").await;
	let asked = approval(&app, &chat_id).await;

	let now = work(&app, &chat_id);
	assert_eq!((now["live"].as_bool(), now["cause"].as_str()), (Some(true), Some("first")));
	assert_eq!(now["files"], json!([{ "name": "PA4.pdf", "path": now["files"][0]["path"], "kind": "pdf" }]));
	let words: Vec<&str> = now["steps"].items().iter().map(|s| s["text"].str_or_empty()).collect();
	assert_eq!(words, ["Looking at CSE 29", "Searching the web for “pointers in c”"], "a read and its own tool are steps, a change is none");
	assert_eq!(now["plan"], plan);
	assert_eq!(now["approvals"], json!([{ "id": asked, "text": "Teacher wants to run this command.", "subject": { "kind": "command", "text": "ls" } }]), "the card's words come from the server");
	let read = now["steps"][0].clone();
	assert_eq!(read["reads"], Json::Null);
	assert!(!round_live(&app), "a lesson's turn starts no round");

	assert!(answer_approval(&app, &chat_id, &asked, true));
	settled(&app, &chat_id).await;
	let saved = app.stores.chats.get_chat(&chat_id).unwrap();
	let called = saved["messages"].items().iter().flat_map(|m| m["content"].items().to_vec()).find(|b| b["name"] == json!("read_space")).unwrap();
	assert_eq!(read["call"], called["id"], "the call's id, so the lesson text leaves out its card");
	assert_eq!(work(&app, &chat_id), json!({ "live": false, "cause": null, "plan": null, "steps": [], "approvals": [], "files": now["files"] }), "the list goes with the turn");
	assert!(!round_live(&app));
}

#[tokio::test(flavor = "multi_thread")]
async fn the_window_reads_a_lesson_s_desk_at_its_route() {
	use tokio::io::{AsyncReadExt, AsyncWriteExt};
	let app = app(&FakeAgent::default());
	let chat_id = lesson(&app, "pointers").await;
	let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
	let port = listener.local_addr().unwrap().port();
	gs_base::tasks::spawn("test", axum::serve(listener, gs_server::http::server(app.clone(), &gs_server::http::access::Access::default())).into_future());
	let get = |path: String| async move {
		let mut conn = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
		conn.write_all(format!("GET {path} HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\n\r\n").as_bytes()).await.unwrap();
		let mut answer = String::new();
		conn.read_to_string(&mut answer).await.unwrap();
		let (head, body) = answer.split_once("\r\n\r\n").unwrap();
		(head[9..12].to_owned(), gs_json::parse(body).unwrap_or(Json::Null))
	};
	let (status, body) = get(format!("/api/chats/{chat_id}/work")).await;
	assert_eq!(status, "200");
	let keys: Vec<&str> = body.as_obj().unwrap().keys().map(String::as_str).collect();
	assert_eq!(keys, ["live", "cause", "plan", "steps", "approvals", "files"], "the contract's fields");
	assert_eq!(get("/api/chats/chat_gone/work".to_owned()).await.0, "404");
}
