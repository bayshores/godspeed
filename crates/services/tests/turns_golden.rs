//! Parity with the TypeScript for turns (tests/golden/turns.json, recorded
//! from the Node server using synthetic lessons): the settled stream terminal, the compaction trigger's
//! context estimate, the canonical turn save and PDF attachments.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::{fsx, ids};
use gs_core::messages::attachments::ChatAttachment;
use gs_json::{Json, json, parse, stringify_pretty};
use gs_services::App;
use gs_services::turns::attachments::{AttachmentError, store_attachments};
use gs_services::turns::compaction::projected_context_tokens;
use gs_services::turns::turn_runs::{clear_turn_failure, remember_turn_failure, settled_turn_frames};
use gs_services::turns::turn_service::persist_turn;

fn golden() -> Json {
	parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/turns.json")).unwrap()).unwrap()
}

fn case(name: &str) -> Json {
	golden().as_arr().unwrap().iter().find(|c| c["name"] == Json::from(name)).unwrap()["output"].clone()
}

/// An app over a fresh folder, removed when dropped.
struct Fixture {
	app: Arc<App>,
	dir: PathBuf,
}

impl Fixture {
	fn new() -> Fixture {
		let dir = std::env::temp_dir().join(format!("gs-turns-golden-{}", ids::uuid()));
		std::fs::create_dir_all(dir.join("data/chats")).unwrap();
		let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.join("res")), None);
		Fixture { app, dir }
	}
}

impl Drop for Fixture {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.dir);
	}
}

#[test]
fn settled_stream_matches_node() {
	let fx = Fixture::new();
	let want = case("settled stream");
	clear_turn_failure(&fx.app, "chat_g");
	assert_eq!(settled_turn_frames(&fx.app, "chat_g"), want["plain"].as_str().unwrap());
	remember_turn_failure(&fx.app, "chat_g", "The reply could not be saved.");
	assert_eq!(settled_turn_frames(&fx.app, "chat_g"), want["failed"].as_str().unwrap());
}

fn usage(input: f64, output: f64) -> Json {
	json!({ "input": input, "output": output, "cacheRead": 0, "cacheWrite": 0, "totalTokens": input + output, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } })
}

fn user(id: &str, content: &str) -> Json {
	json!({ "id": id, "role": "user", "content": content, "timestamp": 1 })
}

fn reply(id: Option<&str>, text: &str, usage: Option<Json>) -> Json {
	let mut m = json!({});
	let o = m.as_obj_mut().unwrap();
	if let Some(id) = id {
		o.insert("id", id);
	}
	o.insert("role", "assistant");
	o.insert("content", json!([{ "type": "text", "text": text }]));
	if let Some(usage) = usage {
		o.insert("usage", usage);
	}
	o.insert("stopReason", "stop");
	o.insert("timestamp", 2);
	m
}

fn call(name: &str, id: &str) -> Json {
	json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": id, "name": name, "arguments": {} }], "stopReason": "toolUse", "timestamp": 3 })
}

fn result(name: &str, id: &str, is_error: bool, details: Option<Json>) -> Json {
	let mut m = json!({ "role": "toolResult", "toolCallId": id, "toolName": name, "content": [{ "type": "text", "text": format!("{name} result") }], "isError": is_error });
	if let Some(details) = details {
		m.as_obj_mut().unwrap().insert("details", details);
	}
	m.as_obj_mut().unwrap().insert("timestamp", 4);
	m
}

#[test]
fn projected_tokens_match_node() {
	let plain = vec![user("m1", &"What is a limit? ".repeat(40)), user("m2", "and continuity")];
	let anchored = vec![user("m1", "hi"), reply(Some("m2"), "Hello there", Some(usage(1200.0, 40.0))), user("m3", &"x".repeat(400))];
	let marker = json!({ "id": "m3", "role": "custom", "customType": "compaction", "content": "[SESSION HISTORY COMPACTED] summary", "display": true, "details": { "firstKeptMessageId": "m4", "tokensBefore": 9 }, "timestamp": 5 });
	let stale = vec![user("m1", "hi"), reply(Some("m2"), "old", Some(usage(50_000.0, 10.0))), marker, user("m4", "kept tail"), user("m5", "next")];
	let got: Vec<Json> = [plain, anchored, stale].iter().map(|messages| json!([projected_context_tokens(messages, 0.0), projected_context_tokens(messages, 1500.0)])).collect();
	assert_eq!(Json::Arr(got), case("projected tokens"));
}

/// What the save minted (ids, a plan block's times) as fixed text, like the golden spec.
fn masked(messages: &[Json], known: &HashSet<String>) -> Json {
	Json::Arr(
		messages
			.iter()
			.map(|m| {
				let mut out = m.clone();
				let o = out.as_obj_mut().unwrap();
				if o.get("id").and_then(Json::as_str).is_some_and(|id| !known.contains(id)) {
					o.insert("id", "<new>");
				}
				if m["customType"].as_str() == Some("plan-block") {
					o.insert("timestamp", "<now>");
					let mut details = m["details"].clone();
					details.get_mut("block").and_then(Json::as_obj_mut).unwrap().insert("at", "<now>");
					o.insert("details", details);
				}
				out
			})
			.collect(),
	)
}

fn persist_case(messages: Vec<Json>, tree: Option<Json>, base: usize, turn: Vec<Json>) -> Json {
	let fx = Fixture::new();
	let mut record = json!({ "id": "chat_g", "title": "G", "createdAt": "x", "updatedAt": "x", "messages": messages.clone() });
	if let Some(tree) = tree {
		record.as_obj_mut().unwrap().insert("tree", tree);
	}
	fsx::write_text_atomic(&fx.dir.join("data/chats/chat_g.json"), &stringify_pretty(&record, "\t")).unwrap();
	let known: HashSet<String> = messages.iter().chain(&turn).filter_map(|m| m["id"].as_str().map(str::to_owned)).collect();
	let stamped = persist_turn(&fx.app, "chat_g", base, &turn).unwrap();
	let saved = fx.app.stores.chats.get_chat("chat_g").unwrap()["messages"].as_arr().unwrap().clone();
	json!({ "stamped": masked(&stamped, &known), "saved": masked(&saved, &known) })
}

#[test]
fn turn_saves_match_node() {
	let hi = user("u1", "hi");
	assert_eq!(persist_case(vec![hi.clone()], None, 1, vec![hi, reply(None, "Hello!", Some(usage(10.0, 2.0))), reply(Some("keep_id"), "Kept id", None)]), case("persist plain turn"));

	let quiz = user("u1", "quiz me");
	let turn = vec![quiz.clone(), call("quiz", "q1"), result("quiz", "q1", false, None), call("ask_user_question", "q2"), result("ask_user_question", "q2", true, None)];
	assert_eq!(persist_case(vec![quiz], None, 1, turn), case("persist drops a clean question placeholder"));

	let tree = json!({ "nodes": [{ "id": "a", "title": "Limits" }, { "id": "b", "title": "Derivatives" }], "edges": [{ "from": "a", "to": "b" }] });
	let plan = user("u1", "plan it");
	let first = persist_case(vec![plan.clone()], Some(tree.clone()), 1, vec![plan.clone(), call("plan_init", "p1"), result("plan_init", "p1", false, Some(json!({ "ok": true }))), reply(None, "Here is the plan.", None)]);
	let failed = persist_case(vec![plan.clone()], Some(tree), 1, vec![plan, call("plan_init", "p1"), result("plan_init", "p1", true, Some(json!({ "ok": false })))]);
	assert_eq!(json!({ "first": first, "failed": failed }), case("persist a plan block once"));

	let turn = vec![user("a", "1"), user("b", "2"), user("c", "3"), reply(None, "four", None)];
	assert_eq!(persist_case(Vec::new(), None, 3, turn), case("persist with a base past the record"));
}

fn file(name: &str, mime_type: &str, bytes: &[u8]) -> ChatAttachment {
	ChatAttachment { name: name.to_owned(), mime_type: mime_type.to_owned(), data: gs_base::base64::encode(bytes) }
}

#[test]
fn pdf_attachments_match_node() {
	let mut saved: Vec<String> = Vec::new();
	let mut save = |name: &str, _: &[u8]| {
		saved.push(name.to_owned());
		Ok(format!("/lessons/chat_g/{name}"))
	};
	let pdf = b"%PDF-1.4 a tiny synthetic document";
	let parts = store_attachments(&[file("Week 3 notes.pdf", "application/pdf", pdf), file("../odd:name?.PDF", "application/pdf", pdf)], &mut save).unwrap();
	let message = |err: AttachmentError| match err {
		AttachmentError::Input(err) => err.0,
		AttachmentError::Save(err) => panic!("not a save failure: {err}"),
	};
	let refused = message(store_attachments(&[file("fake.pdf", "application/pdf", b"hello")], &mut save).unwrap_err());
	let unreadable = message(store_attachments(&[file("photo.png", "image/png", b"not a picture")], &mut save).unwrap_err());
	assert_eq!(json!({ "parts": parts, "saved": saved, "refused": refused, "unreadable": unreadable }), case("pdf attachments"));
}
