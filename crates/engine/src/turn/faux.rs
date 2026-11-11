//! The model side of a turn (pi-ai providers/faux.ts). Every model call in the app goes through
//! pi's faux provider: a responder produces the whole assistant message, and the faux stream
//! stamps the model's ids and the usage estimate on it and streams it out block by block. The
//! outside agent's bridge is the one production responder; tests script one (`Scripted`).

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Instant;

use futures_util::future::BoxFuture;
use gs_base::{clock, num};
use gs_json::{Json, Obj, json};
use parking_lot::Mutex;

use super::abort::Abort;
use super::messages::zero_usage;
use super::usage;

/// One model request as the responder sees it.
pub struct Request {
	/// The request's transcript (the leading system message carries the prompt and tools).
	pub messages: Vec<Json>,
	/// The caller's conversation id (the chat id for lessons).
	pub session_id: Option<String>,
	/// The run's abort; a responder that sees it fire answers at once (any message will do).
	pub abort: Abort,
}

/// Produces assistant messages: pi's faux "response step".
pub trait Respond: Send + Sync {
	/// The reply to `request`, or `None` when nothing is queued (only a script runs out).
	/// `Err` is a thrown step: an error message with no usage.
	fn respond(&self, request: Request) -> Option<BoxFuture<'static, Result<Json, String>>>;
}

/// What an agent loop runs on: the model record and its responder (TS `PiEngine`).
#[derive(Clone)]
pub struct Engine {
	pub model: Json,
	pub respond: Arc<dyn Respond>,
}

/// The streamed message's snapshots before its final form.
pub enum Partial {
	/// The empty message, before the first block.
	Start(Json),
	/// The message after a block started or ended.
	Update(Json),
}

/// Runs one model call and streams it: `on_partial` gets each snapshot, the result is the final
/// message (stop reason "stop", "toolUse", "length", "error" or "aborted"), timed like pi's
/// `AssistantMessageEventStream`.
pub async fn stream(engine: &Engine, messages: Vec<Json>, session_id: Option<String>, abort: &Abort, on_partial: &mut (dyn FnMut(Partial) + Send)) -> Json {
	let started_ms = clock::now_ms() as f64;
	let started = Instant::now();
	let step = engine.respond.respond(Request { messages: messages.clone(), session_id, abort: abort.clone() });
	let mut message = match step {
		None => {
			let mut m = error_message(&engine.model, "No more faux responses queued");
			if let Ok(u) = usage::estimate(&messages, &m) {
				m.as_obj_mut().expect("an object").insert("usage", u);
			}
			m
		}
		Some(step) => match step.await.and_then(|reply| stamped(&engine.model, reply, &messages)) {
			Ok(m) => stream_blocks(&engine.model, m, abort, on_partial),
			Err(e) => error_message(&engine.model, &e),
		},
	};
	let obj = message.as_obj_mut().expect("an object");
	if !obj.contains_key("durationMs") && obj.get("timestamp").and_then(Json::as_f64).is_none_or(|t| t >= started_ms) {
		obj.insert("durationMs", num::math_round(started.elapsed().as_secs_f64() * 1000.0));
	}
	message
}

/// `cloneMessage` + `withUsageEstimate`: the reply with the model's ids, a timestamp and usage.
fn stamped(model: &Json, reply: Json, request: &[Json]) -> Result<Json, String> {
	let mut m = match reply {
		Json::Obj(m) => m,
		_ => Obj::new(),
	};
	m.insert("api", model["api"].clone());
	m.insert("provider", model["provider"].clone());
	m.insert("model", model["id"].clone());
	if m.get("timestamp").is_none_or(Json::is_null) {
		m.insert("timestamp", clock::now_ms());
	}
	if m.get("usage").is_none_or(Json::is_null) {
		m.insert("usage", zero_usage());
	}
	let mut message = Json::Obj(m);
	let estimate = usage::estimate(request, &message)?;
	message.as_obj_mut().expect("an object").insert("usage", estimate);
	Ok(message)
}

/// `createErrorMessage`.
fn error_message(model: &Json, error: &str) -> Json {
	json!({
		"role": "assistant",
		"content": [],
		"api": model["api"].clone(),
		"provider": model["provider"].clone(),
		"model": model["id"].clone(),
		"usage": zero_usage(),
		"stopReason": "error",
		"errorMessage": error,
		"timestamp": clock::now_ms(),
	})
}

/// `createAbortedMessage`: the blocks streamed so far, stopped.
fn aborted(partial: &Json) -> Json {
	let mut m = partial.as_obj().cloned().unwrap_or_default();
	m.insert("stopReason", "aborted");
	m.insert("errorMessage", "Request was aborted");
	m.insert("timestamp", clock::now_ms());
	Json::Obj(m)
}

/// `streamWithDeltas`, block by block. pi cuts each block into random 3-5 token chunks with an
/// update per chunk; they all go out before anything else runs, so a view only ever shows the
/// last one, and a snapshot per block start and end is the same stream as far as anyone sees.
fn stream_blocks(model: &Json, message: Json, abort: &Abort, on_partial: &mut (dyn FnMut(Partial) + Send)) -> Json {
	let mut partial = message.clone();
	let p = partial.as_obj_mut().expect("an object");
	p.insert("content", Json::Arr(Vec::new()));
	p.insert("stopReason", "pending");
	if abort.is_aborted() {
		return aborted(&partial);
	}
	on_partial(Partial::Start(partial.clone()));
	for block in message["content"].as_arr().into_iter().flatten() {
		if abort.is_aborted() {
			return aborted(&partial);
		}
		let (empty, full) = match block["type"].as_str() {
			Some("thinking") => (json!({ "type": "thinking", "thinking": "" }), json!({ "type": "thinking", "thinking": block["thinking"].clone() })),
			Some("text") => (json!({ "type": "text", "text": "" }), json!({ "type": "text", "text": block["text"].clone() })),
			_ => {
				let call = |arguments: Json| json!({ "type": "toolCall", "id": block["id"].clone(), "name": block["name"].clone(), "arguments": arguments });
				(call(json!({})), call(block["arguments"].clone()))
			}
		};
		let content = partial.get_mut("content").and_then(Json::as_arr_mut).expect("content is a list");
		content.push(empty);
		on_partial(Partial::Update(partial.clone()));
		*partial.get_mut("content").and_then(Json::as_arr_mut).and_then(|c| c.last_mut()).expect("the block just added") = full;
		on_partial(Partial::Update(partial.clone()));
	}
	match message["stopReason"].as_str() {
		Some("pending") => error_message(model, "Faux response ended without a stop reason"),
		_ => message,
	}
}

/// A scripted responder for tests (pi's `createFauxCore().setResponses`): each request takes
/// the next queued reply; an empty queue answers pi's "No more faux responses queued".
pub struct Scripted {
	queue: Mutex<VecDeque<Step>>,
}

type StepFn = Box<dyn FnOnce(Request) -> BoxFuture<'static, Result<Json, String>> + Send>;

enum Step {
	Reply(Json),
	Run(StepFn),
}

impl Scripted {
	pub fn new() -> Arc<Scripted> {
		Arc::new(Scripted { queue: Mutex::new(VecDeque::new()) })
	}

	/// Queues a fixed reply (`fauxAssistantMessage(...)`).
	pub fn reply(&self, message: Json) {
		self.queue.lock().push_back(Step::Reply(message));
	}

	/// Queues a reply computed when the request arrives.
	pub fn run(&self, step: impl FnOnce(Request) -> BoxFuture<'static, Result<Json, String>> + Send + 'static) {
		self.queue.lock().push_back(Step::Run(Box::new(step)));
	}
}

impl Respond for Scripted {
	fn respond(&self, request: Request) -> Option<BoxFuture<'static, Result<Json, String>>> {
		Some(match self.queue.lock().pop_front()? {
			Step::Reply(message) => Box::pin(async move { Ok(message) }),
			Step::Run(step) => step(request),
		})
	}
}

/// The model record the faux provider builds for one model definition.
pub fn faux_model(api: &str, provider: &str, id: &str, name: &str, context_window: f64, max_tokens: f64) -> Json {
	json!({
		"id": id,
		"name": name,
		"api": api,
		"provider": provider,
		"baseUrl": "http://localhost:0",
		"reasoning": false,
		"input": ["text", "image"],
		"cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
		"contextWindow": context_window,
		"maxTokens": max_tokens,
	})
}
