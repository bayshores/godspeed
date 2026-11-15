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
	call(app, terminal, None, "wait_for_work", r#"{"timeout_seconds":1}"#).await
}

/// A tools/call from `terminal` and the agent session `agent`, when given.
async fn call(app: &Arc<App>, terminal: Option<&str>, agent: Option<&str>, tool: &str, arguments: &str) -> (u16, String) {
	let mut headers = HeaderMap::new();
	headers.insert("host", HeaderValue::from_static("127.0.0.1:48065"));
	headers.insert("authorization", HeaderValue::from_str(&format!("Bearer {TOKEN}")).unwrap());
	headers.insert("content-type", HeaderValue::from_static("application/json"));
	headers.insert("accept", HeaderValue::from_static("application/json, text/event-stream"));
	if let Some(id) = terminal {
		headers.insert("x-godspeed-terminal", HeaderValue::from_str(id).unwrap());
	}
	let meta = agent.map(|a| format!(r#","_meta":{{"godspeed/agent":"{a}"}}"#)).unwrap_or_default();
	let body = format!(r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"{tool}","arguments":{arguments}{meta}}}}}"#);
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

	app.bridge.set_live_terminals(vec![TERMINAL.to_owned()], Some(TERMINAL.to_owned()));
	let open = tokio::spawn({
		let app = app.clone();
		async move { wait(&app, Some(TERMINAL)).await }
	});
	gs_base::clock::sleep(50).await;
	let access = gs_server::mcp::mcp_access_status(&app).unwrap();
	assert_eq!(access["terminals"], gs_json::json!([{ "id": TERMINAL, "here": true }]));
	assert_eq!(access["outsideHere"], gs_json::Json::Bool(true));
	app.bridge.set_live_terminals(Vec::new(), None);
	let (status, body) = open.await.unwrap();
	assert_eq!(status, 200);
	assert!(body.contains(r#""isError":true"#) && body.contains(CLOSED), "{body}");
}

#[tokio::test]
async fn typing_in_the_terminal_ends_its_wait_with_a_note() {
	let app = app();
	app.bridge.set_live_terminals(vec![TERMINAL.to_owned()], Some(TERMINAL.to_owned()));
	let open = tokio::spawn({
		let app = app.clone();
		async move { wait(&app, Some(TERMINAL)).await }
	});
	gs_base::clock::sleep(50).await;
	app.bridge.typed(TERMINAL, gs_base::clock::now_ms());
	let (status, body) = open.await.unwrap();
	assert_eq!(status, 200);
	let note = r#"{\"status\":\"idle\",\"note\":\"The learner typed to you in your terminal. Answer them there, then call wait_for_work again.\"}"#;
	assert!(body.contains(note) && !body.contains(r#""isError":true"#), "{body}");
	let (_, body) = wait(&app, Some(TERMINAL)).await;
	assert!(body.contains("Nothing to do right now."), "read once: {body}");
}

#[tokio::test]
async fn a_tool_call_after_the_typing_shows_the_agent_already_read_it() {
	let app = app();
	app.bridge.set_live_terminals(vec![TERMINAL.to_owned()], Some(TERMINAL.to_owned()));
	app.bridge.typed(TERMINAL, gs_base::clock::now_ms());
	let (status, body) = call(&app, Some(TERMINAL), None, "list_spaces", "{}").await;
	assert_eq!(status, 200, "{body}");
	let (_, body) = wait(&app, Some(TERMINAL)).await;
	assert!(body.contains("Nothing to do right now.") && !body.contains("typed to you"), "{body}");
}

/// Whether the window opened the agent's last change, as Follow does.
fn opened(app: &App, label: &str) -> bool {
	let actions = gs_services::app::agent_actions::recent_agent_actions(app);
	actions.iter().find(|a| a["label"].as_str() == Some(label)).unwrap()["open"] == gs_json::Json::Bool(true)
}

#[tokio::test]
async fn what_the_teacher_terminal_starts_opens_and_its_running_waiter_needs_no_second() {
	let app = app();
	let helper = "f".repeat(32);
	app.bridge.set_live_terminals(vec![TERMINAL.to_owned(), helper.clone()], Some(TERMINAL.to_owned()));
	call(&app, None, None, "create_space", r#"{"name":"Algebra","icon":"sigma"}"#).await;
	assert!(!opened(&app, "Creating Algebra"), "an agent outside the app changes things on its own");
	call(&app, Some(&helper), None, "create_space", r#"{"name":"Chemistry","icon":"sigma"}"#).await;
	assert!(!opened(&app, "Creating Chemistry"), "the helper's terminal is not where the learner asks");
	call(&app, Some(TERMINAL), None, "create_space", r#"{"name":"Biology","icon":"dna"}"#).await;
	assert!(opened(&app, "Creating Biology"), "the learner asked in the teacher's terminal");

	let (_, body) = call(&app, Some(TERMINAL), Some("sess-1"), "start_lesson", r#"{"topic":"Cells"}"#).await;
	assert!(body.contains("The lesson is in the godspeed window. Wait with the waiter"), "{body}");
	call(&app, None, Some("sess-2"), "wait_for_work", r#"{"timeout_seconds":1}"#).await;
	let waiter = tokio::spawn({
		let app = app.clone();
		async move { call(&app, Some(TERMINAL), Some("sess-1"), "wait_for_work", r#"{"timeout_seconds":5}"#).await }
	});
	gs_base::clock::sleep(50).await;
	let (_, body) = call(&app, Some(TERMINAL), Some("sess-1"), "start_lesson", r#"{"topic":"Mitosis"}"#).await;
	assert!(body.contains("The lesson is in the godspeed window. Your waiter already running brings its turns."), "{body}");
	assert!(opened(&app, "Starting Mitosis"));
	waiter.abort();
}

#[tokio::test]
async fn typing_while_respond_waits_for_a_follow_up_ends_the_turn_with_a_note() {
	let app = app();
	app.bridge.set_live_terminals(vec![TERMINAL.to_owned()], Some(TERMINAL.to_owned()));
	call(&app, Some(TERMINAL), Some("sess-1"), "start_lesson", r#"{"topic":"Cells"}"#).await;
	let (_, body) = call(&app, Some(TERMINAL), Some("sess-1"), "wait_for_work", r#"{"timeout_seconds":5}"#).await;
	let work_id = body.split(r#"workId\":\""#).nth(1).and_then(|rest| rest.split('\\').next()).unwrap_or_else(|| panic!("no work: {body}")).to_owned();
	// A lesson's first turn comes in pages; respond waits until all are read.
	for page in 2..=8 {
		let (_, body) = call(&app, Some(TERMINAL), Some("sess-1"), "read_work", &format!(r#"{{"work_id":"{work_id}","page":{page}}}"#)).await;
		if body.contains(r#""isError":true"#) {
			break;
		}
	}
	let responding = tokio::spawn({
		let app = app.clone();
		async move { call(&app, Some(TERMINAL), Some("sess-1"), "respond", &format!(r#"{{"work_id":"{work_id}","text":"Cells are small.","wait_seconds":5}}"#)).await }
	});
	gs_base::clock::sleep(50).await;
	app.bridge.typed(TERMINAL, gs_base::clock::now_ms());
	let (status, body) = responding.await.unwrap();
	assert_eq!(status, 200);
	// The session id comes as Claude Code sends it, and its waiter ended when it took the turn.
	assert!(body.contains(r#"{\"status\":\"turn_complete\",\"note\":\"Turn done. The learner typed to you in your terminal. Answer them there. Wait with the waiter"#), "{body}");
}
