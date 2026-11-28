//! The shared job runner. The researcher, the demo builder, the deadline requests, the vault
//! notes, the extractor and topic grouper (through `run_submit_agent`) and the compaction
//! summarizer run on it: one job, its tools and its prompt, as a one-off session on the job agent.

use std::path::PathBuf;
use std::sync::Arc;

use gs_engine::turn::abort::Abort;
use gs_engine::turn::job_session::{Approve, Finished, FollowUp, OneOff, OnToolStart, RunError};
use gs_engine::turn::messages::{agent_model_id, parts_of};
use gs_engine::turn::record::usage_json;
use gs_engine::turn::tool::Tool;
use gs_engine::turn::tool_host::ToolHost;
use gs_json::Json;
use gs_runtime::Part;

use super::headless::HeadlessApi;
use super::job_agent::{JobAgent, Priority};

/// Called with each model call's usage (pi's usage record) and the `provider:id` it ran on.
pub(crate) type OnUsage = Arc<dyn Fn(&Json, &str) + Send + Sync>;

pub struct SubagentRunOptions {
	/// Names the job in the log ("Research: Bayes' rule").
	pub label: String,
	pub system_prompt: String,
	/// Text, or content parts with pictures (a cheat sheet prompt's files).
	pub prompt: Json,
	/// Model calls allowed (a safety net).
	pub max_calls: usize,
	/// Ends the run, also while it waits for the pool.
	pub abort_signal: Option<Abort>,
	pub on_usage: Option<OnUsage>,
	pub on_tool_start: Option<OnToolStart>,
	pub priority: Priority,
	/// The folder the agent works in; None is a folder of the job's own.
	pub cwd: Option<PathBuf>,
	/// The learner's answer to the agent's permission questions; None refuses them.
	pub approve: Option<Approve>,
	pub follow_up: Option<FollowUp>,
}

impl SubagentRunOptions {
	pub fn new(label: String, system_prompt: &str, prompt: Json, max_calls: usize) -> SubagentRunOptions {
		SubagentRunOptions {
			label,
			system_prompt: system_prompt.to_owned(),
			prompt,
			max_calls,
			abort_signal: None,
			on_usage: None,
			on_tool_start: None,
			priority: Priority::Own,
			cwd: None,
			approve: None,
			follow_up: None,
		}
	}
}

/// Called with each new activity line (the job record's progress).
pub(crate) type OnActivity = Arc<dyn Fn(&str) + Send + Sync>;

/// Hands an activity line to the job's listener, when it has one.
pub(super) fn report_activity(on_activity: &Option<OnActivity>, line: &str) {
	if let Some(f) = on_activity {
		f(line);
	}
}

/// What the runner hands the demo builder and the pdf reader.
#[derive(Clone)]
pub struct JobAgentOptions {
	pub agent: Arc<dyn JobAgent>,
	pub headless: Arc<dyn HeadlessApi>,
	/// Ends the job, also while it waits for the pool.
	pub abort_signal: Option<Abort>,
	/// One call per model call, folded into the job's usage.
	pub on_usage: Option<OnUsage>,
	pub on_activity: Option<OnActivity>,
	/// The lesson that started the job answers the agent's permission questions.
	pub approve: Option<Approve>,
}

/// A prompt as the agent takes it: text, or content parts.
fn prompt_parts(prompt: &Json) -> Vec<Part> {
	match prompt {
		Json::Str(text) => vec![Part::Text(text.clone())],
		parts => parts_of(parts.items()),
	}
}

/// Runs `tools` under `opts` on `agent` to the end: the agent's last text.
pub async fn run_subagent(agent: &dyn JobAgent, tools: Vec<Arc<dyn Tool>>, opts: SubagentRunOptions) -> Result<Finished, RunError> {
	let host = ToolHost::new(tools, None, Default::default());
	let mut job = OneOff::new(opts.system_prompt, prompt_parts(&opts.prompt), host, opts.max_calls, opts.abort_signal.unwrap_or_default());
	job.cwd = opts.cwd;
	job.on_tool_start = opts.on_tool_start;
	job.approve = opts.approve;
	job.follow_up = opts.follow_up;
	if let Some(on_usage) = opts.on_usage {
		let model = agent_model_id();
		job.on_usage = Some(Arc::new(move |usage| on_usage(&usage_json(usage), &model)));
	}
	agent.run(job, opts.priority, &opts.label).await
}

#[cfg(test)]
mod tests {
	use gs_json::json;
	use gs_runtime::Usage;
	use gs_runtime::fake::FakeStep;
	use parking_lot::Mutex;

	use super::*;
	use crate::subagents::test_support::stand_in;

	#[tokio::test]
	async fn the_last_text_is_the_result_and_usage_carries_the_agent_s_model() {
		let (agent, fake) = stand_in(vec![vec![FakeStep::Usage(Usage { input: 50, cached: 20, output: 4 }), FakeStep::Text("first answer".into())]]);
		let usages = Arc::new(Mutex::new(Vec::new()));
		let mut opts = SubagentRunOptions::new("Task".to_owned(), "You help.", json!([{ "type": "text", "text": "Question?" }, { "type": "image", "data": "AAAA", "mimeType": "image/png" }]), 3);
		opts.on_usage = Some(Arc::new({
			let usages = usages.clone();
			move |usage: &Json, model: &str| usages.lock().push((usage["input"].clone(), usage["cacheRead"].clone(), model.to_owned()))
		}));
		let result = run_subagent(agent.as_ref(), Vec::new(), opts).await.unwrap();
		assert_eq!(result, Finished { text: "first answer".to_owned(), capped: false });
		assert_eq!(*usages.lock(), [(json!(30), json!(20), "agent:outside-agent".to_owned())]);
		let send = fake.sent().into_iter().find(|m| m["type"].as_str() == Some("send")).unwrap();
		assert_eq!(send["content"][1]["source"]["data"].as_str(), Some("AAAA"), "a prompt's pictures go to the agent");
	}

	#[tokio::test]
	async fn an_abort_before_the_run_is_aborted() {
		let (agent, _) = stand_in(Vec::new());
		let abort = Abort::new();
		abort.abort();
		let mut opts = SubagentRunOptions::new("Task".to_owned(), "", Json::from("go"), 3);
		opts.abort_signal = Some(abort);
		assert_eq!(run_subagent(agent.as_ref(), Vec::new(), opts).await, Err(RunError::Aborted));
	}
}
