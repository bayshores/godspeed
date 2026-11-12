//! The agent loop (pi-agent-core agent-loop.ts `runAgentLoop` / `runLoop`): ask the model, run
//! its tool calls, take steering at each turn boundary and follow-ups when it would stop.

use gs_json::Json;

use super::abort::Abort;
use super::agent::{Agent, FinishedTurn};
use super::events::AgentEvent;
use super::faux::{self, Partial};
use super::messages::{role, tool_calls};
use super::tool_batch::{Batch, execute_tool_calls, fail_truncated_calls};
use super::transcript::{declare_tool_changes, tool_declaration};

impl Agent {
	/// One run, from `agent_start` to `agent_end`. `prompts` are the new messages it starts with
	/// (none: it continues the transcript).
	pub(super) async fn run_loop(&self, prompts: Option<Vec<Json>>, skip_initial_steering: bool, abort: &Abort) {
		let declarations: Vec<Json> = self.tools.iter().map(|t| tool_declaration(t.as_ref())).collect();
		let mut context = self.messages();
		let mut new_messages: Vec<Json> = Vec::new();
		let initial = prompts.map(|p| declare_tool_changes(&context, &declarations, p));
		self.emit(AgentEvent::AgentStart);
		self.emit(AgentEvent::TurnStart);
		for message in initial.into_iter().flatten() {
			self.announce(&message);
			context.push(message.clone());
			new_messages.push(message);
		}

		let mut skip_steering = skip_initial_steering;
		let mut steering = || if std::mem::take(&mut skip_steering) { Vec::new() } else { self.steering_messages() };
		let mut pending = steering();
		let mut completed_a_turn = false;
		loop {
			let mut more_tool_calls = true;
			while more_tool_calls || !pending.is_empty() {
				if completed_a_turn {
					if pending.is_empty() {
						pending = steering();
					}
					self.emit(AgentEvent::TurnStart);
				}
				for message in declare_tool_changes(&context, &declarations, std::mem::take(&mut pending)) {
					self.announce(&message);
					context.push(message.clone());
					new_messages.push(message);
				}
				let message = self.stream_response(&mut context, abort).await;
				new_messages.push(message.clone());
				let stop = message["stopReason"].as_str().unwrap_or_default();
				if stop == "error" || stop == "aborted" {
					self.finish(&message, &[]);
					self.emit(AgentEvent::TurnEnd { message, tool_results: Vec::new() });
					self.emit(AgentEvent::AgentEnd { messages: new_messages });
					return;
				}
				let calls = tool_calls(&message);
				let mut results = Vec::new();
				more_tool_calls = false;
				if !calls.is_empty() {
					let batch: Batch = if stop == "length" { fail_truncated_calls(self, &calls) } else { execute_tool_calls(self, &calls, abort).await };
					more_tool_calls = !batch.terminate;
					results = batch.messages;
					context.extend(results.iter().cloned());
					new_messages.extend(results.iter().cloned());
				}
				completed_a_turn = true;
				let end = self.finish(&message, &results);
				self.emit(AgentEvent::TurnEnd { message, tool_results: results });
				if end {
					self.emit(AgentEvent::AgentEnd { messages: new_messages });
					return;
				}
				pending = steering();
			}
			let follow_ups = self.follow_up_messages();
			if follow_ups.is_empty() {
				break;
			}
			pending = follow_ups;
		}
		self.emit(AgentEvent::AgentEnd { messages: new_messages });
	}

	/// A message that arrives whole: its start and end at once.
	pub(super) fn announce(&self, message: &Json) {
		self.emit(AgentEvent::MessageStart(message.clone()));
		self.emit(AgentEvent::MessageEnd(message.clone()));
	}

	fn finish(&self, message: &Json, tool_results: &[Json]) -> bool {
		self.finish_turn.lock().as_mut().is_some_and(|f| f(&FinishedTurn { message, tool_results }))
	}

	/// `streamAssistantResponse`: the transcript as the model sees it, one model call, and the
	/// streamed message's events.
	async fn stream_response(&self, context: &mut Vec<Json>, abort: &Abort) -> Json {
		self.passed_model_call();
		let request = match &self.convert_to_llm {
			Some(convert) => convert(context),
			None => context.iter().filter(|m| matches!(role(m), "system" | "user" | "assistant" | "toolResult")).cloned().collect(),
		};
		let mut started = false;
		let mut message = faux::stream(&self.engine, request, self.session_id.clone(), abort, &mut |partial| match partial {
			Partial::Start(m) => {
				started = true;
				self.emit(AgentEvent::MessageStart(m));
			}
			Partial::Update(m) => self.emit(AgentEvent::MessageUpdate(m)),
		})
		.await;
		// The level the request asked for; the app never sets one.
		message.as_obj_mut().expect("an object").insert("thinkingLevel", "off");
		context.push(message.clone());
		if !started {
			self.emit(AgentEvent::MessageStart(message.clone()));
		}
		self.emit(AgentEvent::MessageEnd(message.clone()));
		message
	}
}
