//! Limits that only end on the app clock: a stuck tool's 30 s timeout and grace, a claim nobody
//! answered for 10 minutes, a compaction that never reported its end, and a helper busy on one
//! long job. One test, because the clock is shared by the whole binary.

use std::sync::Arc;

use gs_base::clock;
use gs_base::events::Events;
use gs_engine::bridge::{AgentReply, Bridge, WaitOptions};
use gs_engine::turn::abort::Abort;
use gs_engine::turn::tool::ToolContext;
use gs_engine::turn::tool_execute::server_execute;
use gs_json::{Json, json};

mod common;
use common::{Marks, park};

fn ctx(abort: &Abort) -> ToolContext {
	ToolContext { tool_call_id: "call_1".to_owned(), abort: abort.clone() }
}

/// Lets spawned tasks reach their next timer before the clock jumps.
async fn settle() {
	clock::sleep(5).await;
}

fn agent(name: &str) -> WaitOptions {
	WaitOptions { agent: Some(name.to_owned()), ..WaitOptions::default() }
}

#[tokio::test]
async fn the_app_clock_ends_stuck_tools_and_stale_claims() {
	// A tool that ignores its abort is dropped after the timeout plus the grace.
	let stuck = tokio::spawn(server_execute("slow", ctx(&Abort::new()), |_| std::future::pending()));
	settle().await;
	clock::advance(30_000);
	settle().await;
	clock::advance(250);
	assert_eq!(stuck.await.unwrap(), Err("Tool \"slow\" timed out after 30s — the result was discarded".to_owned()));

	// One that stops on its abort keeps the partial result it returns within the grace.
	let partial = tokio::spawn(server_execute("read", ctx(&Abort::new()), |c| async move {
		c.abort.aborted().await;
		Ok(Json::from("partial"))
	}));
	settle().await;
	clock::advance(30_000);
	assert_eq!(partial.await.unwrap(), Ok(json!({ "content": [{ "type": "text", "text": "partial" }], "details": "partial" })));

	// The learner's Stop names itself instead of the timeout.
	let run = Abort::new();
	let stopped = tokio::spawn(server_execute("slow", ctx(&run), |_| std::future::pending()));
	settle().await;
	run.abort();
	settle().await;
	clock::advance(250);
	assert_eq!(stopped.await.unwrap(), Err("Operation aborted".to_owned()));

	// A claim with no reply for 10 minutes goes to the next agent; the old workId is dead.
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	let call = park(&bridge, vec![json!({ "role": "user", "content": "hi", "timestamp": 1 })], "chat_l1", &Abort::new());
	settle().await;
	let first = bridge.wait_for_work(0, agent("agent-A")).await.unwrap();
	assert!(bridge.wait_for_work(0, agent("agent-B")).await.is_none());
	clock::advance(9 * 60_000);
	assert!(bridge.wait_for_work(0, agent("agent-B")).await.is_none(), "still claimed after 9 minutes");
	clock::advance(60_001);
	let second = bridge.wait_for_work(0, agent("agent-B")).await.unwrap();
	let reply = |text: &str| AgentReply { text: Some(text.to_owned()), tool_calls: Vec::new() };
	assert!(bridge.respond_to_work(&first.work_id, reply("late"), 0).unwrap_err().starts_with("No open work item"));
	bridge.respond_to_work(&second.work_id, reply("Hi."), 0).unwrap();
	assert_eq!(call.await.unwrap()["content"], json!([{ "type": "text", "text": "Hi." }]));

	// A compacting agent takes nothing; its mark lapses after 10 minutes, and the window hears
	// it a second later.
	let events = Events::new();
	let bridge = Bridge::new(&events, Arc::new(Marks::default()));
	let call = park(&bridge, vec![json!({ "role": "user", "content": "hi", "timestamp": 1 })], "chat_l2", &Abort::new());
	bridge.agent_compacting("main-1", clock::now_ms());
	settle().await;
	assert!(bridge.wait_for_work(0, agent("main-1")).await.is_none());
	clock::advance(9 * 60_000);
	settle().await;
	assert!(bridge.wait_for_work(0, agent("main-1")).await.is_none(), "still compacting after 9 minutes");
	let mut changes = events.subscribe();
	clock::advance(60_000);
	settle().await;
	assert!(changes.try_recv().is_err());
	clock::advance(1000);
	settle().await;
	assert_eq!(changes.try_recv().unwrap().kind.name(), "agent-changed");
	assert!(changes.try_recv().is_err());
	let work = bridge.wait_for_work(0, agent("main-1")).await.unwrap();
	bridge.respond_to_work(&work.work_id, reply("Back."), 0).unwrap();
	assert_eq!(call.await.unwrap()["content"], json!([{ "type": "text", "text": "Back." }]));

	// A helper busy on one long job sends no check-ins, yet still counts as here, so the teacher
	// leaves it the next job until its claim runs out.
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));
	let _sheet = park(&bridge, vec![json!({ "role": "user", "content": "make the sheet", "timestamp": 1 })], "job_sheet", &Abort::new());
	settle().await;
	bridge.wait_for_work(0, WaitOptions { helper: true, ..agent("helper-1") }).await.unwrap();
	let _read = park(&bridge, vec![json!({ "role": "user", "content": "read this file", "timestamp": 1 })], "job_read", &Abort::new());
	settle().await;
	clock::advance(4 * 60_000);
	assert!(bridge.helper_here(clock::now_ms()));
	assert!(bridge.wait_for_work(0, agent("main-1")).await.is_none());
	clock::advance(6 * 60_000 + 1);
	assert!(!bridge.helper_here(clock::now_ms()));
	assert_eq!(bridge.wait_for_work(0, agent("main-1")).await.unwrap().conversation, "job_sheet");
}
