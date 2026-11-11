//! Every message, spelled as it travels.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

/// Server to shell.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum ToShell {
	/// Listening; sent once, right after the bind.
	Ready,
	/// The login token is stored; the shell opens the login URL only after this.
	LoginOk { id: u64 },
	/// Run a demo's HTML and report what went wrong in it.
	Demo { id: u64, html: String, probe: Option<String> },
	/// Snapshot an SVG resvg could not draw, as a PNG of exactly `width` × `height` px.
	Svg { id: u64, svg: String, width: u32, height: u32 },
}

/// Shell to server.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum ToServer {
	/// Accept this one-time login token (64 hex).
	Login { id: u64, token: String },
	DemoDone {
		id: u64,
		#[serde(flatten)]
		outcome: DemoOutcome,
	},
	SvgDone {
		id: u64,
		#[serde(flatten)]
		outcome: SvgOutcome,
	},
}

/// `"result": {…}` or `"error": "…"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DemoOutcome {
	Result(DemoResult),
	Error(String),
}

/// `"png": "<base64>"` or `"error": "…"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SvgOutcome {
	Png(String),
	Error(String),
}

/// What one demo run saw, as the server's demo checks read it.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoResult {
	pub console_errors: Vec<String>,
	pub page_errors: Vec<String>,
	pub failed_requests: Vec<String>,
	/// Absent when no probe ran; a probe that gave `null` is `Some(Value::Null)`.
	#[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "present")]
	pub probe_result: Option<Value>,
	pub ok: bool,
}

/// Keeps a present `null` apart from a missing key.
fn present<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Value>, D::Error> {
	Value::deserialize(d).map(Some)
}

#[cfg(test)]
mod tests {
	use serde_json::json;

	use super::*;

	fn round_trip<T: Serialize + for<'de> Deserialize<'de> + PartialEq + std::fmt::Debug>(msg: T, text: &str) {
		assert_eq!(serde_json::to_string(&msg).unwrap(), text);
		assert_eq!(serde_json::from_str::<T>(text).unwrap(), msg);
	}

	#[test]
	fn server_messages_travel_as_spelled() {
		round_trip(ToShell::Ready, r#"{"t":"ready"}"#);
		round_trip(ToShell::LoginOk { id: 1 }, r#"{"t":"login_ok","id":1}"#);
		round_trip(ToShell::Demo { id: 2, html: "<p>\n</p>".into(), probe: Some("x".into()) }, r#"{"t":"demo","id":2,"html":"<p>\n</p>","probe":"x"}"#);
		round_trip(ToShell::Demo { id: 3, html: String::new(), probe: None }, r#"{"t":"demo","id":3,"html":"","probe":null}"#);
		round_trip(ToShell::Svg { id: 4, svg: "<svg/>".into(), width: 900, height: 700 }, r#"{"t":"svg","id":4,"svg":"<svg/>","width":900,"height":700}"#);
	}

	#[test]
	fn shell_messages_travel_as_spelled() {
		let token = "ab".repeat(32);
		round_trip(ToServer::Login { id: 1, token: token.clone() }, &format!(r#"{{"t":"login","id":1,"token":"{token}"}}"#));
		let probed = DemoResult { console_errors: vec!["boom".into()], probe_result: Some(json!({"n": 1})), ..DemoResult::default() };
		round_trip(
			ToServer::DemoDone { id: 2, outcome: DemoOutcome::Result(probed) },
			r#"{"t":"demo_done","id":2,"result":{"consoleErrors":["boom"],"pageErrors":[],"failedRequests":[],"probeResult":{"n":1},"ok":false}}"#,
		);
		let unprobed = DemoResult { ok: true, ..DemoResult::default() };
		round_trip(ToServer::DemoDone { id: 3, outcome: DemoOutcome::Result(unprobed) }, r#"{"t":"demo_done","id":3,"result":{"consoleErrors":[],"pageErrors":[],"failedRequests":[],"ok":true}}"#);
		let null_probe = DemoResult { probe_result: Some(Value::Null), ok: true, ..DemoResult::default() };
		round_trip(
			ToServer::DemoDone { id: 4, outcome: DemoOutcome::Result(null_probe) },
			r#"{"t":"demo_done","id":4,"result":{"consoleErrors":[],"pageErrors":[],"failedRequests":[],"probeResult":null,"ok":true}}"#,
		);
		round_trip(ToServer::DemoDone { id: 5, outcome: DemoOutcome::Error("no view".into()) }, r#"{"t":"demo_done","id":5,"error":"no view"}"#);
		round_trip(ToServer::SvgDone { id: 6, outcome: SvgOutcome::Png("iVBO".into()) }, r#"{"t":"svg_done","id":6,"png":"iVBO"}"#);
		round_trip(ToServer::SvgDone { id: 7, outcome: SvgOutcome::Error("too big".into()) }, r#"{"t":"svg_done","id":7,"error":"too big"}"#);
	}

	#[test]
	fn unknown_messages_do_not_parse() {
		assert!(serde_json::from_str::<ToServer>(r#"{"t":"hello","id":1}"#).is_err());
		assert!(serde_json::from_str::<ToServer>(r#"{"t":"svg_done","id":1}"#).is_err());
		assert!(serde_json::from_str::<ToShell>(r#"{"id":1}"#).is_err());
	}
}
