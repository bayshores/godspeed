//! The pipeline and the topic grouper against tests/golden/extraction.json (first recorded from
//! the Node server): the same synthetic lesson and notes, the same scripted turns, and everything
//! godspeed sends the agent, every answer and every graph file must match once random ids and
//! clock times are normalized. `GS_RECORD_GOLDEN=1 cargo test -p gs-agent golden_tests` records
//! the outputs again.

use std::collections::HashMap;
use std::sync::LazyLock;

use gs_base::fsx;
use gs_base::re::Re;
use gs_core::graph::graph::get_graph;
use gs_core::messages::native_messages::failed_output_call_ids;
use gs_json::{Json, Obj, json, parse, stringify_pretty};
use gs_runtime::fake::{FakeAgent, FakeStep};

use super::context::prose_view;
use super::extraction::{Extraction, ExtractionHost, NotesImportInput};
use super::findings::{extractor_instructions, notes_extractor_instructions};
use super::ledgers::ScopedGraph;
use super::pipeline_tests::{Host, USED, host};
use super::topic_grouper::{TopicGrouperInput, group_topics, topic_grouper_instructions};

const GOLDEN: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/extraction.json");

fn golden() -> HashMap<String, Json> {
	let cases = parse(&std::fs::read_to_string(GOLDEN).unwrap()).unwrap();
	cases.as_arr().unwrap().iter().map(|c| (c["name"].as_str().unwrap().to_owned(), c["output"].clone())).collect()
}

fn recording() -> bool {
	std::env::var_os("GS_RECORD_GOLDEN").is_some()
}

/// Writes `outputs` over the golden file's cases of the same name.
fn record(outputs: &[(&str, Json)]) {
	let mut cases = parse(&std::fs::read_to_string(GOLDEN).unwrap()).unwrap();
	for case in cases.as_arr_mut().unwrap() {
		if let Some((_, output)) = outputs.iter().find(|(name, _)| case["name"].as_str() == Some(*name)) {
			case.set("output", output.clone());
		}
	}
	fsx::write_text_atomic(std::path::Path::new(GOLDEN), &format!("{}\n", stringify_pretty(&cases, "\t"))).unwrap();
}

fn same(name: &str, rust: &Json, recorded: &Json) {
	assert_eq!(stringify_pretty(rust, "\t"), stringify_pretty(recorded, "\t"), "case {name}");
}

/// A new stand-in playing the case's turns: each reply (`{call}` a tool call, `{say}` text) is one
/// model call.
fn script(host: &Host, turns: &Json, tool: &str) -> FakeAgent {
	let agent = host.new_agent();
	for turn in turns.items() {
		let steps = turn.items().iter().flat_map(|reply| {
			let step = match reply.get("call") {
				Some(args) => FakeStep::Tool { name: tool.to_owned(), args: args.clone() },
				None => FakeStep::Text(reply["say"].as_str().unwrap().to_owned()),
			};
			[FakeStep::Usage(USED), step]
		});
		agent.push(steps.collect());
	}
	agent
}

/// What godspeed sent the agent: each session's instructions and tools, its input, and every
/// tool result.
fn shown(agent: &FakeAgent) -> Json {
	let sent = agent.sent().into_iter().filter_map(|m| match m["type"].as_str() {
		Some("open") => Some(json!({ "open": { "system": m["systemPrompt"].clone(), "tools": m["tools"].clone() } })),
		Some("send") => Some(json!({ "send": m["content"].clone() })),
		Some("tool_result") => Some(json!({ "toolResult": { "isError": m["isError"].clone(), "endTurn": m["endTurn"].clone(), "content": m["content"].clone() } })),
		_ => None,
	});
	Json::Arr(sent.collect())
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

fn notes(input: &Json, may_be_space_info: bool) -> NotesImportInput {
	NotesImportInput { file_path: input["filePath"].as_str().unwrap().into(), text: input["text"].as_str().unwrap().into(), scope: None, source_id: None, may_be_space_info }
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
		let agent = script(&host, &replies[name], "submit_findings");
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
		steps.insert(name, json!({ "result": result, "sent": shown(&agent) }));
	}

	let graph = get_graph(&ScopedGraph::new(&host.stores.graphs, None)).unwrap();
	let facts: Vec<Json> = graph.nodes.iter().map(|n| json!({ "id": n["id"].clone(), "name": n["name"].clone(), "statement": n["statement"].clone() })).collect();
	let ids: Vec<Json> = facts.iter().map(|f| f["id"].clone()).collect();
	let topic_turn = json!([[
		{ "call": { "topics": [{ "name": "Sorting and more and more things", "members": ids[..3].to_vec() }] } },
		{ "call": { "topics": [
			{ "name": "Sorting", "members": [ids[0].clone(), ids[1].clone(), ids[2].clone(), "n_unknown"], "material": " Procedure " },
			{ "name": "Heaps", "members": [ids[3].clone(), ids[3].clone()], "material": "essay" },
			{ "id": "tpc_aaaaaaaaaa", "name": "Old", "members": [ids[5].clone()], "material": "term" },
		] } },
	]]);
	let agent = script(&host, &topic_turn, "submit_topics");
	let input = TopicGrouperInput {
		notes: None,
		space_name: "Algorithms".into(),
		facts: facts.clone(),
		chains: graph.chains.clone(),
		current: vec![json!({ "id": "tpc_aaaaaaaaaa", "name": "Old", "members": [ids[0].clone()], "material": "concept" })],
		loose: None,
		abort: None,
	};
	let grouped = match group_topics(host.job_agent().as_ref(), input).await {
		Ok(topics) => json!({ "ok": topics }),
		Err(err) => json!({ "error": err.to_string() }),
	};
	steps.insert("topics", json!({ "facts": facts, "result": grouped, "sent": shown(&agent) }));
	let chat = parse(&std::fs::read_to_string(&chat_file).unwrap()).unwrap();
	steps.insert("files", json!({ "graph": ledgers(&host), "extractions": chat["extractions"].clone() }));

	let story = normalized(&Json::Obj(steps));
	let cases_of = [
		("a lesson: a stray anchor, a broken chain, then a good submit", "lesson"),
		("short notes: reteaches left out, then a stray messageId is dropped", "shortNotes"),
		("long notes in stretches, the later ones never submit", "longNotes"),
		("a space file that is logistics", "logistics"),
		("the same lesson again has nothing left", "again"),
		("topic grouping: a long name, then a repaired grouping", "topics"),
		("the files afterwards", "files"),
	];
	if recording() {
		record(&cases_of.map(|(case, key)| (case, story[key].clone())));
		return;
	}
	for (case, key) in cases_of {
		same(case, &story[key], &cases[case]);
	}
}
