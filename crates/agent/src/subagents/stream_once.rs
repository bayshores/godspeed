//! Ported from src/backend/agent/subagents/stream-once.ts: one raw model call for the hand-rolled
//! loops (pdf reader, visual maker). They feed rendered images back between calls, which the
//! agent loop's tool plumbing cannot express. A failed call still reports its usage (it may have
//! cost tokens); an aborted one does not, the same as `run_subagent`.

use gs_base::clock;
use gs_engine::turn::abort::Abort;
use gs_engine::turn::faux::{self, Engine};
use gs_engine::turn::transcript::normalize_context;
use gs_json::{Json, json};

use super::pi_run::RunError;

/// The call's final assistant message. `tools` are the wire declarations (name, description,
/// parameters); the prompt and tools fold into a leading system message.
pub async fn stream_once(
	engine: &Engine,
	system_prompt: &str,
	messages: &[Json],
	tools: &[Json],
	session_id: &str,
	abort: &Abort,
	on_usage: &mut (dyn FnMut(&Json) + Send),
) -> Result<Json, RunError> {
	let context = normalize_context(system_prompt, messages, tools);
	let message = faux::stream(engine, context, Some(session_id.to_owned()), abort, &mut |_| {}).await;
	match message["stopReason"].as_str() {
		Some("aborted") => Err(RunError::Aborted),
		Some("error") => {
			on_usage(&message["usage"]);
			Err(RunError::Failed(message["errorMessage"].as_str().unwrap_or("the model call failed").to_owned()))
		}
		_ => {
			on_usage(&message["usage"]);
			Ok(message)
		}
	}
}

/// A text tool result; each loop decides which of its outputs are errors.
pub fn tool_text(tool_call_id: &Json, tool_name: &Json, value: &str, is_error: bool) -> Json {
	json!({
		"role": "toolResult",
		"toolCallId": tool_call_id.clone(),
		"toolName": tool_name.clone(),
		"content": [{ "type": "text", "text": value }],
		"isError": is_error,
		"timestamp": clock::now_ms(),
	})
}

/// A user message showing the model PNGs after a line of text (the loops' image-in-the-loop).
pub fn png_message(text: &str, pngs: &[&[u8]]) -> Json {
	let mut content = vec![json!({ "type": "text", "text": text })];
	content.extend(pngs.iter().map(|png| json!({ "type": "image", "data": gs_base::base64::encode(png), "mimeType": "image/png" })));
	json!({ "role": "user", "content": content, "timestamp": clock::now_ms() })
}

/// A user text message.
pub fn user_text(text: &str) -> Json {
	json!({ "role": "user", "content": text, "timestamp": clock::now_ms() })
}

/// The assistant message's text blocks, joined (the loops' final answer).
pub fn message_text(message: &Json) -> String {
	message["content"].as_arr().into_iter().flatten().filter(|c| c["type"] == Json::from("text")).filter_map(|c| c["text"].as_str()).collect()
}

#[cfg(test)]
mod tests {
	use std::sync::Arc;

	use gs_engine::turn::faux::{Scripted, faux_model};
	use gs_engine::turn::messages::{faux_assistant_message, text_block};

	use super::*;

	fn engine(script: &Arc<Scripted>) -> Engine {
		Engine { model: faux_model("faux", "faux", "faux-1", "Faux", 128_000.0, 16_000.0), respond: script.clone() }
	}

	#[tokio::test]
	async fn a_reply_reports_its_usage() {
		let script = Scripted::new();
		script.reply(faux_assistant_message(vec![text_block("hi")], "stop"));
		let mut usages = Vec::new();
		let message = stream_once(&engine(&script), "sys", &[json!({ "role": "user", "content": "q", "timestamp": 1 })], &[], "s1", &Abort::new(), &mut |u| usages.push(u.clone())).await.unwrap();
		assert_eq!(message_text(&message), "hi");
		assert_eq!(usages.len(), 1);
		assert!(usages[0]["input"].as_f64().unwrap() > 0.0);
	}

	#[tokio::test]
	async fn a_failed_call_throws_its_message_with_usage() {
		let script = Scripted::new();
		script.run(|_| Box::pin(async { Err("provider down".to_owned()) }));
		let mut calls = 0;
		let err = stream_once(&engine(&script), "sys", &[], &[], "s1", &Abort::new(), &mut |_| calls += 1).await.unwrap_err();
		assert_eq!(err, RunError::Failed("provider down".to_owned()));
		assert_eq!(calls, 1);
	}

	#[tokio::test]
	async fn an_aborted_call_reports_no_usage() {
		let script = Scripted::new();
		script.reply(faux_assistant_message(vec![text_block("late")], "stop"));
		let abort = Abort::new();
		abort.abort();
		let mut calls = 0;
		let err = stream_once(&engine(&script), "sys", &[], &[], "s1", &abort, &mut |_| calls += 1).await.unwrap_err();
		assert_eq!(err, RunError::Aborted);
		assert_eq!(calls, 0);
	}

	#[test]
	fn pngs_go_out_as_base64_images() {
		let m = png_message("Look:", &[b"ab", b"c"]);
		assert_eq!(gs_json::stringify(&m["content"]), r#"[{"type":"text","text":"Look:"},{"type":"image","data":"YWI=","mimeType":"image/png"},{"type":"image","data":"Yw==","mimeType":"image/png"}]"#);
	}

	#[test]
	fn tool_text_is_a_tool_result_message() {
		let m = tool_text(&"c1".into(), &"pdf_info".into(), "ERROR: x", true);
		assert_eq!(gs_json::stringify(&m["content"]), r#"[{"type":"text","text":"ERROR: x"}]"#);
		assert_eq!(m["isError"], Json::from(true));
	}
}
