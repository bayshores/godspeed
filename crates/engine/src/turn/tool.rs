//! A tool the model may call (pi-agent-core `AgentTool`).

use futures_util::future::BoxFuture;
use gs_json::Json;

use super::abort::Abort;

/// How a tool runs inside one batch of calls. One sequential tool makes the whole batch
/// sequential.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ExecutionMode {
	Parallel,
	Sequential,
}

/// What `execute` gets besides its arguments.
#[derive(Clone)]
pub struct ToolContext {
	pub tool_call_id: String,
	/// The run's abort (the learner's Stop).
	pub abort: Abort,
}

pub trait Tool: Send + Sync {
	fn name(&self) -> &str;
	fn description(&self) -> &str;
	/// The JSON Schema exactly as TypeBox emits it for the TS tool (key order included: the
	/// outside agent sees it, and a changed text sends the tools again).
	fn parameters(&self) -> &Json;
	fn execution_mode(&self) -> ExecutionMode {
		ExecutionMode::Parallel
	}
	/// pi's `prepareArguments`: runs on the raw arguments before validation.
	fn prepare_arguments(&self, args: Json) -> Json {
		args
	}
	/// Runs one call with validated arguments. `Ok` is pi's `AgentToolResult` record:
	/// `{content: [pi content parts], details?, isError?, terminate?}` in the tool's own key
	/// order (it is sent to the window as is). `Err(message)` is a throw: the model sees
	/// `message` as an error result.
	fn execute(&self, args: Json, ctx: ToolContext) -> BoxFuture<'_, Result<Json, String>>;
}
