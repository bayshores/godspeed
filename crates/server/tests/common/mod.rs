//! What the MCP tests share: an app with an MCP token whose lessons run on a stand-in agent, tool
//! calls sent as an agent's client sends them, the folder's hook telling an agent's own tool, and
//! the teacher's round as the window reads it.

use std::sync::Arc;

use axum::http::{HeaderMap, HeaderValue, Method};
use gs_base::config::Paths;
use gs_base::{fsx, ids};
use gs_runtime::fake::FakeAgent;
use gs_server::mcp::handle_mcp_request;
use gs_services::App;
use gs_services::app::agents::use_runtime;
use http_body_util::BodyExt;

const TOKEN: &str = "abababababababababababababababababababababababababababababababab";
/// An app terminal's id.
pub const TERMINAL: &str = "0123456789abcdef0123456789abcdef";

pub fn app() -> Arc<App> {
	let dir = std::env::temp_dir().join(format!("gs-mcp-{}", ids::uuid()));
	let data = dir.join("data");
	std::fs::create_dir_all(&data).unwrap();
	fsx::write_atomic(&data.join("mcp-token"), TOKEN.as_bytes(), Some(0o600)).unwrap();
	let app = App::new(Paths::new(data, dir.join("home"), dir.join("tmp"), dir), None);
	// A lesson start_lesson opens plays an empty turn, never the learner's real agent.
	use_runtime(&app, FakeAgent::default().runtime());
	app
}

/// A tools/call from `terminal` and the agent session `agent`, when given.
pub async fn call(app: &Arc<App>, terminal: Option<&str>, agent: Option<&str>, tool: &str, arguments: &str) -> (u16, String) {
	send(app, terminal, agent.map(|a| format!(r#""godspeed/agent":"{a}""#)), tool, arguments).await
}

/// A local request with the token, from `terminal` when given.
fn headers(terminal: Option<&str>) -> HeaderMap {
	let mut headers = HeaderMap::new();
	headers.insert("host", HeaderValue::from_static("127.0.0.1:48065"));
	headers.insert("authorization", HeaderValue::from_str(&format!("Bearer {TOKEN}")).unwrap());
	headers.insert("content-type", HeaderValue::from_static("application/json"));
	headers.insert("accept", HeaderValue::from_static("application/json, text/event-stream"));
	if let Some(id) = terminal {
		headers.insert("x-godspeed-terminal", HeaderValue::from_str(id).unwrap());
	}
	headers
}

/// A tools/call with this `_meta` inside.
pub async fn send(app: &Arc<App>, terminal: Option<&str>, meta: Option<String>, tool: &str, arguments: &str) -> (u16, String) {
	let meta = meta.map(|m| format!(r#","_meta":{{{m}}}"#)).unwrap_or_default();
	let body = format!(r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"{tool}","arguments":{arguments}{meta}}}}}"#);
	let res = handle_mcp_request(app, &Method::POST, &headers(terminal), body.as_bytes()).await;
	let status = res.status().as_u16();
	(status, String::from_utf8(res.into_body().collect().await.unwrap().to_bytes().to_vec()).unwrap())
}

/// The workId of the work item an answer holds.
pub fn work_id(body: &str) -> String {
	body.split(r#"workId\":\""#).nth(1).and_then(|rest| rest.split('\\').next()).unwrap_or_else(|| panic!("no work: {body}")).to_owned()
}

/// The teacher's round of work as GET /api/teacher-work sends it: its step words, or None.
pub fn round(app: &App) -> Option<Vec<String>> {
	let round = app.bridge.teacher_work(gs_base::clock::now_ms());
	(round["live"] == gs_json::Json::Bool(true)).then(|| round["steps"].items().iter().map(|s| s["text"].str_or_empty().to_owned()).collect())
}

/// The folder's hook in `terminal` says the agent uses one of its own tools: the answer's status.
pub fn own_tool(app: &App, terminal: Option<&str>, tool: &str, subject: &str) -> u16 {
	let body = gs_json::json!({ "event": "tool", "tool": tool, "subject": subject });
	gs_server::mcp::handle_agent_event(app, &headers(terminal), Some(body)).status().as_u16()
}
