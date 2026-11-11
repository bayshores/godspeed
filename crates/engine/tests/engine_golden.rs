//! Replays tests/golden/engine.json (the real pi Agent on pi-ai's faux core, from
//! engine.golden.ts) on the Rust loop: same scenario, same events, same transcript.

use std::sync::{Arc, OnceLock, Weak};

use futures_util::future::BoxFuture;
use gs_base::clock;
use gs_engine::turn::abort::Abort;
use gs_engine::turn::agent::{Agent, AgentOptions, QueueMode};
use gs_engine::turn::events::AgentEvent;
use gs_engine::turn::faux::{Engine, Scripted, faux_model};
use gs_engine::turn::messages::{faux_assistant_message, text_block};
use gs_engine::turn::tool::{ExecutionMode, Tool, ToolContext};
use gs_json::{Json, Obj, json, parse, stringify_pretty};
use parking_lot::Mutex;

struct LibraryTool {
	name: String,
	description: String,
	parameters: Json,
	agent: Arc<OnceLock<Weak<Agent>>>,
}

fn ok(text: &str, details: Json) -> Json {
	json!({ "content": [text_block(text)], "details": details })
}

impl Tool for LibraryTool {
	fn name(&self) -> &str {
		&self.name
	}
	fn description(&self) -> &str {
		&self.description
	}
	fn parameters(&self) -> &Json {
		&self.parameters
	}
	fn execution_mode(&self) -> ExecutionMode {
		if self.name == "seq" { ExecutionMode::Sequential } else { ExecutionMode::Parallel }
	}
	fn execute(&self, args: Json, _ctx: ToolContext) -> BoxFuture<'_, Result<Json, String>> {
		Box::pin(async move {
			let agent = || self.agent.get().and_then(Weak::upgrade).unwrap();
			Ok(match self.name.as_str() {
				"echo" => ok(&format!("echo: {}", args["text"].as_str().unwrap()), json!({ "text": args["text"].clone() })),
				"count" => ok(&gs_json::js_number(args["n"].as_f64().unwrap()), args["n"].clone()),
				"stop" => json!({ "content": [text_block("posed")], "details": null, "terminate": true }),
				"seq" => ok("seq done", Json::Null),
				"fail" => return Err("boom".to_owned()),
				"flag_error" => json!({ "content": [text_block("bad")], "isError": true }),
				"steer" => {
					agent().steer(json!({ "role": "user", "content": "steer one", "timestamp": "<ts>" }));
					agent().steer(json!({ "role": "user", "content": "steer two", "timestamp": "<ts>" }));
					ok("steered", Json::Null)
				}
				"abort" => {
					agent().abort();
					ok("stopping", Json::Null)
				}
				"slow" => {
					clock::sleep(30).await;
					ok("slow done", Json::Null)
				}
				other => panic!("no tool {other}"),
			})
		})
	}
}

/// Times masked. Whether pi times a queued reply depends on which millisecond the stream
/// started in, so an assistant message's `durationMs` is left out.
fn mask(v: &Json) -> Json {
	match v {
		Json::Arr(items) => Json::Arr(items.iter().map(mask).collect()),
		Json::Obj(o) => {
			let mut out = Obj::new();
			for (k, val) in o {
				if k == "durationMs" && o.get("role") == Some(&Json::from("assistant")) {
					continue;
				}
				let masked = match (k.as_str(), val) {
					("timestamp", Json::Num(_)) => Json::from("<ts>"),
					("durationMs", _) => Json::from("<ms>"),
					_ => mask(val),
				};
				out.insert(k.clone(), masked);
			}
			Json::Obj(out)
		}
		other => other.clone(),
	}
}

async fn play(scenario: &Json, declared: &[Json]) -> Json {
	let scripted = Scripted::new();
	for r in scenario["responses"].as_arr().unwrap() {
		if r == &Json::from("abort") {
			scripted.run(|request| {
				request.abort.abort();
				Box::pin(async { Ok(faux_assistant_message(vec![text_block("")], "stop")) })
			});
		} else {
			// Built before the run, like pi's queued replies, so the stream does not time them.
			let mut message = faux_assistant_message(r["content"].as_arr().unwrap().clone(), r["stopReason"].as_str().unwrap());
			message.as_obj_mut().unwrap().insert("timestamp", 1);
			scripted.reply(message);
		}
	}
	let slot = Arc::new(OnceLock::new());
	let tools: Vec<Arc<dyn Tool>> = scenario["tools"]
		.as_arr()
		.into_iter()
		.flatten()
		.map(|name| {
			let name = name.as_str().unwrap();
			let declaration = declared.iter().find(|t| t["name"] == Json::from(name)).unwrap();
			let (description, parameters) = (declaration["description"].as_str().unwrap().to_owned(), declaration["parameters"].clone());
			Arc::new(LibraryTool { name: name.to_owned(), description, parameters, agent: slot.clone() }) as Arc<dyn Tool>
		})
		.collect();
	let model = faux_model("godspeed-agent", "agent", "outside-agent", "Outside agent (MCP)", 200_000.0, 32_000.0);
	let mut options = AgentOptions::new(Engine { model, respond: scripted });
	options.system_prompt = scenario["systemPrompt"].as_str().unwrap_or_default().to_owned();
	options.tools = tools;
	options.messages = scenario["messages"].as_arr().cloned().unwrap_or_default();
	options.session_id = Some("chat_golden".to_owned());
	if scenario["steeringMode"] == Json::from("all") {
		options.steering_mode = QueueMode::All;
	}
	if let Some(n) = scenario["endAfterTurns"].as_i64() {
		let mut turns = 0;
		options.finish_turn = Some(Box::new(move |_| {
			turns += 1;
			turns >= n
		}));
	}
	let agent = Agent::new(options);
	slot.set(Arc::downgrade(&agent)).unwrap();
	for m in scenario["steer"].as_arr().into_iter().flatten() {
		agent.steer(m.clone());
	}
	for m in scenario["followUp"].as_arr().into_iter().flatten() {
		agent.follow_up(m.clone());
	}
	let events = Arc::new(Mutex::new(Vec::<Json>::new()));
	let sink = events.clone();
	agent.subscribe(Arc::new(move |event: &AgentEvent| {
		let mut list = sink.lock();
		if matches!(event, AgentEvent::MessageUpdate(_)) && list.last().is_some_and(|e| e["type"] == Json::from("message_update")) {
			list.pop();
		}
		list.push(event.to_json());
	}));
	let run = scenario["run"].clone();
	let result = if run == Json::from("continue") {
		agent.continue_run(Abort::new()).await
	} else {
		agent.prompt(run["prompt"].as_arr().unwrap().clone(), Abort::new()).await
	};
	let mut out = json!({ "events": Json::Arr(events.lock().clone()), "messages": Json::Arr(agent.messages()) });
	if let Err(e) = result {
		out.as_obj_mut().unwrap().insert("error", e);
	}
	mask(&out)
}

#[tokio::test]
async fn the_loop_matches_pi() {
	let golden = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/engine.json")).unwrap()).unwrap();
	for case in golden.as_arr().unwrap() {
		let name = case["name"].as_str().unwrap();
		let want = &case["output"];
		let declared: Vec<Json> = want["messages"][0]["toolsAdded"].as_arr().cloned().unwrap_or_default();
		let got = play(&want["scenario"], &declared).await;
		for key in ["events", "messages", "error"] {
			let (got, want) = (stringify_pretty(&got[key], " "), stringify_pretty(&mask(&want[key]), " "));
			if got != want {
				let (g, w): (Vec<&str>, Vec<&str>) = (got.lines().collect(), want.lines().collect());
				let at = g.iter().zip(&w).position(|(a, b)| a != b).unwrap_or(g.len().min(w.len()));
				let from = at.saturating_sub(12);
				panic!("{name}: {key} differs at line {at}\n--- rust\n{}\n--- pi\n{}", g[from..(at + 6).min(g.len())].join("\n"), w[from..(at + 6).min(w.len())].join("\n"));
			}
		}
	}
}
