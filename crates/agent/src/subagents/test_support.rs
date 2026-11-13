//! What the background-job tests share: a bridge with marks in memory and a scripted engine.

use std::path::Path;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_base::events::Events;
use gs_core::records::agent_seen::{SeenMark, SeenStore};
use gs_engine::bridge::Bridge;
use gs_engine::turn::faux::{Engine, Scripted, faux_model};
use gs_engine::turn::messages::{faux_assistant_message, text_block};
use gs_json::{Json, json};
use gs_pdf::RenderedPdfPage;
use parking_lot::Mutex;

use super::headless::{DemoRunResult, HeadlessApi};
use super::pi_run::JobAgentOptions;

/// No saved marks: the background jobs never read them.
struct NoMarks;

impl SeenStore for NoMarks {
	fn get(&self, _agent: &str, _conversation: &str) -> Option<SeenMark> {
		None
	}
	fn set(&self, _agent: &str, _conversation: &str, _mark: &SeenMark) {}
	fn forget_agent(&self, _agent: &str) {}
}

pub fn bridge() -> Bridge {
	Bridge::new(&Events::new(), Arc::new(NoMarks))
}

/// The engine the jobs run on in tests, with the outside agent's provider stamp.
pub fn faux_engine(script: &Arc<Scripted>) -> Engine {
	Engine { model: faux_model("godspeed-agent", "agent", "outside-agent", "Outside agent (MCP)", 200_000.0, 32_000.0), respond: script.clone() }
}

pub fn tool_call(id: &str, name: &str, arguments: Json) -> Json {
	json!({ "type": "toolCall", "id": id, "name": name, "arguments": arguments })
}

/// An assistant reply that calls tools.
pub fn calls(list: &[(&str, Json)]) -> Json {
	let content = list.iter().enumerate().map(|(i, (name, args))| tool_call(&format!("call_{i}"), name, args.clone())).collect();
	faux_assistant_message(content, "toolUse")
}

/// An assistant reply with text only.
pub fn says(text: &str) -> Json {
	faux_assistant_message(vec![text_block(text)], "stop")
}

/// Queues a reply and keeps the request's messages (what the model was shown).
pub fn reply_seeing(script: &Arc<Scripted>, reply: Json, seen: &Arc<Mutex<Vec<Vec<Json>>>>) {
	let seen = seen.clone();
	script.run(move |request| {
		seen.lock().push(request.messages);
		Box::pin(async move { Ok(reply) })
	});
}

/// A headless stand-in: SVGs with "broken" in them fail to render, demos answer `demo`.
pub struct FakeHeadless {
	pub unavailable: Option<String>,
	pub demo: Result<DemoRunResult, String>,
	pub demo_runs: Mutex<Vec<(String, Option<String>)>>,
}

impl FakeHeadless {
	pub fn new(demo: Result<DemoRunResult, String>) -> Arc<FakeHeadless> {
		Arc::new(FakeHeadless { unavailable: None, demo, demo_runs: Mutex::new(Vec::new()) })
	}
}

pub const FAKE_PNG: &[u8] = b"\x89PNG fake";

impl HeadlessApi for FakeHeadless {
	fn unavailable_reason(&self) -> Option<String> {
		self.unavailable.clone()
	}
	fn run_demo<'a>(&'a self, html: &'a str, probe: Option<&'a str>) -> BoxFuture<'a, Result<DemoRunResult, String>> {
		self.demo_runs.lock().push((html.to_owned(), probe.map(str::to_owned)));
		Box::pin(async { self.demo.clone() })
	}
	fn render_svg<'a>(&'a self, svg: &'a str) -> BoxFuture<'a, Result<Vec<u8>, String>> {
		Box::pin(async move { if svg.contains("broken") { Err("bad svg".to_owned()) } else { Ok(FAKE_PNG.to_vec()) } })
	}
	fn render_pdf_pages<'a>(&'a self, _pdf_path: &'a Path, pages: &'a [i64], _dpi: Option<f64>) -> BoxFuture<'a, Result<Vec<RenderedPdfPage>, String>> {
		Box::pin(async move { Ok(pages.iter().filter(|p| (1..=3).contains(*p)).map(|&p| RenderedPdfPage { page: p as u32, png: FAKE_PNG.to_vec() }).collect()) })
	}
}

/// Job agent options on a scripted engine, recording activity lines.
pub fn job_agent_options(script: &Arc<Scripted>, headless: Arc<dyn HeadlessApi>) -> (JobAgentOptions, Arc<Mutex<Vec<String>>>) {
	let lines = Arc::new(Mutex::new(Vec::new()));
	let opts = JobAgentOptions {
		bridge: bridge(),
		engine: Some(faux_engine(script)),
		headless,
		abort_signal: None,
		on_usage: None,
		on_activity: Some(Arc::new({
			let lines = lines.clone();
			move |line: &str| lines.lock().push(line.to_owned())
		})),
	};
	(opts, lines)
}

/// The text of every tool result in a request, in order.
pub fn result_texts(messages: &[Json]) -> Vec<String> {
	messages.iter().filter(|m| m["role"] == Json::from("toolResult")).map(|m| m["content"][0]["text"].as_str().unwrap_or_default().to_owned()).collect()
}
