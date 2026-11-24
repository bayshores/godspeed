//! A lesson's desk (GET /api/chats/{id}/work): the agent that holds the lesson's turn takes it, its
//! reply's tool calls are steps with their call ids and work_plan is its plan, and what it does
//! meanwhile (godspeed's tools, its own tools) is a step of the lesson's, never of Follow's round.
//! The list goes with the turn.

use std::sync::Arc;

use gs_base::clock;
use gs_base::events::EventKind;
use gs_core::messages::input_events::{ChatInput, TurnInput};
use gs_json::{Json, json};
use gs_services::App;
use gs_services::turns::handle_chat_input;
use gs_services::turns::turn_liveness::is_turn_running;
use gs_services::turns::turn_work::lesson_work;

mod common;
use common::{TERMINAL, app, call, own_tool, read_pages, round, work_id};

/// A lesson in the space "CSE 29", with one file, whose first turn waits for an agent.
async fn lesson_waiting(app: &Arc<App>, title: &str) -> (String, String) {
	let space_id = app.stores.spaces.create_space(&json!({ "name": "CSE 29" })).unwrap()["id"].str_or_empty().to_owned();
	let file = json!({ "id": "f_0123456789ab", "origin": "copied", "name": "PA4.pdf", "path": "PA4.pdf", "kind": "info", "contentFp": "x", "status": "ready", "addedAt": "t" });
	app.stores.spaces.save_files(&space_id, vec![file], &[]).unwrap();
	let chat_id = app.stores.chats.create_chat(title, None, Some(&space_id), None, &[]).unwrap()["id"].str_or_empty().to_owned();
	let first = TurnInput::Chat(ChatInput::Text { text: format!("Teach me {title}."), attachments: None, about: None });
	assert!(handle_chat_input(app, &chat_id, first).await.ok());
	(chat_id, space_id)
}

fn work(app: &App, chat_id: &str) -> Json {
	lesson_work(app, chat_id).unwrap()
}

fn step_words(app: &App, chat_id: &str) -> Vec<String> {
	work(app, chat_id)["steps"].items().iter().map(|s| s["text"].str_or_empty().to_owned()).collect()
}

/// Waits for the lesson's turn to settle.
async fn settled(app: &App, chat_id: &str) {
	for _ in 0..100 {
		if !is_turn_running(app, chat_id) {
			return;
		}
		clock::sleep(20).await;
	}
	panic!("the turn never settled");
}

#[tokio::test]
async fn an_outside_agent_s_lesson_turn_is_its_desk_s_from_claim_to_end_and_starts_no_round() {
	let app = app();
	let (chat_id, space_id) = lesson_waiting(&app, "pointers").await;
	let mut events = app.events.subscribe();
	let waiting = work(&app, &chat_id);
	assert_eq!((waiting["live"].as_bool(), waiting["cause"].as_str(), waiting["taken"].as_bool()), (Some(true), Some("first"), Some(false)));
	assert_eq!(waiting["files"], json!([{ "name": "PA4.pdf", "path": waiting["files"][0]["path"], "kind": "pdf" }]));

	let (_, body) = call(&app, None, Some("out-1"), "wait_for_work", r#"{"timeout_seconds":2}"#).await;
	let item = work_id(&body);
	read_pages(&app, None, Some("out-1"), &item).await;
	assert_eq!(work(&app, &chat_id)["taken"], json!(true), "the claim takes the turn");
	let told = std::iter::from_fn(|| events.try_recv().ok()).filter(|e| e.kind == EventKind::LessonWork).count();
	assert_eq!(told, 1, "the claim is told once");

	call(&app, None, Some("out-1"), "read_space", &format!(r#"{{"space_id":"{space_id}"}}"#)).await;
	call(&app, None, Some("out-1"), "update_space", &format!(r#"{{"space_id":"{space_id}","description":"Systems."}}"#)).await;
	assert_eq!(step_words(&app, &chat_id), ["Looking at CSE 29"], "a read is a step, a change is none");
	assert_eq!(round(&app), None, "an outside agent holding a lesson starts no round");

	let plan = json!({ "items": ["Look at PA4", "Find the bug", "Explain it"], "done": 1 });
	let reply = json!({ "work_id": item, "tool_calls": [{ "name": "work_plan", "arguments": plan }, { "name": "read_space", "arguments": {} }], "wait_seconds": 5 });
	let (_, body) = call(&app, None, Some("out-1"), "respond", &gs_json::stringify(&reply)).await;
	let next = work_id(&body);
	read_pages(&app, None, Some("out-1"), &next).await;
	let now = work(&app, &chat_id);
	assert_eq!(now["plan"], plan);
	let read = now["steps"].items().last().unwrap().clone();
	assert_eq!((read["text"].as_str(), &read["reads"]), (Some("Looking at CSE 29"), &Json::Null));
	assert_eq!(round(&app), None);

	call(&app, None, Some("out-1"), "respond", &format!(r#"{{"work_id":"{next}","text":"A pointer holds an address.","wait_seconds":0}}"#)).await;
	settled(&app, &chat_id).await;
	let saved = app.stores.chats.get_chat(&chat_id).unwrap();
	let called = saved["messages"].items().iter().flat_map(|m| m["content"].items().to_vec()).find(|b| b["name"] == json!("read_space")).unwrap();
	assert_eq!(read["call"], called["id"], "the reply's call, so the lesson text leaves out its card");
	assert_eq!(work(&app, &chat_id), json!({ "live": false, "cause": null, "taken": false, "plan": null, "steps": [], "files": waiting["files"] }), "the list goes with the turn");
	call(&app, None, Some("out-1"), "list_spaces", "{}").await;
	assert_eq!(round(&app), Some(vec!["Looking at your spaces".to_owned()]), "done with the lesson, its calls count for Follow again");
}

#[tokio::test]
async fn the_teacher_terminal_s_tools_go_to_the_lesson_it_holds_and_each_lesson_keeps_its_own() {
	let app = app();
	app.bridge.set_live_terminals(vec![TERMINAL.to_owned()], Some(TERMINAL.to_owned()));
	app.bridge.set_terminal_chat(TERMINAL, "sess-1");
	app.bridge.chat_line(TERMINAL, clock::now_ms());
	let (chat_id, space_id) = lesson_waiting(&app, "pointers").await;

	let (_, body) = call(&app, Some(TERMINAL), Some("sess-1"), "wait_for_work", &format!(r#"{{"timeout_seconds":2,"lesson_id":"{chat_id}"}}"#)).await;
	let item = work_id(&body);
	read_pages(&app, Some(TERMINAL), Some("sess-1"), &item).await;
	let (other, _) = lesson_waiting(&app, "sets").await;
	call(&app, Some(TERMINAL), Some("sess-1"), "read_passage", &format!(r#"{{"space_id":"{space_id}","file_id":"f_0123456789ab","range":"p. 2"}}"#)).await;
	own_tool(&app, Some(TERMINAL), "WebSearch", "pointers in c");
	assert_eq!(step_words(&app, &chat_id), ["Reading PA4.pdf, page 2", "Searching the web for “pointers in c”"]);
	assert_eq!(round(&app), Some(Vec::new()), "the round the learner's line began gets none of them");
	assert_eq!((work(&app, &other)["taken"].as_bool(), step_words(&app, &other).len()), (Some(false), 0), "the other lesson's desk is its own");

	call(&app, Some(TERMINAL), Some("sess-1"), "respond", &format!(r#"{{"work_id":"{item}","text":"Hi.","wait_seconds":0}}"#)).await;
	settled(&app, &chat_id).await;
	own_tool(&app, Some(TERMINAL), "Read", "notes.md");
	assert_eq!(round(&app), Some(vec!["Reading notes.md".to_owned()]), "holding no lesson, its tools are the round's again");
}

#[tokio::test]
async fn the_window_reads_a_lesson_s_desk_at_its_route() {
	use tokio::io::{AsyncReadExt, AsyncWriteExt};
	let app = app();
	let (chat_id, _) = lesson_waiting(&app, "pointers").await;
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
	assert_eq!(keys, ["live", "cause", "taken", "plan", "steps", "files"], "the contract's fields");
	assert_eq!(get("/api/chats/chat_gone/work".to_owned()).await.0, "404");
}
