//! The demo builder against tests/golden/subagents.json (first recorded from the Node server):
//! each case's `config` (the agent's turn and the stand-in headless engine's answers) is played on
//! a stand-in agent, which must give the same result, send the agent the same input and tool
//! answers, and write the same activity lines. `GS_RECORD_GOLDEN=1 cargo test -p gs-agent --test
//! subagents_golden` records the outputs again.

use std::path::Path;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_agent::subagents::demo_builder::run_demo_builder;
use gs_agent::subagents::headless::{DemoRunResult, HeadlessApi};
use gs_agent::subagents::job_agent::{JobAgent, Priority};
use gs_agent::subagents::pi_run::JobAgentOptions;
use gs_engine::turn::job_session::{Finished, OneOff, RunError, run_once};
use gs_json::{Json, json, parse, stringify_pretty};
use gs_pdf::RenderedPdfPage;
use gs_runtime::fake::{FakeAgent, FakeStep};
use parking_lot::Mutex;

const GOLDEN: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/subagents.json");

/// Jobs straight on the stand-in agent.
struct StandIn(FakeAgent);

impl JobAgent for StandIn {
	fn run<'a>(&'a self, job: OneOff, _priority: Priority, _label: &'a str) -> BoxFuture<'a, Result<Finished, RunError>> {
		Box::pin(async move { run_once(&self.0.runtime(), &std::env::temp_dir(), job).await })
	}
}

/// The golden's stand-in: demo runs answer in turn.
struct Stand {
	unavailable: Option<String>,
	demo: Vec<Json>,
	calls: Mutex<usize>,
}

fn strings(v: &Json) -> Vec<String> {
	v.items().iter().map(|s| s.as_str().unwrap().to_owned()).collect()
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
	fn render_svg<'a>(&'a self, _svg: &'a str) -> BoxFuture<'a, Result<Vec<u8>, String>> {
		Box::pin(async { Ok(b"png".to_vec()) })
	}
	fn render_pdf_pages<'a>(&'a self, _pdf_path: &'a Path, _pages: &'a [i64], _dpi: Option<f64>) -> BoxFuture<'a, Result<Vec<RenderedPdfPage>, String>> {
		Box::pin(async { Ok(Vec::new()) })
	}
}

/// The case's turn: each step's tool calls, made together, its text, or the agent failing.
fn script(steps: &Json) -> FakeAgent {
	let turn = steps.items().iter().map(|step| match (step.get("calls"), step.get("fails")) {
		(Some(calls), _) => FakeStep::Calls(calls.items().iter().map(|c| (c[0].as_str().unwrap().to_owned(), c[1].clone())).collect()),
		(None, Some(reason)) => FakeStep::Fail(reason.as_str().unwrap().to_owned()),
		(None, None) => FakeStep::Text(step["text"].as_str().unwrap().to_owned()),
	});
	FakeAgent::new(vec![turn.collect()])
}

/// What godspeed sent the agent: its input and the tool answers, pictures as "[image]".
fn shown(agent: &FakeAgent) -> Json {
	let text = |content: &Json| content.items().iter().map(|p| p["text"].as_str().map_or_else(|| "[image]".to_owned(), str::to_owned)).collect::<Vec<_>>().join("\n");
	let out = agent.sent().into_iter().filter_map(|m| match m["type"].as_str() {
		Some("send") => Some(json!({ "user": text(&m["content"]) })),
		Some("tool_result") => Some(json!({ "isError": m["isError"].clone(), "text": text(&m["content"]) })),
		_ => None,
	});
	Json::Arr(out.collect())
}

#[tokio::test]
async fn the_demo_builder_plays_as_recorded() {
	let mut golden = parse(&std::fs::read_to_string(GOLDEN).unwrap()).unwrap();
	let recording = std::env::var_os("GS_RECORD_GOLDEN").is_some();
	for case in golden.as_arr_mut().unwrap() {
		let name = case["name"].as_str().unwrap().to_owned();
		let config = case["output"]["config"].clone();
		let agent = script(&config["steps"]);
		let activity = Arc::new(Mutex::new(Vec::<String>::new()));
		let stand = Stand { unavailable: config["unavailable"].as_str().map(str::to_owned), demo: config["demo"].as_arr().cloned().unwrap_or_default(), calls: Mutex::new(0) };
		let opts = JobAgentOptions {
			agent: Arc::new(StandIn(agent.clone())),
			headless: Arc::new(stand),
			abort_signal: None,
			on_usage: None,
			on_activity: Some(Arc::new({
				let activity = activity.clone();
				move |line: &str| activity.lock().push(line.to_owned())
			})),
			approve: None,
		};
		let brief = config["brief"].as_str().unwrap();
		let result = run_demo_builder(config["title"].str_or_empty(), brief, &opts).await;
		let activity = Json::Arr(activity.lock().iter().map(|l| Json::from(l.as_str())).collect());
		let got = json!({ "config": config, "result": result, "shown": shown(&agent), "activity": activity });
		if recording {
			case.set("output", got);
			continue;
		}
		for key in ["result", "shown", "activity"] {
			assert_eq!(got[key], case["output"][key], "{name}: {key}");
		}
	}
	if recording {
		gs_base::fsx::write_text_atomic(Path::new(GOLDEN), &format!("{}\n", stringify_pretty(&golden, "\t"))).unwrap();
	}
}
