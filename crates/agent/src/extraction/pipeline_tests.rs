//! The pipeline end to end on real stores in a temporary folder, with a scripted model.

use std::path::PathBuf;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_base::config::Paths;
use gs_base::events::Events;
use gs_base::locks::Locks;
use gs_base::{fsx, ids};
use gs_core::graph::graph::get_graph;
use gs_core::graph::ports::GraphStore;
use gs_engine::bridge::Bridge;
use gs_engine::turn::faux::{Engine, Scripted, faux_model};
use gs_engine::turn::messages::{faux_assistant_message, text_block};
use gs_json::{Json, json, stringify_pretty};
use gs_store::Stores;
use gs_store::chats::ChatStore;
use gs_store::graph::GraphStores;
use parking_lot::Mutex;

use super::extraction::{Extraction, ExtractionHost, ExtractionState, ImportOutcome, NotesImportInput};
use super::extraction_runs::ExtractionPhase;
use super::ledgers::ScopedGraph;

pub(super) struct Host {
	pub stores: Stores,
	events: Events,
	locks: Locks,
	pub bridge: Bridge,
	pub state: ExtractionState,
	script: Mutex<Arc<Scripted>>,
	written: Mutex<Vec<Option<String>>>,
	pub dir: PathBuf,
}

impl ExtractionHost for Host {
	fn chats(&self) -> &ChatStore {
		&self.stores.chats
	}
	fn graphs(&self) -> &Arc<GraphStores> {
		&self.stores.graphs
	}
	fn events(&self) -> &Events {
		&self.events
	}
	fn locks(&self) -> &Locks {
		&self.locks
	}
	fn bridge(&self) -> &Bridge {
		&self.bridge
	}
	fn state(&self) -> &ExtractionState {
		&self.state
	}
	fn engine(&self) -> Option<Engine> {
		Some(Engine { model: faux_model("godspeed-agent", "agent", "outside-agent", "Outside agent (MCP)", 200_000.0, 32_000.0), respond: self.script() })
	}
	fn on_graph_written(&self, scope: Option<&str>) {
		self.written.lock().push(scope.map(str::to_owned));
	}
	/// Every existing idea, in ledger order.
	fn related_facts<'a>(&'a self, _scope: Option<&'a str>, nodes: &'a [Json], _text: &'a str, limit: usize) -> BoxFuture<'a, Result<Vec<String>, String>> {
		Box::pin(async move { Ok(nodes.iter().filter_map(|n| n["id"].as_str().map(str::to_owned)).take(limit).collect()) })
	}
}

impl Drop for Host {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.dir);
	}
}

impl Host {
	/// The model's script for the calls to come.
	pub fn script(&self) -> Arc<Scripted> {
		self.script.lock().clone()
	}

	/// A new empty script, so replies left over from earlier never answer later calls.
	pub fn new_script(&self) -> Arc<Scripted> {
		let script = Scripted::new();
		*self.script.lock() = script.clone();
		script
	}
}

pub(super) fn host() -> Arc<Host> {
	let dir = std::env::temp_dir().join(ids::bytes_hex("gs-extraction-test", 6));
	let paths = Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.clone());
	let (events, locks) = (Events::new(), Locks::new());
	let stores = Stores::new(&paths, &events, &locks);
	let bridge = Bridge::new(&events, stores.agent_seen.clone());
	Arc::new(Host { stores, events, locks, bridge, state: ExtractionState::default(), script: Mutex::new(Scripted::new()), written: Mutex::new(Vec::new()), dir })
}

pub(super) fn submit(findings: Json) -> Json {
	faux_assistant_message(vec![json!({ "type": "toolCall", "id": ids::uuid(), "name": "submit_findings", "arguments": findings })], "toolUse")
}

pub(super) fn says(text: &str) -> Json {
	faux_assistant_message(vec![text_block(text)], "stop")
}

/// A lesson with one long teacher reply per topic (each about 2,300 tokens).
fn write_lesson(host: &Host, id: &str, topics: usize) {
	let mut messages = Vec::new();
	for i in 0..topics {
		messages.push(json!({ "id": format!("msg_u{i}"), "role": "user", "content": "Explain.", "timestamp": 1 }));
		messages.push(json!({ "id": format!("msg_t{i}"), "role": "assistant", "content": [{ "type": "text", "text": format!("Topic {i} goes like this. ").repeat(400) }], "stopReason": "stop", "timestamp": 2 }));
	}
	let record = json!({ "id": id, "title": "Sorting", "createdAt": "2026-11-09T19:00:00.000Z", "updatedAt": "2026-11-09T19:03:00.000Z", "messages": messages, "kind": "study", "version": 1 });
	let file = host.dir.join("data").join("chats").join(format!("{id}.json"));
	std::fs::create_dir_all(file.parent().unwrap()).unwrap();
	fsx::write_text_atomic(&file, &stringify_pretty(&record, "\t")).unwrap();
}

#[tokio::test]
async fn a_long_lesson_goes_in_parts_and_a_failed_part_stays_uncovered() {
	let host = host();
	write_lesson(&host, "chat_parts", 3);
	host.script().reply(submit(json!({ "propositions": [{ "id": "p1", "name": "Merge", "statement": "Merging is linear.", "messageId": "msg_t0" }], "chains": [], "reteaches": [] })));
	// Part 2: an anchor from part 1 is refused, then a good submit lands.
	host.script().reply(submit(json!({ "propositions": [{ "id": "p1", "name": "Q", "statement": "Quick.", "messageId": "msg_t0" }], "chains": [], "reteaches": [] })));
	host.script().reply(submit(json!({ "propositions": [{ "id": "p1", "name": "Q", "statement": "Quick.", "messageId": "msg_t1" }], "chains": [], "reteaches": [] })));
	// Part 3: text only, so it fails on its own.
	host.script().reply(says("Heaps are trees."));
	let extraction = Extraction::new(host.clone());
	let stats = extraction.run_extraction("chat_parts").await.unwrap();
	assert_eq!(stats, json!({ "nodes": 2, "chains": 0 }));

	let graph = get_graph(&ScopedGraph::new(&host.stores.graphs, None)).unwrap();
	assert_eq!(graph.nodes.len(), 2);
	assert_eq!(graph.nodes[1]["provenance"], json!([{ "chatId": "chat_parts", "messageId": "msg_t1" }]));
	let coverage = ScopedGraph::new(&host.stores.graphs, None).read_coverage().unwrap();
	assert_eq!(coverage.len(), 2, "the failed part stays uncovered");
	let log = host.stores.chats.get_chat("chat_parts").unwrap()["extractions"].clone();
	let steps: Vec<usize> = log.as_arr().unwrap().iter().map(|e| e["stages"]["extractor"]["steps"].as_arr().unwrap().len()).collect();
	assert_eq!(steps, vec![1, 2, 1]);
	assert!(log[2].get("stats").is_none(), "a failed part logs usage without stats");
	assert_eq!(log[0]["stages"]["extractor"]["model"], Json::from("agent:outside-agent"));
	assert!(host.state.runs.statuses().is_empty());
	assert!(!host.state.runs.in_flight("chat_parts"));
	assert_eq!(*host.written.lock(), vec![None]);

	// What is left goes as one part; then nothing is left.
	host.script().reply(submit(json!({ "propositions": [{ "id": "h", "name": "Heap", "statement": "Smallest on top.", "messageId": "msg_t2" }], "chains": [], "reteaches": [] })));
	assert_eq!(extraction.run_extraction("chat_parts").await.unwrap(), json!({ "nodes": 1, "chains": 0 }));
	assert_eq!(extraction.run_extraction("chat_parts").await.unwrap(), json!({ "nodes": 0, "chains": 0 }));
	assert_eq!(extraction.run_extraction("chat_nope").await, Err("Chat not found: chat_nope".to_owned()));
}

#[tokio::test]
async fn notes_import_in_chunks_reports_partial_failures() {
	let host = host();
	let extraction = Extraction::new(host.clone());
	let long = (0..142).map(|i| format!("Line {i:03} {}", "alpha beta gamma delta ".repeat(6))).collect::<Vec<_>>().join("\n");
	host.script().reply(submit(json!({ "propositions": [{ "id": "p1", "name": "Alpha", "statement": "Alpha first.", "messageId": "stray" }], "chains": [], "reteaches": [] })));
	host.script().reply(says("I cannot read this."));
	let input = NotesImportInput { file_path: "notes/half.md".into(), text: long, scope: None, source_id: None, may_be_course_info: false };
	let err = extraction.import_notes(input).await.unwrap_err();
	assert_eq!((err.outcome, err.message.as_str()), (ImportOutcome::Partial, "the extractor never submitted findings"));
	assert_eq!(err.partial_stats, json!({ "nodes": 1, "chains": 0 }));
	let graph = get_graph(&ScopedGraph::new(&host.stores.graphs, None)).unwrap();
	let source_id = format!("src_{}", &gs_base::hash::sha256_text("notes/half.md")[..12]);
	assert_eq!(graph.nodes[0]["provenance"], json!([{ "chatId": source_id, "messageId": "" }]), "notes provenance is file-level");
	let sources = host.stores.graphs.read_sources(None).unwrap();
	assert_eq!(sources[0]["filePath"], Json::from("notes/half.md"));
	assert_eq!(sources[0]["extractions"].as_arr().unwrap().len(), 2);

	// An empty file completes with nothing to read.
	let empty = NotesImportInput { file_path: "notes/empty.md".into(), text: "  \n".into(), scope: None, source_id: None, may_be_course_info: false };
	assert_eq!(extraction.import_notes(empty).await.unwrap(), json!({ "nodes": 0, "chains": 0 }));
}

#[tokio::test]
async fn course_logistics_are_not_extracted_and_a_busy_source_is_refused() {
	let host = host();
	let extraction = Extraction::new(host.clone());
	host.script().reply(submit(json!({ "propositions": [], "chains": [], "reteaches": [], "courseInfo": true })));
	let input = |text: &str| NotesImportInput { file_path: "syllabus.md".into(), text: text.into(), scope: None, source_id: Some("src_fixed".into()), may_be_course_info: true };
	assert_eq!(extraction.import_notes(input("Office hours moved.")).await.unwrap(), json!({ "nodes": 0, "chains": 0, "courseInfo": true }));

	assert!(host.state.runs.claim("src_fixed"));
	let err = extraction.import_notes(input("again")).await.unwrap_err();
	assert_eq!(err.outcome, ImportOutcome::Busy);
}

#[tokio::test]
async fn an_abort_while_waiting_for_the_graph_lock_ends_the_import() {
	let host = host();
	let extraction = Extraction::new(host.clone());
	let held = host.state.graph_lock_for_tests().await;
	let run = tokio::spawn({
		let extraction = extraction.clone();
		async move { extraction.import_notes(NotesImportInput { file_path: "a.md".into(), text: "x".into(), scope: None, source_id: Some("src_a".into()), may_be_course_info: false }).await }
	});
	while host.state.runs.get("src_a").is_none_or(|r| r.phase != ExtractionPhase::Waiting) {
		tokio::task::yield_now().await;
	}
	assert!(host.state.runs.abort_extraction("src_a"));
	let err = run.await.unwrap().unwrap_err();
	assert_eq!((err.outcome, err.message.as_str()), (ImportOutcome::Aborted, "extraction aborted while waiting for the graph lock"));
	drop(held);
	assert!(host.state.runs.statuses().is_empty());
}

#[tokio::test]
async fn a_lesson_run_that_ends_early_lets_go_of_its_claim() {
	let host = host();
	write_lesson(&host, "chat_dropped", 1);
	let extraction = Extraction::new(host.clone());
	let held = host.state.graph_lock_for_tests().await;
	let run = tokio::spawn({
		let extraction = extraction.clone();
		async move { extraction.run_extraction("chat_dropped").await }
	});
	while host.state.runs.get("chat_dropped").is_none_or(|r| r.phase != ExtractionPhase::Waiting) {
		tokio::task::yield_now().await;
	}
	// Its task goes away mid-run, as it would on a panic.
	run.abort();
	assert!(run.await.unwrap_err().is_cancelled());
	drop(held);
	assert!(!host.state.runs.in_flight("chat_dropped"));
	assert!(host.state.runs.statuses().is_empty());
}
