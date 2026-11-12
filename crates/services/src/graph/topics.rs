//! Topic grouping (server/topics.ts): when an extraction writes a space graph, or a space's file
//! queue drains, a grouping run is asked for. Requests are debounced (20 s on the app clock) and
//! single-flight per space (a request during a run queues exactly one more). A run is skipped with
//! fewer than 4 facts, the graph off, files still waiting or being read, or the same fact set as
//! the last snapshot. It shows in the activity dock (kind "topics"), runs on the outside agent,
//! and appends one full snapshot to the graph's topics.jsonl.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use gs_agent::extraction::topic_grouper::{TopicGrouperInput, group_topics};
use gs_agent::subagents::bg_llm_semaphore::with_bg_llm_slot;
use gs_agent::subagents::pi_run::RunError;
use gs_base::locks::LockKey;
use gs_base::{clock, time};
use gs_core::graph::graph::get_graph;
use gs_core::graph::topics::{MIN_FACTS_FOR_TOPICS, resolve_topics, same_fact_set};
use gs_json::{Json, json};
use gs_store::graph::Ledger;
use parking_lot::Mutex;
use tokio::task::JoinHandle;

use super::extraction_runs::runs;
use super::graph::graph_store_for;
use crate::App;

/// How long the scheduler waits for more graph writes before running.
const TOPIC_GROUPING_DEBOUNCE_MS: i64 = 20_000;

#[derive(Default)]
struct Inner {
	timers: HashMap<String, JoinHandle<()>>,
	running: HashSet<String>,
	/// Spaces asked for again while running: one more run follows.
	again: HashSet<String>,
}

#[derive(Default)]
pub struct TopicGrouping(Mutex<Inner>);

/// The dock and abort key of a space's grouping run.
pub fn topic_run_key(space_id: &str) -> String {
	format!("topics:{space_id}")
}

/// True while a grouping run for the space is going.
pub fn topic_grouping_running(app: &App, space_id: &str) -> bool {
	app.graph.topics.0.lock().running.contains(space_id)
}

/// Asks for a grouping run 20 s from now; a later request starts the wait over.
pub fn schedule_topic_grouping(app: &Arc<App>, space_id: &str) {
	let timer = tokio::spawn({
		let (app, space_id) = (app.clone(), space_id.to_owned());
		async move {
			clock::sleep(TOPIC_GROUPING_DEBOUNCE_MS).await;
			{
				let mut inner = app.graph.topics.0.lock();
				if inner.timers.get(&space_id).is_some_and(|timer| timer.id() == tokio::task::id()) {
					inner.timers.remove(&space_id);
				}
			}
			run_single_flight(&app, &space_id);
		}
	});
	if let Some(prev) = app.graph.topics.0.lock().timers.insert(space_id.to_owned(), timer) {
		prev.abort();
	}
}

/// Drops a pending run and stops a running one (the space is being deleted).
pub fn cancel_topic_grouping(app: &App, space_id: &str) {
	{
		let mut inner = app.graph.topics.0.lock();
		if let Some(timer) = inner.timers.remove(space_id) {
			timer.abort();
		}
		inner.again.remove(space_id);
	}
	runs(app).abort_extraction(&topic_run_key(space_id));
}

fn run_single_flight(app: &Arc<App>, space_id: &str) {
	{
		let mut inner = app.graph.topics.0.lock();
		if inner.running.contains(space_id) {
			inner.again.insert(space_id.to_owned());
			return;
		}
		inner.running.insert(space_id.to_owned());
	}
	let (app, space_id) = (app.clone(), space_id.to_owned());
	tokio::spawn(async move {
		if let Err(err) = group_once(&app, &space_id).await {
			eprintln!("[topics {space_id}] grouping failed: {err}");
		}
		let again = {
			let mut inner = app.graph.topics.0.lock();
			inner.running.remove(&space_id);
			inner.again.remove(&space_id)
		};
		if again {
			run_single_flight(&app, &space_id);
		}
	});
}

async fn group_once(app: &Arc<App>, space_id: &str) -> Result<(), String> {
	let Some(record) = app.stores.spaces.get_space(space_id) else { return Ok(()) };
	let Some(space_name) = record["name"].as_str() else { return Ok(()) };
	if !app.stores.settings.effective_settings()?["graph"]["enabled"].truthy() {
		return Ok(());
	}
	// Grouping reads the whole graph, so a space importing many files groups once, at the end.
	if record["files"].as_arr().into_iter().flatten().any(|f| matches!(f["status"].as_str(), Some("pending" | "extracting"))) {
		return Ok(());
	}
	let scope = Some(space_id);
	let graph = get_graph(graph_store_for(app, scope).as_ref())?;
	if graph.nodes.len() < MIN_FACTS_FOR_TOPICS {
		return Ok(());
	}
	let fact_ids: Vec<String> = graph.nodes.iter().map(|f| f["id"].str_or_empty().to_owned()).collect();
	let last = app.stores.graphs.read_topics(scope)?;
	if same_fact_set(last.as_ref(), &fact_ids) {
		return Ok(());
	}

	let run_key = topic_run_key(space_id);
	let abort = runs(app).start_background_graph_run(&app.events, &run_key, &format!("Topic grouping: {space_name}"));
	let current: Vec<Json> = resolve_topics(last.as_ref(), &fact_ids).into_iter().filter(|t| !t["ungrouped"].truthy()).collect();
	let input = TopicGrouperInput {
		space_name: space_name.to_owned(),
		facts: graph.nodes.iter().map(|f| json!({ "id": f["id"], "name": f["name"], "statement": f["statement"] })).collect(),
		chains: graph.chains,
		current,
		engine: None,
		abort: Some(abort.clone()),
	};
	let grouped = with_bg_llm_slot(&app.graph.bg_llm, Some(&abort), || group_topics(&app.bridge, input)).await;
	// The space lock: a space delete that stopped this run finishes before the run ends.
	let _guard = app.locks.lock(LockKey::Space(space_id));
	let result = match grouped {
		// Aborted while queued for a permit, or stopped mid-run: nothing to write.
		Err(_) => Ok(()),
		Ok(Err(err)) if abort.is_aborted() || err == RunError::Aborted => Ok(()),
		Ok(Err(err)) => Err(err.to_string()),
		// A space deleted mid-run: never recreate its folder.
		Ok(Ok(_)) if app.stores.spaces.get_space(space_id).is_none() => Ok(()),
		Ok(Ok(topics)) => app.stores.graphs.append(scope, Ledger::Topics, &json!({ "at": time::iso_now(), "topics": topics })),
	};
	runs(app).finish_background_graph_run(&app.events, &run_key);
	result
}
