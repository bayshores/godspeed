//! Serving one request in either era: the 2026-07-28 path (JSON answers only, because the
//! godspeed folder's scripts read one JSON body) and the older stateless transport in JSON
//! mode, which Codex still speaks. Nothing is kept between requests.

use axum::http::{HeaderMap, HeaderValue, Method, header};
use axum::response::Response;
use gs_base::config::VERSION;
use gs_json::{Json, json};

use super::protocol::{
	INVALID_PARAMS, INVALID_REQUEST, LEGACY_VERSIONS, MAX_BODY_BYTES, METHOD_NOT_FOUND, MODERN, PARSE_ERROR, Rejection, SERVER_ERROR, answer, check_modern, is_message, is_request,
};
use super::tools::{ToolCall, call_tool, has_tool, tool_list};
use crate::http::reply;

/// What one request needs besides its body: the app, the caller's name, the app terminal it
/// came from and the instructions this request hands over.
pub struct Exchange<'a> {
	pub app: &'a std::sync::Arc<gs_services::App>,
	pub caller: Option<&'a str>,
	pub terminal: Option<&'a str>,
	pub instructions: &'a str,
}

fn capabilities() -> Json {
	json!({ "tools": { "listChanged": false } })
}

fn server_meta() -> Json {
	json!({ "io.modelcontextprotocol/serverInfo": { "name": "godspeed", "version": VERSION } })
}

/// A modern result's cache fields and server identity.
fn modern_result(mut result: Json, cached: bool) -> Json {
	if let Some(fields) = result.as_obj_mut() {
		fields.insert("resultType", "complete");
		if cached {
			fields.insert("ttlMs", 0);
			fields.insert("cacheScope", "private");
		}
		fields.insert("_meta", server_meta());
	}
	result
}

/// One request's result, or its JSON-RPC error.
async fn dispatch(exchange: &Exchange<'_>, message: &Json, modern: bool) -> Result<Json, (i64, String)> {
	let params = &message["params"];
	match message["method"].as_str().unwrap_or_default() {
		"initialize" if !modern => {
			let requested = params["protocolVersion"].as_str().unwrap_or_default();
			let version = LEGACY_VERSIONS.into_iter().find(|v| *v == requested).unwrap_or(LEGACY_VERSIONS[0]);
			Ok(json!({ "protocolVersion": version, "capabilities": capabilities(), "serverInfo": { "name": "godspeed", "version": VERSION }, "instructions": exchange.instructions }))
		}
		"ping" if !modern => Ok(json!({})),
		"server/discover" if modern => Ok(modern_result(json!({ "supportedVersions": [MODERN], "capabilities": capabilities(), "instructions": exchange.instructions }), true)),
		"tools/list" if modern => Ok(modern_result(json!({ "tools": tool_list() }), true)),
		"tools/list" => Ok(json!({ "tools": tool_list() })),
		"tools/call" => {
			let name = params["name"].as_str();
			let args = params.get("arguments");
			let mut issues = Vec::new();
			if name.is_none() {
				issues.push(request_issue("string", "name", params.get("name")));
			}
			if args.is_some_and(|a| a.as_obj().is_none()) {
				issues.push(request_issue("record", "arguments", args));
			}
			let (Some(name), true) = (name, issues.is_empty()) else {
				return Err((INVALID_PARAMS, format!("Invalid tools/call request: {}", gs_json::stringify_pretty(&Json::Arr(issues), "  "))));
			};
			let args = args.cloned().unwrap_or_else(|| Json::Obj(Default::default()));
			if !has_tool(name) {
				return Err((INVALID_PARAMS, format!("Tool {name} not found")));
			}
			let call = ToolCall { app: exchange.app, caller: exchange.caller, terminal: exchange.terminal, meta: &params["_meta"] };
			let result = call_tool(&call, name, &args).await;
			Ok(if modern { modern_result(result, false) } else { result })
		}
		_ => Err((METHOD_NOT_FOUND, "Method not found".to_owned())),
	}
}

/// One zod issue of the tools/call request itself, as the SDK prints it.
fn request_issue(expected: &str, field: &str, given: Option<&Json>) -> Json {
	let received = super::schema::received(given);
	json!({ "expected": expected, "code": "invalid_type", "path": ["params", field], "message": format!("Invalid input: expected {expected}, received {received}") })
}

fn reject(rejection: &Rejection) -> Response {
	reply::json(rejection.status, &rejection.body())
}

/// A modern request after the entry ladder sent it here.
pub async fn serve_modern(exchange: &Exchange<'_>, message: &Json, revision: Option<&str>, headers: &HeaderMap) -> Response {
	if let Some(refused) = check_modern(message, revision, headers) {
		return reject(&refused);
	}
	if !is_request(message) {
		return reply::empty(202);
	}
	let outcome = dispatch(exchange, message, true).await;
	// An unknown method is HTTP 404 in this era; every other dispatch error stays 200.
	let status = if matches!(outcome, Err((METHOD_NOT_FOUND, _))) { 404 } else { 200 };
	reply::json(status, &answer(&message["id"], outcome))
}

/// The older transport's errors: `{jsonrpc, error, id: null}`.
fn transport_error(status: u16, code: i64, message: &str) -> Response {
	reject(&Rejection::new(status, code, message))
}

/// The older protocol's header check: a version it names must be one it speaks.
fn unsupported_version(headers: &HeaderMap) -> Option<Response> {
	let version = headers.get("mcp-protocol-version")?;
	let version = String::from_utf8_lossy(version.as_bytes());
	if LEGACY_VERSIONS.contains(&version.as_ref()) {
		return None;
	}
	let message = format!("Bad Request: Unsupported protocol version: {version} (supported versions: {})", LEGACY_VERSIONS.join(", "));
	Some(transport_error(400, SERVER_ERROR, &message))
}

fn raw_header(headers: &HeaderMap, name: header::HeaderName) -> &str {
	headers.get(name).and_then(|v| v.to_str().ok()).unwrap_or_default()
}

/// The older stateless transport: GET opens an event stream that the per-request server closes
/// at once, DELETE ends a session there is none of, POST answers in JSON.
pub async fn serve_legacy(exchange: &Exchange<'_>, method: &Method, headers: &HeaderMap, raw: &[u8]) -> Response {
	if !matches!(*method, Method::GET | Method::POST | Method::DELETE) {
		let mut res = transport_error(405, SERVER_ERROR, "Method not allowed.");
		res.headers_mut().insert(header::ALLOW, HeaderValue::from_static("GET, POST, DELETE"));
		return res;
	}
	if *method == Method::GET {
		if !raw_header(headers, header::ACCEPT).contains("text/event-stream") {
			return transport_error(406, SERVER_ERROR, "Not Acceptable: Client must accept text/event-stream");
		}
		if let Some(refused) = unsupported_version(headers) {
			return refused;
		}
		let mut res = reply::empty(200);
		let fields = res.headers_mut();
		fields.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/event-stream"));
		fields.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache, no-transform"));
		fields.insert("x-accel-buffering", HeaderValue::from_static("no"));
		return res;
	}
	if *method == Method::DELETE {
		return unsupported_version(headers).unwrap_or_else(|| reply::empty(200));
	}
	let accept = raw_header(headers, header::ACCEPT);
	if !accept.contains("application/json") || !accept.contains("text/event-stream") {
		return transport_error(406, SERVER_ERROR, "Not Acceptable: Client must accept both application/json and text/event-stream");
	}
	if !super::protocol::is_json_content_type(headers) {
		return transport_error(415, SERVER_ERROR, "Unsupported Media Type: Content-Type must be application/json");
	}
	if raw.len() > MAX_BODY_BYTES {
		return transport_error(413, SERVER_ERROR, &format!("Payload Too Large: Request body must not exceed {MAX_BODY_BYTES} bytes"));
	}
	let Ok(body) = gs_json::parse(&reply::body_text(raw)) else {
		return transport_error(400, PARSE_ERROR, "Parse error: Invalid JSON");
	};
	let messages = match body {
		Json::Arr(items) if items.len() > 100 => return transport_error(400, INVALID_REQUEST, "Invalid Request: Batch must not exceed 100 messages"),
		Json::Arr(items) => items,
		one => vec![one],
	};
	if !messages.iter().all(is_message) {
		return transport_error(400, PARSE_ERROR, "Parse error: Invalid JSON-RPC message");
	}
	let initializing = messages.iter().any(|m| is_request(m) && m["method"].as_str() == Some("initialize"));
	if initializing && messages.len() > 1 {
		return transport_error(400, INVALID_REQUEST, "Invalid Request: Only one initialization request is allowed");
	}
	if !initializing && let Some(refused) = unsupported_version(headers) {
		return refused;
	}
	let requests: Vec<&Json> = messages.iter().filter(|m| is_request(m)).collect();
	if requests.is_empty() {
		return reply::empty(202);
	}
	let mut answers = Vec::with_capacity(requests.len());
	for m in requests {
		answers.push(answer(&m["id"], dispatch(exchange, m, false).await));
	}
	let body = if answers.len() == 1 { answers.remove(0) } else { Json::Arr(answers) };
	reply::json(200, &body)
}
