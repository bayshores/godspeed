use gs_json::{Json, json, parse, stringify};
use gs_store::graph::{GraphStores, Ledger};

use crate::support::Lab;

const NEWER: &str = "Graph data is stamped with format version 2, but this build understands only 1. This version of godspeed is older than your data. Update the app to open your graph.";

fn stores(lab: &Lab) -> GraphStores {
	GraphStores::new(&lab.paths, &lab.locks)
}

fn node(id: &str) -> Json {
	json!({ "id": id, "name": "Limits", "statement": "A limit is a value.", "aliases": ["lim"], "createdAt": "2026-11-01T00:00:00.000Z", "provenance": [{ "chatId": "chat_1", "messageId": "m_1" }] })
}

fn chain(id: &str) -> Json {
	json!({ "id": id, "premises": ["n_1"], "conclusion": "n_2", "provenance": [], "createdAt": "2026-11-01T00:00:00.000Z" })
}

fn topics(at: &str) -> Json {
	json!({ "at": at, "topics": [{ "id": "t_1", "name": "Calculus", "members": ["n_1"] }] })
}

fn source(id: &str) -> Json {
	json!({ "id": id, "filePath": "notes/week1.md", "importedAt": "2026-11-01T00:00:00.000Z" })
}

fn texts(list: &[Json]) -> Vec<String> {
	list.iter().map(stringify).collect()
}

#[test]
fn the_first_append_stamps_the_format_and_writes_one_line() {
	let lab = Lab::new("graph-append");
	let graph = stores(&lab);
	assert!(!lab.exists("graph/format.json"));
	graph.append(None, Ledger::Nodes, &node("n_1")).unwrap();
	graph.append(None, Ledger::Nodes, &node("n_2")).unwrap();
	assert_eq!(lab.get("graph/format.json"), "{\n\t\"version\": 1\n}\n");
	assert_eq!(lab.get("graph/nodes.jsonl"), format!("{}\n{}\n", stringify(&node("n_1")), stringify(&node("n_2"))));
	assert_eq!(texts(&graph.read(None, Ledger::Nodes).unwrap()), [stringify(&node("n_1")), stringify(&node("n_2"))]);
}

#[test]
fn a_space_graph_lives_in_its_space_folder() {
	let lab = Lab::new("graph-space");
	let graph = stores(&lab);
	graph.append(Some("cls_a"), Ledger::Chains, &chain("c_1")).unwrap();
	assert!(lab.exists("spaces/cls_a/graph/chains.jsonl") && lab.exists("spaces/cls_a/graph/format.json"));
	assert!(!lab.exists("graph"));
	assert!(graph.read(None, Ledger::Chains).unwrap().is_empty());
	assert_eq!(graph.read(Some("cls_a"), Ledger::Chains).unwrap().len(), 1);
}

#[test]
fn a_space_id_that_could_be_a_path_is_refused() {
	let lab = Lab::new("graph-bad-space");
	let graph = stores(&lab);
	for bad in ["../evil", "cls_a/../../x", "", "notaspace"] {
		let want: Result<(), String> = Err(format!("Invalid space id: {bad}"));
		assert_eq!(graph.append(Some(bad), Ledger::Nodes, &node("n_1")), want);
		assert_eq!(graph.read(Some(bad), Ledger::Nodes).map(|_| ()), want);
		assert_eq!(graph.read_sources(Some(bad)).map(|_| ()), want);
	}
	assert_eq!(lab.names("."), Vec::<String>::new());
}

#[test]
fn lines_that_are_not_valid_records_are_skipped() {
	let lab = Lab::new("graph-skip");
	let bad_node = r#"{"id":"n_x","name":"a","statement":"s","aliases":[1],"createdAt":"t","provenance":[]}"#;
	lab.put("graph/nodes.jsonl", &format!("{}\n\nnot json\n{bad_node}\n  {}  \n[]\n", stringify(&node("n_1")), stringify(&node("n_2"))));
	lab.put("graph/coverage.jsonl", "{\"chatId\":\"c\",\"fp\":\"f\",\"tokens\":\"9\",\"foldedAt\":\"t\"}\n{\"chatId\":\"c\",\"fp\":\"f\",\"tokens\":9,\"foldedAt\":\"t\"}\n");
	let graph = stores(&lab);
	assert_eq!(texts(&graph.read(None, Ledger::Nodes).unwrap()), [stringify(&node("n_1")), stringify(&node("n_2"))]);
	assert_eq!(graph.read(None, Ledger::Coverage).unwrap().len(), 1);
	assert!(graph.read(None, Ledger::Chains).unwrap().is_empty());
	assert!(graph.read(None, Ledger::Checkpoints).unwrap().is_empty());
}

#[test]
fn topics_read_as_the_newest_valid_snapshot() {
	let lab = Lab::new("graph-topics");
	lab.put("graph/topics.jsonl", &format!("{}\n{}\n{{\"at\":\"3\",\"topics\":[{{\"id\":\"t\",\"name\":\"n\"}}]}}\n", stringify(&topics("1")), stringify(&topics("2"))));
	let graph = stores(&lab);
	assert_eq!(graph.read_topics(None).unwrap().map(|t| stringify(&t)), Some(stringify(&topics("2"))));
	assert_eq!(graph.read(None, Ledger::Topics).unwrap().len(), 1);
	assert_eq!(graph.read_topics(Some("cls_none")).unwrap(), None);
}

#[test]
fn a_graph_stamped_newer_refuses_reads_with_the_update_message() {
	let lab = Lab::new("graph-newer");
	lab.put("graph/format.json", "{\"version\": 2}");
	lab.put("graph/nodes.jsonl", &format!("{}\n", stringify(&node("n_1"))));
	let graph = stores(&lab);
	assert_eq!(graph.read(None, Ledger::Nodes), Err(NEWER.to_owned()));
	assert_eq!(graph.read_topics(None), Err(NEWER.to_owned()));
	assert_eq!(graph.read_sources(None), Err(NEWER.to_owned()));
	assert_eq!(lab.get("graph/format.json"), "{\"version\": 2}");
	assert!(graph.read(Some("cls_other"), Ledger::Nodes).is_ok());
}

#[test]
fn an_unusable_stamp_reads_as_unstamped_and_the_first_write_replaces_it() {
	for stamp in ["garbage", "{\"version\":\"1\"}", "{\"version\":1.5}", "[]", ""] {
		let lab = Lab::new("graph-stamp");
		lab.put("graph/format.json", stamp);
		let graph = stores(&lab);
		assert!(graph.read(None, Ledger::Nodes).is_ok(), "{stamp}");
		graph.append(None, Ledger::Nodes, &node("n_1")).unwrap();
		assert_eq!(lab.get("graph/format.json"), "{\n\t\"version\": 1\n}\n", "{stamp}");
	}
}

#[test]
fn a_read_sees_what_was_appended_or_changed_on_disk() {
	let lab = Lab::new("graph-cache");
	let graph = stores(&lab);
	assert!(graph.read(None, Ledger::Nodes).unwrap().is_empty());
	graph.append(None, Ledger::Nodes, &node("n_1")).unwrap();
	assert_eq!(graph.read(None, Ledger::Nodes).unwrap().len(), 1);
	graph.append(None, Ledger::Nodes, &node("n_2")).unwrap();
	assert_eq!(graph.read(None, Ledger::Nodes).unwrap().len(), 2);
	lab.put("graph/nodes.jsonl", &format!("{}\n", stringify(&node("n_9"))));
	assert_eq!(graph.read(None, Ledger::Nodes).unwrap()[0]["id"].as_str(), Some("n_9"));
	std::fs::remove_file(lab.file("graph/nodes.jsonl")).unwrap();
	assert!(graph.read(None, Ledger::Nodes).unwrap().is_empty());
	graph.forget_graph_store("cls_a");
}

#[test]
fn rewriting_ledgers_replaces_each_whole_and_leaves_the_stamp_alone() {
	let lab = Lab::new("graph-rewrite");
	let graph = stores(&lab);
	graph.append(None, Ledger::Nodes, &node("n_old")).unwrap();
	graph.append(None, Ledger::Chains, &chain("c_old")).unwrap();
	let nodes = [node("n_1"), node("n_2")];
	graph.rewrite_ledgers(None, &[(Ledger::Nodes, &nodes), (Ledger::Chains, &[])]).unwrap();
	assert_eq!(lab.get("graph/nodes.jsonl"), format!("{}\n{}\n", stringify(&nodes[0]), stringify(&nodes[1])));
	assert_eq!(lab.get("graph/chains.jsonl"), "");
	assert_eq!(texts(&graph.read(None, Ledger::Nodes).unwrap()), texts(&nodes));
	assert!(graph.read(None, Ledger::Chains).unwrap().is_empty());
	let fresh = Lab::new("graph-rewrite-fresh");
	stores(&fresh).rewrite_ledgers(Some("cls_a"), &[(Ledger::Coverage, &[])]).unwrap();
	assert_eq!(fresh.names("spaces/cls_a/graph"), ["coverage.jsonl"]);
}

#[test]
fn imported_notes_keep_their_usage_log_when_imported_again() {
	let lab = Lab::new("graph-sources");
	let graph = stores(&lab);
	graph.upsert_source(None, &source("s_1")).unwrap();
	graph.upsert_source(None, &source("s_2")).unwrap();
	let run = |started: &str| json!({ "startedAt": started, "nodes": 3 });
	graph.append_source_usage(None, "s_1", &run("2026-11-02T00:00:00.000Z")).unwrap();
	graph.append_source_usage(None, "s_1", &run("2026-11-02T00:00:00.000Z")).unwrap();
	graph.append_source_usage(None, "s_1", &run("2026-11-03T00:00:00.000Z")).unwrap();
	let after_runs = graph.read_sources(None).unwrap();
	assert_eq!(after_runs.iter().map(|s| s["id"].as_str().unwrap()).collect::<Vec<_>>(), ["s_1", "s_2"]);
	assert_eq!(after_runs[0]["extractions"].as_arr().unwrap().len(), 2);
	assert!(after_runs[1].get("extractions").is_none());
	let mut again = source("s_1");
	again.as_obj_mut().unwrap().insert("filePath", "notes/renamed.md");
	graph.upsert_source(None, &again).unwrap();
	let after_import = graph.read_sources(None).unwrap();
	assert_eq!(after_import[0]["filePath"].as_str(), Some("notes/renamed.md"));
	assert_eq!(after_import[0]["extractions"].as_arr().unwrap().len(), 2);
	assert_eq!(graph.remove_source(None, "s_1"), Ok(true));
	assert_eq!(graph.remove_source(None, "s_1"), Ok(false));
	assert_eq!(graph.read_sources(None).unwrap().len(), 1);
	assert_eq!(lab.get("graph/format.json"), "{\n\t\"version\": 1\n}\n");
}

#[test]
fn source_records_need_an_id_and_unknown_ids_change_nothing() {
	let lab = Lab::new("graph-sources-edge");
	let graph = stores(&lab);
	assert_eq!(graph.upsert_source(None, &json!({ "filePath": "a.md", "importedAt": "t" })), Err("a notes source needs an id".to_owned()));
	graph.append_source_usage(None, "s_nope", &json!({ "startedAt": "t" })).unwrap();
	assert_eq!(graph.remove_source(None, "s_nope"), Ok(false));
	assert!(lab.names(".").is_empty());
	lab.put("graph/sources.json", &format!(r#"{{"s_ok":{},"s_bad":{{"id":"s_bad"}},"s_list":[]}}"#, stringify(&source("s_ok"))));
	let read = graph.read_sources(None).unwrap();
	assert_eq!(texts(&read), [stringify(&source("s_ok"))]);
	lab.put("graph/sources.json", "not json");
	assert!(graph.read_sources(None).unwrap().is_empty());
}

#[test]
fn old_ledgers_nothing_reads_any_more_are_deleted_when_the_stores_open() {
	let lab = Lab::new("graph-legacy");
	lab.put("graph/edges.jsonl", "{}\n");
	lab.put("graph/events.jsonl", "{}\n");
	lab.put("graph/nodes.jsonl", &format!("{}\n", stringify(&node("n_1"))));
	let graph = stores(&lab);
	assert_eq!(lab.names("graph"), ["nodes.jsonl"]);
	assert_eq!(graph.read(None, Ledger::Nodes).unwrap().len(), 1);
}

#[test]
fn the_seed_graphs_read_and_rewrite_byte_for_byte() {
	let lab = Lab::new("graph-seed");
	if !lab.copy_seed("graph") || !lab.copy_seed("spaces") {
		return;
	}
	let graph = stores(&lab);
	let ledgers = [(Ledger::Nodes, "nodes.jsonl"), (Ledger::Chains, "chains.jsonl"), (Ledger::Checkpoints, "sessions.jsonl"), (Ledger::Coverage, "coverage.jsonl")];
	let mut scopes: Vec<Option<String>> = vec![None];
	scopes.extend(lab.names("spaces").into_iter().filter(|c| lab.exists(&format!("spaces/{c}/graph"))).map(Some));
	let mut checked = 0;
	for scope in &scopes {
		let dir = scope.as_ref().map_or_else(|| "graph".to_owned(), |c| format!("spaces/{c}/graph"));
		for (ledger, name) in ledgers {
			let file = format!("{dir}/{name}");
			if !lab.exists(&file) {
				continue;
			}
			let before = lab.get(&file);
			let read = graph.read(scope.as_deref(), ledger).unwrap();
			assert_eq!(read.len(), before.lines().filter(|l| !l.trim().is_empty()).count(), "{file} dropped a line");
			graph.rewrite_ledgers(scope.as_deref(), &[(ledger, &read)]).unwrap();
			assert_eq!(lab.get(&file), before, "{file}");
			checked += 1;
		}
		if scope.is_some() && lab.exists(&format!("{dir}/topics.jsonl")) {
			assert!(graph.read_topics(scope.as_deref()).unwrap().is_some() || lab.get(&format!("{dir}/topics.jsonl")).trim().is_empty());
		}
	}
	assert!(checked > 0);
}

#[test]
fn the_seed_sources_save_back_byte_for_byte() {
	let lab = Lab::new("graph-seed-sources");
	if !lab.copy_seed("spaces") {
		return;
	}
	let graph = stores(&lab);
	let mut found = false;
	for space in lab.names("spaces") {
		let file = format!("spaces/{space}/graph/sources.json");
		if !lab.exists(&file) {
			continue;
		}
		let before = lab.get(&file);
		let sources = graph.read_sources(Some(&space)).unwrap();
		let Some(first) = sources.first() else { continue };
		graph.upsert_source(Some(&space), first).unwrap();
		assert_eq!(lab.get(&file), before, "{file}");
		assert_eq!(parse(&before).unwrap().as_obj().unwrap().len(), sources.len(), "{file} dropped a source");
		found = true;
	}
	assert!(found);
}
