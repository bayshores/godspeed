//! The MCP SDK's entry ladder (@modelcontextprotocol/server): which era a POST body belongs to,
//! the per-request `_meta` envelope of 2026-07-28, the standard request headers, and the
//! JSON-RPC answers with Node's key orders:
//! success `{result, jsonrpc, id}`, dispatch error `{jsonrpc, id, error}`, entry rejection
//! `{jsonrpc, error, id}`.

use axum::http::HeaderMap;
use gs_json::{Json, Obj, json};

pub const MODERN: &str = "2026-07-28";
pub const LEGACY_VERSIONS: [&str; 5] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];
pub const VERSION_KEY: &str = "io.modelcontextprotocol/protocolVersion";
const CAPS_KEY: &str = "io.modelcontextprotocol/clientCapabilities";
pub const CLIENT_INFO_KEY: &str = "io.modelcontextprotocol/clientInfo";

pub const INVALID_REQUEST: i64 = -32600;
pub const METHOD_NOT_FOUND: i64 = -32601;
pub const INVALID_PARAMS: i64 = -32602;
pub const PARSE_ERROR: i64 = -32700;
pub const SERVER_ERROR: i64 = -32000;
const HEADER_MISMATCH: i64 = -32020;
const UNSUPPORTED_VERSION: i64 = -32022;

/// The SDK reads at most this much of a body (4 MiB).
pub const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;

/// An answer before any method runs: HTTP status and the JSON-RPC error.
#[derive(Debug, PartialEq)]
pub struct Rejection {
	pub status: u16,
	pub code: i64,
	pub message: String,
	pub data: Option<Json>,
	pub id: Json,
}

impl Rejection {
	pub fn new(status: u16, code: i64, message: impl Into<String>) -> Rejection {
		Rejection { status, code, message: message.into(), data: None, id: Json::Null }
	}

	/// `{jsonrpc, error: {code, message, data?}, id}`.
	pub fn body(&self) -> Json {
		let mut error = json!({ "code": self.code, "message": self.message });
		if let (Some(data), Some(e)) = (&self.data, error.as_obj_mut()) {
			e.insert("data", data.clone());
		}
		json!({ "jsonrpc": "2.0", "error": error, "id": self.id })
	}
}

/// A dispatched request's answer.
pub fn answer(id: &Json, outcome: Result<Json, (i64, String)>) -> Json {
	match outcome {
		Ok(result) => json!({ "result": result, "jsonrpc": "2.0", "id": id }),
		Err((code, message)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
	}
}

/// Where the entry sends a POST body.
#[derive(Debug, PartialEq)]
pub enum Route {
	Legacy,
	/// The 2026-07-28 era; `revision` is the version the envelope (or header) names.
	Modern { message: Json, revision: Option<String> },
	Reject(Rejection),
}

fn has_jsonrpc(v: &Json) -> bool {
	v["jsonrpc"].as_str() == Some("2.0")
}

fn params_ok(v: &Json) -> bool {
	v.get("params").is_none_or(|p| p.as_obj().is_some())
}

pub fn is_request(v: &Json) -> bool {
	has_jsonrpc(v) && v["method"].as_str().is_some() && matches!(v.get("id"), Some(Json::Str(_) | Json::Num(_))) && params_ok(v)
}

pub fn is_notification(v: &Json) -> bool {
	has_jsonrpc(v) && v["method"].as_str().is_some() && v.get("id").is_none() && params_ok(v)
}

pub fn is_response(v: &Json) -> bool {
	has_jsonrpc(v) && v.get("id").is_some() && (v.get("result").is_some() || v["error"].as_obj().is_some())
}

pub fn is_message(v: &Json) -> bool {
	is_request(v) || is_notification(v) || is_response(v)
}

pub fn meta_of(v: &Json) -> Option<&Obj> {
	v["params"]["_meta"].as_obj()
}

fn claimed_version(v: &Json) -> Option<String> {
	meta_of(v)?.get(VERSION_KEY)?.as_str().map(str::to_owned)
}

fn has_claim(v: &Json) -> bool {
	meta_of(v).is_some_and(|m| m.contains_key(VERSION_KEY))
}

fn is_modern(version: &str) -> bool {
	version >= MODERN
}

/// zod's name for a value's type.
fn kind(v: &Json) -> &'static str {
	match v {
		Json::Null => "null",
		Json::Bool(_) => "boolean",
		Json::Num(_) => "number",
		Json::Str(_) => "string",
		Json::Arr(_) => "array",
		Json::Obj(_) => "object",
	}
}

/// The envelope's first problem: a required key missing, then a wrong type.
fn envelope_issue(meta: &Obj) -> Option<(String, String)> {
	for key in [VERSION_KEY, CAPS_KEY] {
		if !meta.contains_key(key) {
			return Some((key.to_owned(), "missing".to_owned()));
		}
	}
	let (version, caps) = (&meta.get(VERSION_KEY).cloned().unwrap_or_default(), &meta.get(CAPS_KEY).cloned().unwrap_or_default());
	if version.as_str().is_none() {
		return Some((VERSION_KEY.to_owned(), format!("Invalid input: expected string, received {}", kind(version))));
	}
	if caps.as_obj().is_none() {
		return Some((CAPS_KEY.to_owned(), format!("Invalid input: expected object, received {}", kind(caps))));
	}
	None
}

fn valid_modern_claim(v: &Json) -> bool {
	claimed_version(v).is_some_and(|c| is_modern(&c)) && meta_of(v).is_some_and(|m| envelope_issue(m).is_none())
}

/// A header with HTTP's optional whitespace stripped.
pub fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
	headers.get(name).and_then(|v| v.to_str().ok()).map(|s| s.trim_matches([' ', '\t']))
}

/// The id an entry rejection may echo: a request's string or number id, else null.
pub fn echoable_id(body: &Json) -> Json {
	match (&body["method"], body.get("id")) {
		(Json::Str(_), Some(id @ (Json::Str(_) | Json::Num(_)))) => id.clone(),
		_ => Json::Null,
	}
}

fn mismatch(header: &str, body: String, id: Json) -> Rejection {
	Rejection {
		status: 400,
		code: HEADER_MISMATCH,
		message: format!("Bad Request: the request headers and body disagree: {body}"),
		data: Some(json!({ "mismatch": { "header": header, "body": body } })),
		id,
	}
}

fn invalid_request(message: &str, id: Json) -> Route {
	Route::Reject(Rejection { id, ..Rejection::new(400, INVALID_REQUEST, message) })
}

/// The SDK's `classifyInboundRequest` for a POST with a JSON body.
pub fn classify(body: &Json, headers: &HeaderMap) -> Route {
	let version_header = header(headers, "mcp-protocol-version");
	let method_header = header(headers, "mcp-method");
	let header_modern = version_header.is_some_and(is_modern);
	if let Json::Arr(items) = body {
		if items.is_empty() {
			return invalid_request("Bad Request: empty JSON-RPC batch", Json::Null);
		}
		for item in items {
			if has_claim(item) {
				return invalid_request("Bad Request: JSON-RPC batches may not contain requests for protocol revision 2026-07-28 or later", Json::Null);
			}
			if !is_message(item) {
				return invalid_request("Bad Request: JSON-RPC batch contains an invalid message", Json::Null);
			}
		}
		return Route::Legacy;
	}
	if is_response(body) {
		return Route::Legacy;
	}
	let id = echoable_id(body);
	let method = body["method"].as_str().unwrap_or_default();
	if body.as_obj().is_some() && is_request(body) {
		if method == "initialize" && !valid_modern_claim(body) {
			if let Some(h) = version_header.filter(|_| header_modern) {
				return Route::Reject(mismatch(h, "an initialize request (legacy handshake) was sent with a modern MCP-Protocol-Version header".into(), id));
			}
			return Route::Legacy;
		}
		if has_claim(body) {
			if let Some((key, problem)) = meta_of(body).and_then(envelope_issue) {
				let message = format!("Invalid _meta envelope for protocol revision 2026-07-28: {key}: {problem}");
				return Route::Reject(Rejection { status: 400, code: INVALID_PARAMS, message, data: Some(json!({ "envelope": { "key": key, "problem": problem } })), id });
			}
			let claimed = claimed_version(body);
			if let (Some(h), Some(c)) = (version_header, &claimed)
				&& h != c
			{
				return Route::Reject(mismatch(h, format!("the body envelope names protocol version {c} but the MCP-Protocol-Version header names {h}"), id));
			}
			if let Some(h) = method_header
				&& h != method
			{
				return Route::Reject(mismatch(h, format!("the body names method {method} but the Mcp-Method header names {h}"), id));
			}
			return Route::Modern { message: body.clone(), revision: claimed };
		}
		if let Some(h) = version_header.filter(|_| header_modern) {
			let missing: Vec<&str> = match meta_of(body) {
				None => vec!["_meta"],
				Some(m) => {
					let absent: Vec<&str> = [VERSION_KEY, CAPS_KEY].into_iter().filter(|k| !m.contains_key(k)).collect();
					if absent.is_empty() { vec![VERSION_KEY] } else { absent }
				}
			};
			let message = format!("Invalid params: the MCP-Protocol-Version header names protocol revision {h}, but the request is missing the required per-request envelope key(s): {}", missing.join(", "));
			return Route::Reject(Rejection { status: 400, code: INVALID_PARAMS, message, data: Some(json!({ "envelope": { "missing": missing } })), id });
		}
		return Route::Legacy;
	}
	if body.as_obj().is_some() && is_notification(body) {
		return classify_notification(body, method, version_header, method_header, header_modern, id);
	}
	invalid_request("Bad Request: the request body is not a valid JSON-RPC message", id)
}

fn classify_notification(body: &Json, method: &str, version_header: Option<&str>, method_header: Option<&str>, header_modern: bool, id: Json) -> Route {
	let method_mismatch = |h: &str| Route::Reject(mismatch(h, format!("the notification body names method {method} but the Mcp-Method header names {h}"), id.clone()));
	if has_claim(body) {
		let Some(claimed) = claimed_version(body) else {
			let problem = meta_of(body).and_then(envelope_issue).filter(|(key, _)| key == VERSION_KEY).map_or_else(|| "expected a protocol version string".to_owned(), |(_, p)| p);
			let message = format!("Invalid _meta envelope for protocol revision 2026-07-28: {VERSION_KEY}: {problem}");
			return Route::Reject(Rejection { status: 400, code: INVALID_PARAMS, message, data: Some(json!({ "envelope": { "key": VERSION_KEY, "problem": problem } })), id });
		};
		if let Some(h) = version_header
			&& h != claimed
		{
			return Route::Reject(mismatch(h, format!("the notification envelope names protocol version {claimed} but the MCP-Protocol-Version header names {h}"), id));
		}
		if is_modern(&claimed)
			&& let Some(h) = method_header.filter(|h| *h != method)
		{
			return method_mismatch(h);
		}
		return Route::Modern { message: body.clone(), revision: Some(claimed) };
	}
	if header_modern {
		if let Some(h) = method_header.filter(|h| *h != method) {
			return method_mismatch(h);
		}
		return Route::Modern { message: body.clone(), revision: version_header.map(str::to_owned) };
	}
	Route::Legacy
}

/// The modern era's checks before a method runs: the version it serves, then the standard
/// headers a request must carry (SEP-2243).
pub fn check_modern(message: &Json, revision: Option<&str>, headers: &HeaderMap) -> Option<Rejection> {
	let id = echoable_id(message);
	if revision != Some(MODERN) {
		let requested = revision.unwrap_or("unknown");
		return Some(Rejection {
			status: 400,
			code: UNSUPPORTED_VERSION,
			message: format!("Unsupported protocol version: {requested}"),
			data: Some(json!({ "supported": [MODERN], "requested": requested })),
			id,
		});
	}
	if !is_request(message) {
		return None;
	}
	let method = message["method"].as_str().unwrap_or_default();
	if header(headers, "mcp-protocol-version").is_none() {
		let body = format!("the body envelope names protocol version {MODERN} but the required MCP-Protocol-Version header is absent");
		return Some(mismatch("(missing)", body, id));
	}
	if header(headers, "mcp-method").is_none() {
		return Some(mismatch("(missing)", format!("the body names method {method} but the required Mcp-Method header is absent"), id));
	}
	let field = match method {
		"tools/call" | "prompts/get" => "name",
		"resources/read" => "uri",
		"tasks/get" | "tasks/update" | "tasks/cancel" => "taskId",
		_ => return None,
	};
	let body_value = message["params"][field].as_str();
	match (header(headers, "mcp-name"), body_value) {
		(None, Some(b)) => Some(mismatch("(missing)", format!("the body carries params.{field}=\"{b}\" but the required Mcp-Name header is absent"), id)),
		(Some(h), Some(b)) if h != b => Some(mismatch(h, format!("the body carries params.{field}=\"{b}\" but the Mcp-Name header names \"{h}\""), id)),
		_ => None,
	}
}

/// `isJsonContentType`: the media type is application/json, parameters ignored.
pub fn is_json_content_type(headers: &HeaderMap) -> bool {
	headers
		.get("content-type")
		.and_then(|v| v.to_str().ok())
		.is_some_and(|c| c.split(';').next().unwrap_or_default().trim_matches([' ', '\t']).eq_ignore_ascii_case("application/json"))
}

#[cfg(test)]
mod tests {
	use axum::http::HeaderValue;

	use super::*;

	fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
		let mut h = HeaderMap::new();
		for (k, v) in pairs {
			h.insert(*k, HeaderValue::from_str(v).unwrap());
		}
		h
	}

	fn modern(method: &str) -> Json {
		json!({ "jsonrpc": "2.0", "id": 4, "method": method, "params": { "_meta": { VERSION_KEY: MODERN, CAPS_KEY: {} } } })
	}

	#[test]
	fn eras_follow_the_body() {
		let legacy = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" });
		assert_eq!(classify(&legacy, &HeaderMap::new()), Route::Legacy);
		let init = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} });
		assert_eq!(classify(&init, &HeaderMap::new()), Route::Legacy);
		let Route::Modern { revision, .. } = classify(&modern("tools/list"), &HeaderMap::new()) else { panic!() };
		assert_eq!(revision.as_deref(), Some(MODERN));
		assert_eq!(classify(&json!([]), &HeaderMap::new()), invalid_request("Bad Request: empty JSON-RPC batch", Json::Null));
	}

	#[test]
	fn header_and_body_must_agree() {
		let Route::Reject(r) = classify(&modern("tools/list"), &headers(&[("mcp-protocol-version", "2025-06-18")])) else { panic!() };
		assert_eq!(r.code, HEADER_MISMATCH);
		assert_eq!(
			gs_json::stringify(&r.body()),
			r#"{"jsonrpc":"2.0","error":{"code":-32020,"message":"Bad Request: the request headers and body disagree: the body envelope names protocol version 2026-07-28 but the MCP-Protocol-Version header names 2025-06-18","data":{"mismatch":{"header":"2025-06-18","body":"the body envelope names protocol version 2026-07-28 but the MCP-Protocol-Version header names 2025-06-18"}}},"id":4}"#
		);
		let bare = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" });
		let Route::Reject(r) = classify(&bare, &headers(&[("mcp-protocol-version", MODERN)])) else { panic!() };
		assert_eq!(r.data, Some(json!({ "envelope": { "missing": ["_meta"] } })));
	}

	#[test]
	fn modern_requests_need_their_headers() {
		let call = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "x" } });
		let full = headers(&[("mcp-protocol-version", MODERN), ("mcp-method", "tools/call"), ("mcp-name", "x")]);
		assert_eq!(check_modern(&call, Some(MODERN), &full), None);
		let r = check_modern(&call, Some("2099-01-01"), &full).unwrap();
		assert_eq!(r.message, "Unsupported protocol version: 2099-01-01");
		let r = check_modern(&call, Some(MODERN), &headers(&[("mcp-protocol-version", MODERN), ("mcp-method", "tools/call")])).unwrap();
		assert!(r.message.ends_with("the body carries params.name=\"x\" but the required Mcp-Name header is absent"));
	}

	#[test]
	fn answers_keep_node_key_order() {
		assert_eq!(gs_json::stringify(&answer(&json!(1), Ok(json!({})))), r#"{"result":{},"jsonrpc":"2.0","id":1}"#);
		assert_eq!(gs_json::stringify(&answer(&json!("a"), Err((METHOD_NOT_FOUND, "Method not found".into())))), r#"{"jsonrpc":"2.0","id":"a","error":{"code":-32601,"message":"Method not found"}}"#);
	}
}
