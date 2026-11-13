//! The background job runner.
//!
//! `run_job` runs the job kind's agent in the background (a lesson's job tool starts it
//! and does not wait), updating the job's activity line as it goes. When the agent ends, the
//! runner saves the outcome with a pending delivery and hands the steer message to `deliver`
//! without waiting: the lesson owns the delivery from then on.
//!
//! A failure is the kind's failure shape (empty html or svg with "FAILED: …" notes, a failure
//! brief), and it still steers: the teacher must learn the outcome.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_base::ids;
use gs_base::re::Re;
use gs_base::text::{slice16, trim};
use gs_core::session::jobs::{accumulate_job_usage, build_subagent_steer, is_subagent_failure, notes_or, pi_usage_to_step};
use gs_engine::bridge::Bridge;
use gs_engine::turn::abort::Abort;
use gs_engine::turn::faux::Engine;
use gs_json::{Json, json};
use gs_pdf::Pdf;
use gs_store::chats::ChatStore;
use gs_store::jobs::JobStore;
use parking_lot::Mutex;

use super::aborts::JobAborts;
use super::demo_builder::run_demo_builder;
use super::headless::HeadlessApi;
use super::pdf_reader::run_pdf_reader_agent;
use super::pi_run::{HelperOptions, OnActivity, OnToolStart, OnUsage, RunError};
use super::researcher::{ResearcherRunOptions, run_researcher_agent};
use super::visual_maker::run_visual_maker;

/// What the runner needs from the server: the TS `JobRunnerDeps` (stores, `deliver`,
/// `engineFor`) and the server state the TS reached through modules.
pub trait JobHost: Send + Sync {
	fn job_store(&self) -> &JobStore;
	fn chat_store(&self) -> &ChatStore;
	fn bridge(&self) -> &Bridge;
	fn pdf(&self) -> &Pdf;
	fn job_aborts(&self) -> &JobAborts;
	/// `os.tmpdir()`: the research job's PDF folder goes here.
	fn tmp_dir(&self) -> &Path;
	fn headless(&self) -> Arc<dyn HeadlessApi>;
	/// The person's Tavily key, read when a research job starts.
	fn search_key(&self) -> Option<String>;
	/// The engine for a model role ("researcher", "demoBuilder", "visualMaker", "pdfReader");
	/// None refuses the job.
	fn engine_for(&self, role: &str) -> Option<Engine>;
	/// Hands a finished job's steer to the lesson's delivery. The runner never waits for it; the
	/// saved pending delivery survives a restart.
	fn deliver(&self, steer: Json) -> BoxFuture<'static, Result<(), String>>;
}

pub struct JobRunner {
	host: Arc<dyn JobHost>,
	/// Running usage totals per live job.
	usage_totals: Mutex<HashMap<String, Json>>,
}

pub fn create_job_runner(host: Arc<dyn JobHost>) -> Arc<JobRunner> {
	Arc::new(JobRunner { host, usage_totals: Mutex::new(HashMap::new()) })
}

/// The model role each job kind runs as.
fn kind_role(kind: &str) -> Option<&'static str> {
	Some(match kind {
		"research" => "researcher",
		"demo" => "demoBuilder",
		"visual" => "visualMaker",
		"pdf" => "pdfReader",
		_ => return None,
	})
}

/// One job loop's kill switch and usage tap.
struct LoopContext {
	/// Fired by the abort endpoint; it rides into every model call.
	abort: Abort,
	on_usage: OnUsage,
}

impl JobRunner {
	fn jobs(&self) -> &JobStore {
		self.host.job_store()
	}

	/// A merge patch on the job; a failed write is logged, as the TS let it throw past.
	fn update(&self, job_id: &str, patch: Json) {
		if let Err(e) = self.jobs().update_job(job_id, &patch) {
			eprintln!("[job {job_id}] update failed: {e}");
		}
	}

	/// True while the job may still write its outcome. False once the abort path flipped it to
	/// error: the runner then unwinds quietly, and the abort path owns the record and its steer.
	fn still_running(&self, job_id: &str) -> bool {
		self.jobs().get_job(job_id).is_some_and(|j| j["status"] == Json::from("running"))
	}

	fn loop_context(self: &Arc<Self>, job_id: &str, engine: &Engine) -> LoopContext {
		// The engine's actual model, provider-qualified.
		let model = format!("{}:{}", engine.model["provider"].as_str().unwrap_or("undefined"), engine.model["id"].as_str().unwrap_or("undefined"));
		let abort = Abort::new();
		self.host.job_aborts().register_job_abort(job_id, abort.clone());
		let runner = Arc::downgrade(self);
		let id = job_id.to_owned();
		let on_usage: OnUsage = Arc::new(move |usage: &Json| {
			let Some(runner) = runner.upgrade() else { return };
			let next = {
				let mut totals = runner.usage_totals.lock();
				let next = accumulate_job_usage(totals.get(&id), &model, &pi_usage_to_step(usage));
				totals.insert(id.clone(), next.clone());
				next
			};
			// A merge patch: the status stays as it is.
			runner.update(&id, json!({ "usage": next }));
		});
		LoopContext { abort, on_usage }
	}

	/// Runs one job's agent to the end; never fails. The tool input rides along from the
	/// dispatch; recovery reads the saved input, or the transcript for older jobs.
	pub async fn run_job(self: Arc<Self>, job_id: String, input: Option<Json>) {
		let Some(job) = self.jobs().get_job(&job_id) else {
			eprintln!("[job {job_id}] not found — nothing to run");
			return;
		};
		// Already finished, or re-run after crash recovery.
		if job["status"] != Json::from("running") {
			return;
		}
		let kind = job["kind"].as_str().unwrap_or_default().to_owned();
		let Some(role) = kind_role(&kind) else {
			// `${job.kind}`.
			let shown = match job.get("kind") {
				None => "undefined".to_owned(),
				Some(Json::Str(s)) => s.clone(),
				Some(other) => gs_json::stringify(other),
			};
			eprintln!("[job {job_id}] unknown kind: {shown}");
			self.update(&job_id, json!({ "status": "error", "error": format!("unknown kind {shown}"), "activity": "failed" }));
			return;
		};
		let Some(engine) = self.host.engine_for(role) else {
			// Refused like any failed job: the honest error, then the kind's failure shape
			// through finish_job, so the lesson resumes instead of waiting forever.
			eprintln!("[job {job_id}] refused — no engine");
			let reason = "No model is available to run this job";
			if self.still_running(&job_id) {
				self.update(&job_id, json!({ "error": reason }));
			}
			let input = self.resolve_input(&job, input);
			self.finish_job(&job_id, failure_result(&kind, input.as_ref(), reason));
			return;
		};
		let ctx = self.loop_context(&job_id, &engine);
		match kind.as_str() {
			"research" => self.run_research_job(&job_id, engine, input, &ctx).await,
			"demo" => self.run_demo_job(&job_id, engine, input, &ctx).await,
			"visual" => self.run_visual_job(&job_id, engine, input, &ctx).await,
			_ => self.run_pdf_job(&job_id, engine, input, &ctx).await,
		}
		self.host.job_aborts().unregister_job_abort(&job_id);
		// The last usage write may have raced the loop's end: save what was folded (a merge
		// patch, so an aborted job stays aborted).
		let usage = self.usage_totals.lock().remove(&job_id);
		if let Some(usage) = usage {
			self.update(&job_id, json!({ "usage": usage }));
		}
	}

	/// The dispatch input, else the job's saved input, else (older jobs) the arguments of the
	/// tool call in the lesson's transcript.
	fn resolve_input(&self, job: &Json, input: Option<Json>) -> Option<Json> {
		if input.is_some() {
			return input;
		}
		if let Some(saved) = job.get("input") {
			return Some(saved.clone());
		}
		let chat = self.host.chat_store().get_chat(job["chatId"].as_str()?)?;
		for m in chat["messages"].as_arr().into_iter().flatten().filter(|m| m["role"] == Json::from("assistant")) {
			for block in m["content"].as_arr().into_iter().flatten() {
				if block["type"] == Json::from("toolCall") && block["id"] == job["toolCallId"] {
					return block.get("arguments").cloned();
				}
			}
		}
		None
	}

	/// Saves the outcome and the pending delivery together, then hands the steer over.
	fn finish_job(&self, job_id: &str, result: Json) {
		let Some(job) = self.jobs().get_job(job_id) else { return };
		// Aborted mid-run: no result and no steer; the abort path owns both.
		if job["status"] != Json::from("running") {
			return;
		}
		let failed = is_subagent_failure(job["kind"].as_str().unwrap_or_default(), &result);
		let steer = build_subagent_steer(&job, &result);
		let patch = json!({
			"result": result,
			"status": if failed { "error" } else { "done" },
			"activity": if failed { "failed" } else { "finished" },
			"delivery": { "kind": "result", "status": "pending" },
		});
		// An abort that lands after the check above owns the record and its steer.
		match self.jobs().update_job_if(job_id, &patch, |now| now["status"] == Json::from("running")) {
			Ok(Some(_)) => {}
			Ok(None) => return,
			Err(e) => eprintln!("[job {job_id}] update failed: {e}"),
		}
		let delivery = self.host.deliver(steer);
		let id = job_id.to_owned();
		tokio::spawn(async move {
			if let Err(e) = delivery.await {
				eprintln!("[job {id}] pending delivery: {e}");
			}
		});
	}

	/// The running job, or None; a job whose lesson is gone fails here.
	fn job_context(&self, job_id: &str) -> Option<Arc<Json>> {
		let job = self.jobs().get_job(job_id).filter(|j| j["status"] == Json::from("running"))?;
		let chat_id = job["chatId"].as_str().unwrap_or_default();
		if self.host.chat_store().get_chat(chat_id).is_none() {
			self.update(job_id, json!({ "status": "error", "error": format!("Chat not found: {chat_id}"), "activity": "failed" }));
			return None;
		}
		Some(job)
	}

	/// What the demo, visual and pdf helpers get.
	fn helper_options(self: &Arc<Self>, job_id: &str, engine: Engine, ctx: &LoopContext) -> HelperOptions {
		let runner = Arc::downgrade(self);
		let id = job_id.to_owned();
		let on_activity: OnActivity = Arc::new(move |line: &str| {
			if let Some(runner) = runner.upgrade() {
				runner.update(&id, json!({ "activity": line }));
			}
		});
		HelperOptions {
			bridge: self.host.bridge().clone(),
			engine: Some(engine),
			headless: self.host.headless(),
			abort_signal: Some(ctx.abort.clone()),
			on_usage: Some(ctx.on_usage.clone()),
			on_activity: Some(on_activity),
		}
	}

	/// The usual end of a failed run: unwind quietly when aborted, else record and steer.
	fn fail(&self, job_id: &str, kind: &str, input: Option<&Json>, reason: &str, ctx: &LoopContext) {
		if ctx.abort.is_aborted() {
			return;
		}
		if self.still_running(job_id) {
			self.update(job_id, json!({ "error": reason }));
		}
		self.finish_job(job_id, failure_result(kind, input, reason));
	}

	async fn run_research_job(self: &Arc<Self>, job_id: &str, engine: Engine, passed: Option<Json>, ctx: &LoopContext) {
		let Some(job) = self.job_context(job_id) else { return };
		let input = self.resolve_input(&job, passed);
		let input_ref = input.as_ref().unwrap_or(&Json::Null);
		let Some(question) = input_ref["question"].as_str().filter(|q| !trim(q).is_empty()) else {
			self.update(job_id, json!({ "error": "research question unavailable" }));
			self.finish_job(job_id, json!({ "brief": "Research failed: the research question is unavailable.", "sources": [] }));
			return;
		};
		let context = input_ref["context"].as_str().filter(|c| !trim(c).is_empty());
		let mut parts = vec![format!("Research question: {question}")];
		parts.extend(context.map(|c| format!("Context (what this is needed for): {c}")));
		parts.push("Produce your final brief in the required format.".to_owned());
		let prompt = parts.join("\n\n");

		// Node made this folder with an await, so a spawned job goes on in the background here.
		tokio::task::yield_now().await;
		// The job's PDF folder: web_fetch_pdf downloads land here, every PDF tool is scoped to
		// it, and it goes with the job.
		let pdf_dir = match make_temp_dir(self.host.tmp_dir(), "lh-research-") {
			Ok(dir) => dir,
			Err(e) => {
				eprintln!("[job {job_id}] no PDF folder: {e}");
				return;
			}
		};
		let fetched: Arc<Mutex<Vec<String>>> = Arc::default();
		let on_tool_start: OnToolStart = {
			let runner = Arc::downgrade(self);
			let (id, fetched) = (job_id.to_owned(), fetched.clone());
			Arc::new(move |tool_name: &str, args: &Json| {
				if let Some(url) = args["url"].as_str()
					&& (tool_name == "web_fetch" || tool_name == "web_fetch_pdf")
				{
					fetched.lock().push(url.to_owned());
				}
				let line = activity_line(tool_name, args)?;
				if let Some(runner) = runner.upgrade() {
					runner.update(&id, json!({ "activity": line }));
				}
				Ok(())
			})
		};
		self.update(job_id, json!({ "activity": "researching" }));
		let opts = ResearcherRunOptions {
			engine: Some(engine),
			pdf: self.host.pdf(),
			pdf_dir: &pdf_dir,
			abort_signal: Some(ctx.abort.clone()),
			on_usage: Some(ctx.on_usage.clone()),
			on_tool_start: Some(on_tool_start),
			task_label: Some(format!("Research: {question}")),
			search_key: self.host.search_key(),
		};
		let outcome = match run_researcher_agent(self.host.bridge(), &prompt, opts).await {
			Ok(brief) if trim(&brief).is_empty() => Err(RunError::Failed("the researcher produced no text".to_owned())),
			outcome => outcome,
		};
		match outcome {
			Ok(brief) => {
				let brief = trim(&brief);
				let sources = parse_sources(brief, &fetched.lock());
				self.finish_job(job_id, json!({ "brief": brief, "sources": sources }));
			}
			Err(e) => self.fail(job_id, "research", input.as_ref(), &e.to_string(), ctx),
		}
		let _ = std::fs::remove_dir_all(&pdf_dir);
	}

	async fn run_demo_job(self: &Arc<Self>, job_id: &str, engine: Engine, passed: Option<Json>, ctx: &LoopContext) {
		let Some(job) = self.job_context(job_id) else { return };
		let input = self.resolve_input(&job, passed).unwrap_or(Json::Null);
		let title = input["title"].as_str().filter(|t| !trim(t).is_empty()).unwrap_or("Interactive demo");
		let brief = input["brief"].as_str().unwrap_or_default();
		self.update(job_id, json!({ "activity": "building demo" }));
		let result = run_demo_builder(title, brief, &self.helper_options(job_id, engine, ctx)).await;
		if result["html"].as_str().is_none_or(str::is_empty) && self.still_running(job_id) {
			self.update(job_id, json!({ "error": notes_or(&result, "demo build failed") }));
		}
		self.finish_job(job_id, result);
	}

	async fn run_visual_job(self: &Arc<Self>, job_id: &str, engine: Engine, passed: Option<Json>, ctx: &LoopContext) {
		let Some(job) = self.job_context(job_id) else { return };
		let input = self.resolve_input(&job, passed).unwrap_or(Json::Null);
		let brief = input["brief"].as_str().unwrap_or_default();
		self.update(job_id, json!({ "activity": "drawing figure" }));
		let result = run_visual_maker(brief, &self.helper_options(job_id, engine, ctx)).await;
		if result["svg"].as_str().is_none_or(str::is_empty) && self.still_running(job_id) {
			self.update(job_id, json!({ "error": notes_or(&result, "visual build failed") }));
		}
		self.finish_job(job_id, result);
	}

	async fn run_pdf_job(self: &Arc<Self>, job_id: &str, engine: Engine, passed: Option<Json>, ctx: &LoopContext) {
		let Some(job) = self.job_context(job_id) else { return };
		let input = self.resolve_input(&job, passed).unwrap_or(Json::Null);
		let path = input["path"].as_str().map(trim).unwrap_or_default();
		let question = input["question"].as_str().unwrap_or_default();
		self.update(job_id, json!({ "activity": "reading pdf" }));
		let result = run_pdf_reader_agent(path, question, self.host.pdf(), &self.helper_options(job_id, engine, ctx)).await;
		static FAILED: std::sync::LazyLock<Re> = std::sync::LazyLock::new(|| Re::new(r"^PDF failed:\s*", "i"));
		let brief = result["brief"].as_str().unwrap_or_default();
		if FAILED.test(brief) && self.still_running(job_id) {
			self.update(job_id, json!({ "error": FAILED.replace(brief, "") }));
		}
		self.finish_job(job_id, result);
	}
}

/// Each kind's failure shape, built from whatever input the job has.
fn failure_result(kind: &str, input: Option<&Json>, reason: &str) -> Json {
	let input = input.unwrap_or(&Json::Null);
	match kind {
		"research" => json!({ "brief": format!("Research failed: {reason}"), "sources": [] }),
		"demo" => {
			let title = input["title"].as_str().filter(|t| !trim(t).is_empty()).unwrap_or("Interactive demo");
			json!({ "title": title, "html": "", "tested": true, "notes": format!("FAILED: {reason}") })
		}
		"visual" => json!({ "svg": "", "notes": format!("FAILED: {reason}") }),
		_ => json!({
			"path": input["path"].as_str().map(trim).unwrap_or_default(),
			"question": input["question"].as_str().unwrap_or_default(),
			"brief": format!("PDF failed: {reason}"),
			"pagesRead": [],
			"pagesConsulted": [],
		}),
	}
}

/// The activity line the window shows: `web_fetch: <host>`, else the tool's name. An `Err` is
/// what the TS threw for a URL that is not text.
fn activity_line(tool_name: &str, args: &Json) -> Result<String, String> {
	if tool_name == "web_fetch" { Ok(format!("web_fetch: {}", host_of(&args["url"])?)) } else { Ok(tool_name.to_owned()) }
}

/// `new URL(url).hostname`, else the first 40 characters. A value that is not text has no
/// `slice`, so it throws like the TS did.
fn host_of(url: &Json) -> Result<String, String> {
	let text = match url {
		Json::Null | Json::Bool(false) => return Ok("(no url)".to_owned()),
		Json::Str(s) if s.is_empty() => return Ok("(no url)".to_owned()),
		Json::Num(n) if *n == 0.0 => return Ok("(no url)".to_owned()),
		Json::Str(s) => s,
		_ => return Err("e.slice is not a function".to_owned()),
	};
	Ok(url_hostname(text).unwrap_or_else(|| slice16(text, 0, Some(40))))
}

/// The WHATWG URL parser's `hostname` for the URLs a model writes; None where it throws. ASCII
/// hosts only: no IDNA and no IPv4 number forms.
fn url_hostname(url: &str) -> Option<String> {
	let url: String = url.trim_matches(|c: char| c <= ' ').chars().filter(|c| !matches!(c, '\t' | '\n' | '\r')).collect();
	let colon = url.find(':')?;
	let scheme = url[..colon].to_ascii_lowercase();
	let mut chars = scheme.chars();
	if !chars.next().is_some_and(|c| c.is_ascii_alphabetic()) || !chars.all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c)) {
		return None;
	}
	let rest = &url[colon + 1..];
	let special = matches!(scheme.as_str(), "http" | "https" | "ws" | "wss" | "ftp" | "file");
	let slash = |c: char| c == '/' || (special && c == '\\');
	let authority = if scheme == "file" || !special {
		// Only "//" opens an authority here; without one the host is empty.
		let mut it = rest.chars();
		if !(it.next().is_some_and(slash) && it.next().is_some_and(slash)) {
			return Some(String::new());
		}
		&rest[2..]
	} else {
		rest.trim_start_matches(slash)
	};
	let end = authority.find(|c: char| slash(c) || c == '?' || c == '#').unwrap_or(authority.len());
	let authority = &authority[..end];
	let host_port = authority.rfind('@').map_or(authority, |at| &authority[at + 1..]);
	let (host, port) = match host_port.strip_prefix('[') {
		Some(v6) => {
			let close = v6.find(']')?;
			(&host_port[..close + 2], &v6[close + 1..])
		}
		None => host_port.find(':').map_or((host_port, ""), |at| (&host_port[..at], &host_port[at..])),
	};
	if let Some(digits) = port.strip_prefix(':') {
		if !digits.chars().all(|c| c.is_ascii_digit()) || digits.parse::<u64>().is_ok_and(|p| p > 65535) {
			return None;
		}
	} else if !port.is_empty() {
		return None;
	}
	if special && scheme != "file" && host.is_empty() {
		return None;
	}
	if host.chars().any(|c| c <= ' ' || "<>^|\"%".contains(c) || c == '\u{7f}') {
		return None;
	}
	Some(if special { host.to_ascii_lowercase() } else { host.to_owned() })
}

/// The result's sources: markdown links cited in the brief, else the fetched URLs.
fn parse_sources(brief: &str, fetched: &[String]) -> Vec<Json> {
	static LINK: std::sync::LazyLock<Re> = std::sync::LazyLock::new(|| Re::new(r"\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)", "g"));
	let mut sources = Vec::new();
	let mut seen = std::collections::HashSet::new();
	for m in LINK.captures_iter(brief) {
		let title = m.get(1).unwrap_or_default();
		let title = trim(&title);
		let url = m.get(2).unwrap_or_default();
		if title.is_empty() || seen.contains(&url) {
			continue;
		}
		seen.insert(url.clone());
		sources.push(json!({ "title": title, "url": url }));
	}
	if sources.is_empty() {
		for url in fetched {
			if !seen.insert(url.clone()) {
				continue;
			}
			// A fetched URL is text, so host_of cannot throw here.
			let title = host_of(&Json::from(url.as_str())).unwrap_or_default();
			sources.push(json!({ "title": title, "url": url }));
		}
	}
	sources.truncate(10);
	sources
}

/// `fs.mkdtemp(path.join(dir, prefix))`: a new folder named prefix + 6 random characters.
fn make_temp_dir(dir: &Path, prefix: &str) -> std::io::Result<PathBuf> {
	const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	loop {
		let suffix: String = ids::random_bytes(6).iter().map(|b| CHARS[*b as usize % CHARS.len()] as char).collect();
		let path = dir.join(format!("{prefix}{suffix}"));
		match std::fs::create_dir(&path) {
			Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
			made => return made.map(|()| path),
		}
	}
}

#[cfg(test)]
#[path = "runner_tests.rs"]
mod tests;
