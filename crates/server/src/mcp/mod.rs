//! The MCP server (src/backend/server/mcp.ts): how outside agents (Claude Code, Codex, any MCP
//! client) reach godspeed. Served at /api/mcp, stateless, guarded by the bearer token in
//! data/mcp-token. It speaks both MCP versions: 2026-07-28 (every request says who sent it;
//! server/discover hands over the instructions) and the older one that starts with initialize.
//!
//! Four kinds of tools: the work loop (`work`), direct access to lessons and graphs (`lessons`,
//! `graph`), spaces (`spaces`), and memory (`memory`). Deleting a space is app-only on purpose.

mod caller;
mod spaces;
mod graph;
mod instructions;
mod lessons;
mod memory;
mod protocol;
mod reply;
mod schema;
mod tools;
mod transport;
mod work;

use std::sync::Arc;

use axum::http::{HeaderMap, Method};
use axum::response::Response;
use gs_base::clock;
use gs_json::{Json, json};
use gs_services::App;

use crate::http::reply as http_reply;
use caller::{agent_id_of, caller_of};
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
	None
}

/// The /api/mcp transport: one stateless exchange per request, in either era.
pub async fn handle_mcp_request(app: &Arc<App>, method: &Method, headers: &HeaderMap, raw: &[u8]) -> Response {
	if let Some(refused) = refuse(app, headers) {
		return refused;
	}
	let post = *method == Method::POST;
	let body = if post { gs_json::parse(&http_reply::body_text(raw)).ok() } else { None };
	// Every authorized request means an agent is connected (only the work loop means it is
	// teaching), and names it when it says who it is.
	let caller = post.then(|| caller_of(body.as_ref()));
	let now = clock::now_ms();
	if let Some(caller) = &caller {
		app.bridge.record_check_in(caller.name.as_deref(), false, now);
	}
	// Only a client's own name changes the shared one; a guess names just this request.
	let agent = caller.as_ref().and_then(|c| c.name.clone().or_else(|| c.guessed.clone())).or_else(|| app.bridge.agent_name(now));
	// Only initialize and server/discover hand instructions to the agent, so only they build the briefing.
	let instructions = if caller.as_ref().is_some_and(|c| c.wants_instructions) { instructions::connect_instructions(app) } else { instructions::INSTRUCTIONS.to_owned() };
	let exchange = Exchange { app, caller: agent.as_deref(), instructions: &instructions };
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

/// A godspeed folder hook's request: the refusal, or `then` runs with the session id it sent
/// and its body.
fn hook_request(app: &App, headers: &HeaderMap, body: Option<Json>, then: impl FnOnce(&str, &Json)) -> Response {
	if let Some(refused) = refuse(app, headers) {
		return refused;
	}
	let body = body.unwrap_or_default();
	let Some(agent) = agent_id_of(&json!({ "godspeed/agent": body["agent"] })) else {
		return http_reply::json(400, &json!({ "error": "Send the agent's session id as \"agent\"." }));
	};
	then(&agent, &body);
	http_reply::json(200, &json!({ "ok": true }))
}

/// /api/mcp/forget: the godspeed folder's Claude Code hook says an agent lost its context (it
/// compacted, or /clear ended the session), so its next items come in full.
pub fn handle_agent_forget(app: &App, headers: &HeaderMap, body: Option<Json>) -> Response {
	hook_request(app, headers, body, |agent, body| app.bridge.forget_agent(agent, body["cleared"] == Json::Bool(true)))
}

/// /api/mcp/compacting: the godspeed folder's Claude Code hook says an agent started compacting
/// its context, so the backup teacher answers meanwhile.
pub fn handle_agent_compacting(app: &App, headers: &HeaderMap, body: Option<Json>) -> Response {
	hook_request(app, headers, body, |agent, _| app.bridge.agent_compacting(agent, clock::now_ms()))
}

/// Token and agent status for the window (GET /api/mcp-access), without the url.
pub fn mcp_access_status(app: &App) -> Result<Json, String> {
	let now = clock::now_ms();
	Ok(json!({
		"token": app.stores.mcp_token.ensure_mcp_token()?,
		"agentConnected": app.bridge.agent_connected(now),
		"agentTeaching": app.bridge.agent_teaching(now),
		"agentName": app.bridge.agent_name(now),
		"backupConnected": app.bridge.backup_connected(now),
		"backupAnswering": app.bridge.backup_answering(now),
		"pendingWork": app.bridge.pending_work_count(),
		"claimedLessons": app.bridge.claimed_lessons(),
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
