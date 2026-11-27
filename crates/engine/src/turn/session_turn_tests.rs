use std::collections::HashSet;

use gs_runtime::ToolCall;
use tokio::sync::Semaphore;

use super::super::messages::{agent_model, text_block};
use super::super::tool::{ExecutionMode, Tool, ToolContext};
use super::*;

/// A tool that says when each call starts and ends. `look` waits for the test's go-ahead and
/// runs beside other calls; `quiz` runs alone.
struct Logged {
	name: &'static str,
	schema: Json,
	log: Arc<Mutex<Vec<String>>>,
	go: Arc<Semaphore>,
}

impl Tool for Logged {
	fn name(&self) -> &str {
		self.name
	}
	fn description(&self) -> &str {
		""
	}
	fn parameters(&self) -> &Json {
		&self.schema
	}
	fn execution_mode(&self) -> ExecutionMode {
		if self.name == "quiz" { ExecutionMode::Sequential } else { ExecutionMode::Parallel }
	}
	fn execute(&self, _args: Json, ctx: ToolContext) -> BoxFuture<'_, Result<Json, String>> {
		Box::pin(async move {
			self.log.lock().push(format!("start {}", ctx.tool_call_id));
			if self.name == "look" {
				self.go.acquire().await.expect("open").forget();
			}
			self.log.lock().push(format!("end {}", ctx.tool_call_id));
			Ok(json!({ "content": [text_block("ok")] }))
		})
	}
}

#[tokio::test]
async fn a_call_of_a_tool_that_runs_alone_never_runs_beside_another_call() {
	let (log, go) = (Arc::new(Mutex::new(Vec::new())), Arc::new(Semaphore::new(0)));
	let tool = |name| -> Arc<dyn Tool> { Arc::new(Logged { name, schema: json!({ "type": "object", "properties": {} }), log: log.clone(), go: go.clone() }) };
	let turn = SessionTurn::new(SessionTurnSpec {
		open: Box::new(|_| Box::pin(async { Err("not opened".to_owned()) })),
		host: ToolHost::new(vec![tool("look"), tool("quiz")], None, HashSet::new()),
		check_text: Box::new(str::to_owned),
		before: Vec::new(),
		model: agent_model(),
		folds_steers: false,
	});
	let (ran_tx, mut ran_rx) = mpsc::unbounded_channel::<Ran>();
	let mut calls = CallQueue::new();
	// The agent's side of each answer stays open to the test's end.
	let mut answers = Vec::new();
	for (id, name) in [("c1", "look"), ("c2", "look"), ("c3", "quiz"), ("c4", "look")] {
		let (reply, answer) = oneshot::channel();
		answers.push(answer);
		turn.take(SessionEvent::ToolCall { call: ToolCall { id: id.to_owned(), name: name.to_owned(), args: json!({}) }, reply }, &mut calls);
	}
	turn.start_calls(&mut calls, &ran_tx);
	assert_eq!(calls.running(), 2, "the two looks run side by side; the quiz waits for them");

	go.add_permits(2);
	for _ in 0..2 {
		let ran = ran_rx.recv().await.unwrap();
		calls.done();
		turn.ran(ran);
		turn.start_calls(&mut calls, &ran_tx);
	}
	assert_eq!(calls.running(), 1, "the quiz alone; the look after it waits");
	let ran = ran_rx.recv().await.unwrap();
	assert_eq!(ran.block["id"].as_str(), Some("c3"));
	calls.done();
	turn.ran(ran);
	turn.start_calls(&mut calls, &ran_tx);
	go.add_permits(1);
	assert_eq!(ran_rx.recv().await.unwrap().block["id"].as_str(), Some("c4"));

	let log = log.lock().clone();
	let at = |line: &str| log.iter().position(|l| l == line).unwrap_or_else(|| panic!("{line} in {log:?}"));
	assert!(at("start c3") > at("end c1") && at("start c3") > at("end c2"), "{log:?}");
	assert_eq!(&log[4..], ["start c3", "end c3", "start c4", "end c4"]);
}
