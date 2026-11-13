//! Parity with the TypeScript visual maker and demo builder (tests/golden/subagents.json, recorded from the Node server): each case's `config` (a model script and the
//! stand-in headless engine's answers) is replayed on the Rust loops, which must give the same
//! result, show the model the same tool answers and messages, and write the same activity lines.

use std::path::Path;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_agent::subagents::demo_builder::run_demo_builder;
use gs_agent::subagents::headless::{DemoRunResult, HeadlessApi};
use gs_agent::subagents::pi_run::HelperOptions;
use gs_agent::subagents::visual_maker::run_visual_maker;
use gs_base::events::Events;
use gs_core::records::agent_seen::{SeenMark, SeenStore};
use gs_engine::bridge::Bridge;
use gs_engine::turn::faux::{Engine, Scripted, faux_model};
use gs_engine::turn::messages::{faux_assistant_message, text_block};
use gs_json::{Json, json, parse};
use gs_pdf::RenderedPdfPage;
use parking_lot::Mutex;

struct NoMarks;

impl SeenStore for NoMarks {
	fn get(&self, _agent: &str, _conversation: &str) -> Option<SeenMark> {
		None
	}
	fn set(&self, _agent: &str, _conversation: &str, _mark: &SeenMark) {}
	fn forget_agent(&self, _agent: &str) {}
}

/// The golden's stand-in: renders fail for SVGs with "broken" in them, demo runs answer in turn.
struct Stand {
	unavailable: Option<String>,
	demo: Vec<Json>,
	calls: Mutex<usize>,
}

fn strings(v: &Json) -> Vec<String> {
	v.as_arr().into_iter().flatten().map(|s| s.as_str().unwrap().to_owned()).collect()
}

impl HeadlessApi for Stand {
	fn unavailable_reason(&self) -> Option<String> {
		self.unavailable.clone()
	}
	fn run_demo<'a>(&'a self, _html: &'a str, _probe: Option<&'a str>) -> BoxFuture<'a, Result<DemoRunResult, String>> {
		let n = {
			let mut calls = self.calls.lock();
			*calls += 1;
			*calls - 1
		};
		let next = self.demo[n.min(self.demo.len() - 1)].clone();
		Box::pin(async move {
			if let Some(message) = next["throws"].as_str() {
				return Err(message.to_owned());
			}
			let r = &next["result"];
			Ok(DemoRunResult {
				console_errors: strings(&r["consoleErrors"]),
				page_errors: strings(&r["pageErrors"]),
				failed_requests: strings(&r["failedRequests"]),
				probe_result: r.get("probeResult").cloned(),
				ok: r["ok"] == Json::from(true),
			})
		})
	}
	fn render_svg<'a>(&'a self, svg: &'a str) -> BoxFuture<'a, Result<Vec<u8>, String>> {
		Box::pin(async move { if svg.contains("broken") { Err("bad svg".to_owned()) } else { Ok(b"png".to_vec()) } })
	}
	fn render_pdf_pages<'a>(&'a self, _pdf_path: &'a Path, _pages: &'a [i64], _dpi: Option<f64>) -> BoxFuture<'a, Result<Vec<RenderedPdfPage>, String>> {
		Box::pin(async { Ok(Vec::new()) })
	}
}

/// The case's script: each step's tool calls (ids `call_<step>_<n>`) or text.
fn script(steps: &Json, last: &Arc<Mutex<Vec<Json>>>) -> Arc<Scripted> {
	let script = Scripted::new();
	for (i, step) in steps.as_arr().into_iter().flatten().enumerate() {
		let reply = match step.get("calls") {
			Some(calls) => {
				let content = calls.as_arr().unwrap().iter().enumerate().map(|(k, c)| json!({ "type": "toolCall", "id": format!("call_{i}_{k}"), "name": c[0].clone(), "arguments": c[1].clone() })).collect();
				faux_assistant_message(content, "toolUse")
			}
			None => faux_assistant_message(vec![text_block(step["text"].as_str().unwrap())], "stop"),
		};
		let last = last.clone();
		script.run(move |request| {
			*last.lock() = request.messages;
			Box::pin(async move { Ok(reply) })
		});
	}
	script
}

/// What the model was shown: tool answers and user messages, pictures as "[image]".
fn shown(messages: &[Json]) -> Json {
	let out = messages.iter().filter(|m| m["role"] == Json::from("toolResult") || m["role"] == Json::from("user")).map(|m| {
		let text = match &m["content"] {
			Json::Str(s) => s.clone(),
			parts => parts.as_arr().unwrap().iter().map(|p| if p["type"] == Json::from("text") { p["text"].as_str().unwrap().to_owned() } else { "[image]".to_owned() }).collect::<Vec<_>>().join("\n"),
		};
		if m["role"] == Json::from("toolResult") { json!({ "tool": m["toolName"].clone(), "isError": m["isError"].clone(), "text": text }) } else { json!({ "user": text }) }
	});
	Json::Arr(out.collect())
}

#[tokio::test]
async fn the_loops_match_the_typescript() {
	let golden = parse(&std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden/subagents.json")).unwrap()).unwrap();
	for case in golden.as_arr().unwrap() {
		let name = case["name"].as_str().unwrap();
		let want = &case["output"];
		let config = &want["config"];
		let last = Arc::new(Mutex::new(Vec::new()));
		let script = script(&config["steps"], &last);
		let activity = Arc::new(Mutex::new(Vec::<String>::new()));
		let stand = Stand { unavailable: config["unavailable"].as_str().map(str::to_owned), demo: config["demo"].as_arr().cloned().unwrap_or_default(), calls: Mutex::new(0) };
		let opts = HelperOptions {
			bridge: Bridge::new(&Events::new(), Arc::new(NoMarks)),
			engine: Some(Engine { model: faux_model("faux", "faux", "faux-1", "Faux", 128_000.0, 16_000.0), respond: script }),
			headless: Arc::new(stand),
			abort_signal: None,
			on_usage: None,
			on_activity: Some(Arc::new({
				let activity = activity.clone();
				move |line: &str| activity.lock().push(line.to_owned())
			})),
		};
		let brief = config["brief"].as_str().unwrap();
		let result = match config["kind"].as_str().unwrap() {
			"visual" => run_visual_maker(brief, &opts).await,
			_ => run_demo_builder(config["title"].as_str().unwrap_or_default(), brief, &opts).await,
		};
		assert_eq!(result, want["result"], "{name}: result");
		assert_eq!(shown(&last.lock()), want["shown"], "{name}: what the model was shown");
		let activity = Json::Arr(activity.lock().iter().map(|l| Json::from(l.as_str())).collect());
		assert_eq!(activity, want["activity"], "{name}: activity lines");
	}
}
