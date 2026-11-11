//! The registry of running graph jobs (extraction-runs.ts): extraction runs and the topic grouper,
//! what the activity dock lists and what its abort button stops. One per server, in `App`.

use std::collections::HashSet;

use gs_base::clock;
use gs_base::events::{EventKind, Events};
use gs_engine::turn::abort::Abort;
use gs_json::{Json, json};
use parking_lot::Mutex;

/// The pipeline phases, in order: "waiting" is queued behind another job's extract and merge,
/// "grouping" a topic-grouping run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExtractionPhase {
	Waiting,
	Extracting,
	Merging,
	Grouping,
}

impl ExtractionPhase {
	pub fn as_str(self) -> &'static str {
		match self {
			ExtractionPhase::Waiting => "waiting",
			ExtractionPhase::Extracting => "extracting",
			ExtractionPhase::Merging => "merging",
			ExtractionPhase::Grouping => "grouping",
		}
	}
}

/// Which front door a run came through.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunKind {
	Chat,
	Notes,
	Topics,
}

impl RunKind {
	pub fn as_str(self) -> &'static str {
		match self {
			RunKind::Chat => "chat",
			RunKind::Notes => "notes",
			RunKind::Topics => "topics",
		}
	}
}

/// One in-flight run.
#[derive(Clone)]
pub struct RunningExtraction {
	/// The source id (chat id or notes `src_` id): the abort key. The registry key adds "#i" for
	/// the parts of a source that fanned out.
	pub chat_id: String,
	/// Which part of how many, only when the source fanned out.
	pub part: Option<(usize, usize)>,
	pub kind: RunKind,
	/// A notes import's file path; chat runs show the chat's title.
	pub label: Option<String>,
	pub phase: ExtractionPhase,
	pub started_at: i64,
	/// The extractor's live usage, `{ model, steps }`, once a step has finished.
	pub extractor_usage: Option<Json>,
	/// One per run, shared across phases: aborting cancels the model call in flight.
	pub abort: Abort,
}

#[derive(Default)]
struct Inner {
	/// By registry key, in insertion order (a Map).
	running: Vec<(String, RunningExtraction)>,
	/// The single-flight guard of every source.
	in_flight: HashSet<String>,
	/// Kept increasing, so two runs started in one millisecond never share a usage key.
	last_started_at: i64,
}

#[derive(Default)]
pub struct ExtractionRuns {
	inner: Mutex<Inner>,
}

impl Inner {
	fn get(&self, key: &str) -> Option<&RunningExtraction> {
		self.running.iter().find(|(k, _)| k == key).map(|(_, run)| run)
	}

	fn next_started_at(&mut self) -> i64 {
		self.last_started_at = clock::now_ms().max(self.last_started_at + 1);
		self.last_started_at
	}
}

impl ExtractionRuns {
	/// Every run, oldest first.
	pub fn statuses(&self) -> Vec<RunningExtraction> {
		let mut runs: Vec<RunningExtraction> = self.inner.lock().running.iter().map(|(_, run)| run.clone()).collect();
		runs.sort_by_key(|run| run.started_at);
		runs
	}

	pub fn get(&self, key: &str) -> Option<RunningExtraction> {
		self.inner.lock().get(key).cloned()
	}

	/// Claims a source for one run; false when a run of it is already going.
	pub fn claim(&self, source_id: &str) -> bool {
		self.inner.lock().in_flight.insert(source_id.to_owned())
	}

	pub fn release(&self, source_id: &str) {
		self.inner.lock().in_flight.remove(source_id);
	}

	pub fn in_flight(&self, source_id: &str) -> bool {
		self.inner.lock().in_flight.contains(source_id)
	}

	/// Registers the job or moves it to `phase`; a phase change keeps its part, label, start time,
	/// usage and abort. Every change announces the dock.
	pub fn set_phase(&self, events: &Events, key: &str, phase: ExtractionPhase, kind: RunKind, label: Option<&str>, part: Option<(usize, usize)>) {
		let mut inner = self.inner.lock();
		match inner.running.iter_mut().find(|(k, _)| k == key) {
			Some((_, run)) => {
				run.kind = kind;
				run.phase = phase;
				if run.part.is_none() {
					run.part = part;
				}
				if run.label.is_none() {
					run.label = label.map(str::to_owned);
				}
			}
			None => {
				let started_at = inner.next_started_at();
				let chat_id = key.split('#').next().unwrap_or(key).to_owned();
				let run = RunningExtraction { chat_id, part, kind, label: label.map(str::to_owned), phase, started_at, extractor_usage: None, abort: Abort::new() };
				inner.running.push((key.to_owned(), run));
			}
		}
		drop(inner);
		events.emit(EventKind::ActivityChanged, json!({}));
	}

	/// The run is over (done, failed or aborted): it leaves the feed, which is told either way.
	pub fn finish(&self, events: &Events, key: &str) {
		self.inner.lock().running.retain(|(k, _)| k != key);
		events.emit(EventKind::ActivityChanged, json!({}));
	}

	/// Adds one extractor step's usage to the running job.
	pub fn record_step(&self, key: &str, usage: Json, model: &str) {
		let mut inner = self.inner.lock();
		let Some((_, run)) = inner.running.iter_mut().find(|(k, _)| k == key) else { return };
		let stage = run.extractor_usage.get_or_insert_with(|| json!({ "model": model, "steps": [] }));
		if let Some(steps) = stage.get_mut("steps").and_then(Json::as_arr_mut) {
			steps.push(usage);
		}
	}

	/// A background graph job that is not an extraction (the topic grouper) joins the registry so
	/// the dock shows it and its abort works. A second start returns the running one's abort.
	pub fn start_background_graph_run(&self, events: &Events, key: &str, label: &str) -> Abort {
		let mut inner = self.inner.lock();
		if let Some(run) = inner.get(key) {
			return run.abort.clone();
		}
		let started_at = inner.next_started_at();
		let abort = Abort::new();
		let run = RunningExtraction { chat_id: key.to_owned(), part: None, kind: RunKind::Topics, label: Some(label.to_owned()), phase: ExtractionPhase::Grouping, started_at, extractor_usage: None, abort: abort.clone() };
		inner.running.push((key.to_owned(), run));
		drop(inner);
		events.emit(EventKind::ActivityChanged, json!({}));
		abort
	}

	pub fn finish_background_graph_run(&self, events: &Events, key: &str) {
		let mut inner = self.inner.lock();
		let before = inner.running.len();
		inner.running.retain(|(k, _)| k != key);
		let removed = inner.running.len() != before;
		drop(inner);
		if removed {
			events.emit(EventKind::ActivityChanged, json!({}));
		}
	}

	/// Cancels every job of a source (all its parts): the model call in flight is cancelled and
	/// the run ends like a failure. False when nothing of it is running.
	pub fn abort_extraction(&self, source_id: &str) -> bool {
		let aborts: Vec<Abort> = self.inner.lock().running.iter().filter(|(_, run)| run.chat_id == source_id).map(|(_, run)| run.abort.clone()).collect();
		for abort in &aborts {
			abort.abort();
		}
		!aborts.is_empty()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn phases_keep_what_the_job_started_with() {
		let (runs, events) = (ExtractionRuns::default(), Events::new());
		runs.set_phase(&events, "src_1#2", ExtractionPhase::Waiting, RunKind::Notes, Some("a.md"), Some((2, 3)));
		let first = runs.get("src_1#2").unwrap();
		runs.set_phase(&events, "src_1#2", ExtractionPhase::Merging, RunKind::Notes, None, None);
		let now = runs.get("src_1#2").unwrap();
		assert_eq!((now.chat_id.as_str(), now.part, now.label.as_deref(), now.phase), ("src_1", Some((2, 3)), Some("a.md"), ExtractionPhase::Merging));
		assert_eq!(now.started_at, first.started_at);
		runs.record_step("src_1#2", json!({ "inputTokens": 1 }), "agent:outside-agent");
		assert_eq!(runs.get("src_1#2").unwrap().extractor_usage.unwrap()["steps"].as_arr().unwrap().len(), 1);
		assert!(runs.abort_extraction("src_1"));
		assert!(now.abort.is_aborted());
		runs.finish(&events, "src_1#2");
		assert!(!runs.abort_extraction("src_1"));
	}

	#[test]
	fn start_times_never_repeat_and_background_runs_are_single() {
		let (runs, events) = (ExtractionRuns::default(), Events::new());
		let a = runs.start_background_graph_run(&events, "topics:none", "Topic grouping: No class");
		let b = runs.start_background_graph_run(&events, "topics:none", "again");
		b.abort();
		assert!(a.is_aborted());
		runs.set_phase(&events, "chat_1", ExtractionPhase::Waiting, RunKind::Chat, None, None);
		let statuses = runs.statuses();
		assert_eq!(statuses.len(), 2);
		assert!(statuses[0].started_at < statuses[1].started_at);
		assert!(runs.claim("chat_1") && !runs.claim("chat_1") && runs.in_flight("chat_1"));
		runs.release("chat_1");
		assert!(!runs.in_flight("chat_1"));
	}
}
