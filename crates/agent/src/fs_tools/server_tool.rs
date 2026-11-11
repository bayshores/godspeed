//! What every tool here shares: a name, text, schema and a body that runs under the engine's
//! per-call guard (`serverExecute` in tool-execute.ts).

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use gs_engine::turn::tool::{Tool, ToolContext};
use gs_engine::turn::tool_execute::server_execute;
use gs_json::Json;

type Body = Box<dyn Fn(Json, ToolContext) -> Pin<Box<dyn Future<Output = Result<Json, String>> + Send>> + Send + Sync>;

struct ServerTool {
	name: &'static str,
	description: String,
	parameters: Json,
	body: Body,
}

/// `body` gets the validated arguments and the guard's context (its abort carries the learner's
/// Stop and the 30 s timeout). A string it returns goes to the model as it is.
pub fn server_tool<F, Fut>(name: &'static str, description: String, parameters: Json, body: F) -> Arc<dyn Tool>
where
	F: Fn(Json, ToolContext) -> Fut + Send + Sync + 'static,
	Fut: Future<Output = Result<Json, String>> + Send + 'static,
{
	Arc::new(ServerTool { name, description, parameters, body: Box::new(move |args, ctx| Box::pin(body(args, ctx))) })
}

impl Tool for ServerTool {
	fn name(&self) -> &str {
		self.name
	}

	fn description(&self) -> &str {
		&self.description
	}

	fn parameters(&self) -> &Json {
		&self.parameters
	}

	fn execute(&self, args: Json, ctx: ToolContext) -> Pin<Box<dyn Future<Output = Result<Json, String>> + Send + '_>> {
		Box::pin(server_execute(self.name, ctx, move |ctx| (self.body)(args, ctx)))
	}
}

/// Runs blocking file work on its own thread, so a long walk never holds the server's workers.
pub async fn off_thread(work: impl FnOnce() -> Result<Json, String> + Send + 'static) -> Result<Json, String> {
	tokio::task::spawn_blocking(work).await.map_err(|e| e.to_string())?
}
