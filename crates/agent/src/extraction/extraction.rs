//! The extraction pipeline (extraction.ts), the only graph writer. Each stretch of a source (a
//! lesson's uncovered teacher prose, or a notes file in chunks) goes to the extractor with THE
//! GRAPH SO FAR and RELATED IDEAS in its prompt; it submits new ideas, chains and re-taught ids in
//! one call, and the merger (gs_core) appends them to the ledgers.
//!
//! Extract and merge run under one server-wide FIFO lock, so each extractor sees every earlier
//! merge and two runs never mint duplicates. A source's stretches run in order, each as its own
//! job (registry row, usage record); a failed job leaves its stretch for the next run while the
//! others keep their merges, and an abort ends the whole run.

use std::collections::HashSet;
use std::future::Future;
use std::sync::Arc;
use std::time::Instant;

use futures_util::future::BoxFuture;
use gs_base::events::Events;
use gs_base::locks::{LockKey, Locks};
use gs_base::{hash, time};
use gs_core::graph::coverage::{CoverageSlot, batch_runs, coverage_of, message_view_lines};
use gs_core::graph::graph::{MergeSource, get_graph, merge_findings};
use gs_core::graph::ports::GraphStore;
use gs_core::messages::native_messages::failed_output_call_ids;
use gs_core::records::settings::factory_settings;
use gs_engine::bridge::Bridge;
use gs_engine::turn::abort::Abort;
use gs_engine::turn::faux::Engine;
use gs_json::{Json, Obj, json};
use gs_store::chats::ChatStore;
use gs_store::graph::GraphStores;

use super::context::{chunk_notes, graph_context, message_id, notes_view, prose_view};
use super::extraction_runs::{ExtractionPhase, ExtractionRuns, RunKind};
use super::findings::{
	as_session_findings, extractor_instructions, fill_notes_findings, notes_extractor_instructions, notes_findings_schema, session_findings_schema, validate_findings_chains,
	validate_session_anchors,
};
use super::ledgers::ScopedGraph;
use super::submit_agent::{SubmitAgentOptions, run_submit_agent};
use crate::subagents::pi_run::RunError;

/// How many related ideas each stretch's prompt carries.
const RELATED_FACTS: usize = 25;

/// What the pipeline runs on: the server's stores, registry and search.
pub trait ExtractionHost: Send + Sync {
	fn chats(&self) -> &ChatStore;
	fn graphs(&self) -> &Arc<GraphStores>;
	fn events(&self) -> &Events;
	fn locks(&self) -> &Locks;
	fn bridge(&self) -> &Bridge;
	fn state(&self) -> &ExtractionState;
	/// The engine the extractor runs on; None is the outside agent.
	fn engine(&self) -> Option<Engine> {
		None
	}
	/// A run that may have written `scope`'s graph ended (the topic grouper's trigger).
	fn on_graph_written(&self, scope: Option<&str>);
	/// The existing ideas of `scope` (its merged `nodes`) most related to `text`, best first.
	fn related_facts<'a>(&'a self, scope: Option<&'a str>, nodes: &'a [Json], text: &'a str, limit: usize) -> BoxFuture<'a, Result<Vec<String>, String>>;
}

/// The pipeline's server-wide state.
#[derive(Default)]
pub struct ExtractionState {
	pub runs: ExtractionRuns,
	/// Extract and merge run one job at a time (tokio's mutex queues first come, first served).
	graph_lock: tokio::sync::Mutex<()>,
}

#[cfg(test)]
impl ExtractionState {
	pub(super) async fn graph_lock_for_tests(&self) -> tokio::sync::MutexGuard<'_, ()> {
		self.graph_lock.lock().await
	}
}

/// Why a job ended without merging.
#[derive(Clone, Debug, PartialEq)]
enum JobError {
	/// The run's abort (the dock's button, a lesson or class being deleted).
	Aborted(String),
	Failed(String),
}

impl JobError {
	pub fn message(&self) -> &str {
		match self {
			JobError::Aborted(m) | JobError::Failed(m) => m,
		}
	}

	pub fn is_abort(&self) -> bool {
		matches!(self, JobError::Aborted(_))
	}
}

impl From<RunError> for JobError {
	fn from(err: RunError) -> JobError {
		match err {
			RunError::Aborted => JobError::Aborted("aborted".to_owned()),
			RunError::Failed(message) => JobError::Failed(message),
		}
	}
}

/// What `AbortSignal.throwIfAborted` throws.
fn aborted_now() -> JobError {
	JobError::Aborted("This operation was aborted".to_owned())
}

/// How a notes import that did not finish ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImportOutcome {
	Failed,
	Partial,
	Aborted,
	Busy,
}

impl ImportOutcome {
	pub fn as_str(self) -> &'static str {
		match self {
			ImportOutcome::Failed => "failed",
			ImportOutcome::Partial => "partial",
			ImportOutcome::Aborted => "aborted",
			ImportOutcome::Busy => "busy",
		}
	}
}

/// A notes import did not finish. Earlier merges and logged usage stay; `partial_stats` counts
/// what did merge.
#[derive(Clone, Debug, PartialEq)]
pub struct NotesImportError {
	pub outcome: ImportOutcome,
	pub partial_stats: Json,
	pub message: String,
}

impl std::fmt::Display for NotesImportError {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		f.write_str(&self.message)
	}
}

/// One raw notes file to import.
pub struct NotesImportInput {
	/// The source's identity (its id hashes it) and its label.
	pub file_path: String,
	/// The file's content, verbatim, any format.
	pub text: String,
	/// The graph to import into: None is "No class".
	pub scope: Option<String>,
	/// An explicit source id (class files); None is `src_` + the path's hash.
	pub source_id: Option<String>,
	/// A class file godspeed may sort by itself: the first stretch's read also says whether the
	/// file is course logistics.
	pub may_be_course_info: bool,
}

/// The merger's append counts, summed over jobs. `droppedChains` only when something dropped.
#[derive(Default)]
struct Stats {
	nodes: f64,
	chains: f64,
	dropped: Option<f64>,
}

impl Stats {
	fn add(&mut self, merged: &Json) {
		self.nodes += merged["nodes"].as_f64().unwrap_or(0.0);
		self.chains += merged["chains"].as_f64().unwrap_or(0.0);
		if let Some(dropped) = merged["droppedChains"].as_f64().filter(|d| *d != 0.0) {
			self.dropped = Some(self.dropped.unwrap_or(0.0) + dropped);
		}
	}

	fn to_json(&self) -> Json {
		let mut out = Obj::new();
		out.insert("nodes", self.nodes);
		out.insert("chains", self.chains);
		if let Some(dropped) = self.dropped {
			out.insert("droppedChains", dropped);
		}
		Json::Obj(out)
	}
}

/// The batch budget: always the factory value (the Settings value is not read here).
fn chunk_tokens() -> f64 {
	factory_settings()["graph"]["extractionChunkTokens"].as_f64().unwrap_or(4096.0)
}

fn job_key(source_id: &str, part: Option<(usize, usize)>) -> String {
	part.map_or_else(|| source_id.to_owned(), |(i, _)| format!("{source_id}#{i}"))
}

fn elapsed_ms(t0: Instant) -> i64 {
	t0.elapsed().as_millis() as i64
}

/// One model step's usage as the extraction log stores it.
fn call_usage(usage: &Json) -> Json {
	let or_zero = |v: &Json| if v.is_null() { Json::from(0) } else { v.clone() };
	json!({
		"inputTokens": usage["input"],
		"outputTokens": usage["output"],
		"cacheReadTokens": usage["cacheRead"],
		"cacheWriteTokens": usage["cacheWrite"],
		"cacheWrite1hTokens": or_zero(&usage["cacheWrite1h"]),
		"reasoningTokens": or_zero(&usage["reasoning"]),
	})
}

/// Which submit the extractor gets.
enum Door {
	/// A lesson: anchors must be passages of this batch.
	Session(HashSet<String>),
	/// A notes file, maybe asked whether it is course logistics.
	Notes(bool),
}

/// Takes a job out of the registry however its run ends.
struct Finish<'a> {
	host: &'a dyn ExtractionHost,
	key: &'a str,
}

impl Drop for Finish<'_> {
	fn drop(&mut self) {
		self.host.state().runs.finish(self.host.events(), self.key);
	}
}

/// Lets go of a lesson's claim however its run ends, a panic or a dropped future included: a claim
/// left behind would refuse the lesson's delete and move until a restart.
struct Claimed<'a> {
	host: &'a dyn ExtractionHost,
	chat_id: &'a str,
}

impl Drop for Claimed<'_> {
	fn drop(&mut self) {
		let runs = &self.host.state().runs;
		runs.release(self.chat_id);
		runs.finish(self.host.events(), self.chat_id);
	}
}

/// The pipeline: every front door (lessons, notes imports, class files) shares one host.
#[derive(Clone)]
pub struct Extraction(Arc<dyn ExtractionHost>);

impl Extraction {
	pub fn new(host: Arc<dyn ExtractionHost>) -> Extraction {
		Extraction(host)
	}

	fn runs(&self) -> &ExtractionRuns {
		&self.0.state().runs
	}

	fn set_phase(&self, key: &str, phase: ExtractionPhase, kind: RunKind, label: Option<&str>, part: Option<(usize, usize)>) {
		self.runs().set_phase(self.0.events(), key, phase, kind, label, part);
	}

	fn abort_of(&self, key: &str) -> Abort {
		self.runs().get(key).map(|run| run.abort).unwrap_or_default()
	}

	/// The graph a lesson writes to: its class's, or "No class".
	fn scope_of_chat(&self, chat_id: &str) -> Option<String> {
		self.0.chats().get_chat(chat_id).and_then(|record| record["classId"].as_str().map(str::to_owned))
	}

	/// The job's name on the outside agent's work items: which lesson or file, and which part.
	fn task_label(&self, key: &str) -> String {
		let run = self.runs().get(key);
		let name = run.as_ref().and_then(|r| r.label.clone()).or_else(|| {
			let chat_id = run.as_ref().map_or(key, |r| r.chat_id.as_str());
			self.0.chats().get_chat(chat_id).and_then(|record| record["title"].as_str().map(str::to_owned))
		});
		let part = run.and_then(|r| r.part).map(|(i, n)| format!(" (part {i} of {n})")).unwrap_or_default();
		format!("Graph extraction: {}{part}", name.unwrap_or_else(|| key.to_owned()))
	}

	/// Holds the graph lock around `critical`; a job aborted while it waits leaves the queue.
	async fn with_graph_lock<F>(&self, key: &str, kind: RunKind, label: Option<&str>, part: Option<(usize, usize)>, critical: F) -> Result<Json, JobError>
	where
		F: Future<Output = Result<Json, JobError>>,
	{
		self.set_phase(key, ExtractionPhase::Waiting, kind, label, part);
		let abort = self.abort_of(key);
		let _held = tokio::select! {
			biased;
			held = self.0.state().graph_lock.lock() => held,
			() = abort.aborted() => return Err(JobError::Aborted("extraction aborted while waiting for the graph lock".to_owned())),
		};
		if abort.is_aborted() {
			return Err(aborted_now());
		}
		critical.await
	}

	/// One extractor call over a stretch: the prompt's graph context, then the submit.
	async fn extract(&self, key: &str, source_id: &str, scope: Option<&str>, view: &str, stretch: &str, door: Door) -> Result<Json, JobError> {
		let abort = self.abort_of(key);
		if abort.is_aborted() {
			return Err(aborted_now());
		}
		let graph = get_graph(&ScopedGraph::new(self.0.graphs(), scope)).map_err(JobError::Failed)?;
		let related = self.0.related_facts(scope, &graph.nodes, stretch, RELATED_FACTS).await.map_err(JobError::Failed)?;
		let context = graph_context(&graph, source_id, &related);
		let prompt = if context.is_empty() { view.to_owned() } else { format!("{context}\n\n{view}") };
		let existing: HashSet<String> = graph.nodes.iter().filter_map(|n| n["id"].as_str().map(str::to_owned)).collect();
		let never = "the extractor never submitted findings";
		let mut opts = match door {
			Door::Session(batch_ids) => {
				let mut opts = SubmitAgentOptions::new("submit_findings", "Submit the session findings.", session_findings_schema(), extractor_instructions(), Json::from(prompt), never);
				opts.validate = Some(Box::new(move |value| {
					let problem = validate_session_anchors(value, &batch_ids, &existing).or_else(|| validate_findings_chains(value, &existing));
					Box::pin(async move { problem })
				}));
				opts
			}
			Door::Notes(may_be_course_info) => {
				let mut opts = SubmitAgentOptions::new("submit_findings", "Submit the notes findings.", notes_findings_schema(may_be_course_info), notes_extractor_instructions(may_be_course_info), Json::from(prompt), never);
				opts.fill = Some(Box::new(fill_notes_findings));
				opts.validate = Some(Box::new(move |value| {
					let problem = validate_findings_chains(value, &existing);
					Box::pin(async move { problem })
				}));
				opts
			}
		};
		opts.engine = self.0.engine();
		opts.abort = Some(abort);
		opts.task_label = Some(self.task_label(key));
		let (host, step_key) = (self.0.clone(), key.to_owned());
		opts.on_step = Some(Arc::new(move |usage, model| host.state().runs.record_step(&step_key, call_usage(usage), model)));
		Ok(run_submit_agent(self.0.bridge(), opts).await?)
	}

	/// Merges one job's findings under the graph's file lock.
	fn merge(&self, source_id: &str, scope: Option<&str>, findings: &Json, source: &MergeSource) -> Result<Json, JobError> {
		let _held = self.0.locks().lock(LockKey::Graph(scope));
		merge_findings(source_id, findings, &ScopedGraph::new(self.0.graphs(), scope), source).map_err(JobError::Failed)
	}

	/// Appends the job's usage record to its source's log, success or failure (a failed job
	/// still spent tokens; `stats` absent means nothing merged). Idempotent per start time.
	fn persist_run_usage(&self, key: &str, scope: Option<&str>, duration_ms: i64, stats: Option<&Json>) -> Result<(), String> {
		let Some(run) = self.runs().get(key) else { return Ok(()) };
		// A lesson deleted mid-run has no log to append to.
		if run.kind == RunKind::Chat && self.0.chats().get_chat(&run.chat_id).is_none() {
			return Ok(());
		}
		let mut entry = Obj::new();
		entry.insert("startedAt", run.started_at);
		entry.insert("at", time::iso_now());
		entry.insert("durationMs", duration_ms);
		if let Some(stats) = stats {
			entry.insert("stats", stats.clone());
		}
		let extractor = run.extractor_usage.unwrap_or_else(|| json!({ "model": "unknown", "steps": [] }));
		entry.insert("stages", json!({ "extractor": extractor }));
		let entry = Json::Obj(entry);
		match run.kind {
			RunKind::Notes => self.0.graphs().append_source_usage(scope, &run.chat_id, &entry),
			_ => self.0.chats().append_extraction_usage(&run.chat_id, &entry),
		}
	}

	/// One job's lifecycle: its body, its usage record, and its registry row removed on any exit.
	async fn run_job<F>(&self, key: &str, scope: Option<&str>, body: F) -> Result<Json, JobError>
	where
		F: Future<Output = Result<Json, JobError>>,
	{
		let _finish = Finish { host: self.0.as_ref(), key };
		let t0 = Instant::now();
		let err = match body.await {
			Ok(stats) => match self.persist_run_usage(key, scope, elapsed_ms(t0), Some(&stats)) {
				Ok(()) => return Ok(stats),
				Err(usage_err) => JobError::Failed(usage_err),
			},
			Err(err) => err,
		};
		// Read before the row goes: a usage write that fails after an abort must not hide it.
		let aborted = self.runs().get(key).is_some_and(|run| run.abort.is_aborted()) || err.is_abort();
		if let Err(usage_err) = self.persist_run_usage(key, scope, elapsed_ms(t0), None) {
			if !aborted {
				return Err(JobError::Failed(usage_err));
			}
			return Err(JobError::Aborted(format!("extraction aborted; job cleanup failed: {usage_err}")));
		}
		Err(err)
	}

	/// Extracts and merges what one lesson's coverage does not hold yet. Single-flight per
	/// lesson; Err only before any job ran (no lesson, an unreadable graph).
	pub async fn run_extraction(&self, chat_id: &str) -> Result<Json, String> {
		if !self.runs().claim(chat_id) {
			return Ok(Stats::default().to_json());
		}
		let claimed = Claimed { host: self.0.as_ref(), chat_id };
		let result = self.extract_chat(chat_id).await;
		if let Err(err) = &result {
			eprintln!("[extraction {chat_id}] pipeline failed: {err}");
		}
		drop(claimed);
		self.0.on_graph_written(self.scope_of_chat(chat_id).as_deref());
		result
	}

	async fn extract_chat(&self, chat_id: &str) -> Result<Json, String> {
		// Read under the lesson's lock: a move or delete holds it from its last check that no run
		// claimed the lesson through the change, so this run reads the class it ends up in.
		let record = {
			let _held = self.0.locks().lock(LockKey::Chat(chat_id));
			self.0.chats().get_chat(chat_id)
		};
		let record = record.ok_or_else(|| format!("Chat not found: {chat_id}"))?;
		// The lesson's graph, fixed for the whole run (a class move is refused while it runs).
		let scope = record["classId"].as_str().map(str::to_owned);
		let messages = record["messages"].as_arr().map_or(&[][..], Vec::as_slice);
		let entries = ScopedGraph::new(self.0.graphs(), scope.as_deref()).read_coverage()?;
		let covered = coverage_of(messages, &entries, chat_id);
		if covered.uncovered.is_empty() {
			return Ok(Stats::default().to_json());
		}
		let failed = failed_output_call_ids(messages);
		let title = record["title"].as_str();
		// A tool call and its results always share a batch.
		let batches = batch_runs(&covered.slots, &covered.uncovered, chunk_tokens());
		let mut settled = Vec::new();
		for (i, batch) in batches.iter().enumerate() {
			let part = (batches.len() > 1).then_some((i + 1, batches.len()));
			let key = job_key(chat_id, part);
			let result = self.run_job(&key, scope.as_deref(), self.chat_batch(&key, chat_id, scope.as_deref(), title, batch, part, &failed)).await;
			let aborted = result.as_ref().is_err_and(JobError::is_abort);
			settled.push(result);
			// An abort ends the whole run; a failed batch leaves the rest going.
			if aborted {
				break;
			}
		}
		Ok(aggregate_jobs(chat_id, &settled))
	}

	#[allow(clippy::too_many_arguments)]
	async fn chat_batch(&self, key: &str, chat_id: &str, scope: Option<&str>, title: Option<&str>, batch: &[CoverageSlot<'_>], part: Option<(usize, usize)>, failed: &HashSet<String>) -> Result<Json, JobError> {
		let messages: Vec<&Json> = batch.iter().map(|slot| slot.message).collect();
		let view = prose_view(&messages, title, failed);
		// The only anchors this job's submit may name.
		let batch_ids: HashSet<String> = messages.iter().filter(|m| !message_view_lines(m, message_id(m), Some(failed)).is_empty()).map(|m| message_id(m).to_owned()).collect();
		self.with_graph_lock(key, RunKind::Chat, None, part, async {
			self.set_phase(key, ExtractionPhase::Extracting, RunKind::Chat, None, part);
			let raw = self.extract(key, chat_id, scope, &view, &view, Door::Session(batch_ids)).await?;
			let findings = as_session_findings(&raw);
			self.set_phase(key, ExtractionPhase::Merging, RunKind::Chat, None, part);
			// A lesson deleted mid-run never merges: this ends the job like an abort.
			if self.0.chats().get_chat(chat_id).is_none() {
				return Err(JobError::Aborted(format!("chat deleted mid-run: {chat_id}")));
			}
			let folded_at = time::iso_now();
			let coverage: Vec<Json> = batch.iter().filter(|slot| slot.tokens > 0).map(|slot| json!({ "chatId": chat_id, "fp": slot.fp, "tokens": slot.tokens, "foldedAt": folded_at })).collect();
			let stats = self.merge(chat_id, scope, &findings, &MergeSource { folded_at: folded_at.clone(), coverage: Some(coverage) })?;
			eprintln!("[extraction {key}] merged: {} nodes, {} chains", gs_json::stringify(&stats["nodes"]), gs_json::stringify(&stats["chains"]));
			Ok(stats)
		})
		.await
	}

	/// Runs the pipeline over one raw notes file. Re-importing a file runs it again under the
	/// same source id.
	pub async fn import_notes(&self, input: NotesImportInput) -> Result<Json, NotesImportError> {
		let id = input.source_id.clone().unwrap_or_else(|| format!("src_{}", &hash::sha256_text(&input.file_path)[..12]));
		// Claimed before the source record is touched, so overlapping imports change nothing.
		if !self.runs().claim(&id) {
			return Err(NotesImportError { outcome: ImportOutcome::Busy, partial_stats: Stats::default().to_json(), message: "This file is already being imported. Try again when it finishes.".to_owned() });
		}
		let scope = input.scope.as_deref();
		let imported_at = time::iso_now();
		let upserted = self.0.graphs().upsert_source(scope, &json!({ "id": id, "filePath": input.file_path, "importedAt": imported_at }));
		let result = match upserted {
			Ok(()) => {
				let result = self.notes_jobs(&id, &input, &imported_at).await;
				self.runs().finish(self.0.events(), &id);
				result
			}
			Err(message) => Err(NotesImportError { outcome: ImportOutcome::Failed, partial_stats: Stats::default().to_json(), message }),
		};
		if let Err(err) = &result {
			eprintln!("[extraction {id}] notes pipeline failed: {}", err.message);
		}
		self.runs().release(&id);
		self.0.on_graph_written(scope);
		result
	}

	async fn notes_jobs(&self, id: &str, input: &NotesImportInput, imported_at: &str) -> Result<Json, NotesImportError> {
		let scope = input.scope.as_deref();
		let label = input.file_path.as_str();
		let chunks = chunk_notes(&input.text, chunk_tokens());
		let mut merged = Stats::default();
		let mut settled = Vec::new();
		for (i, chunk) in chunks.iter().enumerate() {
			let part = (chunks.len() > 1).then_some((i + 1, chunks.len()));
			let key = job_key(id, part);
			// Only the first stretch decides course info; then nothing is extracted.
			let may_be_course_info = input.may_be_course_info && i == 0;
			let mut course_info = false;
			let job = self.with_graph_lock(&key, RunKind::Notes, Some(label), part, async {
				self.set_phase(&key, ExtractionPhase::Extracting, RunKind::Notes, Some(label), part);
				let view = notes_view(label, chunk, part);
				let raw = self.extract(&key, id, scope, &view, chunk, Door::Notes(may_be_course_info)).await?;
				if may_be_course_info && raw["courseInfo"] == Json::Bool(true) {
					course_info = true;
					return Ok(Stats::default().to_json());
				}
				self.set_phase(&key, ExtractionPhase::Merging, RunKind::Notes, Some(label), part);
				let stats = self.merge(id, scope, &as_session_findings(&raw), &MergeSource { folded_at: imported_at.to_owned(), coverage: None })?;
				// Counted before the usage write can fail.
				merged.add(&stats);
				Ok(stats)
			});
			let result = self.run_job(&key, scope, job).await;
			let aborted = result.as_ref().is_err_and(JobError::is_abort);
			settled.push(result);
			if aborted {
				break;
			}
			if course_info {
				eprintln!("[extraction {id}] course info, nothing extracted ({label})");
				return Ok(json!({ "nodes": 0, "chains": 0, "courseInfo": true }));
			}
		}
		let stats = aggregate_jobs(id, &settled);
		// Completion is every chunk done; zero findings (or an empty file) is a valid result.
		let rejected: Vec<&JobError> = settled.iter().filter_map(|r| r.as_ref().err()).collect();
		if !rejected.is_empty() || settled.len() != chunks.len() {
			let outcome = if rejected.iter().any(|e| e.is_abort()) {
				ImportOutcome::Aborted
			} else if settled.iter().any(Result::is_ok) {
				ImportOutcome::Partial
			} else {
				ImportOutcome::Failed
			};
			let details: Vec<&str> = rejected.iter().map(|e| e.message()).collect();
			let message = if details.is_empty() { "Notes import did not complete".to_owned() } else { details.join("; ") };
			return Err(NotesImportError { outcome, partial_stats: merged.to_json(), message });
		}
		Ok(stats)
	}
}

/// What the source's jobs merged: failures and aborts are logged and counted as nothing.
fn aggregate_jobs(source_id: &str, settled: &[Result<Json, JobError>]) -> Json {
	let mut stats = Stats::default();
	let (mut aborted, mut failed) = (false, 0);
	for result in settled {
		match result {
			Ok(merged) => stats.add(merged),
			Err(err) if err.is_abort() => aborted = true,
			Err(err) => {
				failed += 1;
				eprintln!("[extraction {source_id}] job failed (isolated): {}", err.message());
			}
		}
	}
	if aborted {
		eprintln!("[extraction {source_id}] aborted: merged chunks keep their coverage, the rest stay uncovered for the next run");
	}
	if failed > 0 {
		eprintln!("[extraction {source_id}] {failed} job(s) failed; successful jobs still merged");
	}
	stats.to_json()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn stats_sum_and_drop_counts_only_when_some_dropped() {
		let mut stats = Stats::default();
		stats.add(&json!({ "nodes": 2, "chains": 1 }));
		assert_eq!(gs_json::stringify(&stats.to_json()), r#"{"nodes":2,"chains":1}"#);
		stats.add(&json!({ "nodes": 1, "chains": 0, "droppedChains": 1 }));
		assert_eq!(gs_json::stringify(&stats.to_json()), r#"{"nodes":3,"chains":1,"droppedChains":1}"#);
		let settled = vec![Ok(json!({ "nodes": 1, "chains": 2 })), Err(JobError::Failed("x".into())), Err(JobError::Aborted("aborted".into()))];
		assert_eq!(aggregate_jobs("s", &settled), json!({ "nodes": 1, "chains": 2 }));
	}

	#[test]
	fn usage_steps_fill_the_optional_counts() {
		let usage = json!({ "input": 10, "output": 5, "cacheRead": 0, "cacheWrite": 1, "totalTokens": 16 });
		assert_eq!(
			gs_json::stringify(&call_usage(&usage)),
			r#"{"inputTokens":10,"outputTokens":5,"cacheReadTokens":0,"cacheWriteTokens":1,"cacheWrite1hTokens":0,"reasoningTokens":0}"#
		);
		assert_eq!(job_key("chat_1", None), "chat_1");
		assert_eq!(job_key("src_1", Some((2, 3))), "src_1#2");
	}
}
