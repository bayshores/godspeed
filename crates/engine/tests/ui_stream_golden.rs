//! Replays tests/golden/ui_stream.json: a lesson turn on a stand-in agent session (gs-runtime's
//! FakeAgent), the frames a view gets, what `on_finish` receives, and the settle-failure report.
//! `GS_RECORD_GOLDEN=1 cargo test -p gs-engine --test ui_stream_golden` records the cases again,
//! which is right only when the wire is meant to change.

use std::collections::HashSet;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_engine::turn::messages::agent_model;
use gs_engine::turn::messages::text_block;
use gs_engine::turn::session_turn::{Opened, SessionTurn, SessionTurnSpec};
use gs_engine::turn::tool::{Tool, ToolContext};
use gs_engine::turn::tool_host::ToolHost;
use gs_engine::turn::ui_stream::{SettleError, TurnSpec, run_pi_turn};
use gs_json::{Json, Obj, json, parse, stringify_pretty};
use gs_runtime::fake::{FakeAgent, FakeStep};
use gs_runtime::{Part, SessionSpec};
use parking_lot::Mutex;
use tokio::sync::mpsc::UnboundedReceiver;

const GOLDEN: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/ui_stream.json");

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

fn echo(text: &str) -> FakeStep {
	FakeStep::Tool { name: "echo".into(), args: json!({ "text": text }) }
}

struct Case {
	name: &'static str,
	steps: Vec<FakeStep>,
	used_ids: Vec<&'static str>,
	opens: bool,
	finish_fails: bool,
}

fn cases() -> Vec<Case> {
	vec![
		Case { name: "reused ids get fresh ones", steps: vec![echo("a"), echo("b"), FakeStep::Text("done".into())], used_ids: vec!["toolu_1", "toolu_1~2"], opens: true, finish_fails: false },
		Case { name: "fresh ids stay", steps: vec![FakeStep::Text("Look at this.".into()), echo("c"), FakeStep::Text("ok".into())], used_ids: vec!["call_0"], opens: true, finish_fails: false },
		Case { name: "run cannot start", steps: Vec::new(), used_ids: Vec::new(), opens: false, finish_fails: false },
		Case { name: "finish fails", steps: vec![FakeStep::Text("hello there".into())], used_ids: Vec::new(), opens: true, finish_fails: true },
	]
}

async fn play(case: &Case) -> Json {
	let agent = FakeAgent::new(vec![case.steps.clone()]);
	let runtime = Arc::new(agent.runtime());
	let opens = case.opens;
	let schema = json!({ "type": "object", "required": ["text"], "properties": { "text": { "type": "string" } } });
	let turn = SessionTurn::new(SessionTurnSpec {
		open: Box::new(move |_| {
			let runtime = runtime.clone();
			Box::pin(async move {
				if !opens {
					return Err("godspeed couldn't find Claude Code on this computer.".to_owned());
				}
				let spec = SessionSpec { cwd: std::env::temp_dir(), read_dirs: Vec::new(), model: None, instructions: "P".to_owned(), tools: Vec::new(), resume: None, persist: false };
				Ok(Opened { session: Arc::new(runtime.open(spec).await?), input: vec![Part::Text("again".to_owned())], knew: false })
			})
		}),
		host: ToolHost::new(vec![Arc::new(Echo(schema))], None, HashSet::new()),
		check_text: Box::new(str::to_owned),
		before: Vec::new(),
		model: agent_model(),
		folds_steers: false,
	});
	let finished = Arc::new(Mutex::new(Json::Null));
	let failures = Arc::new(Mutex::new(Vec::new()));
	let (fin, fails, finish_fails) = (finished.clone(), failures.clone(), case.finish_fails);
	let handle = run_pi_turn(TurnSpec {
		turn,
		on_error: Box::new(|err| format!("loop: {err}")),
		on_settle_error: Box::new(|err| format!("settle: {err}")),
		on_settle_failure: Box::new(move |err, reported| fails.lock().push(json!({ "error": err.to_string(), "reported": reported }))),
		on_finish: Box::new(move |messages| {
			*fin.lock() = Json::Arr(messages);
			if finish_fails { Err(SettleError::Other("disk full".to_owned())) } else { Ok(()) }
		}),
		used_tool_call_ids: case.used_ids.iter().map(|id| (*id).to_owned()).collect(),
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

#[tokio::test(flavor = "multi_thread")]
async fn the_turn_wire_matches_the_recording() {
	let mut got = Vec::new();
	for case in cases() {
		got.push(json!({ "name": case.name, "output": play(&case).await }));
	}
	if std::env::var_os("GS_RECORD_GOLDEN").is_some() {
		gs_base::fsx::write_text_atomic(std::path::Path::new(GOLDEN), &format!("{}\n", stringify_pretty(&Json::Arr(got), "\t"))).unwrap();
		return;
	}
	let golden = parse(&std::fs::read_to_string(GOLDEN).unwrap()).unwrap();
	assert_eq!(golden.items().len(), got.len());
	for (want, got) in golden.items().iter().zip(&got) {
		for key in ["frames", "finished", "failures", "late"] {
			assert_eq!(stringify_pretty(&got["output"][key], " "), stringify_pretty(&want["output"][key], " "), "{}: {key}", want["name"].str_or_empty());
		}
	}
}
