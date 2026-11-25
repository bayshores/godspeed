use std::collections::HashSet;
use std::path::Path;

use gs_json::Json;
use gs_runtime::fake::{FakeAgent, FakeStep};
use parking_lot::Mutex;

use super::*;
use crate::turn::messages::text_block;
use crate::turn::tool::{Tool, ToolContext};

/// A job tool: `note` answers "Noted.", `submit` ends the job, `wait` runs until it is stopped.
struct JobTool {
	name: &'static str,
	schema: Json,
}

impl Tool for JobTool {
	fn name(&self) -> &str {
		self.name
	}
	fn description(&self) -> &str {
		"A job tool."
	}
	fn parameters(&self) -> &Json {
		&self.schema
	}
	fn execute(&self, _args: Json, ctx: ToolContext) -> BoxFuture<'_, Result<Json, String>> {
		Box::pin(async move {
			match self.name {
				"submit" => Ok(json!({ "content": [text_block("Submitted.")], "terminate": true })),
				"wait" => {
					ctx.abort.aborted().await;
					Err("Operation aborted".to_owned())
				}
				_ => Ok(json!({ "content": [text_block("Noted.")] })),
			}
		})
	}
}

fn host() -> ToolHost {
	let tool = |name| -> Arc<dyn Tool> { Arc::new(JobTool { name, schema: json!({ "type": "object", "properties": {} }) }) };
	ToolHost::new(vec![tool("note"), tool("submit"), tool("wait")], None, HashSet::new())
}

fn job(max_calls: usize) -> OneOff {
	OneOff::new("You read a PDF for a teacher.".to_owned(), vec![Part::Text("Read it.".to_owned())], host(), max_calls, Abort::new())
}

fn job_aborted() -> OneOff {
	let job = job(5);
	job.abort.abort();
	job
}

fn tool(name: &str) -> FakeStep {
	FakeStep::Tool { name: name.to_owned(), args: json!({}) }
}

fn text(text: &str) -> FakeStep {
	FakeStep::Text(text.to_owned())
}

const USED: Usage = Usage { input: 100, cached: 80, output: 9 };

/// The kinds of message godspeed sent the agent, in order.
fn sent(agent: &FakeAgent) -> Vec<String> {
	agent.sent().iter().map(|m| m["type"].str_or_empty().to_owned()).collect()
}

async fn run(agent: &FakeAgent, job: OneOff) -> Result<Finished, RunError> {
	run_once(&agent.runtime(), Path::new("/jobs/1"), job).await
}

#[tokio::test]
async fn the_last_text_is_the_result_and_each_model_call_is_counted() {
	let agent = FakeAgent::new(vec![vec![FakeStep::Usage(USED), text("Reading."), tool("note"), FakeStep::Usage(USED), text("The brief.")]]);
	let used = Arc::new(Mutex::new(Vec::new()));
	let mut job = job(5);
	job.on_usage = Some(Arc::new({
		let used = used.clone();
		move |usage| used.lock().push(usage)
	}));
	assert_eq!(run(&agent, job).await, Ok(Finished { text: "The brief.".to_owned(), capped: false }));
	assert_eq!(*used.lock(), [USED, USED]);
	let open = &agent.sent()[0];
	assert_eq!((open["systemPrompt"].as_str(), open["persist"].as_bool(), &open["model"]), (Some("You read a PDF for a teacher."), Some(false), &Json::Null), "a session of its own, not kept, on the agent's own model");
	assert_eq!(open["cwd"].as_str(), Some("/jobs/1"));
	let tools: Vec<&str> = open["tools"].items().iter().filter_map(|t| t["name"].as_str()).collect();
	assert_eq!(tools, ["note", "submit", "wait"]);
	assert_eq!(agent.sent()[2]["content"][0]["text"].as_str(), Some("Noted."), "the tool's result goes back to the agent");
}

#[tokio::test]
async fn a_tool_whose_result_ends_the_job_ends_its_turn() {
	let agent = FakeAgent::new(vec![vec![text("Done."), tool("submit"), text("never written")]]);
	assert_eq!(run(&agent, job(5)).await, Ok(Finished { text: "Done.".to_owned(), capped: false }));
	let reply = agent.sent().into_iter().find(|m| m["type"].as_str() == Some("tool_result")).unwrap();
	assert_eq!(reply["endTurn"].as_bool(), Some(true));
}

#[tokio::test]
async fn past_the_cap_the_agent_is_stopped_and_the_text_so_far_kept() {
	let agent = FakeAgent::new(vec![vec![FakeStep::Usage(USED), text("one"), tool("note"), FakeStep::Usage(USED), text("two"), tool("note"), FakeStep::Usage(USED), text("three"), tool("note")]]);
	assert_eq!(run(&agent, job(2)).await, Ok(Finished { text: "two".to_owned(), capped: true }));
	assert!(sent(&agent).contains(&"interrupt".to_owned()));
}

#[tokio::test]
async fn stop_during_a_tool_stops_the_agent_and_closes_the_session() {
	let agent = FakeAgent::new(vec![vec![tool("wait"), text("never written")]]);
	let job = job(5);
	let abort = job.abort.clone();
	let runtime = agent.runtime();
	let running = gs_base::tasks::spawn("test", async move { run_once(&runtime, Path::new("/jobs/1"), job).await });
	while !sent(&agent).contains(&"send".to_owned()) {
		tokio::task::yield_now().await;
	}
	abort.abort();
	assert_eq!(running.await.unwrap(), Err(RunError::Aborted));
	while !sent(&agent).contains(&"close".to_owned()) {
		tokio::task::yield_now().await;
	}
	assert!(sent(&agent).contains(&"interrupt".to_owned()));

	let stopped = job_aborted();
	assert_eq!(run(&agent, stopped).await, Err(RunError::Aborted), "a job stopped before it starts opens no session");
}

#[tokio::test]
async fn a_follow_up_sends_one_more_turn() {
	let agent = FakeAgent::new(vec![vec![text("A brief from nothing.")], vec![text("A brief from page 2.")], vec![text("never asked")]]);
	let mut job = job(5);
	let asked = Arc::new(Mutex::new(Vec::new()));
	job.follow_up = Some(Box::new({
		let asked = asked.clone();
		move |text: &str| {
			asked.lock().push(text.to_owned());
			Some(vec![Part::Text("Read a page first.".to_owned())])
		}
	}));
	assert_eq!(run(&agent, job).await.unwrap().text, "A brief from page 2.");
	assert_eq!(*asked.lock(), ["A brief from nothing."], "asked once");
	let sends: Vec<Json> = agent.sent().into_iter().filter(|m| m["type"].as_str() == Some("send")).collect();
	assert_eq!(sends.len(), 2);
	assert_eq!(sends[1]["content"][0]["text"].as_str(), Some("Read a page first."));
}

#[tokio::test]
async fn permission_questions_go_to_approve_and_without_it_are_refused() {
	let bash = || FakeStep::Approval { tool: "Bash".to_owned(), input: json!({ "command": "latexmk sheet.tex" }) };
	let agent = FakeAgent::new(vec![vec![bash(), text("Made it.")], vec![bash(), text("Could not.")]]);
	let mut watched = job(5);
	let asked = Arc::new(Mutex::new(Vec::new()));
	watched.approve = Some(Arc::new({
		let asked = asked.clone();
		move |ask| {
			asked.lock().push(ask);
			Box::pin(async { Verdict { allow: true, message: None } })
		}
	}));
	assert_eq!(run(&agent, watched).await.unwrap().text, "Made it.");
	assert_eq!(*asked.lock(), [Ask::Tool { name: "Bash".to_owned(), input: json!({ "command": "latexmk sheet.tex" }) }]);
	assert_eq!(run(&agent, job(5)).await.unwrap().text, "Could not.");
	let verdicts: Vec<Option<bool>> = agent.sent().iter().filter(|m| m["type"].as_str() == Some("approval")).map(|m| m["allow"].as_bool()).collect();
	assert_eq!(verdicts, [Some(true), Some(false)]);
}

#[tokio::test]
async fn a_failed_turn_and_a_failing_tool_start_fail_the_job() {
	let agent = FakeAgent::new(vec![vec![FakeStep::Fail("overloaded".to_owned())], vec![tool("note"), text("never written")]]);
	assert_eq!(run(&agent, job(5)).await, Err(RunError::Failed("overloaded".to_owned())));
	let mut job = job(5);
	job.on_tool_start = Some(Arc::new(|name, _| Err(format!("{name} is not allowed"))));
	assert_eq!(run(&agent, job).await, Err(RunError::Failed("note is not allowed".to_owned())));
}

#[tokio::test]
async fn the_agent_s_own_tools_are_heard() {
	let agent = FakeAgent::new(vec![vec![FakeStep::OwnTool { name: "WebSearch".to_owned(), input: json!({ "query": "Bayes" }) }, text("Found it.")]]);
	let mut job = job(5);
	let heard = Arc::new(Mutex::new(Vec::new()));
	job.on_own_tool = Some(Arc::new({
		let heard = heard.clone();
		move |name: &str, input: &Json| heard.lock().push((name.to_owned(), input.clone()))
	}));
	assert_eq!(run(&agent, job).await.unwrap().text, "Found it.");
	assert_eq!(*heard.lock(), [("WebSearch".to_owned(), json!({ "query": "Bayes" }))]);
}
