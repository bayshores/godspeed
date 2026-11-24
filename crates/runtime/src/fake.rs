//! A stand-in agent that plays scripted turns. It speaks the Claude helper's protocol, so
//! godspeed's own code runs as it does with Claude Code. For other crates' tests and
//! `npm run layout`.

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

use gs_base::tasks;
use gs_core::spaces::agent_folder::FolderAgent;
use gs_json::{Json, json, stringify};
use parking_lot::Mutex;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, WriteHalf};

use crate::pipes::Started;
use crate::session::Runtime;

/// One step of a scripted turn.
#[derive(Clone, Debug, PartialEq)]
pub enum FakeStep {
	/// Reply text, streamed a word at a time, then whole.
	Text(String),
	/// A godspeed tool call. The turn waits for godspeed's answer, and ends there if the answer
	/// ends the turn.
	Tool { name: String, args: Json },
	/// A permission question. The turn waits for the answer.
	Approval { tool: String, input: Json },
	/// One of the agent's own tools, started and done.
	OwnTool { name: String, input: Json },
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
	/// One list of steps per turn, played in order whichever session sends.
	turns: VecDeque<Vec<FakeStep>>,
	sent: Vec<Json>,
}

impl FakeAgent {
	pub fn new(turns: Vec<Vec<FakeStep>>) -> FakeAgent {
		FakeAgent { script: Arc::new(Mutex::new(Script { turns: turns.into(), sent: Vec::new() })) }
	}

	/// Every message godspeed sent the agent, in order, as the Claude helper reads them.
	pub fn sent(&self) -> Vec<Json> {
		self.script.lock().sent.clone()
	}

	/// A runtime on this agent. It starts a new stand-in after the last one stopped, as a real
	/// runtime starts the agent again.
	pub fn runtime(&self) -> Runtime {
		let agent = self.clone();
		Runtime::from_pipes(FolderAgent::Claude, move || {
			let (ours, theirs) = tokio::io::duplex(1 << 16);
			let (reader, writer) = tokio::io::split(ours);
			tasks::detach("fake agent", agent.clone().play(theirs));
			Started { reader: Box::new(reader), writer: Box::new(writer), process: None }
		})
	}

	async fn play(self, pipe: tokio::io::DuplexStream) {
		let (reader, writer) = tokio::io::split(pipe);
		let mut player = Player { agent: self, out: writer, turns: HashMap::new(), next_id: 1 };
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

/// A session's turn under way: the steps left, and the call or question it waits on.
struct Playing {
	steps: VecDeque<FakeStep>,
	waiting: Option<String>,
}

struct Player {
	agent: FakeAgent,
	out: WriteHalf<tokio::io::DuplexStream>,
	turns: HashMap<String, Playing>,
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
				let native = message["resume"].as_str().map_or_else(|| format!("fake-{session}"), str::to_owned);
				self.write(json!({ "type": "opened", "session": session, "nativeId": native })).await
			}
			Some("send") if !message["steer"].truthy() => {
				let steps = self.agent.script.lock().turns.pop_front().unwrap_or_default();
				self.turns.insert(session.clone(), Playing { steps: steps.into(), waiting: None });
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
				self.write(json!({ "type": "closed", "session": session })).await
			}
			_ => Ok(()),
		}
	}

	/// Plays steps until one waits for godspeed, or the turn is over.
	async fn advance(&mut self, session: &str) -> std::io::Result<()> {
		loop {
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
				FakeStep::Approval { tool, input } => {
					self.write(json!({ "type": "approval", "id": id, "session": session, "tool": tool, "input": input, "toolUseId": format!("toolu_{id}") })).await?;
					return self.wait(session, id);
				}
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
}
