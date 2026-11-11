//! The pure fold behind the graph view's cost pill.
//! A stage-run is a plan run (named by its plan's label) or counted unpriced; a stage that never
//! reached the model cost nothing and is not counted. Tokens always sum.

use gs_json::{Json, Obj};

use super::prices::{CallUsage, is_subscription_model, subscription_labels, sum_steps};

const RECENT_RUNS: usize = 10;

/// One pipeline stage's cumulative cost across every run.
#[derive(Default)]
struct StageCost {
	subscription_runs: Option<u32>,
	subscription_providers: Option<Vec<String>>,
	unpriced_runs: u32,
	runs: u32,
	tokens: CallUsage,
}

impl StageCost {
	/// Folds one stage's steps into the totals. The long-cache split is folded before the write
	/// total changes, so an older write-bearing total with no split stays unknown.
	fn merge_tokens(&mut self, steps: &[CallUsage]) {
		let summed = sum_steps(steps);
		let t = &mut self.tokens;
		t.cache_write_1h_tokens = sum_steps(&[t.clone(), summed.clone()]).cache_write_1h_tokens;
		let add = |a: Option<f64>, b: Option<f64>| Some(a.unwrap_or(0.0) + b.unwrap_or(0.0));
		t.input_tokens = add(t.input_tokens, summed.input_tokens);
		t.output_tokens = add(t.output_tokens, summed.output_tokens);
		t.cache_read_tokens = add(t.cache_read_tokens, summed.cache_read_tokens);
		t.cache_write_tokens = add(t.cache_write_tokens, summed.cache_write_tokens);
		t.reasoning_tokens = add(t.reasoning_tokens, summed.reasoning_tokens);
	}

	fn fold(&mut self, stage: &Json) {
		self.runs += 1;
		self.merge_tokens(&steps_of(stage));
		let model = stage["model"].as_str();
		if is_subscription_model(model) {
			self.subscription_runs = Some(self.subscription_runs.unwrap_or(0) + 1);
			let providers = self.subscription_providers.get_or_insert_with(Vec::new);
			for label in subscription_labels(&[model]) {
				if !providers.contains(&label) {
					providers.push(label);
				}
			}
		} else {
			self.unpriced_runs += 1;
		}
	}

	fn to_json(&self) -> Json {
		let mut out = Obj::new();
		out.insert("unpricedRuns", f64::from(self.unpriced_runs));
		out.insert("runs", f64::from(self.runs));
		out.insert("tokens", self.tokens_json());
		if let Some(n) = self.subscription_runs {
			out.insert("subscriptionRuns", f64::from(n));
		}
		if let Some(p) = &self.subscription_providers {
			out.insert("subscriptionProviders", p.iter().cloned().map(Json::Str).collect::<Json>());
		}
		Json::Obj(out)
	}

	/// A stage never merged has no counts at all; after a merge the long-cache split comes last.
	fn tokens_json(&self) -> Json {
		let t = &self.tokens;
		let mut out = Obj::new();
		for (key, value) in [
			("inputTokens", t.input_tokens),
			("outputTokens", t.output_tokens),
			("cacheReadTokens", t.cache_read_tokens),
			("cacheWriteTokens", t.cache_write_tokens),
			("reasoningTokens", t.reasoning_tokens),
			("cacheWrite1hTokens", t.cache_write_1h_tokens),
		] {
			if let Some(n) = value {
				out.insert(key, n);
			}
		}
		Json::Obj(out)
	}
}

fn steps_of(stage: &Json) -> Vec<CallUsage> {
	stage["steps"].as_arr().map_or_else(Vec::new, |steps| steps.iter().map(CallUsage::from_json).collect())
}

/// A stage with no steps never reached the model (an abort while queued).
fn reached_model(stage: &Json) -> bool {
	stage["steps"].as_arr().is_some_and(|s| !s.is_empty())
}

struct RecentRun {
	started_at: f64,
	json: Json,
}

/// `title` is the chat title or source path, left out when the owner has none.
fn fold_run(run: &Json, title: Option<&Json>, extraction: &mut StageCost, audit: &mut StageCost, runs: &mut Vec<RecentRun>) {
	// Records from before the linking stage was folded in carry an auditor stage.
	let extractor = &run["stages"]["extractor"];
	let auditor = &run["stages"]["auditor"];
	if reached_model(extractor) {
		extraction.fold(extractor);
	}
	if reached_model(auditor) {
		audit.fold(auditor);
	}
	let stages: Vec<&Json> = [extractor, auditor].into_iter().filter(|s| reached_model(s)).collect();
	if stages.is_empty() {
		return;
	}
	let models: Vec<Option<&str>> = stages.iter().map(|s| s["model"].as_str()).collect();
	let subscription_runs = models.iter().filter(|m| is_subscription_model(**m)).count();
	let unpriced_runs = stages.len() - subscription_runs;
	let all_steps: Vec<CallUsage> = stages.iter().flat_map(|s| steps_of(s)).collect();

	let mut out = Obj::new();
	if subscription_runs > 0 {
		out.insert("subscriptionRuns", subscription_runs as f64);
		out.insert("subscriptionProviders", subscription_labels(&models).into_iter().map(Json::Str).collect::<Json>());
	}
	if unpriced_runs > 0 {
		out.insert("unpricedRuns", unpriced_runs as f64);
	}
	if let Some(at) = run.get("startedAt") {
		out.insert("startedAt", at.clone());
	}
	if let Some(title) = title {
		out.insert("title", title.clone());
	}
	out.insert("tokens", sum_steps(&all_steps).to_json());
	if run["stats"].truthy() {
		out.insert("merged", run["stats"].clone());
	}
	// Subtraction reads null as 0 and a missing time as NaN.
	let started_at = match run.get("startedAt") {
		Some(Json::Null) => 0.0,
		at => at.and_then(Json::as_f64).unwrap_or(f64::NAN),
	};
	runs.push(RecentRun { started_at, json: Json::Obj(out) });
}

/// Newest first. A stable insertion sort, so unordered times (NaN) never reorder, as with the
/// original comparator `b.startedAt - a.startedAt`.
fn newest_first(runs: Vec<RecentRun>) -> Vec<RecentRun> {
	let mut sorted: Vec<RecentRun> = Vec::with_capacity(runs.len());
	for run in runs {
		let mut place = sorted.len();
		while place > 0 && run.started_at - sorted[place - 1].started_at > 0.0 {
			place -= 1;
		}
		sorted.insert(place, run);
	}
	sorted
}

/// `graphCostSummary`: `{stages: {extraction, audit}, runs}` from chat and notes-source runs.
pub fn graph_cost_summary(input: &Json) -> Json {
	let mut extraction = StageCost::default();
	let mut audit = StageCost::default();
	let mut runs: Vec<RecentRun> = Vec::new();
	for (list, title_key) in [("chats", "title"), ("sources", "filePath")] {
		for owner in input[list].as_arr().into_iter().flatten() {
			let title = owner.get(title_key);
			for run in owner["extractions"].as_arr().into_iter().flatten() {
				fold_run(run, title, &mut extraction, &mut audit, &mut runs);
			}
		}
	}
	let recent: Vec<Json> = newest_first(runs).into_iter().take(RECENT_RUNS).map(|r| r.json).collect();
	let mut stages = Obj::new();
	stages.insert("extraction", extraction.to_json());
	stages.insert("audit", audit.to_json());
	let mut out = Obj::new();
	out.insert("stages", stages);
	out.insert("runs", recent);
	Json::Obj(out)
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;

	fn run(at: f64, model: &str) -> Json {
		json!({ "startedAt": at, "stats": { "nodes": 1 }, "stages": { "extractor": { "model": model, "steps": [{ "inputTokens": 3, "outputTokens": 2, "cacheWriteTokens": 4 }] }, "auditor": { "model": "x", "steps": [] } } })
	}

	#[test]
	fn folds_stages_and_lists_newest_runs() {
		let input = json!({ "chats": [{ "title": "A", "extractions": [run(1.0, "agent:q"), run(5.0, "old")] }], "sources": [{ "filePath": "f.md", "extractions": [run(3.0, "agent:q")] }] });
		let out = graph_cost_summary(&input);
		let stages = &out["stages"];
		assert_eq!(stringify(&stages["audit"]), r#"{"unpricedRuns":0,"runs":0,"tokens":{}}"#);
		assert_eq!(stringify(&stages["extraction"]["tokens"]), r#"{"inputTokens":9,"outputTokens":6,"cacheReadTokens":0,"cacheWriteTokens":12,"reasoningTokens":0}"#);
		assert_eq!(stages["extraction"]["subscriptionRuns"].as_f64(), Some(2.0));
		let times: Vec<f64> = out["runs"].as_arr().unwrap().iter().filter_map(|r| r["startedAt"].as_f64()).collect();
		assert_eq!(times, [5.0, 3.0, 1.0]);
		assert_eq!(out["runs"][0]["unpricedRuns"].as_f64(), Some(1.0));
		assert_eq!(out["runs"][0]["merged"]["nodes"].as_f64(), Some(1.0));
	}
}
