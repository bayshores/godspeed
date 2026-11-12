//! Work a tool call starts in the background and gates on `next_model_call` delivers after the
//! steering poll that follows that tool call, so its message rides the turn after next.

use std::sync::{Arc, OnceLock, Weak};

use futures_util::future::BoxFuture;
use gs_engine::turn::abort::Abort;
use gs_engine::turn::agent::{Agent, AgentOptions};
use gs_engine::turn::faux::{Engine, Scripted, faux_model};
use gs_engine::turn::messages::{faux_assistant_message, text_block};
use gs_engine::turn::tool::{Tool, ToolContext};
use gs_json::{Json, json};
use parking_lot::Mutex;

struct Dispatch {
	parameters: Json,
	agent: Arc<OnceLock<Weak<Agent>>>,
}

impl Tool for Dispatch {
	fn name(&self) -> &str {
		"dispatch"
	}
	fn description(&self) -> &str {
		"Starts background work."
	}
	fn parameters(&self) -> &Json {
		&self.parameters
	}
	fn execute(&self, _args: Json, _ctx: ToolContext) -> BoxFuture<'_, Result<Json, String>> {
		let agent = self.agent.get().and_then(Weak::upgrade).unwrap();
		let gate = agent.next_model_call();
		tokio::spawn(async move {
			gate.await;
			agent.steer(json!({ "role": "user", "content": "background result", "timestamp": 1 }));
		});
		Box::pin(async { Ok(json!({ "content": [text_block("dispatched")], "details": null })) })
	}
}

fn says(messages: &[Json], text: &str) -> bool {
	messages.iter().any(|m| m["content"] == Json::from(text))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn background_work_misses_the_poll_after_its_tool_call() {
	let seen: Arc<Mutex<Vec<bool>>> = Arc::default();
	let scripted = Scripted::new();
	scripted.reply(faux_assistant_message(vec![json!({ "type": "toolCall", "id": "call_1", "name": "dispatch", "arguments": {} })], "toolUse"));
	for _ in 0..2 {
		let seen = seen.clone();
		scripted.run(move |request| {
			seen.lock().push(says(&request.messages, "background result"));
			Box::pin(async {
				// Long enough for the background work to have steered, were it not gated.
				gs_base::clock::sleep(50).await;
				Ok(faux_assistant_message(vec![text_block("ok")], "stop"))
			})
		});
	}
	let slot = Arc::new(OnceLock::new());
	let model = faux_model("godspeed-agent", "agent", "outside-agent", "Outside agent (MCP)", 200_000.0, 32_000.0);
	let mut options = AgentOptions::new(Engine { model, respond: scripted });
	options.tools = vec![Arc::new(Dispatch { parameters: json!({ "type": "object", "properties": {} }), agent: slot.clone() })];
	let agent = Agent::new(options);
	slot.set(Arc::downgrade(&agent)).unwrap();
	agent.prompt(vec![json!({ "role": "user", "content": "go", "timestamp": 1 })], Abort::new()).await.unwrap();
	assert_eq!(*seen.lock(), [false, true], "the result reaches the model one turn after the call that started it");
}
