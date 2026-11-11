//! The run registry's reads and the dock's abort (extraction-runs.ts), for the activity feed,
//! the lesson and class guards and the routes.

use gs_agent::extraction::extraction_runs::{ExtractionRuns, RunningExtraction};
use gs_json::{Json, Obj, json};

use crate::App;

/// The registry itself (the single-flight guard: `runs(app).in_flight(chat_id)`).
pub fn runs(app: &App) -> &ExtractionRuns {
	&app.graph.extraction.runs
}

fn status_json(run: &RunningExtraction) -> Json {
	let mut out = Obj::new();
	out.insert("chatId", run.chat_id.as_str());
	if let Some((i, n)) = run.part {
		out.insert("part", json!({ "i": i, "n": n }));
	}
	out.insert("kind", run.kind.as_str());
	if let Some(label) = &run.label {
		out.insert("label", label.as_str());
	}
	out.insert("phase", run.phase.as_str());
	out.insert("startedAt", run.started_at);
	Json::Obj(out)
}

/// The runs in flight, oldest first: `{ chatId, part?, kind, label?, phase, startedAt }`.
pub fn extraction_statuses(app: &App) -> Vec<Json> {
	runs(app).statuses().iter().map(status_json).collect()
}

/// Cancels every job of a source (the dock's abort): the model call in flight is cancelled,
/// nothing more merges. False when nothing of it runs.
pub fn abort_extraction(app: &App, source_id: &str) -> bool {
	runs(app).abort_extraction(source_id)
}
