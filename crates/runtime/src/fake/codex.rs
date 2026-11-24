//! The scripted turns played over `codex app-server`'s JSON-RPC. The message shapes are copied
//! from the recorded turns in `fixtures/` and from the adapter's tests.

use std::collections::{HashMap, VecDeque};

use gs_base::clock;
use gs_json::{Json, json, stringify};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, WriteHalf};

use super::{FakeAgent, FakeStep};
use crate::codex::wire;
use crate::jsonrpc::UNKNOWN_METHOD;

/// How long a turn waits after a godspeed tool call completes. godspeed interrupts at once when
/// the reply ends the turn; a real Codex is still thinking by then, so the turn goes on only
/// when no interrupt came.
const SETTLE_MS: i64 = 100;

/// What a turn waits on: godspeed's answer to a request the agent sent.
enum Waiting {
	Call { request: Json, call: String, tool: String, args: Json },
	Approval { request: Json, item: String, command: String },
}

struct Turn {
	id: String,
	steps: VecDeque<FakeStep>,
	waiting: Option<Waiting>,
	/// A godspeed call has completed and an interrupt may follow.
	settling: bool,
}

#[derive(Default)]
struct Thread {
	cwd: String,
	turn: Option<Turn>,
}

struct Player {
	agent: FakeAgent,
	out: WriteHalf<DuplexStream>,
	threads: HashMap<String, Thread>,
	next_id: u64,
}

pub(super) async fn play(agent: FakeAgent, pipe: DuplexStream) {
	let (reader, writer) = tokio::io::split(pipe);
	let mut player = Player { agent, out: writer, threads: HashMap::new(), next_id: 1 };
	let mut lines = BufReader::new(reader).lines();
	loop {
		let line = if player.settling() {
			let Some(line) = clock::within(SETTLE_MS, lines.next_line()).await else {
				if player.settled().await.is_err() {
					return;
				}
				continue;
			};
			line
		} else {
			lines.next_line().await
		};
		let Ok(Some(line)) = line else { return };
		let Ok(message) = gs_json::parse(&line) else { continue };
		player.agent.script.lock().sent.push(message.clone());
		if player.take(&message).await.is_err() {
			return;
		}
	}
}

/// A turn as `turn/started` and `turn/completed` carry it.
fn turn_json(id: &str, status: &str, error: Option<&str>) -> Json {
	let error = error.map(|message| json!({ "message": message }));
	json!({ "id": id, "rootTurnId": null, "items": [], "itemsView": "notLoaded", "status": status, "error": error, "startedAtMs": null, "completedAt": null, "durationMs": null })
}

/// What a scripted command's text is: the command it names, else the tool's name.
fn command_of(tool: &str, input: &Json) -> String {
	input["command"].as_str().unwrap_or(tool).to_owned()
}

fn command_item(id: &str, command: &str, cwd: &str, status: &str) -> Json {
	let done = status != "inProgress";
	json!({
		"type": "commandExecution", "id": id, "pluginId": null, "scriptPath": null, "command": command, "cwd": cwd, "processId": null, "source": "agent", "status": status,
		"commandActions": [], "aggregatedOutput": if done { json!("") } else { Json::Null }, "exitCode": if done { json!(0) } else { Json::Null }, "durationMs": null,
	})
}

fn message_item(id: &str, text: &str) -> Json {
	json!({ "type": "agentMessage", "id": id, "text": text, "phase": null, "moderation": null, "memoryCitation": null, "delivery": null, "questions": null })
}

impl Player {
	async fn write(&mut self, message: Json) -> std::io::Result<()> {
		self.out.write_all(format!("{}\n", stringify(&message)).as_bytes()).await
	}

	async fn respond(&mut self, id: &Json, result: Json) -> std::io::Result<()> {
		self.write(json!({ "id": id, "result": result })).await
	}

	async fn note(&mut self, method: &str, params: Json) -> std::io::Result<()> {
		self.write(json!({ "method": method, "params": params })).await
	}

	async fn item(&mut self, thread: &str, turn: &str, item: Json, done: bool) -> std::io::Result<()> {
		let (method, at) = if done { ("item/completed", "completedAtMs") } else { ("item/started", "startedAtMs") };
		let mut params = json!({ "threadId": thread, "turnId": turn, "item": item });
		params.set(at, 0);
		self.note(method, params).await
	}

	fn fresh_id(&mut self) -> u64 {
		self.next_id += 1;
		self.next_id - 1
	}

	fn settling(&self) -> bool {
		self.threads.values().any(|thread| thread.turn.as_ref().is_some_and(|turn| turn.settling))
	}

	/// No interrupt came after a godspeed call: the turn goes on.
	async fn settled(&mut self) -> std::io::Result<()> {
		let settled: Vec<String> = self.threads.iter().filter(|(_, thread)| thread.turn.as_ref().is_some_and(|turn| turn.settling)).map(|(id, _)| id.clone()).collect();
		for thread in settled {
			if let Some(turn) = self.threads.get_mut(&thread).and_then(|thread| thread.turn.as_mut()) {
				turn.settling = false;
			}
			self.advance(&thread).await?;
		}
		Ok(())
	}

	async fn take(&mut self, message: &Json) -> std::io::Result<()> {
		let params = &message["params"];
		let thread = params["threadId"].str_or_empty().to_owned();
		let Some(method) = message["method"].as_str() else { return self.answered(&message["id"], &message["result"]).await };
		let id = &message["id"];
		match method {
			wire::INITIALIZE => self.respond(id, json!({ "userAgent": "godspeed/fake", "codexHome": "/fake", "platformFamily": "unix", "platformOs": "macos" })).await,
			wire::THREAD_START | wire::THREAD_RESUME => {
				let thread = if method == wire::THREAD_START { format!("fake-thread-{}", self.fresh_id()) } else { thread };
				self.threads.entry(thread.clone()).or_default().cwd = params["cwd"].str_or_empty().to_owned();
				self.respond(id, json!({ "thread": { "id": thread }, "model": params["model"] })).await
			}
			wire::TURN_START => {
				let steps = self.agent.script.lock().turns.pop_front().unwrap_or_default();
				let turn = format!("turn_{}", self.fresh_id());
				self.threads.entry(thread.clone()).or_default().turn = Some(Turn { id: turn.clone(), steps: steps.into(), waiting: None, settling: false });
				self.respond(id, json!({ "turn": turn_json(&turn, "inProgress", None) })).await?;
				self.note("turn/started", json!({ "threadId": thread, "turn": turn_json(&turn, "inProgress", None) })).await?;
				self.advance(&thread).await
			}
			wire::TURN_STEER => self.respond(id, json!({ "turnId": params["expectedTurnId"] })).await,
			wire::TURN_INTERRUPT => {
				self.respond(id, json!({})).await?;
				self.finish(&thread, "interrupted", None).await
			}
			wire::THREAD_UNSUBSCRIBE => {
				self.threads.remove(&thread);
				self.respond(id, json!({})).await
			}
			_ if message.get("id").is_some() => self.write(json!({ "id": id, "error": { "code": UNKNOWN_METHOD, "message": "the stand-in agent does not handle this request" } })).await,
			_ => Ok(()),
		}
	}

	/// godspeed answered a request the agent sent.
	async fn answered(&mut self, request: &Json, result: &Json) -> std::io::Result<()> {
		let waiting = self.threads.iter().find(|(_, thread)| thread.turn.as_ref().is_some_and(|turn| matches!(&turn.waiting, Some(Waiting::Call { request: id, .. } | Waiting::Approval { request: id, .. }) if id == request))).map(|(thread, _)| thread.clone());
		let Some(thread) = waiting else { return Ok(()) };
		let Some((turn, waiting)) = self.threads.get_mut(&thread).and_then(|thread| thread.turn.as_mut()).and_then(|turn| turn.waiting.take().map(|waiting| (turn.id.clone(), waiting))) else { return Ok(()) };
		match waiting {
			Waiting::Call { call, tool, args, .. } => {
				let item = json!({ "type": "dynamicToolCall", "id": call, "namespace": null, "tool": tool, "arguments": args, "status": "completed", "contentItems": null, "success": result["success"], "durationMs": 1 });
				self.item(&thread, &turn, item, true).await?;
				if let Some(turn) = self.threads.get_mut(&thread).and_then(|thread| thread.turn.as_mut()) {
					turn.settling = true;
				}
				Ok(())
			}
			Waiting::Approval { item, command, .. } => {
				let status = if result["decision"].as_str() == Some("accept") { "completed" } else { "declined" };
				let cwd = self.threads[&thread].cwd.clone();
				self.item(&thread, &turn, command_item(&item, &command, &cwd, status), true).await?;
				self.advance(&thread).await
			}
		}
	}

	/// Plays steps until one waits for godspeed, or the turn is over.
	async fn advance(&mut self, thread: &str) -> std::io::Result<()> {
		loop {
			let Some(cwd) = self.threads.get(thread).map(|thread| thread.cwd.clone()) else { return Ok(()) };
			let Some((turn, step)) = self.threads.get_mut(thread).and_then(|thread| thread.turn.as_mut()).map(|turn| (turn.id.clone(), turn.steps.pop_front())) else { return Ok(()) };
			let Some(step) = step else { return self.finish(thread, "completed", None).await };
			let n = self.fresh_id();
			match step {
				FakeStep::Text(text) => {
					let item = format!("item_{n}");
					self.item(thread, &turn, message_item(&item, ""), false).await?;
					for word in text.split_inclusive(' ') {
						self.note("item/agentMessage/delta", json!({ "threadId": thread, "turnId": turn, "itemId": item, "delta": word })).await?;
					}
					self.item(thread, &turn, message_item(&item, &text), true).await?;
				}
				FakeStep::OwnTool { name, input } => {
					let (item, command) = (format!("item_{n}"), command_of(&name, &input));
					self.item(thread, &turn, command_item(&item, &command, &cwd, "inProgress"), false).await?;
					self.item(thread, &turn, command_item(&item, &command, &cwd, "completed"), true).await?;
				}
				FakeStep::Tool { name, args } => {
					let (request, call) = (json!(n), format!("call_{n}"));
					self.write(json!({ "id": request, "method": "item/tool/call", "params": { "threadId": thread, "turnId": turn, "callId": call, "namespace": null, "tool": name, "arguments": args } })).await?;
					return self.wait(thread, Waiting::Call { request, call, tool: name, args });
				}
				// Codex has no message for a step's calls: they come one at a time.
				FakeStep::Calls(calls) => {
					if let Some(turn) = self.threads.get_mut(thread).and_then(|thread| thread.turn.as_mut()) {
						for (name, args) in calls.into_iter().rev() {
							turn.steps.push_front(FakeStep::Tool { name, args });
						}
					}
				}
				FakeStep::Approval { tool, input } => {
					let (request, item, command) = (json!(n), format!("item_{n}"), command_of(&tool, &input));
					self.item(thread, &turn, command_item(&item, &command, &cwd, "inProgress"), false).await?;
					self.write(json!({ "id": request, "method": "item/commandExecution/requestApproval", "params": { "kind": "command", "threadId": thread, "turnId": turn, "itemId": item, "startedAtMs": 0, "environmentId": null, "reason": null, "command": command, "cwd": cwd } })).await?;
					return self.wait(thread, Waiting::Approval { request, item, command });
				}
				FakeStep::Fail(why) => return self.finish(thread, "failed", Some(&why)).await,
			}
		}
	}

	fn wait(&mut self, thread: &str, waiting: Waiting) -> std::io::Result<()> {
		if let Some(turn) = self.threads.get_mut(thread).and_then(|thread| thread.turn.as_mut()) {
			turn.waiting = Some(waiting);
		}
		Ok(())
	}

	/// Ends the thread's turn, if one runs.
	async fn finish(&mut self, thread: &str, status: &str, error: Option<&str>) -> std::io::Result<()> {
		let Some(turn) = self.threads.get_mut(thread).and_then(|thread| thread.turn.take()) else { return Ok(()) };
		self.note("turn/completed", json!({ "threadId": thread, "turn": turn_json(&turn.id, status, error) })).await
	}
}
