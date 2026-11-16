//! The single-submit agent seam (submit-agent.ts): one schema-checked submit call is the whole
//! deliverable, run as a background agent only so the model can retry a refused call. The value is
//! captured where the engine runs a schema-valid call; `fill`, `validate` and `notice` apply there.

use std::cell::Cell;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use futures_util::future::BoxFuture;
use gs_core::session::argument_heal::heal_encoded_arguments;
use gs_engine::bridge::Bridge;
use gs_engine::turn::abort::Abort;
use gs_engine::turn::faux::Engine;
use gs_engine::turn::tool::{Tool, ToolContext};
use gs_engine::turn::tool_execute::{invalid_input_result, to_tool_result};
use gs_json::Json;
use parking_lot::Mutex;

use crate::subagents::pi_run::{RunError, SubagentRunOptions, run_subagent};

/// Defaults for omitted optional fields, applied to the schema-valid input.
pub type Fill = Box<dyn Fn(Json) -> Json + Send + Sync>;
/// A pipeline law the schema cannot state: `Some(problem)` goes back to the model as an error
/// result and it tries again within its turns. May read files.
pub type Validate = Box<dyn Fn(&Json) -> BoxFuture<'static, Option<String>> + Send + Sync>;
/// Asked once, of the first submit that passes `validate`: `Some(text)` goes back to the model as
/// a plain result, not an error, and its next valid submit is final. The model call this adds does
/// not count against `max_turns`.
pub type Notice = Box<dyn Fn(&Json) -> BoxFuture<'static, Option<String>> + Send + Sync>;
/// Each finished model call's usage and `provider:model`.
pub type OnStep = Arc<dyn Fn(&Json, &str) + Send + Sync>;

pub struct SubmitAgentOptions {
	pub tool_name: String,
	pub tool_description: String,
	/// The submit tool's JSON Schema, as TypeBox emits it.
	pub parameters: Json,
	pub fill: Option<Fill>,
	pub validate: Option<Validate>,
	pub notice: Option<Notice>,
	pub system_prompt: String,
	/// Text, or content parts.
	pub prompt: Json,
	/// None: the outside agent.
	pub engine: Option<Engine>,
	pub abort: Option<Abort>,
	pub on_step: Option<OnStep>,
	/// The error when the model never makes a valid submit.
	pub never_submitted: String,
	/// The task's name on the outside agent's work items.
	pub task_label: Option<String>,
	/// The learner asked for it: the teacher takes it before a helper.
	pub asked: bool,
	/// Tools to look things up before submitting.
	pub lookups: Vec<Arc<dyn Tool>>,
	/// Model calls allowed; the default (4) only leaves room for retries.
	pub max_turns: Option<usize>,
}

impl SubmitAgentOptions {
	pub fn new(tool_name: &str, tool_description: &str, parameters: Json, system_prompt: String, prompt: Json, never_submitted: &str) -> SubmitAgentOptions {
		SubmitAgentOptions {
			tool_name: tool_name.to_owned(),
			tool_description: tool_description.to_owned(),
			parameters,
			fill: None,
			validate: None,
			notice: None,
			system_prompt,
			prompt,
			engine: None,
			abort: None,
			on_step: None,
			never_submitted: never_submitted.to_owned(),
			task_label: None,
			asked: false,
			lookups: Vec::new(),
			max_turns: None,
		}
	}
}

struct SubmitTool {
	name: String,
	description: String,
	parameters: Json,
	fill: Option<Fill>,
	validate: Option<Validate>,
	notice: Option<Notice>,
	/// Whether `notice` was asked.
	noticed: Arc<AtomicBool>,
	submitted: Arc<Mutex<Option<Json>>>,
}

impl Tool for SubmitTool {
	fn name(&self) -> &str {
		&self.name
	}
	fn description(&self) -> &str {
		&self.description
	}
	fn parameters(&self) -> &Json {
		&self.parameters
	}
	fn prepare_arguments(&self, args: Json) -> Result<Json, String> {
		Ok(heal_encoded_arguments(&args, &self.parameters))
	}
	fn execute(&self, args: Json, _ctx: ToolContext) -> BoxFuture<'_, Result<Json, String>> {
		Box::pin(async move {
			let value = match &self.fill {
				Some(fill) => fill(args),
				None => args,
			};
			let problem = match &self.validate {
				Some(validate) => validate(&value).await,
				None => None,
			};
			if let Some(problem) = problem {
				return Ok(invalid_input_result(&self.name, &[problem]));
			}
			if let Some(notice) = self.notice.as_ref().filter(|_| !self.noticed.swap(true, Ordering::SeqCst))
				&& let Some(text) = notice(&value).await
			{
				return Ok(to_tool_result(&Json::from(text)));
			}
			let result = to_tool_result(&value);
			*self.submitted.lock() = Some(value);
			Ok(result)
		})
	}
}

/// The names of an assistant message's tool calls, or "(none)".
fn called_tools(message: &Json) -> String {
	let names: Vec<&str> = message["content"].items().iter().filter(|c| c["type"] == Json::from("toolCall")).filter_map(|c| c["name"].as_str()).collect();
	if names.is_empty() { "(none)".to_owned() } else { names.join(", ") }
}

/// Runs the agent until it makes one valid submit, and returns the (filled) value.
pub async fn run_submit_agent(bridge: &Bridge, opts: SubmitAgentOptions) -> Result<Json, RunError> {
	let submitted = Arc::new(Mutex::new(None));
	let noticed = Arc::new(AtomicBool::new(false));
	let max_turns = opts.max_turns.unwrap_or(4);
	let ceiling = max_turns + usize::from(opts.notice.is_some());
	let submit = SubmitTool { name: opts.tool_name, description: opts.tool_description, parameters: opts.parameters, fill: opts.fill, validate: opts.validate, notice: opts.notice, noticed: noticed.clone(), submitted: submitted.clone() };
	let mut tools = opts.lookups;
	tools.push(Arc::new(submit));

	let mut run = SubagentRunOptions::new(&opts.system_prompt, opts.prompt, ceiling);
	run.engine = opts.engine;
	run.abort_signal = opts.abort;
	run.task_label = opts.task_label;
	run.asked = opts.asked;
	if let Some(on_step) = opts.on_step {
		run.on_assistant_message = Some(Arc::new(move |message: &Json, step: usize| {
			// pi reports the bare model id; usage stamps carry provider:id.
			let model = format!("{}:{}", message["provider"].as_str().unwrap_or("undefined"), message["model"].as_str().unwrap_or("undefined"));
			on_step(&message["usage"], &model);
			eprintln!("[submit-agent] step {step}: {}, tools: {}", message["stopReason"].str_or_empty(), called_tools(message));
		}));
	}
	let (captured, turns) = (submitted.clone(), Cell::new(0));
	run.should_stop = Some(Box::new(move |_message, _results| {
		turns.set(turns.get() + 1);
		captured.lock().is_some() || turns.get() >= max_turns + usize::from(noticed.load(Ordering::SeqCst))
	}));
	run_subagent(bridge, tools, run).await?;
	let value = submitted.lock().take();
	value.ok_or(RunError::Failed(opts.never_submitted))
}
