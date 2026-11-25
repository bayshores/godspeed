//! A stand-in agent that plays scripted turns. It speaks the Claude helper's JSON-lines protocol
//! or `codex app-server`'s JSON-RPC, so godspeed's own code runs as it does with either agent. For
//! other crates' tests and `npm run layout`.

mod codex;

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

use gs_base::tasks;
use gs_core::spaces::agent_folder::FolderAgent;
use gs_json::{Json, json, stringify};
use parking_lot::Mutex;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, WriteHalf};

use crate::claude::protocol::TOOL_SERVER;
use crate::event::Usage;
use crate::pipes::Started;
use crate::session::Runtime;

/// One step of a scripted turn.
#[derive(Clone, Debug, PartialEq)]
pub enum FakeStep {
	/// Reply text, streamed a word at a time, then whole.
	Text(String),
	/// A godspeed tool call. The turn waits for godspeed's answer, and ends there if the answer
	/// ends the turn (as interrupted, over Codex, where godspeed does the interrupting).
	Tool { name: String, args: Json },
	/// Several godspeed calls in one message, as Claude Code sends a step's calls: the message
	/// first, then each call in turn, each waiting for godspeed's answer like `Tool`. Codex has no
	/// such message, so there they are only a run of `Tool` steps.
	Calls(Vec<(String, Json)>),
	/// A permission question. The turn waits for the answer. Over Codex it asks to run the
	/// command in `input`, or one named `tool`.
	Approval { tool: String, input: Json },
	/// One of the agent's own tools, started and done. Over Codex it is a command execution.
	OwnTool { name: String, input: Json },
	/// One model call's tokens.
	Usage(Usage),
	/// The agent says nothing more until it is stopped.
	Silence,
	/// The turn fails with this text.
	Fail(String),
}

/// The script, and everything godspeed sent the agent.
#[derive(Clone, Default)]
pub struct FakeAgent {
	script: Arc<Mutex<Script>>,
}

#[derive(Default)]
struct Script {
	/// One list of steps per turn, played in order whichever session sends, for the sessions no
	/// keyed script is for.
	turns: VecDeque<Vec<FakeStep>>,
	/// Turns for the sessions whose instructions hold the key, so a lesson and its jobs each play
	/// their own.
	keyed: Vec<(String, VecDeque<Vec<FakeStep>>)>,
	sent: Vec<Json>,
}

impl Script {
	/// The key of the script a session opened with these instructions plays; None is the shared one.
	fn key_for(&self, instructions: &str) -> Option<String> {
		self.keyed.iter().find(|(key, _)| instructions.contains(key.as_str())).map(|(key, _)| key.clone())
	}

	fn next_turn(&mut self, key: Option<&str>) -> Vec<FakeStep> {
		let turns = match key {
			Some(key) => self.keyed.iter_mut().find(|(k, _)| k == key).map(|(_, turns)| turns),
			None => Some(&mut self.turns),
		};
		turns.and_then(VecDeque::pop_front).unwrap_or_default()
	}
}

impl FakeAgent {
	pub fn new(turns: Vec<Vec<FakeStep>>) -> FakeAgent {
		FakeAgent { script: Arc::new(Mutex::new(Script { turns: turns.into(), ..Script::default() })) }
	}

	/// Adds a turn after the ones already scripted.
	pub fn push(&self, turn: Vec<FakeStep>) {
		self.script.lock().turns.push_back(turn);
	}

	/// Adds a turn for the sessions whose instructions hold `key`. They play only these turns, in
	/// order; a session opened before the first is pushed plays the shared ones.
	pub fn push_for(&self, key: &str, turn: Vec<FakeStep>) {
		let mut script = self.script.lock();
		match script.keyed.iter_mut().find(|(k, _)| k == key) {
			Some((_, turns)) => turns.push_back(turn),
			None => script.keyed.push((key.to_owned(), VecDeque::from([turn]))),
		}
	}

	/// The key of the script a session opened with `instructions` plays.
	fn key_for(&self, instructions: &str) -> Option<String> {
		self.script.lock().key_for(instructions)
	}

	/// The next turn of the script `key` names.
	fn next_turn(&self, key: Option<&str>) -> Vec<FakeStep> {
		self.script.lock().next_turn(key)
	}

	/// Every message godspeed sent the agent, in order, as the agent reads them: helper lines or
	/// JSON-RPC messages.
	pub fn sent(&self) -> Vec<Json> {
		self.script.lock().sent.clone()
	}

	/// A runtime on this agent, as Claude Code. It starts a new stand-in after the last one
	/// stopped, as a real runtime starts the agent again.
	pub fn runtime(&self) -> Runtime {
		self.runtime_on(FolderAgent::Claude)
	}

	/// A runtime on this agent, as Codex.
	pub fn codex_runtime(&self) -> Runtime {
		self.runtime_on(FolderAgent::Codex)
	}

	fn runtime_on(&self, folder_agent: FolderAgent) -> Runtime {
		let agent = self.clone();
		Runtime::from_pipes(folder_agent, move || {
			let (ours, theirs) = tokio::io::duplex(1 << 16);
			let (reader, writer) = tokio::io::split(ours);
			match folder_agent {
				FolderAgent::Claude => tasks::detach("fake agent", agent.clone().play(theirs)),
				FolderAgent::Codex => tasks::detach("fake agent", codex::play(agent.clone(), theirs)),
			}
			Started { reader: Box::new(reader), writer: Box::new(writer), process: None }
		})
	}

	async fn play(self, pipe: tokio::io::DuplexStream) {
		let (reader, writer) = tokio::io::split(pipe);
		let mut player = Player { agent: self, out: writer, turns: HashMap::new(), keys: HashMap::new(), next_id: 1 };
		let mut lines = BufReader::new(reader).lines();
		while let Ok(Some(line)) = lines.next_line().await {
			let Ok(message) = gs_json::parse(&line) else { continue };
			player.agent.script.lock().sent.push(message.clone());
			if player.take(&message).await.is_err() {
				return;
			}
		}
	}
}

/// A session's turn under way: the steps left, the calls of a `Calls` step not yet made (id,
/// name, arguments), and the call or question it waits on.
struct Playing {
	steps: VecDeque<FakeStep>,
	calls: VecDeque<(String, String, Json)>,
	waiting: Option<String>,
}

struct Player {
	agent: FakeAgent,
	out: WriteHalf<tokio::io::DuplexStream>,
	turns: HashMap<String, Playing>,
	/// Each session's script key, from its instructions.
	keys: HashMap<String, Option<String>>,
	next_id: u64,
}

impl Player {
	async fn write(&mut self, message: Json) -> std::io::Result<()> {
		self.out.write_all(format!("{}\n", stringify(&message)).as_bytes()).await
	}

	async fn sdk(&mut self, session: &str, message: Json) -> std::io::Result<()> {
		let mut message = message;
		message.set("parent_tool_use_id", Json::Null);
		self.write(json!({ "type": "sdk", "session": session, "message": message })).await
	}

	async fn take(&mut self, message: &Json) -> std::io::Result<()> {
		let session = message["session"].str_or_empty().to_owned();
		match message["type"].as_str() {
			Some("open") => {
				self.keys.insert(session.clone(), self.agent.key_for(message["systemPrompt"].str_or_empty()));
				let native = message["resume"].as_str().map_or_else(|| format!("fake-{session}"), str::to_owned);
				self.write(json!({ "type": "opened", "session": session, "nativeId": native })).await
			}
			Some("send") => {
				let steps = self.agent.next_turn(self.keys.get(&session).cloned().flatten().as_deref());
				self.turns.insert(session.clone(), Playing { steps: steps.into(), calls: VecDeque::new(), waiting: None });
				self.sdk(&session, json!({ "type": "system", "subtype": "init" })).await?;
				self.advance(&session).await
			}
			Some("tool_result") | Some("approval") => {
				let id = message["id"].str_or_empty();
				let Some(session) = self.turns.iter().find(|(_, playing)| playing.waiting.as_deref() == Some(id)).map(|(session, _)| session.clone()) else { return Ok(()) };
				if message["endTurn"].truthy() {
					return self.finish(&session, None).await;
				}
				if let Some(playing) = self.turns.get_mut(&session) {
					playing.waiting = None;
				}
				self.advance(&session).await
			}
			Some("interrupt") if self.turns.contains_key(&session) => self.finish(&session, Some("error_during_execution")).await,
			Some("close") => {
				self.turns.remove(&session);
				self.keys.remove(&session);
				self.write(json!({ "type": "closed", "session": session })).await
			}
			_ => Ok(()),
		}
	}

	/// Plays steps until one waits for godspeed, or the turn is over.
	async fn advance(&mut self, session: &str) -> std::io::Result<()> {
		loop {
			if let Some((id, name, args)) = self.turns.get_mut(session).and_then(|playing| playing.calls.pop_front()) {
				self.write(json!({ "type": "tool_call", "id": id, "session": session, "toolUseId": format!("toolu_{id}"), "name": name, "args": args })).await?;
				return self.wait(session, id);
			}
			let Some(step) = self.turns.get_mut(session).and_then(|playing| playing.steps.pop_front()) else { return self.finish(session, None).await };
			let id = self.next_id.to_string();
			self.next_id += 1;
			match step {
				FakeStep::Text(text) => {
					for word in text.split_inclusive(' ') {
						self.sdk(session, json!({ "type": "stream_event", "event": { "type": "content_block_delta", "delta": { "type": "text_delta", "text": word } } })).await?;
					}
					self.sdk(session, json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": text }] } })).await?;
				}
				FakeStep::OwnTool { name, input } => {
					let use_id = format!("toolu_{id}");
					self.sdk(session, json!({ "type": "assistant", "message": { "content": [{ "type": "tool_use", "id": use_id, "name": name, "input": input }] } })).await?;
					self.sdk(session, json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "tool_use_id": use_id }] } })).await?;
				}
				FakeStep::Tool { name, args } => {
					self.write(json!({ "type": "tool_call", "id": id, "session": session, "toolUseId": format!("toolu_{id}"), "name": name, "args": args })).await?;
					return self.wait(session, id);
				}
				FakeStep::Calls(calls) => {
					let calls: Vec<(String, String, Json)> = calls.into_iter().enumerate().map(|(i, (name, args))| (format!("{id}.{i}"), name, args)).collect();
					let blocks: Vec<Json> = calls.iter().map(|(id, name, args)| json!({ "type": "tool_use", "id": format!("toolu_{id}"), "name": format!("mcp__{TOOL_SERVER}__{name}"), "input": args })).collect();
					self.sdk(session, json!({ "type": "assistant", "message": { "content": blocks } })).await?;
					if let Some(playing) = self.turns.get_mut(session) {
						playing.calls = calls.into();
					}
				}
				FakeStep::Approval { tool, input } => {
					self.write(json!({ "type": "approval", "id": id, "session": session, "tool": tool, "input": input, "toolUseId": format!("toolu_{id}") })).await?;
					return self.wait(session, id);
				}
				FakeStep::Usage(usage) => {
					let start = json!({ "type": "message_start", "message": { "usage": { "input_tokens": usage.input.saturating_sub(usage.cached), "cache_read_input_tokens": usage.cached } } });
					self.sdk(session, json!({ "type": "stream_event", "event": start })).await?;
					self.sdk(session, json!({ "type": "stream_event", "event": { "type": "message_delta", "usage": { "output_tokens": usage.output } } })).await?;
				}
				FakeStep::Silence => return Ok(()),
				FakeStep::Fail(why) => {
					self.turns.remove(session);
					return self.sdk(session, json!({ "type": "result", "subtype": "success", "is_error": true, "result": why })).await;
				}
			}
		}
	}

	fn wait(&mut self, session: &str, id: String) -> std::io::Result<()> {
		if let Some(playing) = self.turns.get_mut(session) {
			playing.waiting = Some(id);
		}
		Ok(())
	}

	/// Ends the session's turn: done, or with the error subtype given.
	async fn finish(&mut self, session: &str, error: Option<&str>) -> std::io::Result<()> {
		self.turns.remove(session);
		let result = match error {
			Some(subtype) => json!({ "type": "result", "subtype": subtype, "is_error": true, "errors": [] }),
			None => json!({ "type": "result", "subtype": "success", "is_error": false }),
		};
		self.sdk(session, result).await
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::event::{Ask, End, Part, SessionEvent, ToolReply, Verdict};
	use crate::session::{Session, SessionSpec};
	use crate::test_peer::{events_until_end, spec};

	#[tokio::test]
	async fn a_scripted_turn_plays_its_text_tools_and_question() {
		let agent = FakeAgent::new(vec![vec![
			FakeStep::OwnTool { name: "Read".into(), input: json!({ "file_path": "notes.md" }) },
			FakeStep::Approval { tool: "Bash".into(), input: json!({ "command": "ls" }) },
			FakeStep::Text("Here is a question.".into()),
			FakeStep::Tool { name: "ask_question".into(), args: json!({ "question": "2 + 2?" }) },
			FakeStep::Text("never played".into()),
		]]);
		let runtime = agent.runtime();
		let session = runtime.open(spec(None)).await.unwrap();
		assert_eq!(session.native_id(), "fake-s1");
		session.send(&[Part::Text("Teach me".into())]).await.unwrap();
		let mut text = String::new();
		let mut own = Vec::new();
		let end = loop {
			match session.next().await.unwrap() {
				SessionEvent::TextDelta(delta) => text.push_str(&delta),
				SessionEvent::OwnTool { name, done, .. } => own.push((name, done)),
				SessionEvent::Approval { ask, reply } => {
					assert_eq!(ask, Ask::Tool { name: "Bash".into(), input: json!({ "command": "ls" }) });
					reply.send(Verdict { allow: true, message: None }).unwrap();
				}
				SessionEvent::ToolCall { call, reply } => {
					assert_eq!((call.name.as_str(), &call.args), ("ask_question", &json!({ "question": "2 + 2?" })));
					reply.send(ToolReply { content: vec![Part::Text("Shown.".into())], is_error: false, ends_turn: true }).unwrap();
				}
				SessionEvent::Ended(end) => break end,
				_ => {}
			}
		};
		assert_eq!(end, End::Completed);
		assert_eq!(text, "Here is a question.");
		assert_eq!(own, [("Read".to_owned(), false), ("Read".to_owned(), true)]);
		let sent: Vec<String> = agent.sent().iter().map(|m| m["type"].str_or_empty().to_owned()).collect();
		assert_eq!(sent, ["open", "send", "approval", "tool_result"]);
	}

	#[tokio::test]
	async fn stop_and_a_failing_turn_end_as_they_should() {
		let agent = FakeAgent::new(vec![vec![FakeStep::Tool { name: "read_space".into(), args: json!({}) }], vec![FakeStep::Fail("overloaded".into())]]);
		let runtime = agent.runtime();
		let session = runtime.open(spec(Some("old-session"))).await.unwrap();
		assert_eq!(session.native_id(), "old-session", "a resumed session keeps its id");
		session.send(&[Part::Text("go".into())]).await.unwrap();
		// Held unanswered: a dropped reply would answer the call first.
		let _unanswered = loop {
			if let SessionEvent::ToolCall { reply, .. } = session.next().await.unwrap() {
				session.interrupt().await.unwrap();
				break reply;
			}
		};
		assert_eq!(events_until_end(&session).await.1, End::Interrupted);
		session.send(&[Part::Text("again".into())]).await.unwrap();
		assert_eq!(events_until_end(&session).await.1, End::Failed("overloaded".into()));
	}

	#[tokio::test]
	async fn a_scripted_turn_plays_over_codex_as_app_server_messages() {
		let agent = FakeAgent::new(vec![vec![
			FakeStep::OwnTool { name: "Read".into(), input: json!({ "file_path": "notes.md" }) },
			FakeStep::Approval { tool: "Bash".into(), input: json!({ "command": "ls" }) },
			FakeStep::Text("Here is a question.".into()),
			FakeStep::Tool { name: "ask_question".into(), args: json!({ "question": "2 + 2?" }) },
			FakeStep::Text("never played".into()),
		]]);
		let runtime = agent.codex_runtime();
		assert_eq!(runtime.agent(), FolderAgent::Codex);
		let session = runtime.open(spec(None)).await.unwrap();
		assert_eq!(session.native_id(), "fake-thread-1");
		session.send(&[Part::Text("Teach me".into())]).await.unwrap();
		let mut text = String::new();
		let mut own = Vec::new();
		let end = loop {
			match session.next().await.unwrap() {
				SessionEvent::TextDelta(delta) => text.push_str(&delta),
				SessionEvent::OwnTool { name, done, .. } => own.push((name, done)),
				SessionEvent::Approval { ask, reply } => {
					assert_eq!(ask, Ask::Command { command: "ls".into(), cwd: "/work".into(), reason: None });
					reply.send(Verdict { allow: true, message: None }).unwrap();
				}
				SessionEvent::ToolCall { call, reply } => {
					assert_eq!((call.name.as_str(), &call.args), ("ask_question", &json!({ "question": "2 + 2?" })));
					reply.send(ToolReply { content: vec![Part::Text("Shown.".into())], is_error: false, ends_turn: true }).unwrap();
				}
				SessionEvent::Ended(end) => break end,
				_ => {}
			}
		};
		assert_eq!(end, End::Completed);
		assert_eq!(text, "Here is a question.");
		let command = |done| ("commandExecution".to_owned(), done);
		assert_eq!(own, [command(false), command(true), command(false), command(true)]);
		let sent: Vec<String> = agent.sent().iter().map(|m| m["method"].as_str().unwrap_or("answer").to_owned()).collect();
		assert_eq!(sent, ["initialize", "initialized", "thread/start", "turn/start", "answer", "answer", "turn/interrupt"]);
	}

	/// The text a turn on `session` writes, and its usage events.
	async fn played(session: &Session) -> (String, Vec<Usage>) {
		let (events, end) = events_until_end(session).await;
		assert_eq!(end, End::Completed);
		let text = events.iter().filter_map(|e| if let SessionEvent::TextDone(text) = e { Some(text.as_str()) } else { None }).collect();
		let usage = events.iter().filter_map(|e| if let SessionEvent::Usage(usage) = e { Some(*usage) } else { None }).collect();
		(text, usage)
	}

	#[tokio::test]
	async fn each_session_plays_the_script_its_instructions_name() {
		for codex in [false, true] {
			let agent = FakeAgent::new(vec![vec![FakeStep::Text("lesson".into())]]);
			let used = Usage { input: 120, cached: 100, output: 7 };
			agent.push_for("PDF reading specialist", vec![FakeStep::Usage(used), FakeStep::Text("job".into())]);
			let runtime = if codex { agent.codex_runtime() } else { agent.runtime() };
			let job_spec = SessionSpec { instructions: "You are a PDF reading specialist.".into(), ..spec(None) };
			let job = runtime.open(job_spec).await.unwrap();
			let lesson = runtime.open(spec(None)).await.unwrap();
			job.send(&[Part::Text("read".into())]).await.unwrap();
			lesson.send(&[Part::Text("teach".into())]).await.unwrap();
			assert_eq!(played(&lesson).await, ("lesson".to_owned(), Vec::new()), "codex: {codex}");
			assert_eq!(played(&job).await, ("job".to_owned(), vec![used]), "codex: {codex}");
			job.send(&[Part::Text("again".into())]).await.unwrap();
			assert_eq!(played(&job).await, (String::new(), Vec::new()), "a keyed script never plays the shared turns");
		}
	}

	#[tokio::test]
	async fn a_steer_during_a_waiting_approval_reaches_codex_and_a_failing_turn_ends_failed() {
		let agent = FakeAgent::new(vec![vec![FakeStep::Approval { tool: "Bash".into(), input: json!({ "command": "ls" }) }, FakeStep::Text("done".into())], vec![FakeStep::Fail("overloaded".into())]]);
		let runtime = agent.codex_runtime();
		let session = runtime.open(spec(Some("old-thread"))).await.unwrap();
		assert_eq!(session.native_id(), "old-thread", "a resumed thread keeps its id");
		session.send(&[Part::Text("go".into())]).await.unwrap();
		let reply = loop {
			if let SessionEvent::Approval { reply, .. } = session.next().await.unwrap() {
				break reply;
			}
		};
		session.steer(&[Part::Text("also this".into())]).await.unwrap();
		let steers: Vec<Json> = agent.sent().into_iter().filter(|m| m["method"].as_str() == Some("turn/steer")).collect();
		assert_eq!(steers.len(), 1);
		assert_eq!(steers[0]["params"]["input"][0]["text"].as_str(), Some("also this"));
		reply.send(Verdict { allow: true, message: None }).unwrap();
		assert_eq!(events_until_end(&session).await.1, End::Completed);
		session.send(&[Part::Text("again".into())]).await.unwrap();
		assert_eq!(events_until_end(&session).await.1, End::Failed("overloaded".into()));
	}
}
