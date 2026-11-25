use std::path::Path;
use std::sync::Arc;

use gs_json::{Json, json};
use gs_pdf::Pdf;
use gs_runtime::fake::FakeStep;
use parking_lot::Mutex;

use super::*;
use crate::subagents::headless::{NO_CHROME_MESSAGE, get_headless};
use crate::subagents::test_support::{FakeHeadless, job_agent_options, result_texts, says, tool};

fn clean() -> Result<DemoRunResult, String> {
	Ok(DemoRunResult { ok: true, ..Default::default() })
}

#[tokio::test]
async fn a_tested_demo_is_delivered_with_notes() {
	let turn = vec![
		tool("run_demo", json!({})),
		tool("write_demo", json!({ "html": "" })),
		tool("write_demo", json!({ "html": 5 })),
		tool("run_demo", json!({ "probe": "1 + 1" })),
		tool("run_demo", json!({ "probe": "" })),
		says(" A stepper. "),
	];
	let mut probed = clean().unwrap();
	probed.probe_result = Some(json!(2));
	let fake = FakeHeadless::new(Ok(probed));
	let (opts, agent, lines) = job_agent_options(vec![turn], fake.clone());
	let result = run_demo_builder("  Stepper ", "", &opts).await;
	assert_eq!(result, json!({ "title": "Stepper", "html": "5", "tested": true, "notes": "A stepper." }));
	assert_eq!(
		result_texts(&agent),
		vec![
			"ERROR: nothing to run — call write_demo first.",
			"ERROR: empty document — write the full HTML.",
			"Saved (1 bytes). Now call run_demo to test it — never deliver untested.",
			"PASSED: no console errors, no uncaught errors, no failed requests. Probe result: 2. If you are satisfied, finish with your notes; otherwise keep improving and re-test.",
			"PASSED: no console errors, no uncaught errors, no failed requests. Probe result: 2. If you are satisfied, finish with your notes; otherwise keep improving and re-test.",
		]
	);
	assert_eq!(*fake.demo_runs.lock(), vec![("5".to_owned(), Some("1 + 1".to_owned())), ("5".to_owned(), None)]);
	assert_eq!(*lines.lock(), vec!["run_demo", "write_demo", "write_demo", "write_demo: 0.0 KB", "run_demo", "run_demo: clean", "run_demo", "run_demo: clean"]);
	let open = &agent.sent()[0];
	assert!(open["systemPrompt"].str_or_empty().starts_with("You are a demo builder"));
	assert!(open["persist"] == Json::Bool(false));
}

#[tokio::test]
async fn failed_runs_list_their_errors() {
	let failing = DemoRunResult { console_errors: vec!["boom".to_owned()], page_errors: vec!["x".to_owned(), "y".to_owned()], failed_requests: vec![], probe_result: None, ok: false };
	assert_eq!(format_run_result(&failing), "FAILED: 1 console error, 2 page errors.\nConsole errors:\n- boom\nUncaught errors:\n- x\n- y\nFix the document (write_demo) and re-test (run_demo).");
	assert_eq!(failure_summary(&failing), "1 console error, 2 page errors: boom | x | y");
	assert_eq!(summarize_counts(&DemoRunResult::default()), "ok");

	let fake = FakeHeadless::new(Ok(failing));
	let (opts, _, lines) = job_agent_options(vec![vec![tool("write_demo", json!({ "html": "<p>hi</p>" })), says("Done.")]], fake.clone());
	let result = run_demo_builder("", "b", &opts).await;
	assert_eq!(result, json!({ "title": "Interactive demo", "html": "", "tested": true, "notes": "FAILED: the demo never passed headless verification (1 console error, 2 page errors: boom | x | y)." }));
	assert_eq!(lines.lock().last().unwrap(), "final verification");
}

#[tokio::test]
async fn without_a_browser_every_run_fails() {
	let turn = vec![tool("write_demo", json!({ "html": "<p>hi</p>" })), tool("run_demo", json!({})), says("It works.")];
	let (opts, agent, lines) = job_agent_options(vec![turn], get_headless(&Pdf::new(Path::new("/nonexistent")), None));
	let result = run_demo_builder("T", "b", &opts).await;
	assert_eq!(result["notes"], Json::from(format!("FAILED: final verification crashed: {NO_CHROME_MESSAGE}")));
	assert_eq!(result_texts(&agent)[1], format!("HEADLESS ERROR (retrying may help): {NO_CHROME_MESSAGE}"));
	assert!(lines.lock().contains(&"run_demo: browser error".to_owned()));
}

#[tokio::test]
async fn nothing_written_unavailable_and_crashes_fail() {
	let (opts, _, _) = job_agent_options(vec![vec![says("Nothing could be built.")]], FakeHeadless::new(clean()));
	assert_eq!(run_demo_builder("T", "b", &opts).await["notes"], Json::from("FAILED: the builder never wrote a demo. (Nothing could be built.)"));

	let (opts, _, _) = job_agent_options(vec![vec![tool("run_demo", json!({}))]], FakeHeadless::new(clean()));
	assert_eq!(run_demo_builder("T", "b", &opts).await["notes"], Json::from("FAILED: the builder never wrote a demo."));

	let fake = FakeHeadless { unavailable: Some("no browser".to_owned()), demo: clean(), demo_runs: Mutex::new(Vec::new()) };
	let (opts, agent, _) = job_agent_options(Vec::new(), Arc::new(fake));
	assert_eq!(run_demo_builder("T", "b", &opts).await, json!({ "title": "T", "html": "", "tested": true, "notes": "FAILED: no browser" }));
	assert!(agent.sent().is_empty(), "no session without a browser");

	let (opts, _, _) = job_agent_options(vec![vec![FakeStep::Fail("overloaded".to_owned())]], FakeHeadless::new(clean()));
	assert_eq!(run_demo_builder("T", "b", &opts).await["notes"], Json::from("FAILED: the builder crashed: overloaded"));
}

#[tokio::test]
async fn the_tools_are_declared_like_typebox() {
	let state = Arc::new(Mutex::new(BuilderState::default()));
	let headless: Arc<dyn HeadlessApi> = FakeHeadless::new(clean());
	let tools = demo_tools(&state, &headless, &None);
	assert_eq!(
		gs_json::stringify(tools[1].parameters()),
		r#"{"type":"object","properties":{"probe":{"type":"string","description":"Optional JS expression evaluated in the page after settling, e.g. \"document.querySelectorAll('input').length\"."}}}"#
	);
	assert_eq!(tools[0].prepare_arguments(json!({ "html": "<p>" })), Ok(json!({ "html": "<p>" })));
}
