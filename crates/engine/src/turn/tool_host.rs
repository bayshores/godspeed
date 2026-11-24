//! Running one godspeed tool call: find the tool, prepare and validate its arguments, ask the
//! before-call hook, run it. A lesson's agent session calls its tools one at a time through a
//! `ToolHost`, which also says whether a call ends the turn; the agent loop's batches run their
//! calls through the same `prepare` and `run`.

use std::collections::HashSet;
use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use std::time::Instant;

use futures_util::FutureExt;
use gs_base::num;
use gs_json::{Json, json};
use gs_runtime::ToolSpec;

use super::abort::Abort;
use super::agent::{BeforeToolCall, BeforeToolCallFn};
use super::messages::{error_tool_result, text_block};
use super::tool::{Tool, ToolContext};
use super::validate::validate_tool_arguments;

/// The assistant message whose calls run, and the transcript before it.
#[derive(Clone, Copy)]
pub struct Reply<'a> {
	pub before: &'a [Json],
	pub message: &'a Json,
}

pub(super) struct Finalized {
	pub call: Json,
	pub result: Json,
	pub is_error: bool,
	pub duration_ms: Option<f64>,
}

pub(super) enum Prepared {
	/// Refused before running: unknown tool, bad arguments, or aborted.
	Immediate(Finalized),
	Ready(Arc<dyn Tool>, Json),
}

pub(super) fn text(v: &Json) -> String {
	v.as_str().unwrap_or("undefined").to_owned()
}

pub(super) fn refused(call: &Json, message: &str) -> Finalized {
	Finalized { call: call.clone(), result: error_tool_result(message), is_error: true, duration_ms: None }
}

/// `prepareToolCall`: find the tool, prepare and validate its arguments, then ask the
/// `before_tool_call` hook.
pub(super) fn prepare(tools: &[Arc<dyn Tool>], hook: Option<&BeforeToolCallFn>, reply: Reply, call: &Json, abort: &Abort) -> Prepared {
	let name = text(&call["name"]);
	let Some(tool) = tools.iter().find(|t| t.name() == name) else {
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
	let blocked = hook.and_then(|hook| hook(&BeforeToolCall { messages: reply.before, message: reply.message, call, args: &validated }));
	match blocked {
		Some(reason) => Prepared::Immediate(refused(call, &reason)),
		None if abort.is_aborted() => Prepared::Immediate(refused(call, "Operation aborted")),
		None => Prepared::Ready(tool.clone(), validated),
	}
}

/// `executePreparedToolCall`: a failed call (or a panic in the tool) becomes an error result.
pub(super) async fn run(tool: &dyn Tool, call: &Json, args: Json, abort: &Abort) -> Finalized {
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

/// One call's outcome: the tool's result record (`{content, details?, isError?, terminate?,
/// held?, releases?}`), and whether the turn ends with it.
#[derive(Clone, Debug, PartialEq)]
pub struct HostReply {
	pub result: Json,
	pub is_error: bool,
	pub ends_turn: bool,
	/// The call waits for a later one (`held: true`): the agent reads its result, the record
	/// leaves the call out until a later call releases it, and the turn goes on.
	pub held: bool,
	/// A held call that goes back into the record with this one (`releases: {toolCallId,
	/// result?}`), with its result; none leaves it unanswered, as a question for the learner.
	pub releases: Option<Release>,
	/// Set for a call that ran.
	pub duration_ms: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Release {
	pub id: String,
	pub result: Option<Json>,
}

/// A lesson turn's tools, and the rules for its calls.
pub struct ToolHost {
	tools: Vec<Arc<dyn Tool>>,
	before_tool_call: Option<BeforeToolCallFn>,
	/// A clean result of one of these ends the turn: the learner answers it next.
	stops: HashSet<String>,
	/// Tools kept in the list but not allowed this turn, with what the agent reads instead.
	refused: Vec<(String, String)>,
	/// Tools whose calls may be held (`held: true`), so they are not shown before their result.
	holding: HashSet<String>,
}

impl ToolHost {
	pub fn new(tools: Vec<Arc<dyn Tool>>, before_tool_call: Option<BeforeToolCallFn>, stops: HashSet<String>) -> ToolHost {
		ToolHost { tools, before_tool_call, stops, refused: Vec::new(), holding: HashSet::new() }
	}

	/// These tools stay in the list, so the session's tools do not change, but their calls are
	/// refused with `reason` once their arguments pass.
	pub fn refuse(mut self, names: impl IntoIterator<Item = String>, reason: &str) -> ToolHost {
		self.refused.extend(names.into_iter().map(|name| (name, reason.to_owned())));
		self
	}

	/// These tools' calls may be held.
	pub fn holding(mut self, names: impl IntoIterator<Item = String>) -> ToolHost {
		self.holding.extend(names);
		self
	}

	pub fn may_hold(&self, name: &str) -> bool {
		self.holding.contains(name)
	}

	pub fn tool_names(&self) -> impl Iterator<Item = &str> {
		self.tools.iter().map(|t| t.name())
	}

	/// The tools as the agent session is given them.
	pub fn specs(&self) -> Vec<ToolSpec> {
		self.tools.iter().map(|t| ToolSpec { name: t.name().to_owned(), description: t.description().to_owned(), input_schema: t.parameters().clone() }).collect()
	}

	/// Runs `call` (a `toolCall` block) from `reply`. A question for the learner ends the turn
	/// when it resolved cleanly; one that failed its checks does not, so the agent can try again.
	pub async fn call(&self, call: &Json, reply: Reply<'_>, abort: &Abort) -> HostReply {
		let refusal = self.refused.iter().find(|(name, _)| Some(name.as_str()) == call["name"].as_str()).map(|(_, reason)| reason);
		let finalized = match (prepare(&self.tools, self.before_tool_call.as_ref(), reply, call, abort), refusal) {
			(Prepared::Immediate(finalized), _) => finalized,
			(Prepared::Ready(_, _), Some(reason)) => Finalized { call: call.clone(), result: json!({ "content": [text_block(reason)], "isError": true }), is_error: true, duration_ms: None },
			(Prepared::Ready(tool, args), None) => run(tool.as_ref(), call, args, abort).await,
		};
		let stops = call["name"].as_str().is_some_and(|name| self.stops.contains(name)) || finalized.result["terminate"] == Json::Bool(true);
		let held = !finalized.is_error && finalized.result["held"] == Json::Bool(true);
		let releases = finalized.result["releases"]["toolCallId"].as_str().filter(|_| !finalized.is_error).map(|id| Release { id: id.to_owned(), result: finalized.result["releases"].get("result").cloned() });
		HostReply { ends_turn: stops && !finalized.is_error && !held, held, releases, result: finalized.result, is_error: finalized.is_error, duration_ms: finalized.duration_ms }
	}
}

#[cfg(test)]
mod tests {
	use futures_util::future::BoxFuture;

	use super::*;

	struct Ask(Json);

	impl Tool for Ask {
		fn name(&self) -> &str {
			"quiz"
		}
		fn description(&self) -> &str {
			"Asks the learner."
		}
		fn parameters(&self) -> &Json {
			&self.0
		}
		fn execute(&self, args: Json, _ctx: ToolContext) -> BoxFuture<'_, Result<Json, String>> {
			Box::pin(async move {
				if args["question"].str_or_empty().is_empty() { Ok(json!({ "content": [text_block("question: empty.")], "isError": true })) } else { Ok(json!({ "content": [text_block("Shown.")] })) }
			})
		}
	}

	fn host() -> ToolHost {
		let schema = json!({ "type": "object", "properties": { "question": { "type": "string" } }, "required": ["question"] });
		ToolHost::new(vec![Arc::new(Ask(schema))], None, HashSet::from(["quiz".to_owned()]))
	}

	async fn call(host: &ToolHost, args: Json) -> HostReply {
		let call = json!({ "type": "toolCall", "id": "c1", "name": "quiz", "arguments": args });
		let message = json!({ "role": "assistant", "content": [call.clone()] });
		host.call(&call, Reply { before: &[], message: &message }, &Abort::new()).await
	}

	#[tokio::test]
	async fn a_clean_question_ends_the_turn_and_one_that_failed_its_checks_does_not() {
		let host = host();
		let asked = call(&host, json!({ "question": "2 + 2?" })).await;
		assert!(asked.ends_turn && !asked.is_error);
		let failed = call(&host, json!({ "question": "" })).await;
		assert!(!failed.ends_turn && failed.is_error);
		let invalid = call(&host, json!({})).await;
		assert!(!invalid.ends_turn && invalid.is_error, "arguments that fail the schema never run");
	}

	#[tokio::test]
	async fn a_tool_not_allowed_this_turn_is_refused_with_its_reason() {
		let host = host().refuse(["quiz".to_owned()], "A question is already waiting.");
		let refused = call(&host, json!({ "question": "2 + 2?" })).await;
		assert_eq!(refused.result, json!({ "content": [{ "type": "text", "text": "A question is already waiting." }], "isError": true }));
		assert!(!refused.ends_turn);
		assert_eq!(host.specs().len(), 1, "the tool stays in the list");
	}
}
