//! The shared helper-agent runner. The
//! researcher, the demo builder, the extractor and topic grouper (through `run_submit_agent`)
//! and the compaction summarizer run on it: an agent built per call, without saved state,
//! driven to completion.
//!
//! Model and loop failures come back as `RunError::Failed`, and an abort as `RunError::Aborted`.

use std::fmt;
use std::sync::Arc;

use gs_base::{clock, ids};
use gs_engine::bridge::Bridge;
use gs_engine::turn::abort::Abort;
use gs_engine::turn::agent::{Agent, AgentOptions};
use gs_engine::turn::events::AgentEvent;
use gs_engine::turn::faux::Engine;
use gs_engine::turn::messages::zero_usage;
use gs_engine::turn::models::agent_engine;
use gs_engine::turn::tool::Tool;
use gs_json::{Json, json};
use parking_lot::Mutex;

use super::headless::HeadlessApi;
use super::stream_once::message_text;

/// Why a helper agent's run ended without a result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunError {
	/// The caller's abort fired (TS: an `AbortError` with the message "aborted").
	Aborted,
	/// The model call or the loop failed, with the message.
	Failed(String),
}

impl fmt::Display for RunError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			RunError::Aborted => f.write_str("aborted"),
			RunError::Failed(message) => f.write_str(message),
		}
	}
}

/// Called with each completed model call's usage.
pub type OnUsage = Arc<dyn Fn(&Json) + Send + Sync>;
/// Called when a tool starts, with its name and arguments. An `Err` is a throw: the run ends
/// with that failure before the tool runs.
pub type OnToolStart = Arc<dyn Fn(&str, &Json) -> Result<(), String> + Send + Sync>;
/// Called per completed assistant message, with the step number from 1.
pub type OnAssistantMessage = Arc<dyn Fn(&Json, usize) + Send + Sync>;
/// An extra stop rule over the finished turn's message and tool results.
pub type ShouldStop = Box<dyn Fn(&Json, &[Json]) -> bool + Send>;

pub struct SubagentRunOptions {
	/// The runner's or a test's engine; without one, the outside agent runs it.
	pub engine: Option<Engine>,
	pub system_prompt: String,
	/// Text, or content parts with pictures (a cheat sheet prompt's files).
	pub prompt: Json,
	/// Model calls allowed (a safety net).
	pub max_turns: usize,
	/// Ends the run mid-model-call.
	pub abort_signal: Option<Abort>,
	pub on_usage: Option<OnUsage>,
	pub on_tool_start: Option<OnToolStart>,
	pub on_assistant_message: Option<OnAssistantMessage>,
	pub should_stop: Option<ShouldStop>,
	/// The task's name ("Topic grouping: CSE 21"): the outside agent sees it on the run's work
	/// items, so it can tell which background job it is answering.
	pub task_label: Option<String>,
}

impl SubagentRunOptions {
	pub fn new(system_prompt: &str, prompt: Json, max_turns: usize) -> SubagentRunOptions {
		SubagentRunOptions {
			engine: None,
			system_prompt: system_prompt.to_owned(),
			prompt,
			max_turns,
			abort_signal: None,
			on_usage: None,
			on_tool_start: None,
			on_assistant_message: None,
			should_stop: None,
			task_label: None,
		}
	}
}

/// Called with each new activity line (the job record's progress).
pub type OnActivity = Arc<dyn Fn(&str) + Send + Sync>;

/// What the runner hands the demo builder, the visual maker and the pdf reader.
#[derive(Clone)]
pub struct HelperOptions {
	/// Names the job's conversation for the outside agent and runs it when `engine` is None.
	pub bridge: Bridge,
	pub engine: Option<Engine>,
	pub headless: Arc<dyn HeadlessApi>,
	/// Ends the job mid-model-call.
	pub abort_signal: Option<Abort>,
	/// One call per model request, folded into the job's usage.
	pub on_usage: Option<OnUsage>,
	pub on_activity: Option<OnActivity>,
}

impl HelperOptions {
	pub(super) fn activity(&self, line: &str) {
		if let Some(f) = &self.on_activity {
			f(line);
		}
	}

	pub(super) fn usage(&self, usage: &Json) {
		if let Some(f) = &self.on_usage {
			f(usage);
		}
	}

	/// The engine the job runs on: the given one, else the outside agent.
	pub(super) fn engine(&self) -> Engine {
		self.engine.clone().unwrap_or_else(|| agent_engine(&self.bridge))
	}

	pub(super) fn abort(&self) -> Abort {
		self.abort_signal.clone().unwrap_or_default()
	}
}

pub struct SubagentRunResult {
	/// The messages the run added (the prompt, assistant messages and tool results).
	pub new_messages: Vec<Json>,
	/// The last assistant message's text (the deliverable).
	pub text: String,
}

/// What the event listener saw of the run.
#[derive(Default)]
struct Seen {
	step: usize,
	error_message: Option<String>,
	aborted: bool,
	/// What a callback threw.
	thrown: Option<String>,
}

/// pi's `handleRunFailure` message for a run that threw.
fn run_failure_message(model: &Json, error: &str) -> Json {
	json!({
		"role": "assistant",
		"content": [{ "type": "text", "text": "" }],
		"api": model["api"],
		"provider": model["provider"],
		"model": model["id"],
		"usage": zero_usage(),
		"stopReason": "error",
		"errorMessage": error,
		"timestamp": clock::now_ms(),
	})
}

/// Runs `tools` under `opts` to the end. `bridge` names the run's conversation for the outside
/// agent and runs it when `opts.engine` is None.
pub async fn run_subagent(bridge: &Bridge, tools: Vec<Arc<dyn Tool>>, opts: SubagentRunOptions) -> Result<SubagentRunResult, RunError> {
	// Cancelled before the run started: an aborted signal never fires again, so end now.
	if opts.abort_signal.as_ref().is_some_and(Abort::is_aborted) {
		return Err(RunError::Aborted);
	}
	let engine = opts.engine.unwrap_or_else(|| agent_engine(bridge));
	// One unsaved conversation per run, the same through every turn.
	let session_id = ids::uuid();
	if let Some(label) = &opts.task_label {
		bridge.label_conversation(&session_id, label);
	}
	let max_turns = opts.max_turns;
	let should_stop = opts.should_stop;
	let mut turns = 0;
	let model = engine.model.clone();
	let mut options = AgentOptions::new(engine);
	options.system_prompt = opts.system_prompt;
	options.tools = tools;
	options.session_id = Some(session_id.clone());
	// Ending exits before the steering poll.
	options.finish_turn = Some(Box::new(move |turn| {
		turns += 1;
		turns >= max_turns || should_stop.as_ref().is_some_and(|stop| stop(turn.message, turn.tool_results))
	}));
	let agent = Agent::new(options);

	let seen = Arc::new(Mutex::new(Seen::default()));
	let run_abort = opts.abort_signal.as_ref().map_or_else(Abort::new, Abort::child);
	let (on_usage, on_tool_start, on_assistant) = (opts.on_usage, opts.on_tool_start, opts.on_assistant_message);
	agent.subscribe(Arc::new({
		let seen = seen.clone();
		let run_abort = run_abort.clone();
		move |event: &AgentEvent| match event {
			AgentEvent::MessageEnd(m) if m["role"] == Json::from("assistant") => {
				if m["stopReason"] == Json::from("aborted") {
					// The call was cancelled: no completed step and no usage.
					seen.lock().aborted = true;
					return;
				}
				let step = {
					let mut s = seen.lock();
					s.step += 1;
					if m["stopReason"] == Json::from("error") {
						s.error_message = m["errorMessage"].as_str().map(str::to_owned);
					}
					s.step
				};
				if let Some(f) = &on_usage {
					f(&m["usage"]);
				}
				if let Some(f) = &on_assistant {
					f(m, step);
				}
			}
			AgentEvent::ToolExecutionStart { tool_name, args, .. } => {
				if let Some(Err(thrown)) = on_tool_start.as_ref().map(|f| f(tool_name, args)) {
					// A throw in a listener ends pi's loop with its failure message, a step with no
					// usage; stop the run here.
					let failed = run_failure_message(&model, &thrown);
					let step = {
						let mut s = seen.lock();
						if s.thrown.is_some() {
							return;
						}
						s.thrown = Some(thrown);
						s.step += 1;
						s.step
					};
					if let Some(f) = &on_usage {
						f(&failed["usage"]);
					}
					if let Some(f) = &on_assistant {
						f(&failed, step);
					}
					run_abort.abort();
				}
			}
			_ => {}
		}
	}));

	let prompt = json!({ "role": "user", "content": opts.prompt, "timestamp": clock::now_ms() });
	let ran = agent.prompt(vec![prompt], run_abort).await;
	bridge.forget_conversation(&session_id);
	ran.map_err(RunError::Failed)?;

	let seen = std::mem::take(&mut *seen.lock());
	if let Some(thrown) = seen.thrown {
		return Err(RunError::Failed(thrown));
	}
	if seen.aborted || opts.abort_signal.as_ref().is_some_and(Abort::is_aborted) {
		return Err(RunError::Aborted);
	}
	if let Some(message) = seen.error_message {
		return Err(RunError::Failed(message));
	}
	// Without the seeded leading system message.
	let new_messages: Vec<Json> = agent.messages().into_iter().filter(|m| m["role"] != Json::from("system")).collect();
	let text = new_messages.iter().rev().find(|m| m["role"] == Json::from("assistant")).map(message_text).unwrap_or_default();
	Ok(SubagentRunResult { new_messages, text })
}

#[cfg(test)]
mod tests {
	use gs_engine::turn::faux::Scripted;
	use gs_engine::turn::messages::{faux_assistant_message, text_block};

	use super::*;
	use crate::subagents::test_support::{bridge, faux_engine, tool_call};

	#[tokio::test]
	async fn the_last_assistant_text_is_the_result() {
		let script = Scripted::new();
		script.reply(faux_assistant_message(vec![text_block("first "), text_block("answer")], "stop"));
		let bridge = bridge();
		let usages = Arc::new(Mutex::new(0));
		let mut opts = SubagentRunOptions::new("You help.", Json::from("Question?"), 3);
		opts.engine = Some(faux_engine(&script));
		opts.task_label = Some("Task".to_owned());
		opts.on_usage = Some(Arc::new({
			let usages = usages.clone();
			move |_| *usages.lock() += 1
		}));
		let result = run_subagent(&bridge, Vec::new(), opts).await.unwrap();
		assert_eq!(result.text, "first answer");
		assert_eq!(result.new_messages.len(), 2, "the prompt and the reply");
		assert_eq!(result.new_messages[0]["content"], Json::from("Question?"));
		assert_eq!(*usages.lock(), 1);
	}

	#[tokio::test]
	async fn max_turns_ends_a_tool_loop() {
		let script = Scripted::new();
		for _ in 0..3 {
			script.reply(faux_assistant_message(vec![tool_call("c", "nope", json!({}))], "toolUse"));
		}
		let mut opts = SubagentRunOptions::new("", Json::from("go"), 2);
		opts.engine = Some(faux_engine(&script));
		let starts = Arc::new(Mutex::new(Vec::new()));
		opts.on_tool_start = Some(Arc::new({
			let starts = starts.clone();
			move |name, _| {
				starts.lock().push(name.to_owned());
				Ok(())
			}
		}));
		let result = run_subagent(&bridge(), Vec::new(), opts).await.unwrap();
		assert_eq!(result.text, "");
		assert_eq!(result.new_messages.iter().filter(|m| m["role"] == Json::from("assistant")).count(), 2);
		assert_eq!(*starts.lock(), vec!["nope", "nope"]);
	}

	#[tokio::test]
	async fn a_throwing_tool_start_ends_the_run_with_its_error() {
		let script = Scripted::new();
		script.reply(faux_assistant_message(vec![tool_call("c", "web_fetch", json!({ "url": 5 }))], "toolUse"));
		script.reply(faux_assistant_message(vec![text_block("never asked")], "stop"));
		let mut opts = SubagentRunOptions::new("", Json::from("go"), 5);
		opts.engine = Some(faux_engine(&script));
		opts.on_tool_start = Some(Arc::new(|_, _| Err("e.slice is not a function".to_owned())));
		let usages = Arc::new(Mutex::new(Vec::new()));
		opts.on_usage = Some(Arc::new({
			let usages = usages.clone();
			move |usage: &Json| usages.lock().push(usage["input"].clone())
		}));
		let err = run_subagent(&bridge(), Vec::new(), opts).await.err().unwrap();
		assert_eq!(err, RunError::Failed("e.slice is not a function".to_owned()));
		// The model's step, then the failure's step with no usage.
		assert_eq!(usages.lock().len(), 2);
		assert_eq!(usages.lock()[1], json!(0));
	}

	#[tokio::test]
	async fn a_model_error_is_a_failure() {
		let script = Scripted::new();
		script.run(|_| Box::pin(async { Err("rate limited".to_owned()) }));
		let mut opts = SubagentRunOptions::new("", Json::from("go"), 3);
		opts.engine = Some(faux_engine(&script));
		let err = run_subagent(&bridge(), Vec::new(), opts).await.err().unwrap();
		assert_eq!(err, RunError::Failed("rate limited".to_owned()));
	}

	#[tokio::test]
	async fn an_abort_before_or_during_the_run_is_aborted() {
		let abort = Abort::new();
		abort.abort();
		let mut opts = SubagentRunOptions::new("", Json::from("go"), 3);
		opts.abort_signal = Some(abort);
		assert_eq!(run_subagent(&bridge(), Vec::new(), opts).await.err(), Some(RunError::Aborted));

		// On the outside agent: the call waits on the bridge until the abort ends it.
		let bridge = bridge();
		let abort = Abort::new();
		let mut opts = SubagentRunOptions::new("", Json::from("go"), 3);
		opts.abort_signal = Some(abort.clone());
		let run = tokio::spawn({
			let bridge = bridge.clone();
			async move { run_subagent(&bridge, Vec::new(), opts).await.err() }
		});
		while bridge.pending_work_count() == 0 {
			tokio::task::yield_now().await;
		}
		abort.abort();
		assert_eq!(run.await.unwrap(), Some(RunError::Aborted));
		assert_eq!(bridge.pending_work_count(), 0);
	}
}
