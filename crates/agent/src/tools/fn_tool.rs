//! One tool built from closures, so each lesson tool is a few lines instead of a type.

use std::future::Future;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_core::session::argument_heal::heal_encoded_arguments;
use gs_engine::turn::tool::{ExecutionMode, Tool, ToolContext};
use gs_engine::turn::tool_execute::server_execute;
use gs_json::Json;

/// What a call does: the validated arguments in, pi's result record (or a throw) out.
pub type Run = Arc<dyn Fn(Json, ToolContext) -> BoxFuture<'static, Result<Json, String>> + Send + Sync>;
type Prepare = Arc<dyn Fn(Json) -> Result<Json, String> + Send + Sync>;

#[derive(Clone)]
pub struct FnTool {
	name: String,
	description: String,
	parameters: Json,
	mode: ExecutionMode,
	prepare: Option<Prepare>,
	run: Run,
}

impl FnTool {
	/// A tool whose body runs under the engine's per-call guard; its value becomes the result
	/// (a string as it is, anything else as JSON with the value as `details`).
	pub fn server<F, Fut>(name: &str, description: impl Into<String>, parameters: Json, body: F) -> FnTool
	where
		F: Fn(Json, ToolContext) -> Fut + Send + Sync + 'static,
		Fut: Future<Output = Result<Json, String>> + Send + 'static,
	{
		let body = Arc::new(body);
		let tool_name = name.to_owned();
		let run: Run = Arc::new(move |args, ctx| {
			let (body, tool_name) = (body.clone(), tool_name.clone());
			Box::pin(async move { server_execute(&tool_name, ctx, move |ctx| (*body)(args, ctx)).await })
		});
		FnTool { name: name.to_owned(), description: description.into(), parameters, mode: ExecutionMode::Parallel, prepare: None, run }
	}

	/// A tool that answers at once with a ready result record, no guard (the question tools).
	pub fn immediate<F>(name: &str, description: impl Into<String>, parameters: Json, answer: F) -> FnTool
	where
		F: Fn(Json) -> Json + Send + Sync + 'static,
	{
		let answer = Arc::new(answer);
		let run: Run = Arc::new(move |args, _ctx| {
			let answer = answer.clone();
			Box::pin(async move { Ok((*answer)(args)) })
		});
		FnTool { name: name.to_owned(), description: description.into(), parameters, mode: ExecutionMode::Parallel, prepare: None, run }
	}

	/// Another module's tool, so it can take the same wrappers.
	pub fn from_tool(tool: Arc<dyn Tool>) -> FnTool {
		let prepare_with = tool.clone();
		let run_with = tool.clone();
		FnTool {
			name: tool.name().to_owned(),
			description: tool.description().to_owned(),
			parameters: tool.parameters().clone(),
			mode: tool.execution_mode(),
			prepare: Some(Arc::new(move |args| prepare_with.prepare_arguments(args))),
			run: Arc::new(move |args, ctx| {
				let tool = run_with.clone();
				Box::pin(async move { tool.execute(args, ctx).await })
			}),
		}
	}

	pub fn sequential(mut self) -> FnTool {
		self.mode = ExecutionMode::Sequential;
		self
	}

	/// Replaces the arguments' preparation (pi's `prepareArguments`, before validation); its
	/// `Err` refuses the call with that text alone.
	pub fn prepared(mut self, prepare: impl Fn(Json) -> Result<Json, String> + Send + Sync + 'static) -> FnTool {
		self.prepare = Some(Arc::new(prepare));
		self
	}

	/// The tool's own preparation first, then the heal against its declared schema.
	pub fn healed(mut self) -> FnTool {
		let (inner, schema) = (self.prepare.take(), self.parameters.clone());
		self.prepare = Some(Arc::new(move |args| {
			let prepared = match &inner {
				Some(prepare) => prepare(args)?,
				None => args,
			};
			Ok(heal_encoded_arguments(&prepared, &schema))
		}));
		self
	}

	/// Swaps what a call does, keeping the name, schema and preparation.
	pub fn with_run(mut self, wrap: impl FnOnce(Run) -> Run) -> FnTool {
		self.run = wrap(self.run);
		self
	}

	pub fn into_arc(self) -> Arc<dyn Tool> {
		Arc::new(self)
	}
}

impl Tool for FnTool {
	fn name(&self) -> &str {
		&self.name
	}

	fn description(&self) -> &str {
		&self.description
	}

	fn parameters(&self) -> &Json {
		&self.parameters
	}

	fn execution_mode(&self) -> ExecutionMode {
		self.mode
	}

	fn prepare_arguments(&self, args: Json) -> Result<Json, String> {
		match &self.prepare {
			Some(prepare) => prepare(args),
			None => Ok(args),
		}
	}

	fn execute(&self, args: Json, ctx: ToolContext) -> BoxFuture<'_, Result<Json, String>> {
		(self.run)(args, ctx)
	}
}
