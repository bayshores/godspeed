//! Limits that only end on the app clock: a stuck tool's 30 s timeout and grace, and a job whose
//! agent went quiet. One test, because the clock is shared by the whole binary.

use std::collections::HashSet;
use std::path::Path;

use gs_base::clock;
use gs_engine::turn::abort::Abort;
use gs_engine::turn::job_session::{OneOff, RunError, run_once};
use gs_engine::turn::tool_host::ToolHost;
use gs_runtime::Part;
use gs_runtime::fake::{FakeAgent, FakeStep};
use gs_engine::turn::tool::ToolContext;
use gs_engine::turn::tool_execute::server_execute;
use gs_json::{Json, json};

fn ctx(abort: &Abort) -> ToolContext {
	ToolContext { tool_call_id: "call_1".to_owned(), abort: abort.clone() }
}

/// Lets spawned tasks reach their next timer before the clock jumps.
async fn settle() {
	clock::sleep(5).await;
}

#[tokio::test]
async fn the_app_clock_ends_stuck_tools_and_stale_claims() {
	// A tool that ignores its abort is dropped after the timeout plus the grace.
	let stuck = gs_base::tasks::spawn("test", server_execute("slow", ctx(&Abort::new()), |_| std::future::pending()));
	settle().await;
	clock::advance(30_000);
	settle().await;
	clock::advance(250);
	assert_eq!(stuck.await.unwrap(), Err("Tool \"slow\" timed out after 30s — the result was discarded".to_owned()));

	// One that stops on its abort keeps the partial result it returns within the grace.
	let partial = gs_base::tasks::spawn("test", server_execute("read", ctx(&Abort::new()), |c| async move {
		c.abort.aborted().await;
		Ok(Json::from("partial"))
	}));
	settle().await;
	clock::advance(30_000);
	assert_eq!(partial.await.unwrap(), Ok(json!({ "content": [{ "type": "text", "text": "partial" }], "details": "partial" })));

	// The learner's Stop names itself instead of the timeout.
	let run = Abort::new();
	let stopped = gs_base::tasks::spawn("test", server_execute("slow", ctx(&run), |_| std::future::pending()));
	settle().await;
	run.abort();
	settle().await;
	clock::advance(250);
	assert_eq!(stopped.await.unwrap(), Err("Operation aborted".to_owned()));

	// A job whose agent says nothing for 10 minutes fails, and its agent is stopped.
	let quiet = FakeAgent::new(vec![vec![FakeStep::Text("Reading.".to_owned()), FakeStep::Silence]]);
	let runtime = quiet.runtime();
	let host = ToolHost::new(Vec::new(), None, HashSet::new());
	let job = OneOff::new("You read a PDF.".to_owned(), vec![Part::Text("Read it.".to_owned())], host, 5, Abort::new());
	let silent = gs_base::tasks::spawn("test", async move { run_once(&runtime, Path::new("/jobs/1"), job).await });
	while !quiet.sent().iter().any(|m| m["type"].as_str() == Some("send")) {
		settle().await;
	}
	settle().await;
	clock::advance(9 * 60_000);
	settle().await;
	assert!(!silent.is_finished(), "still waiting after 9 minutes");
	clock::advance(60_000);
	assert_eq!(silent.await.unwrap(), Err(RunError::Failed("the agent said nothing for 10 minutes".to_owned())));
	assert!(quiet.sent().iter().any(|m| m["type"].as_str() == Some("interrupt")));
}
