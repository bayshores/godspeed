//! JSON-RPC over lines, as `codex app-server` speaks it (no `"jsonrpc"` field): ids for our
//! requests and the answers waiting on them, and the requests and notifications the agent sends.

use std::collections::HashMap;

use gs_json::{Json, json, stringify};
use parking_lot::Mutex;
use tokio::sync::{mpsc, oneshot};

/// What the agent sent that is not an answer to us.
#[derive(Debug, PartialEq)]
pub enum Incoming {
	Request { id: Json, method: String, params: Json },
	Notification { method: String, params: Json },
}

/// Method not found: a request this side does not handle.
pub const UNKNOWN_METHOD: i64 = -32601;

type Answer = oneshot::Sender<Result<Json, String>>;

pub struct Rpc {
	out: mpsc::UnboundedSender<String>,
	/// None once the connection has closed, so no request waits on an answer that cannot come.
	pending: Mutex<Option<HashMap<i64, Answer>>>,
	next: Mutex<i64>,
}

impl Rpc {
	/// `out` takes each line to write.
	pub fn new(out: mpsc::UnboundedSender<String>) -> Rpc {
		Rpc { out, pending: Mutex::new(Some(HashMap::new())), next: Mutex::new(1) }
	}

	/// Sends a request and waits for its result, or the error the agent answered.
	pub async fn request(&self, method: &str, params: Json) -> Result<Json, String> {
		let (tx, rx) = oneshot::channel();
		let id = {
			let mut next = self.next.lock();
			*next += 1;
			*next - 1
		};
		{
			let mut pending = self.pending.lock();
			let Some(pending) = pending.as_mut() else { return Err(closed(method)) };
			pending.insert(id, tx);
		}
		self.write(&json!({ "id": id, "method": method, "params": params }));
		rx.await.unwrap_or_else(|_| Err(closed(method)))
	}

	pub fn notify(&self, method: &str, params: Option<Json>) {
		let mut message = json!({ "method": method });
		if let Some(params) = params {
			message.set("params", params);
		}
		self.write(&message);
	}

	pub fn respond(&self, id: Json, result: Json) {
		self.write(&json!({ "id": id, "result": result }));
	}

	pub fn respond_error(&self, id: Json, code: i64, message: &str) {
		self.write(&json!({ "id": id, "error": { "code": code, "message": message } }));
	}

	/// Reads one line from the agent: an answer settles its request and gives None.
	pub fn take(&self, line: &str) -> Option<Incoming> {
		let message = match gs_json::parse(line) {
			Ok(message) => message,
			Err(err) => {
				eprintln!("[jsonrpc] a line that is not JSON ({err}): {}", line.chars().take(200).collect::<String>());
				return None;
			}
		};
		let method = message["method"].as_str().map(str::to_owned);
		let id = message.get("id").cloned();
		match (method, id) {
			(Some(method), Some(id)) => Some(Incoming::Request { id, method, params: message["params"].clone() }),
			(Some(method), None) => Some(Incoming::Notification { method, params: message["params"].clone() }),
			(None, Some(id)) => {
				let waiting = id.as_i64().and_then(|id| self.pending.lock().as_mut().and_then(|pending| pending.remove(&id)));
				match waiting {
					Some(answer) => {
						let result = if message["error"].is_null() { Ok(message["result"].clone()) } else { Err(error_text(&message["error"])) };
						let _ = answer.send(result);
					}
					None => eprintln!("[jsonrpc] an answer to no request: {}", stringify(&id)),
				}
				None
			}
			(None, None) => {
				eprintln!("[jsonrpc] a message with neither method nor id: {}", line.chars().take(200).collect::<String>());
				None
			}
		}
	}

	/// The connection ended: every request still waiting fails, and later ones fail at once.
	pub fn close(&self) {
		self.pending.lock().take();
	}

	fn write(&self, message: &Json) {
		// The writer is gone only once the connection has ended, which the reader reports.
		let _ = self.out.send(stringify(message));
	}
}

fn closed(method: &str) -> String {
	format!("{method}: the agent's connection closed")
}

fn error_text(error: &Json) -> String {
	let message = error["message"].as_str().map_or_else(|| stringify(error), str::to_owned);
	match error["code"].as_i64() {
		Some(code) => format!("{message} ({code})"),
		None => message,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn rpc() -> (std::sync::Arc<Rpc>, mpsc::UnboundedReceiver<String>) {
		let (tx, rx) = mpsc::unbounded_channel();
		(std::sync::Arc::new(Rpc::new(tx)), rx)
	}

	#[tokio::test]
	async fn a_request_gets_its_own_answer_by_id() {
		let (rpc, mut out) = rpc();
		let first = tokio::join!(rpc.request("a", json!({})), async {
			let sent = gs_json::parse(&out.recv().await.unwrap()).unwrap();
			assert_eq!(sent, json!({ "id": 1, "method": "a", "params": {} }));
			assert_eq!(rpc.take(r#"{"id":7,"result":"stray"}"#), None);
			assert_eq!(rpc.take(r#"{"id":1,"result":{"ok":true}}"#), None);
		});
		assert_eq!(first.0, Ok(json!({ "ok": true })));
		let second = tokio::join!(rpc.request("b", Json::Null), async {
			out.recv().await.unwrap();
			rpc.take(r#"{"id":2,"error":{"code":-32600,"message":"bad"}}"#);
		});
		assert_eq!(second.0, Err("bad (-32600)".to_owned()));
	}

	#[test]
	fn requests_and_notifications_from_the_agent_are_told_apart() {
		let (rpc, _out) = rpc();
		assert_eq!(rpc.take(r#"{"id":"x","method":"item/tool/call","params":{"tool":"quiz"}}"#), Some(Incoming::Request { id: json!("x"), method: "item/tool/call".into(), params: json!({ "tool": "quiz" }) }));
		assert_eq!(rpc.take(r#"{"method":"turn/started","params":{}}"#), Some(Incoming::Notification { method: "turn/started".into(), params: json!({}) }));
		assert_eq!(rpc.take("not json"), None);
	}

	#[tokio::test]
	async fn a_closed_connection_fails_waiting_and_later_requests() {
		let (rpc, mut out) = rpc();
		let waiting = tokio::join!(rpc.request("a", Json::Null), async {
			out.recv().await.unwrap();
			rpc.close();
		});
		assert_eq!(waiting.0, Err("a: the agent's connection closed".to_owned()));
		assert_eq!(rpc.request("b", Json::Null).await, Err("b: the agent's connection closed".to_owned()));
	}

	#[test]
	fn answers_and_notes_are_written_as_lines() {
		let (rpc, mut out) = rpc();
		rpc.respond(json!(3), json!({ "decision": "accept" }));
		rpc.respond_error(json!("r"), UNKNOWN_METHOD, "not handled");
		rpc.notify("initialized", None);
		assert_eq!(out.try_recv().unwrap(), r#"{"id":3,"result":{"decision":"accept"}}"#);
		assert_eq!(out.try_recv().unwrap(), r#"{"id":"r","error":{"code":-32601,"message":"not handled"}}"#);
		assert_eq!(out.try_recv().unwrap(), r#"{"method":"initialized"}"#);
	}
}
