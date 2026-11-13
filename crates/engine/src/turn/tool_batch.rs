//! Running one assistant message's tool calls (pi-agent-core agent-loop.ts
//! `executeToolCalls`): in parallel unless a called tool is sequential, each validated first,
//! with pi's events and result messages.

use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use std::time::Instant;

use futures_util::FutureExt;
use futures_util::future::join_all;
use gs_base::num;
use gs_json::Json;

use super::abort::Abort;
use super::agent::{Agent, BeforeToolCall};
use super::events::AgentEvent;
use super::messages::{error_tool_result, tool_result_message};
use super::tool::{ExecutionMode, Tool, ToolContext};
use super::validate::validate_tool_arguments;

/// The batch's result messages; `terminate` when every result asked to end the run.
pub(super) struct Batch {
	pub messages: Vec<Json>,
	pub terminate: bool,
}

/// The assistant message whose calls run, and the transcript before it.
#[derive(Clone, Copy)]
pub(super) struct Reply<'a> {
	pub before: &'a [Json],
	pub message: &'a Json,
}

struct Finalized {
	call: Json,
	result: Json,
	is_error: bool,
	duration_ms: Option<f64>,
}

enum Prepared {
	/// Refused before running: unknown tool, bad arguments, or aborted.
	Immediate(Finalized),
	Ready(Arc<dyn Tool>, Json),
}

fn text(v: &Json) -> String {
	v.as_str().unwrap_or("undefined").to_owned()
}

fn refused(call: &Json, message: &str) -> Finalized {
	Finalized { call: call.clone(), result: error_tool_result(message), is_error: true, duration_ms: None }
}

fn start(agent: &Agent, call: &Json) {
	agent.emit(AgentEvent::ToolExecutionStart { tool_call_id: text(&call["id"]), tool_name: text(&call["name"]), args: call["arguments"].clone() });
}

fn end(agent: &Agent, f: &Finalized) {
	agent.emit(AgentEvent::ToolExecutionEnd {
		tool_call_id: text(&f.call["id"]),
		tool_name: text(&f.call["name"]),
		result: f.result.clone(),
		is_error: f.is_error,
		duration_ms: f.duration_ms,
	});
}

/// Emits and returns the call's result message.
fn result_message(agent: &Agent, f: &Finalized) -> Json {
	let message = tool_result_message(&f.call, &f.result, f.is_error, f.duration_ms);
	agent.announce(&message);
	message
}

/// `prepareToolCall`: find the tool, prepare and validate its arguments, then ask the
/// `before_tool_call` hook.
fn prepare(agent: &Agent, reply: Reply, call: &Json, abort: &Abort) -> Prepared {
	let name = text(&call["name"]);
	let Some(tool) = agent.tools.iter().find(|t| t.name() == name) else {
		return Prepared::Immediate(refused(call, &format!("Tool {name} not found")));
	};
	let args = match tool.prepare_arguments(call["arguments"].clone()) {
		Ok(args) => args,
		Err(message) => return Prepared::Immediate(refused(call, &message)),
	};
	let validated = match validate_tool_arguments(&name, tool.parameters(), &args) {
		Ok(validated) => validated,
		Err(message) => return Prepared::Immediate(refused(call, &message)),
	};
	let blocked = agent.before_tool_call.as_ref().and_then(|hook| hook(&BeforeToolCall { messages: reply.before, message: reply.message, call, args: &validated }));
	match blocked {
		Some(reason) => Prepared::Immediate(refused(call, &reason)),
		None if abort.is_aborted() => Prepared::Immediate(refused(call, "Operation aborted")),
		None => Prepared::Ready(tool.clone(), validated),
	}
}

/// `executePreparedToolCall`: a failed call (or a panic in the tool) becomes an error result.
async fn run(tool: &dyn Tool, call: &Json, args: Json, abort: &Abort) -> Finalized {
	let started = Instant::now();
	let ctx = ToolContext { tool_call_id: text(&call["id"]), abort: abort.clone() };
	let outcome = AssertUnwindSafe(tool.execute(args, ctx)).catch_unwind().await;
	let duration_ms = Some(num::math_round(started.elapsed().as_secs_f64() * 1000.0));
	let (result, is_error) = match outcome {
		Ok(Ok(result)) => {
			let is_error = result["isError"] == Json::Bool(true);
			(result, is_error)
		}
		Ok(Err(message)) => (error_tool_result(&message), true),
		Err(panic) => {
			let message = panic.downcast_ref::<&str>().map(|s| (*s).to_owned()).or_else(|| panic.downcast_ref::<String>().cloned()).unwrap_or_else(|| "The tool failed.".to_owned());
			(error_tool_result(&message), true)
		}
	};
	Finalized { call: call.clone(), result, is_error, duration_ms }
}

fn terminates(calls: &[Finalized]) -> bool {
	!calls.is_empty() && calls.iter().all(|f| f.result["terminate"] == Json::Bool(true))
}

pub(super) async fn execute_tool_calls(agent: &Agent, reply: Reply<'_>, calls: &[Json], abort: &Abort) -> Batch {
	let sequential = calls.iter().any(|c| agent.tools.iter().any(|t| Some(t.name()) == c["name"].as_str() && t.execution_mode() == ExecutionMode::Sequential));
	if sequential { run_sequential(agent, reply, calls, abort).await } else { run_parallel(agent, reply, calls, abort).await }
}

async fn run_sequential(agent: &Agent, reply: Reply<'_>, calls: &[Json], abort: &Abort) -> Batch {
	let mut finalized = Vec::new();
	let mut messages = Vec::new();
	for call in calls {
		start(agent, call);
		let f = match prepare(agent, reply, call, abort) {
			Prepared::Immediate(f) => f,
			Prepared::Ready(tool, args) => run(tool.as_ref(), call, args, abort).await,
		};
		end(agent, &f);
		messages.push(result_message(agent, &f));
		finalized.push(f);
		if abort.is_aborted() {
			break;
		}
	}
	Batch { messages, terminate: terminates(&finalized) }
}

async fn run_parallel(agent: &Agent, reply: Reply<'_>, calls: &[Json], abort: &Abort) -> Batch {
	let mut entries = Vec::new();
	for call in calls {
		start(agent, call);
		match prepare(agent, reply, call, abort) {
			Prepared::Immediate(f) => {
				end(agent, &f);
				entries.push(Ok(f));
			}
			Prepared::Ready(tool, args) => entries.push(Err((call, tool, args))),
		}
		if abort.is_aborted() {
			break;
		}
	}
	let finalized = join_all(entries.into_iter().map(|entry| async move {
		match entry {
			Ok(f) => f,
			Err((call, _, _)) if abort.is_aborted() => {
				let f = refused(call, "Operation aborted");
				end(agent, &f);
				f
			}
			Err((call, tool, args)) => {
				let f = run(tool.as_ref(), call, args, abort).await;
				// A call that ran ends a step after the calls refused at the start, as in pi.
				tokio::task::yield_now().await;
				end(agent, &f);
				f
			}
		}
	}))
	.await;
	let messages = finalized.iter().map(|f| result_message(agent, f)).collect();
	Batch { messages, terminate: terminates(&finalized) }
}

/// A message cut off by the token limit may carry cut-off arguments: none of its calls run.
pub(super) fn fail_truncated_calls(agent: &Agent, calls: &[Json]) -> Batch {
	let messages = calls
		.iter()
		.map(|call| {
			start(agent, call);
			let f = refused(call, &format!("Tool call \"{}\" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.", text(&call["name"])));
			end(agent, &f);
			result_message(agent, &f)
		})
		.collect();
	Batch { messages, terminate: false }
}

#[cfg(test)]
mod tests {
	use futures_util::future::BoxFuture;
	use gs_json::{Json, json};

	use super::*;
	use crate::turn::agent::AgentOptions;
	use crate::turn::faux::{Engine, Scripted, faux_model};

	struct Refusing(Json);

	impl Tool for Refusing {
		fn name(&self) -> &str {
			"refusing"
		}
		fn description(&self) -> &str {
			"Refuses every call in its preparation."
		}
		fn parameters(&self) -> &Json {
			&self.0
		}
		fn prepare_arguments(&self, _args: Json) -> Result<Json, String> {
			Err("nodeId: missing.\nopener.lead: too long.".to_owned())
		}
		fn execute(&self, _args: Json, _ctx: ToolContext) -> BoxFuture<'_, Result<Json, String>> {
			Box::pin(async { panic!("a refused call never runs") })
		}
	}

	#[tokio::test]
	async fn a_preparation_error_is_the_whole_result_with_no_echo() {
		let mut options = AgentOptions::new(Engine { model: faux_model("m", "p", "faux", "Faux", 1000.0, 100.0), respond: Scripted::new() });
		options.tools = vec![Arc::new(Refusing(json!({ "type": "object", "properties": { "nodeId": { "type": "string" } }, "required": ["nodeId"] })))];
		let agent = Agent::new(options);
		let call = json!({ "type": "toolCall", "id": "call_1", "name": "refusing", "arguments": { "secret": "never shown" } });
		let message = json!({ "role": "assistant", "content": [call.clone()] });
		let batch = execute_tool_calls(&agent, Reply { before: &[], message: &message }, &[call], &Abort::new()).await;
		assert_eq!(batch.messages[0]["content"], json!([{ "type": "text", "text": "nodeId: missing.\nopener.lead: too long." }]));
		assert_eq!(batch.messages[0]["isError"], Json::Bool(true));
		assert!(!batch.terminate);
	}

	struct Echo(Json);

	impl Tool for Echo {
		fn name(&self) -> &str {
			"echo"
		}
		fn description(&self) -> &str {
			"Says its argument back."
		}
		fn parameters(&self) -> &Json {
			&self.0
		}
		fn execute(&self, args: Json, _ctx: ToolContext) -> BoxFuture<'_, Result<Json, String>> {
			Box::pin(async move { Ok(json!({ "content": [{ "type": "text", "text": gs_json::stringify(&args["n"]) }] })) })
		}
	}

	/// The hook sees the whole reply, so a call can be refused for one listed after it, and its
	/// reason is the whole result.
	#[tokio::test]
	async fn the_hook_sees_the_whole_reply_and_its_reason_is_the_result() {
		let mut options = AgentOptions::new(Engine { model: faux_model("m", "p", "faux", "Faux", 1000.0, 100.0), respond: Scripted::new() });
		options.tools = vec![Arc::new(Echo(json!({ "type": "object", "properties": { "n": { "type": "number" } }, "required": ["n"] })))];
		options.before_tool_call = Some(Box::new(|ctx| {
			let later = ctx.message["content"].as_arr().unwrap().iter().skip_while(|c| c["id"] != ctx.call["id"]).skip(1).count();
			(later > 0 && ctx.messages.len() == 1 && ctx.args["n"] == json!(1.0)).then(|| format!("call {} waits for the {later} after it.", ctx.call["id"].as_str().unwrap()))
		}));
		let agent = Agent::new(options);
		let calls = [json!({ "type": "toolCall", "id": "c1", "name": "echo", "arguments": { "n": "1" } }), json!({ "type": "toolCall", "id": "c2", "name": "echo", "arguments": { "n": 1 } })];
		let message = json!({ "role": "assistant", "content": calls.to_vec() });
		let before = [json!({ "role": "user", "content": "go" })];
		let batch = execute_tool_calls(&agent, Reply { before: &before, message: &message }, &calls, &Abort::new()).await;
		assert_eq!(batch.messages[0]["content"], json!([{ "type": "text", "text": "call c1 waits for the 1 after it." }]), "the hook gets the validated arguments");
		assert_eq!(batch.messages[0]["isError"], Json::Bool(true));
		assert_eq!(batch.messages[1]["content"], json!([{ "type": "text", "text": "1" }]));
	}
}
