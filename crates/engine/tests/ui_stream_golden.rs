//! Replays tests/golden/ui_stream.json (the real runPiTurn, recorded from the Node server): the frames a
//! view gets, what `on_finish` receives, and the settle-failure report.

use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_engine::turn::agent::{Agent, AgentOptions};
use gs_engine::turn::faux::{Engine, Scripted, faux_model};
use gs_engine::turn::messages::{faux_assistant_message, text_block};
use gs_engine::turn::tool::{Tool, ToolContext};
use gs_engine::turn::ui_stream::{TurnSpec, run_pi_turn};
use gs_json::{Json, Obj, json, parse, stringify_pretty};
use parking_lot::Mutex;
use tokio::sync::mpsc::UnboundedReceiver;

struct Echo(Json);

impl Tool for Echo {
	fn name(&self) -> &str {
		"echo"
	}
	fn description(&self) -> &str {
		"Echo text."
	}
	fn parameters(&self) -> &Json {
		&self.0
	}
	fn execute(&self, args: Json, _ctx: ToolContext) -> BoxFuture<'_, Result<Json, String>> {
		Box::pin(async move { Ok(json!({ "content": [text_block(&format!("echo: {}", args["text"].as_str().unwrap()))], "details": { "text": args["text"].clone() } })) })
	}
}

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

async fn frames(mut rx: UnboundedReceiver<String>) -> Vec<String> {
	let mut out = Vec::new();
	while let Some(frame) = rx.recv().await {
		out.push(frame);
	}
	out
}

async fn play(s: &Json) -> Json {
	let scripted = Scripted::new();
	for r in s["responses"].as_arr().unwrap() {
		let mut m = faux_assistant_message(r["content"].as_arr().unwrap().clone(), r["stopReason"].as_str().unwrap());
		m.as_obj_mut().unwrap().insert("timestamp", 1);
		scripted.reply(m);
	}
	let mut options = AgentOptions::new(Engine { model: faux_model("godspeed-agent", "agent", "outside-agent", "Outside agent (MCP)", 200_000.0, 32_000.0), respond: scripted });
	options.system_prompt = "P".to_owned();
	options.tools = vec![Arc::new(Echo(json!({ "type": "object", "required": ["text"], "properties": { "text": { "type": "string" } } })))];
	options.messages = s["messages"].as_arr().unwrap().clone();
	options.session_id = Some("chat_golden".to_owned());
	let agent = Agent::new(options);
	let finished = Arc::new(Mutex::new(Json::Null));
	let failures = Arc::new(Mutex::new(Vec::new()));
	let (fin, fails, finish_fails) = (finished.clone(), failures.clone(), s["finishFails"] == Json::Bool(true));
	let handle = run_pi_turn(TurnSpec {
		agent,
		on_error: Box::new(|err| format!("loop: {err}")),
		on_settle_error: Box::new(|err| format!("settle: {err}")),
		on_settle_failure: Box::new(move |err, reported| fails.lock().push(json!({ "error": err, "reported": reported }))),
		on_finish: Box::new(move |messages| {
			*fin.lock() = Json::Arr(messages);
			if finish_fails { Err("disk full".to_owned()) } else { Ok(()) }
		}),
		used_tool_call_ids: s["usedIds"].as_arr().unwrap().iter().map(|id| id.as_str().unwrap().to_owned()).collect(),
		update_flush_ms: 100,
	});
	let view = handle.subscribe();
	handle.start();
	let frames: Vec<Json> = frames(view)
		.await
		.iter()
		.map(|f| {
			let data = f.strip_prefix("data: ").unwrap().strip_suffix("\n\n").unwrap();
			if data == "[DONE]" { Json::from("[DONE]") } else { parse(data).unwrap() }
		})
		.collect();
	let late = self::frames(handle.subscribe()).await.len();
	let failures = Json::Arr(failures.lock().clone());
	mask(&json!({ "frames": frames, "finished": finished.lock().clone(), "failures": failures, "late": late }))
}

#[tokio::test]
async fn the_turn_wire_matches_pi() {
	let golden = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/ui_stream.json")).unwrap()).unwrap();
	for case in golden.as_arr().unwrap() {
		let want = &case["output"];
		let got = play(&want["scenario"]).await;
		for key in ["frames", "finished", "failures", "late"] {
			assert_eq!(stringify_pretty(&got[key], " "), stringify_pretty(&mask(&want[key]), " "), "{}: {key}", case["name"].as_str().unwrap());
		}
	}
}
