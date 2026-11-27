//! The single-submit agent seam (submit-agent.ts): one schema-checked submit call is the whole
//! deliverable, run as a background job only so the model can retry a refused call. The value is
//! captured where the host runs a schema-valid call; `fill`, `validate` and `notice` apply there.
//! The final valid submit ends the job's turn; a turn that ends without one gets one reminder.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use futures_util::future::BoxFuture;
use gs_core::session::argument_heal::heal_encoded_arguments;
use gs_engine::turn::job_session::RunError;
use gs_engine::turn::tool::{Tool, ToolContext};
use gs_engine::turn::tool_execute::{invalid_input_result, to_tool_result};
use gs_json::Json;
use gs_runtime::Part;
use parking_lot::Mutex;

use crate::subagents::job_agent::JobAgent;
use crate::subagents::pi_run::{SubagentRunOptions, run_subagent};

/// Defaults for omitted optional fields, applied to the schema-valid input.
pub type Fill = Box<dyn Fn(Json) -> Json + Send + Sync>;
/// A pipeline law the schema cannot state: `Some(problem)` goes back to the model as an error
/// result and it tries again within its model calls. May read files.
pub type Validate = Box<dyn Fn(&Json) -> BoxFuture<'static, Option<String>> + Send + Sync>;
/// Asked once, of the first submit that passes `validate`: `Some(text)` goes back to the model as
/// a plain result, not an error, and its next valid submit is final. The model call this adds does
/// not count against `max_calls`.
pub type Notice = Box<dyn Fn(&Json) -> BoxFuture<'static, Option<String>> + Send + Sync>;

pub struct SubmitAgentOptions {
	pub tool_name: String,
	pub tool_description: String,
	/// The submit tool's JSON Schema, as TypeBox emits it.
	pub parameters: Json,
	pub fill: Option<Fill>,
	pub validate: Option<Validate>,
	pub notice: Option<Notice>,
	/// The error when the model never makes a valid submit.
	pub never_submitted: String,
	/// Tools to look things up before submitting.
	pub lookups: Vec<Arc<dyn Tool>>,
	/// The run's prompt, label, priority, folder and the rest; its `max_calls` default (4) only
	/// leaves room for retries.
	pub run: SubagentRunOptions,
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
			never_submitted: never_submitted.to_owned(),
			lookups: Vec::new(),
			run: SubagentRunOptions::new(tool_name.to_owned(), &system_prompt, prompt, 4),
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
			let mut result = to_tool_result(&value);
			result.set("terminate", true);
			*self.submitted.lock() = Some(value);
			Ok(result)
		})
	}
}

/// What the agent reads when its turn ended without the submit.
fn reminder(tool_name: &str) -> String {
	format!("You have not called {tool_name} yet. Call it now; it is the only way your work reaches godspeed.")
}

/// Runs the agent until it makes one valid submit, and returns the (filled) value.
pub async fn run_submit_agent(agent: &dyn JobAgent, opts: SubmitAgentOptions) -> Result<Json, RunError> {
	let submitted = Arc::new(Mutex::new(None));
	let noticed = Arc::new(AtomicBool::new(false));
	let notice_call = usize::from(opts.notice.is_some());
	let reminder = reminder(&opts.tool_name);
	let submit = SubmitTool { name: opts.tool_name, description: opts.tool_description, parameters: opts.parameters, fill: opts.fill, validate: opts.validate, notice: opts.notice, noticed, submitted: submitted.clone() };
	let mut tools = opts.lookups;
	tools.push(Arc::new(submit));

	let mut run = opts.run;
	run.max_calls += notice_call;
	run.follow_up = Some(Box::new({
		let submitted = submitted.clone();
		move |_: &str| submitted.lock().is_none().then(|| vec![Part::Text(reminder)])
	}));
	run_subagent(agent, tools, run).await?;
	let value = submitted.lock().take();
	value.ok_or(RunError::Failed(opts.never_submitted))
}
