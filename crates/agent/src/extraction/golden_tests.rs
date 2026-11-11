//! Parity with Node for the pipeline and the topic grouper (tests/golden/extraction.json, made by
//! scripts/golden.ts from extraction.golden.ts): the same synthetic lesson and notes, the same
//! scripted replies, and every prompt, refusal, answer and graph file must match once random ids
//! and clock times are normalized the same way.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock};

use gs_base::fsx;
use gs_base::re::Re;
use gs_core::graph::graph::get_graph;
use gs_core::messages::native_messages::failed_output_call_ids;
use gs_engine::turn::faux::Scripted;
use gs_engine::turn::messages::faux_assistant_message;
use gs_json::{Json, Obj, json, parse, stringify_pretty};
use parking_lot::Mutex;

use super::context::prose_view;
use super::extraction::{Extraction, ExtractionHost, NotesImportInput};
use super::findings::{extractor_instructions, notes_extractor_instructions};
use super::ledgers::ScopedGraph;
use super::pipeline_tests::{Host, host, says};
use super::topic_grouper::{TopicGrouperInput, group_topics, topic_grouper_instructions};

fn golden() -> HashMap<String, Json> {
	let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/extraction.json")).unwrap();
	let cases = parse(&text).unwrap();
	cases.as_arr().unwrap().iter().map(|c| (c["name"].as_str().unwrap().to_owned(), c["output"].clone())).collect()
}

fn same(name: &str, rust: &Json, node: &Json) {
	assert_eq!(stringify_pretty(rust, "\t"), stringify_pretty(node, "\t"), "case {name}");
}

type Requests = Arc<Mutex<Vec<Json>>>;

/// Queues the case's replies on a new script (`{call}` a tool call, `{say}` text) and keeps what
/// each call was shown.
fn script(host: &Host, replies: &Json, tool: &str) -> Requests {
	let requests = Requests::default();
	let script: Arc<Scripted> = host.new_script();
	for (i, reply) in replies.as_arr().unwrap().iter().enumerate() {
		let answer = match reply.get("call") {
			Some(args) => faux_assistant_message(vec![json!({ "type": "toolCall", "id": format!("call_{i}"), "name": tool, "arguments": args.clone() })], "toolUse"),
			None => says(reply["say"].as_str().unwrap()),
		};
		let requests = requests.clone();
		script.run(move |request| {
			requests.lock().push(shown(&request.messages));
			Box::pin(async move { Ok(answer) })
		});
	}
	requests
}

/// The golden spec's `request()`: the system prompt, its tools, then each message's role and content.
fn shown(messages: &[Json]) -> Json {
	let rest = messages[1..].iter().map(|m| match m["role"].as_str() {
		Some("assistant") => json!({ "role": "assistant" }),
		Some("toolResult") => json!({ "role": "toolResult", "toolName": m["toolName"].clone(), "isError": m["isError"].clone(), "content": m["content"].clone() }),
		_ => json!({ "role": m["role"].clone(), "content": m["content"].clone() }),
	});
	json!({ "system": messages[0]["content"].clone(), "tools": messages[0]["toolsAdded"].clone(), "messages": Json::Arr(rest.collect()) })
}

static TIME: LazyLock<Re> = LazyLock::new(|| Re::new(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$", ""));
static ID: LazyLock<Re> = LazyLock::new(|| Re::new(r"\b(n|arg|tpc)_[0-9a-f]{10,12}\b", "g"));

/// The spec's `normalized()`: random ids become their order of first appearance, clock times a marker.
fn normalized(value: &Json) -> Json {
	fn walk(v: &Json, key: &str, seen: &mut Vec<String>) -> Json {
		match v {
			Json::Str(s) if TIME.test(s) => Json::from("<time>"),
			Json::Str(s) => Json::from(ID.replace_with(s, |caps| {
				let id = caps.as_string();
				let at = seen.iter().position(|x| *x == id).unwrap_or_else(|| {
					seen.push(id.clone());
					seen.len() - 1
				});
				format!("{}_#{at}", caps.get(1).unwrap())
			})),
			Json::Num(_) if key.ends_with("At") || key.ends_with("Ms") => Json::from("<time>"),
			Json::Arr(items) => Json::Arr(items.iter().map(|x| walk(x, "", seen)).collect()),
			Json::Obj(o) => Json::Obj(o.iter().map(|(k, x)| (k.clone(), walk(x, k, seen))).collect()),
			other => other.clone(),
		}
	}
	walk(value, "", &mut Vec::new())
}

/// Every graph ledger file, as lines.
fn ledgers(host: &Host) -> Json {
	let dir = host.dir.join("data").join("graph");
	let mut names: Vec<String> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
	names.sort();
	let mut out = Obj::new();
	for name in names {
		let text = std::fs::read_to_string(dir.join(&name)).unwrap();
		let value = if name.ends_with(".jsonl") { Json::Arr(text.lines().filter(|l| !l.is_empty()).map(|l| parse(l).unwrap()).collect()) } else { parse(&text).unwrap() };
		out.insert(name, value);
	}
	Json::Obj(out)
}

fn notes(input: &Json, may_be_course_info: bool) -> NotesImportInput {
	NotesImportInput { file_path: input["filePath"].as_str().unwrap().into(), text: input["text"].as_str().unwrap().into(), scope: None, source_id: None, may_be_course_info }
}

#[test]
fn instructions_and_the_prose_view_match_node() {
	let cases = golden();
	let instructions = json!({ "extractor": extractor_instructions(), "notes": notes_extractor_instructions(false), "topics": topic_grouper_instructions() });
	same("instructions", &instructions, &cases["instructions"]);
	let lesson = &cases["inputs"]["lesson"];
	let messages = lesson["messages"].as_arr().unwrap();
	let refs: Vec<&Json> = messages.iter().collect();
	let failed = failed_output_call_ids(messages);
	same("prose view", &Json::from(prose_view(&refs, lesson["title"].as_str(), &failed)), &cases["prose view"]);
	same("prose view without a title", &Json::from(prose_view(&refs, Some(""), &failed)), &cases["prose view without a title"]);
}

#[tokio::test]
async fn the_pipeline_and_the_topic_grouper_match_node() {
	let cases = golden();
	let inputs = &cases["inputs"];
	let replies = &inputs["replies"];
	let host = host();
	let lesson = &inputs["lesson"];
	let chat_file = host.dir.join("data").join("chats").join(format!("{}.json", lesson["id"].as_str().unwrap()));
	std::fs::create_dir_all(chat_file.parent().unwrap()).unwrap();
	fsx::write_text_atomic(&chat_file, &stringify_pretty(lesson, "\t")).unwrap();
	let extraction = Extraction::new(host.clone());
	let chat_id = lesson["id"].as_str().unwrap();

	let mut steps = Obj::new();
	for name in ["lesson", "shortNotes", "longNotes", "logistics", "again"] {
		let requests = script(&host, &replies[name], "submit_findings");
		let result = match name {
			"lesson" | "again" => match extraction.run_extraction(chat_id).await {
				Ok(stats) => json!({ "ok": stats }),
				Err(error) => json!({ "error": error }),
			},
			_ => {
				let input = if name == "logistics" { notes(&inputs[name], true) } else { notes(&inputs[name], false) };
				match extraction.import_notes(input).await {
					Ok(stats) => json!({ "ok": stats }),
					Err(err) => json!({ "error": err.message, "outcome": err.outcome.as_str(), "partialStats": err.partial_stats }),
				}
			}
		};
		steps.insert(name, json!({ "result": result, "requests": Json::Arr(requests.lock().clone()) }));
	}

	let graph = get_graph(&ScopedGraph::new(&host.stores.graphs, None)).unwrap();
	let facts: Vec<Json> = graph.nodes.iter().map(|n| json!({ "id": n["id"].clone(), "name": n["name"].clone(), "statement": n["statement"].clone() })).collect();
	let ids: Vec<Json> = facts.iter().map(|f| f["id"].clone()).collect();
	let topic_replies = json!([
		{ "call": { "topics": [{ "name": "Sorting and more and more things", "members": ids[..3].to_vec() }] } },
		{ "call": { "topics": [{ "name": "Sorting", "members": [ids[0].clone(), ids[1].clone(), ids[2].clone(), "n_unknown"] }, { "name": "Heaps", "members": [ids[3].clone(), ids[3].clone()] }] } },
	]);
	let requests = script(&host, &topic_replies, "submit_topics");
	let input = TopicGrouperInput {
		class_name: "Algorithms".into(),
		facts: facts.clone(),
		chains: graph.chains.clone(),
		current: vec![json!({ "id": "tpc_aaaaaaaaaa", "name": "Old", "members": [ids[0].clone()] })],
		engine: host.engine(),
		abort: None,
	};
	let grouped = match group_topics(&host.bridge, input).await {
		Ok(topics) => json!({ "ok": topics }),
		Err(err) => json!({ "error": err.to_string() }),
	};
	steps.insert("topics", json!({ "facts": facts, "result": grouped, "requests": Json::Arr(requests.lock().clone()) }));
	let chat = parse(&std::fs::read_to_string(&chat_file).unwrap()).unwrap();
	steps.insert("files", json!({ "graph": ledgers(&host), "extractions": chat["extractions"].clone() }));

	let story = normalized(&Json::Obj(steps));
	for (case, key) in [
		("a lesson: a stray anchor, a broken chain, then a good submit", "lesson"),
		("short notes: reteaches left out, then a stray messageId is dropped", "shortNotes"),
		("long notes in stretches, the later ones never submit", "longNotes"),
		("a class file that is course logistics", "logistics"),
		("the same lesson again has nothing left", "again"),
		("topic grouping: a long name, then a repaired grouping", "topics"),
		("the files afterwards", "files"),
	] {
		same(case, &story[key], &cases[case]);
	}
}
