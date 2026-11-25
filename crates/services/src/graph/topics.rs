//! Topic grouping (server/topics.ts): when an extraction writes a space graph, or a space's file
//! queue drains, a grouping run is asked for. Requests are debounced (20 s on the app clock) and
//! single-flight per space (a request during a run queues exactly one more). A run is skipped with
//! fewer than 4 facts, the graph off, files still waiting or being read, or the same fact set as
//! the last snapshot. The first grouping and the one after a file import group every fact. Any
//! other run keeps the topics: each new fact joins its chain neighbors' topic with no model call,
//! and only facts with no grouped neighbor go to the grouper, alone. A model run shows in the
//! activity dock (kind "topics") and runs on the learner's agent. Every run appends one full
//! snapshot to the graph's topics.jsonl.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use gs_agent::extraction::topic_grouper::{TopicGrouperInput, group_topics};
use gs_engine::turn::job_session::RunError;
use gs_base::events::EventKind;
use gs_base::locks::LockKey;
use gs_base::tasks::detach;
use gs_base::{clock, time};
use gs_core::spaces::file_state::FileStatus;
use gs_core::graph::graph::get_graph;
use gs_core::graph::topics::{MIN_FACTS_FOR_TOPICS, place_new_facts, resolve_topics, same_fact_set};
use gs_json::{Json, json};
use gs_store::graph::Ledger;
use parking_lot::Mutex;
use tokio::task::JoinHandle;

use super::extraction_runs::runs;
use super::graph::graph_store_for;
use crate::App;
use crate::jobs::job_agent::job_agent;

/// How long the scheduler waits for more graph writes before running.
const TOPIC_GROUPING_DEBOUNCE_MS: i64 = 20_000;

#[derive(Default)]
struct Inner {
	timers: HashMap<String, JoinHandle<()>>,
	running: HashSet<String>,
	/// Spaces asked for again while running: one more run follows.
	again: HashSet<String>,
	/// Spaces whose next run groups every fact: a file import changed what the graph holds.
	whole: HashSet<String>,
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
	let timer = gs_base::tasks::spawn("topics", {
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

/// Asks for a run that groups every fact, after a file import.
pub fn schedule_whole_topic_grouping(app: &Arc<App>, space_id: &str) {
	app.graph.topics.0.lock().whole.insert(space_id.to_owned());
	schedule_topic_grouping(app, space_id);
}

/// Drops a pending run and stops a running one (the space is being deleted).
pub fn cancel_topic_grouping(app: &App, space_id: &str) {
	{
		let mut inner = app.graph.topics.0.lock();
		if let Some(timer) = inner.timers.remove(space_id) {
			timer.abort();
		}
		inner.again.remove(space_id);
		inner.whole.remove(space_id);
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
	detach("topics", async move {
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
	if record["files"].items().iter().any(|f| FileStatus::of(f).is_some_and(FileStatus::is_waiting)) {
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
		app.graph.topics.0.lock().whole.remove(space_id);
		return Ok(());
	}

	let current: Vec<Json> = resolve_topics(last.as_ref(), &fact_ids).into_iter().filter(|t| !t["ungrouped"].truthy()).collect();
	let whole = current.is_empty() || app.graph.topics.0.lock().whole.contains(space_id);
	let (current, loose) = if whole {
		(current, None)
	} else {
		let (placed, loose) = place_new_facts(&current, &fact_ids, &graph.chains);
		if loose.is_empty() {
			let _guard = app.locks.lock(LockKey::Space(space_id));
			write_topics(app, space_id, placed)?;
			// No run starts or ends here, and the pages that show topics reload on this.
			app.events.emit(EventKind::ActivityChanged, json!({}));
			return Ok(());
		}
		(placed, Some(loose))
	};

	let run_key = topic_run_key(space_id);
	let abort = runs(app).start_background_graph_run(&app.events, &run_key, &format!("Topic grouping: {space_name}"));
	let taken = crate::vault::take_block(app, space_id).await;
	let input = TopicGrouperInput {
		space_name: space_name.to_owned(),
		facts: graph.nodes.iter().map(|f| json!({ "id": f["id"], "name": f["name"], "statement": f["statement"] })).collect(),
		chains: graph.chains,
		current,
		loose,
		abort: Some(abort.clone()),
		notes: taken.as_ref().map(|t| t.riding()),
	};
	let grouped = group_topics(job_agent(app).as_ref(), input).await;
	if let Some(taken) = taken {
		taken.done(app, grouped.is_ok());
	}
	// The space lock: a space delete that stopped this run finishes before the run ends.
	let _guard = app.locks.lock(LockKey::Space(space_id));
	let result = match grouped {
		// Stopped while waiting or mid-run: nothing to write.
		Err(err) if abort.is_aborted() || err == RunError::Aborted => Ok(()),
		Err(err) => Err(err.to_string()),
		Ok(topics) => write_topics(app, space_id, topics),
	};
	runs(app).finish_background_graph_run(&app.events, &run_key);
	result
}

/// Appends a grouping as the space's newest snapshot; the caller holds the space lock. A space
/// deleted meanwhile is left alone: its folder is never recreated.
fn write_topics(app: &App, space_id: &str, topics: Vec<Json>) -> Result<(), String> {
	if app.stores.spaces.get_space(space_id).is_none() {
		return Ok(());
	}
	app.stores.graphs.append(Some(space_id), Ledger::Topics, &json!({ "at": time::iso_now(), "topics": topics }))?;
	app.graph.topics.0.lock().whole.remove(space_id);
	Ok(())
}

#[cfg(test)]
mod tests {
	use gs_store::graph::Ledger;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[tokio::test]
	async fn a_new_fact_with_a_grouped_neighbor_joins_its_topic_with_no_job() {
		let root = scratch_dir("topics");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Algebra" })).unwrap()["id"].str_or_empty().to_owned();
		let scope = Some(space_id.as_str());
		let fact = |id: &str| json!({ "id": id, "name": id, "statement": format!("{id} holds."), "aliases": [], "createdAt": "t", "provenance": [{ "chatId": "c", "messageId": "" }] });
		for id in ["n_a", "n_b", "n_c", "n_d"] {
			app.stores.graphs.append(scope, Ledger::Nodes, &fact(id)).unwrap();
		}
		let topics = json!([{ "id": "tpc_1", "name": "Lines", "members": ["n_a", "n_b"], "material": "concept" }, { "id": "tpc_2", "name": "Slopes", "members": ["n_c", "n_d"] }]);
		app.stores.graphs.append(scope, Ledger::Topics, &json!({ "at": "t", "topics": topics })).unwrap();
		app.stores.graphs.append(scope, Ledger::Nodes, &fact("n_new")).unwrap();
		app.stores.graphs.append(scope, Ledger::Chains, &json!({ "id": "ch_1", "premises": ["n_c"], "conclusion": "n_new", "createdAt": "t", "provenance": [{ "chatId": "c", "messageId": "" }] })).unwrap();

		// A job for the grouper would wait for an agent that never comes.
		tokio::select! {
			done = group_once(&app, &space_id) => done.unwrap(),
			() = clock::sleep(5_000) => panic!("a model was asked"),
		}

		let written = app.stores.graphs.read_topics(scope).unwrap().unwrap();
		assert_eq!(written["topics"], json!([{ "id": "tpc_1", "name": "Lines", "members": ["n_a", "n_b"], "material": "concept" }, { "id": "tpc_2", "name": "Slopes", "members": ["n_c", "n_d", "n_new"] }]));
	}
}
