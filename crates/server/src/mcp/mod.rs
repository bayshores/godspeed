//! The MCP server: how outside agents (Claude Code, Codex, any MCP
//! client) reach godspeed. Served at /api/mcp, stateless, guarded by the bearer token in
//! data/mcp-token. It speaks both MCP versions: 2026-07-28 (every request says who sent it;
//! server/discover hands over the instructions) and the older one that starts with initialize.
//!
//! Its tools are godspeed's data tools (`gs_services::talk::tools`), the ones free talk in the
//! teacher panel uses.

mod caller;
mod instructions;
mod protocol;
mod teacher_work;
mod transport;

use std::sync::Arc;

use axum::http::{HeaderMap, Method};
use axum::response::Response;
use gs_base::clock;
use gs_base::events::EventKind;
use gs_json::{Json, json};
use gs_services::App;

use crate::http::reply as http_reply;
use caller::caller_of;
use protocol::{MAX_BODY_BYTES, Rejection, Route, SERVER_ERROR, classify, is_json_content_type};
use transport::{Exchange, serve_legacy, serve_modern};

const LOCAL_HOSTS: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];

/// Equal lengths and equal bytes, looking at every byte either way.
fn token_matches(supplied: &[u8], expected: &[u8]) -> bool {
	supplied.len() == expected.len() && supplied.iter().zip(expected).fold(0u8, |diff, (a, b)| diff | (a ^ b)) == 0
}

/// `\s` as a JS regex reads it, over a header's Latin-1 bytes.
fn is_space(byte: u8) -> bool {
	matches!(byte, b'\t' | 0x0b | 0x0c | b' ' | 0xa0)
}

/// The token after an optional "Bearer " (any case).
fn supplied_token(authorization: &[u8]) -> &[u8] {
	let rest = authorization.get(..6).filter(|w| w.eq_ignore_ascii_case(b"bearer")).map(|_| &authorization[6..]);
	match rest {
		Some(rest) if rest.first().copied().is_some_and(is_space) => {
			let start = rest.iter().position(|b| !is_space(*b)).unwrap_or(rest.len());
			&rest[start..]
		}
		_ => authorization,
	}
}

/// Only this computer: a page in a browser (which sends Origin) or a request addressed to
/// another host name (DNS rebinding) is refused, then the token is checked.
fn refuse(app: &App, headers: &HeaderMap) -> Option<Response> {
	let refusal = |status: u16, error: &str| Some(http_reply::json_no_store(status, &json!({ "error": error })));
	if headers.get("origin").is_some_and(|o| !o.is_empty()) {
		return refusal(403, "Browser requests are not allowed.");
	}
	let host = headers.get("host").map(|h| String::from_utf8_lossy(h.as_bytes()).into_owned()).unwrap_or_default();
	let bare = match host.rfind(':') {
		Some(i) if i + 1 < host.len() && host[i + 1..].bytes().all(|c| c.is_ascii_digit()) => &host[..i],
		_ => host.as_str(),
	};
	if !LOCAL_HOSTS.contains(&bare) {
		return refusal(403, "Only local connections are allowed.");
	}
	let Ok(expected) = app.stores.mcp_token.ensure_mcp_token() else { return Some(http_reply::empty(500)) };
	let supplied = supplied_token(headers.get("authorization").map_or(&[][..], |a| a.as_bytes()));
	if supplied.is_empty() || !token_matches(supplied, expected.as_bytes()) {
		return refusal(401, "Missing or wrong access token (Settings → Connection).");
	}
	// An agent started in an app terminal says which; once that terminal ended it is refused.
	if headers.get(TERMINAL_HEADER).is_some() && !terminal_of(headers).is_some_and(|id| app.terminals.terminal_live(&id)) {
		return refusal(403, TERMINAL_CLOSED);
	}
	None
}

const TERMINAL_HEADER: &str = "x-godspeed-terminal";
pub(crate) const TERMINAL_CLOSED: &str = "This terminal was closed in godspeed.";

/// The app terminal a request came from: its id, 32 lowercase hex.
fn terminal_of(headers: &HeaderMap) -> Option<String> {
	let id = headers.get(TERMINAL_HEADER)?.to_str().ok()?;
	(id.len() == 32 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))).then(|| id.to_owned())
}

/// The /api/mcp transport: one stateless exchange per request, in either era.
pub async fn handle_mcp_request(app: &Arc<App>, method: &Method, headers: &HeaderMap, raw: &[u8]) -> Response {
	if let Some(refused) = refuse(app, headers) {
		return refused;
	}
	let post = *method == Method::POST;
	let body = if post { gs_json::parse(&http_reply::body_text(raw)).ok() } else { None };
	// Every authorized request means an agent is connected, and names it when it says who it is.
	let caller = post.then(|| caller_of(body.as_ref()));
	let terminal = terminal_of(headers);
	let now = clock::now_ms();
	if let Some(caller) = &caller {
		app.terminals.record_check_in(caller.name.as_deref(), now);
		app.terminals.record_terminal_contact(terminal.as_deref(), now);
	}
	// Only a client's own name changes the shared one; a guess names just this request.
	let agent = caller.as_ref().and_then(|c| c.name.clone().or_else(|| c.guessed.clone())).or_else(|| app.terminals.agent_name(now));
	// Only initialize and server/discover hand instructions to the agent, so only they build the briefing.
	let instructions = caller.as_ref().filter(|c| c.wants_instructions).map(|_| instructions::connect_instructions(app)).unwrap_or_default();
	let exchange = Exchange { app, caller: agent.as_deref(), terminal: terminal.as_deref(), instructions: &instructions };
	let too_large = post && raw.len() > MAX_BODY_BYTES;
	let route = match &body {
		_ if !post => Route::Legacy,
		_ if too_large => Route::Reject(Rejection::new(413, SERVER_ERROR, format!("Payload Too Large: Request body must not exceed {MAX_BODY_BYTES} bytes"))),
		None => Route::Legacy,
		Some(body) => classify(body, headers),
	};
	match route {
		Route::Legacy => serve_legacy(&exchange, method, headers, raw).await,
		_ if !is_json_content_type(headers) => {
			http_reply::json(415, &Rejection::new(415, SERVER_ERROR, "Unsupported Media Type: Content-Type must be application/json").body())
		}
		Route::Modern { message, revision } => serve_modern(&exchange, &message, revision.as_deref(), headers).await,
		Route::Reject(refused) => http_reply::json(refused.status, &refused.body()),
	}
}

/// /api/mcp/line: the godspeed folder's prompt hook hands over a line the learner typed to the
/// agent. `{ "sent": "lesson" }` when the page on screen took it (the hook then blocks it), else
/// `{ "sent": null }`.
pub async fn handle_terminal_line(app: &App, headers: &HeaderMap, body: Option<Json>) -> Response {
	if let Some(refused) = refuse(app, headers) {
		return refused;
	}
	let body = body.unwrap_or_default();
	let Some(line) = body["line"].as_str().filter(|line| !line.trim().is_empty()) else {
		return http_reply::json(400, &json!({ "error": "Send the typed line as \"line\"." }));
	};
	let sent = gs_services::app::terminal_lines::take_terminal_line(app, terminal_of(headers).as_deref(), line).await;
	http_reply::json(200, &json!({ "sent": sent }))
}

/// /api/mcp/agent-event: the godspeed folder's hook says the agent in a terminal started a chat
/// (`{ "event": "session", ... }`), stopped (`"stop"`), waits for the learner's say (`"needs"`)
/// or uses one of its own tools (`{ "event": "tool", "tool": "WebSearch", "subject": "cse 21
/// hw7" }`). Its own tools are steps of its round of work. The window may play its sound: for a stop only when
/// the teacher was answering a line typed to it there (a lesson's reply has its own turn), for a
/// need only from the teacher's terminal.
pub fn handle_agent_event(app: &App, headers: &HeaderMap, body: Option<Json>) -> Response {
	if let Some(refused) = refuse(app, headers) {
		return refused;
	}
	let body = body.unwrap_or_default();
	let terminal = terminal_of(headers);
	let kind = match (body["event"].as_str(), terminal.as_deref()) {
		// The teacher's chats are the panel's now; a terminal's own is not kept.
		(Some("session"), _) => None,
		(Some("stop"), Some(id)) => {
			app.terminals.agent_stopped(id);
			app.terminals.take_chat(id).then_some("done")
		}
		(Some("needs"), id) if app.terminals.is_teacher_terminal(id) => Some("needs"),
		(Some("tool"), Some(id)) => {
			teacher_work::note_own_tool(app, id, body["tool"].str_or_empty(), body["subject"].as_str());
			None
		}
		(Some("stop" | "needs" | "tool"), _) => None,
		_ => return http_reply::json(400, &json!({ "error": "Send \"event\": \"session\", \"stop\", \"needs\" or \"tool\"." })),
	};
	if let Some(kind) = kind {
		app.events.emit(EventKind::AgentEvent, json!({ "kind": kind }));
	}
	http_reply::json(200, &json!({ "ok": true }))
}

/// Token and agent status for the window (GET /api/mcp-access), without the url.
pub fn mcp_access_status(app: &App) -> Result<Json, String> {
	let now = clock::now_ms();
	let turns = gs_services::turns::turn_liveness::turns_running(app);
	Ok(json!({
		"token": app.stores.mcp_token.ensure_mcp_token()?,
		"agentConnected": app.terminals.agent_connected(now),
		"agentName": app.terminals.agent_name(now),
		"turnsRunning": turns,
		"terminals": app.terminals.terminals_here(now).into_iter().map(|(id, here)| json!({ "id": id, "here": here })).collect::<Vec<_>>(),
		"outsideHere": app.terminals.outside_here(now),
	}))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn reads_the_bearer_token_like_the_ts() {
		assert_eq!(supplied_token(b"Bearer abc"), b"abc");
		assert_eq!(supplied_token(b"bearer \t abc"), b"abc");
		assert_eq!(supplied_token(b"Bearer "), b"");
		assert_eq!(supplied_token(b"abc"), b"abc");
		assert_eq!(supplied_token(b"Basic abc"), b"Basic abc");
		assert_eq!(supplied_token(b"Bearerabc"), b"Bearerabc");
		assert!(token_matches(b"abc", b"abc"));
		assert!(!token_matches(b"abd", b"abc"));
		assert!(!token_matches(b"abcc", b"abc"));
	}
}
