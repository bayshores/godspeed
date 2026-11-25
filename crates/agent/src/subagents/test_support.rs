//! What the background-job tests share: jobs on a stand-in agent, and a stand-in headless browser.

use std::path::Path;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_engine::turn::job_session::{Finished, OneOff, RunError, run_once};
use gs_json::Json;
use gs_pdf::RenderedPdfPage;
use gs_runtime::fake::{FakeAgent, FakeStep};
use parking_lot::Mutex;

use super::headless::{DemoRunResult, HeadlessApi};
use super::job_agent::{JobAgent, Priority};
use super::pi_run::JobAgentOptions;

/// Jobs straight on a stand-in agent: no pool and no wait, in the job's folder or the temp folder.
struct StandIn(FakeAgent);

impl JobAgent for StandIn {
	fn run<'a>(&'a self, job: OneOff, _priority: Priority, _label: &'a str) -> BoxFuture<'a, Result<Finished, RunError>> {
		let cwd = job.cwd.clone().unwrap_or_else(std::env::temp_dir);
		Box::pin(async move { run_once(&self.0.runtime(), &cwd, job).await })
	}
}

/// A job agent on `fake`.
pub fn on(fake: FakeAgent) -> Arc<dyn JobAgent> {
	Arc::new(StandIn(fake))
}

/// A job agent playing `turns`, and the stand-in, which keeps what godspeed sent it.
pub fn stand_in(turns: Vec<Vec<FakeStep>>) -> (Arc<dyn JobAgent>, FakeAgent) {
	let fake = FakeAgent::new(turns);
	(on(fake.clone()), fake)
}

/// A call of a godspeed tool.
pub fn tool(name: &str, args: Json) -> FakeStep {
	FakeStep::Tool { name: name.to_owned(), args }
}

pub fn says(text: &str) -> FakeStep {
	FakeStep::Text(text.to_owned())
}

/// Every tool result godspeed sent the agent, in order.
pub fn results(fake: &FakeAgent) -> Vec<Json> {
	fake.sent().into_iter().filter(|m| m["type"].as_str() == Some("tool_result")).collect()
}

/// The text of every tool result godspeed sent the agent, in order.
pub fn result_texts(fake: &FakeAgent) -> Vec<String> {
	results(fake).iter().map(|m| m["content"][0]["text"].str_or_empty().to_owned()).collect()
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

/// Job agent options on a stand-in agent playing `turns`, recording activity lines.
pub fn job_agent_options(turns: Vec<Vec<FakeStep>>, headless: Arc<dyn HeadlessApi>) -> (JobAgentOptions, FakeAgent, Arc<Mutex<Vec<String>>>) {
	let (agent, fake) = stand_in(turns);
	let lines = Arc::new(Mutex::new(Vec::new()));
	let opts = JobAgentOptions {
		agent,
		headless,
		abort_signal: None,
		on_usage: None,
		on_activity: Some(Arc::new({
			let lines = lines.clone();
			move |line: &str| lines.lock().push(line.to_owned())
		})),
		approve: None,
	};
	(opts, fake, lines)
}
