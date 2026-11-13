//! The demo job's agent. Given a brief it
//! writes one self-contained HTML/JS demo, tests it headlessly (run_demo) and fixes and re-runs
//! it until clean, before anything reaches the lesson.
//!
//! `tested: true` means the check loop ran. A failure is `{title, html: "", tested: true, notes:
//! "FAILED: <reason>"}`: the card shows the note and no frame, and the runner marks the job an
//! error.

use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_base::num::to_fixed;
use gs_base::text::{len16, slice16, trim};
use gs_core::session::argument_heal::heal_encoded_arguments;
use gs_engine::turn::tool::{Tool, ToolContext};
use gs_engine::turn::tool_execute::server_execute;
use gs_json::{Json, json, stringify};
use parking_lot::Mutex;

use super::headless::{DemoRunResult, HeadlessApi};
use super::pi_run::{JobAgentOptions, OnActivity, OnToolStart, SubagentRunOptions, run_subagent};

const INSTRUCTIONS: &str = r#"You are a demo builder — a specialist sub-agent inside a learning application. You
receive a brief for ONE interactive teaching instrument and deliver a single self-contained HTML document
that runs it. You never see the lesson; the brief is everything you know.

Runtime contract (the document runs in a sandboxed iframe, sandbox="allow-scripts", opaque origin):
- Single file. Vanilla JS + Canvas 2D or SVG. CDN imports (e.g. a plotting or math library) are allowed
  when they genuinely help — but prefer dependency-free; you own the failure if a CDN import fails.
- NO localStorage, sessionStorage, or document.cookie — the sandbox makes them throw.
- The parent sizes the iframe to the document height automatically; just build normal flowing layout.
  Make the demo fill the width and size its own height sensibly.

Build quality:
- The demo must directly serve the brief: every control named in the brief must exist and do the thing.
- Controls need labels; sliders/inputs need current-value readouts. A learner should operate it unguided.
- Smooth enough interaction; requestAnimationFrame for animation, not setInterval when it matters.
- Dark-mode neutral: pick a clean light background for the demo area so it reads on any card.

THE HOUSE RULE — never deliver untested:
1. Call write_demo with the complete HTML document.
2. Call run_demo. It loads the file in a headless browser, waits ~2s, and reports console errors, uncaught
   errors (window.onerror), and failed requests. Optionally pass a probe: a JS expression evaluated in
   the page (e.g. "typeof window.simulate === 'function'" or a state assertion) to check deeper.
3. If run_demo reports problems, FIX the document and call write_demo again, then run_demo again.
   Iterate until run_demo reports PASSED.
4. Only then finish. Your final message is 1-3 sentences of NOTES for the teacher (what the demo shows,
   its controls, what to try) — NEVER the HTML itself.

Never claim success you did not see: a PASSED run_demo is the only definition of done."#;

/// Each write, run and fix is one step: about 6 cycles.
const MAX_TURNS: usize = 24;

#[derive(Default)]
struct BuilderState {
	html: Option<String>,
	/// The HTML the last run_demo tested.
	tested_html: Option<String>,
	last_result: Option<DemoRunResult>,
}

#[derive(Clone, Copy)]
enum Kind {
	Write,
	Run,
}

struct DemoTool {
	kind: Kind,
	parameters: Json,
	state: Arc<Mutex<BuilderState>>,
	headless: Arc<dyn HeadlessApi>,
	on_activity: Option<OnActivity>,
}

impl DemoTool {
	fn activity(&self, line: &str) {
		if let Some(f) = &self.on_activity {
			f(line);
		}
	}

	fn write_demo(&self, args: &Json) -> String {
		let html = args["html"].as_str().unwrap_or_default();
		if trim(html).is_empty() {
			return "ERROR: empty document — write the full HTML.".to_owned();
		}
		self.state.lock().html = Some(html.to_owned());
		let size = len16(html);
		self.activity(&format!("write_demo: {} KB", to_fixed(size as f64 / 1024.0, 1)));
		format!("Saved ({size} bytes). Now call run_demo to test it — never deliver untested.")
	}

	async fn run_demo(&self, args: &Json) -> String {
		let Some(html) = self.state.lock().html.clone() else { return "ERROR: nothing to run — call write_demo first.".to_owned() };
		if let Some(reason) = self.headless.unavailable_reason() {
			return format!("HEADLESS UNAVAILABLE: {reason}");
		}
		let probe = args["probe"].as_str().filter(|p| !p.is_empty());
		let result = match self.headless.run_demo(&html, probe).await {
			Ok(result) => result,
			Err(e) => {
				self.activity("run_demo: browser error");
				return format!("HEADLESS ERROR (retrying may help): {e}");
			}
		};
		self.activity(&if result.ok { "run_demo: clean".to_owned() } else { format!("run_demo: {}", summarize_counts(&result)) });
		let text = format_run_result(&result);
		let mut state = self.state.lock();
		// The document as it is now: a write in the same batch may have replaced the one tested.
		state.tested_html = state.html.clone();
		state.last_result = Some(result);
		text
	}
}

impl Tool for DemoTool {
	fn name(&self) -> &str {
		match self.kind {
			Kind::Write => "write_demo",
			Kind::Run => "run_demo",
		}
	}

	fn description(&self) -> &str {
		match self.kind {
			Kind::Write => "Write the complete self-contained HTML document for the demo (overwrites any previous version). Always follow with run_demo to test it headlessly.",
			Kind::Run => "Headlessly execute the current demo in a browser and report console errors, uncaught errors, and failed requests. Optionally pass a probe expression to assert on page state.",
		}
	}

	fn parameters(&self) -> &Json {
		&self.parameters
	}

	fn prepare_arguments(&self, args: Json) -> Json {
		heal_encoded_arguments(&args, &self.parameters)
	}

	fn execute(&self, args: Json, ctx: ToolContext) -> BoxFuture<'_, Result<Json, String>> {
		Box::pin(server_execute(self.name(), ctx, move |_| async move {
			Ok(Json::from(match self.kind {
				Kind::Write => self.write_demo(&args),
				Kind::Run => self.run_demo(&args).await,
			}))
		}))
	}
}

fn demo_tools(state: &Arc<Mutex<BuilderState>>, headless: &Arc<dyn HeadlessApi>, on_activity: &Option<OnActivity>) -> Vec<Arc<dyn Tool>> {
	let tool = |kind, parameters| -> Arc<dyn Tool> { Arc::new(DemoTool { kind, parameters, state: state.clone(), headless: headless.clone(), on_activity: on_activity.clone() }) };
	vec![
		tool(Kind::Write, json!({ "type": "object", "required": ["html"], "properties": { "html": { "type": "string", "description": "The complete HTML document: <!doctype html>…</html>, all JS inline." } } })),
		tool(
			Kind::Run,
			json!({ "type": "object", "properties": { "probe": { "type": "string", "description": "Optional JS expression evaluated in the page after settling, e.g. \"document.querySelectorAll('input').length\"." } } }),
		),
	]
}

fn counted(n: usize, what: &str) -> Option<String> {
	(n > 0).then(|| format!("{n} {what}{}", if n == 1 { "" } else { "s" }))
}

fn summarize_counts(result: &DemoRunResult) -> String {
	let counts: Vec<String> = [counted(result.console_errors.len(), "console error"), counted(result.page_errors.len(), "page error"), counted(result.failed_requests.len(), "failed request")].into_iter().flatten().collect();
	if counts.is_empty() { "ok".to_owned() } else { counts.join(", ") }
}

fn format_run_result(result: &DemoRunResult) -> String {
	if result.ok {
		// `JSON.stringify(x) ?? "undefined"`: a value JSON cannot write reads "undefined".
		let probe = result.probe_result.as_ref().map_or_else(String::new, |p| format!(" Probe result: {}.", stringify(p)));
		return format!("PASSED: no console errors, no uncaught errors, no failed requests.{probe} If you are satisfied, finish with your notes; otherwise keep improving and re-test.");
	}
	let listed = |title: &str, items: &[String]| (!items.is_empty()).then(|| format!("{title}:\n{}", items.iter().take(10).map(|e| format!("- {e}")).collect::<Vec<_>>().join("\n")));
	let mut sections = vec![format!("FAILED: {}.", summarize_counts(result))];
	sections.extend(listed("Console errors", &result.console_errors));
	sections.extend(listed("Uncaught errors", &result.page_errors));
	sections.extend(listed("Failed requests", &result.failed_requests));
	sections.push("Fix the document (write_demo) and re-test (run_demo).".to_owned());
	sections.join("\n")
}

/// A run's short summary for failure notes.
fn failure_summary(result: &DemoRunResult) -> String {
	let details: Vec<&str> = result.console_errors.iter().chain(&result.page_errors).chain(&result.failed_requests).take(5).map(String::as_str).collect();
	if details.is_empty() { summarize_counts(result) } else { format!("{}: {}", summarize_counts(result), details.join(" | ")) }
}

fn failed(title: &str, notes: &str) -> Json {
	json!({ "title": title, "html": "", "tested": true, "notes": format!("FAILED: {notes}") })
}

/// Builds the demo. Never fails: a failure is the failure shape.
pub async fn run_demo_builder(title: &str, brief: &str, opts: &JobAgentOptions) -> Json {
	let title = match trim(title) {
		"" => "Interactive demo",
		t => t,
	};
	let brief = match trim(brief) {
		"" => "(no brief)",
		b => b,
	};
	if let Some(reason) = opts.headless.unavailable_reason() {
		return failed(title, &reason);
	}
	let state = Arc::new(Mutex::new(BuilderState::default()));
	let prompt = [&format!("Demo title: {title}"), "Brief (all you know about the lesson — this comes from the teacher, verbatim):", brief, "", "Build the demo, test it with run_demo, iterate until PASSED, then finish with your notes."].join("\n");

	let mut run = SubagentRunOptions::new(INSTRUCTIONS, Json::from(prompt), MAX_TURNS);
	run.engine = opts.engine.clone();
	run.abort_signal = opts.abort_signal.clone();
	run.on_usage = opts.on_usage.clone();
	run.on_tool_start = opts.on_activity.clone().map(|f| -> OnToolStart {
		Arc::new(move |name: &str, _: &Json| {
			f(name);
			Ok(())
		})
	});
	run.task_label = Some(format!("Demo: {title}"));
	let final_text = match run_subagent(&opts.bridge, demo_tools(&state, &opts.headless, &opts.on_activity), run).await {
		Ok(result) => result.text,
		Err(e) => return failed(title, &format!("the builder crashed: {e}")),
	};

	let (html, tested_html, last_ok) = {
		let s = state.lock();
		(s.html.clone(), s.tested_html.clone(), s.last_result.as_ref().is_some_and(|r| r.ok))
	};
	let Some(html) = html else {
		let said = if final_text.is_empty() { String::new() } else { format!(" ({})", slice16(&final_text, 0, Some(300))) };
		return failed(title, &format!("the builder never wrote a demo.{said}"));
	};
	// The delivered HTML must have a clean run, even when the model claims success or forgets
	// the last run_demo.
	if tested_html.as_ref() != Some(&html) || !last_ok {
		opts.activity("final verification");
		let verify = match opts.headless.run_demo(&html, None).await {
			Ok(verify) => verify,
			Err(e) => return failed(title, &format!("final verification crashed: {e}")),
		};
		if !verify.ok {
			return failed(title, &format!("the demo never passed headless verification ({}).", failure_summary(&verify)));
		}
	}
	let mut result = json!({ "title": title, "html": html, "tested": true });
	if !trim(&final_text).is_empty() {
		result.as_obj_mut().expect("an object").insert("notes", trim(&final_text));
	}
	result
}

#[cfg(test)]
#[path = "demo_builder_tests.rs"]
mod tests;
