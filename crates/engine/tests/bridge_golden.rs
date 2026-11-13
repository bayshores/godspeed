//! Replays tests/golden/bridge.json (the real agent-bridge.ts, recorded from the Node server): the same
//! script of operations on the Rust Bridge gives the same views, errors, replies, events, saved
//! marks and backup teacher status.

use std::collections::HashMap;
use std::sync::Arc;

use gs_base::clock;
use gs_base::events::Events;
use gs_base::re::Re;
use gs_engine::bridge::{AgentReply, Bridge, ReplyCall, WaitOptions, WorkView, display_agent_name};
use gs_engine::turn::abort::Abort;
use gs_json::{Json, Obj, json, parse, stringify_pretty};
use tokio::task::JoinHandle;

mod common;
use common::{Marks, park};

/// The view as agent-bridge.ts builds it, keys in its order.
fn view_json(v: &WorkView) -> Json {
	let mut o = Obj::new();
	o.insert("workId", v.work_id.clone());
	o.insert("conversation", v.conversation.clone());
	o.insert("continued", v.continued);
	if let Some(id) = &v.instructions_as_in {
		o.insert("instructionsAsIn", id.clone());
	}
	if let Some(text) = &v.instructions {
		o.insert("instructions", text.clone());
	}
	if let Some(tools) = &v.tools {
		o.insert("tools", tools.clone());
	}
	if let Some(names) = &v.tools_as_before {
		o.insert("toolsAsBefore", names.iter().map(Json::from).collect::<Json>());
	}
	o.insert("messages", v.messages.clone());
	if let Some(label) = &v.label {
		o.insert("label", label.clone());
	}
	if let Some(images) = &v.images {
		o.insert("images", images.clone());
	}
	Json::Obj(o)
}

fn number_ids(v: &Json, seen: &mut Vec<String>) -> Json {
	match v {
		Json::Str(s) => Json::from(Re::new(r"\b(work|agent)_[0-9a-f]{8}-[0-9a-f]{3}", "g").replace_with(s, |caps| {
			let id = caps.as_string();
			let kind = caps.get(1).unwrap();
			if !seen.contains(&id) {
				seen.push(id.clone());
			}
			let n = seen.iter().take_while(|k| **k != id).filter(|k| k.starts_with(&kind)).count() + 1;
			format!("<{kind}#{n}>")
		})),
		Json::Arr(items) => Json::Arr(items.iter().map(|i| number_ids(i, seen)).collect()),
		Json::Obj(o) => {
			let mut out = Obj::new();
			for (k, val) in o {
				if k == "durationMs" && o.get("role") == Some(&Json::from("assistant")) {
					continue;
				}
				let masked = match k.as_str() {
					"timestamp" | "claimedAt" => Json::from("<t>"),
					_ => number_ids(val, seen),
				};
				out.insert(k.clone(), masked);
			}
			Json::Obj(out)
		}
		other => other.clone(),
	}
}

struct Parked {
	messages: Vec<Json>,
	conversation: String,
	abort: Abort,
	task: Option<JoinHandle<Json>>,
	result: Option<Json>,
}

async fn result_of(parked: &mut Parked) -> Json {
	if let Some(task) = parked.task.take() {
		parked.result = Some(task.await.unwrap());
	}
	parked.result.clone().unwrap()
}

fn park_as(bridge: &Bridge, messages: Vec<Json>, conversation: &str) -> Parked {
	let abort = Abort::new();
	let task = park(bridge, messages.clone(), conversation, &abort);
	Parked { messages, conversation: conversation.to_owned(), abort, task: Some(task), result: None }
}

fn reply_of(s: &Json) -> AgentReply {
	AgentReply {
		text: s["text"].as_str().map(str::to_owned),
		tool_calls: s["toolCalls"].as_arr().into_iter().flatten().map(|c| ReplyCall { name: c["name"].as_str().unwrap().to_owned(), arguments: c["arguments"].clone() }).collect(),
	}
}

fn outcome<T>(r: Result<T, String>, ok: impl FnOnce(T) -> Vec<(&'static str, Json)>) -> Json {
	let mut o = Obj::new();
	match r {
		Ok(v) => {
			o.insert("ok", true);
			for (k, val) in ok(v) {
				o.insert(k, val);
			}
		}
		Err(e) => {
			o.insert("ok", false);
			o.insert("error", e);
		}
	}
	Json::Obj(o)
}

#[tokio::test]
async fn the_bridge_matches_agent_bridge_ts() {
	let golden = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/bridge.json")).unwrap()).unwrap();
	let want = &golden[0]["output"];
	let events = Events::new();
	let mut rx = events.subscribe();
	let marks = Arc::new(Marks::default());
	let bridge = Bridge::new(&events, marks.clone());
	let mut parked: HashMap<String, Parked> = HashMap::new();
	let mut works: HashMap<String, String> = HashMap::new();
	let mut steps = Vec::new();
	let wanted_steps = want["steps"].as_arr().unwrap();
	for wanted in wanted_steps {
		let s = &wanted["step"];
		let text = |k: &str| s[k].as_str().unwrap_or_default().to_owned();
		let work = || works[&text("work")].clone();
		let mut result = Json::Null;
		match s["op"].as_str().unwrap() {
			"park" => {
				parked.insert(text("as"), park_as(&bridge, s["messages"].as_arr().unwrap().clone(), &text("conversation")));
				clock::sleep(5).await;
			}
			"parkNext" => {
				let from = parked.get_mut(&text("from")).unwrap();
				let reply = result_of(from).await;
				let mut messages = from.messages.clone();
				messages.push(reply.clone());
				for call in reply["content"].as_arr().unwrap().iter().filter(|b| b["type"] == Json::from("toolCall")) {
					messages.push(json!({ "role": "toolResult", "toolCallId": call["id"].clone(), "toolName": call["name"].clone(), "content": [{ "type": "text", "text": s["result"].clone() }], "isError": false, "timestamp": 1 }));
				}
				if let Some(lead) = s["lead"].as_str()
					&& let Some(first) = messages[0].as_obj_mut()
				{
					first.insert("content", lead);
				}
				if let Some(n) = s["summarize"].as_i64() {
					messages.splice(1..1 + n as usize, [json!({ "role": "user", "content": "[summary]", "timestamp": 1 })]);
				}
				if let Some(user) = s["user"].as_str() {
					messages.push(json!({ "role": "user", "content": user, "timestamp": 1 }));
				}
				let conversation = from.conversation.clone();
				parked.insert(text("as"), park_as(&bridge, messages, &conversation));
				clock::sleep(5).await;
			}
			"wait" => {
				let opts = WaitOptions {
					conversation: s["conversation"].as_str().map(str::to_owned),
					agent: s["agent"].as_str().map(str::to_owned),
					full: s["full"].truthy(),
					and_background: s["andBackground"].truthy(),
					backup: s["backup"].truthy(),
				};
				if let Some(view) = bridge.wait_for_work(0, opts).await {
					works.insert(text("as"), view.work_id.clone());
					result = view_json(&view);
				}
			}
			"respond" => {
				let hold = s["hold"].as_i64().unwrap_or(30_000);
				result = outcome(bridge.respond_to_work(&work(), reply_of(s), hold), |a| {
					let mut fields = vec![("conversation", Json::from(a.conversation))];
					fields.extend(a.agent.map(|agent| ("agent", Json::from(agent))));
					fields
				});
				clock::sleep(5).await;
			}
			"result" => result = result_of(parked.get_mut(&text("of")).unwrap()).await,
			"pages" => bridge.set_work_pages(&work(), s["pages"].as_arr().unwrap().iter().map(|p| p.as_arr().unwrap().iter().map(|b| b.as_str().unwrap().to_owned()).collect()).collect()),
			"read" => result = outcome(bridge.read_work_page(&work(), s["page"].as_i64().unwrap()), |(blocks, pages)| vec![("blocks", blocks.into()), ("pages", pages.into())]),
			"full" => result = outcome(bridge.full_work_view(&work()), |v| vec![("view", view_json(&v))]),
			"release" => bridge.release_conversation(&text("conversation")),
			"forget" => bridge.forget_agent(&text("agent"), s["cleared"].truthy()),
			"label" => bridge.label_conversation(&text("conversation"), &text("label")),
			"claimed" => result = Json::Arr(bridge.claimed_lessons()),
			"pending" => result = Json::from(bridge.pending_work_count()),
			"abort" => {
				parked[&text("of")].abort.abort();
				clock::sleep(5).await;
			}
			"stay" => bridge.stay_on(s["agent"].as_str(), s["lesson"].as_str()),
			"staying" => result = bridge.staying_on(s["agent"].as_str()).map_or(Json::Null, Json::from),
			"forgetConversation" => bridge.forget_conversation(&text("conversation")),
			"compacting" => bridge.agent_compacting(&text("agent"), clock::now_ms()),
			"status" => {
				let now = clock::now_ms();
				let backups: Json = s["agents"].as_arr().unwrap().iter().map(|a| Json::from(bridge.is_backup_agent(a.as_str()))).collect();
				result = json!({ "connected": bridge.backup_connected(now), "answering": bridge.backup_answering(now), "backups": backups });
			}
			"names" => result = s["infos"].as_arr().unwrap().iter().map(|i| display_agent_name(i).map_or(Json::Null, Json::from)).collect(),
			other => panic!("unknown op {other}"),
		}
		let mut names = Vec::new();
		while let Ok(e) = rx.try_recv() {
			names.push(Json::from(e.kind.name()));
		}
		steps.push(json!({ "result": result, "events": names }));
	}
	let mut saved = Obj::new();
	for (k, m) in marks.0.lock().iter() {
		saved.insert(k.clone(), m.to_json());
	}
	let got = number_ids(&json!({ "steps": steps, "saved": Json::Obj(saved) }), &mut Vec::new());
	for (i, (g, w)) in got["steps"].as_arr().unwrap().iter().zip(wanted_steps).enumerate() {
		for key in ["result", "events"] {
			assert_eq!(stringify_pretty(&g[key], " "), stringify_pretty(&w[key], " "), "step {i} ({}): {key}", w["step"]["op"].as_str().unwrap());
		}
	}
	// The marks of chat_l1 and chat_l7 cover a reply's random tool-call id, so their hashes
	// cannot match; chat_l1's last message has one too.
	let (got, want) = (&got["saved"], &want["saved"]);
	let keys = |v: &Json| v.as_obj().unwrap().keys().cloned().collect::<Vec<_>>();
	assert_eq!(keys(got), keys(want));
	for key in keys(want) {
		let random = ["chat_l1", "chat_l7"].iter().any(|c| key.ends_with(c));
		for field in ["count", "hash", "last", "lead"] {
			if random && (field == "hash" || (field == "last" && key.ends_with("chat_l1"))) {
				continue;
			}
			assert_eq!(got[key.as_str()][field], want[key.as_str()][field], "saved {key} {field}");
		}
	}
}
