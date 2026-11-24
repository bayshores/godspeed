//! The agent's end of the pipes, played by a test, and what the adapter tests share.

use gs_base::clock;
use gs_core::spaces::agent_folder::FolderAgent;
use gs_json::{Json, json, stringify};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, Lines, ReadHalf, WriteHalf};
use tokio::sync::mpsc;

use crate::event::{Ask, End, Part, SessionEvent, ToolCall, ToolReply, Usage, Verdict};
use crate::pipes::Started;
use crate::session::{Runtime, Session, SessionSpec, ToolSpec};

const WAIT_MS: i64 = 5_000;

pub struct Peer {
	lines: Lines<BufReader<ReadHalf<DuplexStream>>>,
	out: WriteHalf<DuplexStream>,
}

impl Peer {
	/// The next line godspeed wrote, as JSON.
	pub async fn recv(&mut self) -> Json {
		let line = clock::within(WAIT_MS, self.lines.next_line()).await.expect("godspeed wrote nothing").unwrap().expect("godspeed closed its end");
		gs_json::parse(&line).unwrap()
	}

	/// Whether godspeed writes nothing for `ms`.
	pub async fn quiet(&mut self, ms: i64) -> bool {
		clock::within(ms, self.lines.next_line()).await.is_none()
	}

	pub async fn send(&mut self, message: &Json) {
		self.send_line(&stringify(message)).await;
	}

	pub async fn send_line(&mut self, line: &str) {
		self.out.write_all(format!("{line}\n").as_bytes()).await.unwrap();
	}

	/// Takes godspeed's next request, which must be `method`, answers it with `result`, and
	/// gives its params.
	pub async fn answer(&mut self, method: &str, result: Json) -> Json {
		let request = self.recv().await;
		assert_eq!(request["method"].as_str(), Some(method), "{}", stringify(&request));
		self.send(&json!({ "id": request["id"], "result": result })).await;
		request["params"].clone()
	}
}

/// A runtime whose every start hands the test a new peer.
pub fn runtime(agent: FolderAgent) -> (Runtime, mpsc::UnboundedReceiver<Peer>) {
	let (peers, rx) = mpsc::unbounded_channel();
	let runtime = Runtime::from_pipes(agent, move || {
		let (ours, theirs) = tokio::io::duplex(1 << 16);
		let (reader, writer) = tokio::io::split(ours);
		let (their_reader, their_writer) = tokio::io::split(theirs);
		let _ = peers.send(Peer { lines: BufReader::new(their_reader).lines(), out: their_writer });
		Started { reader: Box::new(reader), writer: Box::new(writer), process: None }
	});
	(runtime, rx)
}

pub fn spec(resume: Option<&str>) -> SessionSpec {
	SessionSpec {
		cwd: "/work".into(),
		model: Some("claude-sonnet-5-5".into()),
		instructions: "You are a tutor inside godspeed.".into(),
		tools: vec![ToolSpec { name: "quiz".into(), description: "Show the learner one quiz question.".into(), input_schema: json!({ "type": "object", "properties": { "question": { "type": "string" } }, "required": ["question"] }) }],
		resume: resume.map(str::to_owned),
		persist: true,
	}
}

/// The next event, or the test fails.
pub async fn next(session: &Session) -> SessionEvent {
	clock::within(WAIT_MS, session.next()).await.expect("no event came").expect("the session closed")
}

/// Every event until the turn ends, answering nothing, and the end.
pub async fn events_until_end(session: &Session) -> (Vec<SessionEvent>, End) {
	let mut events = Vec::new();
	loop {
		match next(session).await {
			SessionEvent::Ended(end) => return (events, end),
			event => events.push(event),
		}
	}
}

/// An event as a test compares it; a tool call or an approval has been answered.
#[derive(Debug, PartialEq)]
pub enum Seen {
	Started,
	Delta(String),
	Done(String),
	Own(String, bool),
	Calls(Vec<ToolCall>),
	Tool(ToolCall),
	Asked(Ask),
	Usage(Usage),
	Compacted,
	Ended(End),
}

/// Reads `event`, answering a tool call with `reply` and allowing an approval.
fn seen(event: SessionEvent, reply: &ToolReply) -> Seen {
	match event {
		SessionEvent::TurnStarted => Seen::Started,
		SessionEvent::TextDelta(text) => Seen::Delta(text),
		SessionEvent::TextDone(text) => Seen::Done(text),
		SessionEvent::OwnTool { name, done, .. } => Seen::Own(name, done),
		SessionEvent::Calls(calls) => Seen::Calls(calls),
		SessionEvent::ToolCall { call, reply: answer } => {
			let _ = answer.send(reply.clone());
			Seen::Tool(call)
		}
		SessionEvent::Approval { ask, reply: answer } => {
			let _ = answer.send(Verdict { allow: true, message: None });
			Seen::Asked(ask)
		}
		SessionEvent::Usage(usage) => Seen::Usage(usage),
		SessionEvent::Compacted => Seen::Compacted,
		SessionEvent::Ended(end) => Seen::Ended(end),
	}
}

pub fn text_reply(text: &str) -> ToolReply {
	ToolReply { content: vec![Part::Text(text.to_owned())], is_error: false, ends_turn: false }
}

/// Sends a recorded turn's lines. After a line that asks godspeed something (a JSON-RPC request,
/// a tool call or an approval), the events up to that question are read, the question is
/// answered, and godspeed's answer line is kept. Gives the events seen and the answers.
pub async fn replay(peer: &mut Peer, session: &Session, lines: &[String], reply: &ToolReply) -> (Vec<Seen>, Vec<Json>) {
	let (mut events, mut answers) = (Vec::new(), Vec::new());
	for line in lines {
		peer.send_line(line).await;
		let message = gs_json::parse(line).unwrap();
		let asks = (message.get("id").is_some() && message.get("method").is_some()) || matches!(message["type"].as_str(), Some("tool_call" | "approval"));
		if !asks {
			continue;
		}
		loop {
			let event = seen(next(session).await, reply);
			let answered = matches!(event, Seen::Tool(_) | Seen::Asked(_));
			events.push(event);
			if answered {
				break;
			}
		}
		answers.push(peer.recv().await);
	}
	(events, answers)
}

/// The events until the turn ends, the end included.
pub async fn seen_until_end(session: &Session) -> Vec<Seen> {
	let mut events = Vec::new();
	loop {
		let event = seen(next(session).await, &text_reply("unexpected"));
		let end = matches!(event, Seen::Ended(_));
		events.push(event);
		if end {
			return events;
		}
	}
}

/// The lines of a recorded turn in `fixtures/`.
pub fn fixture(name: &str) -> Vec<String> {
	let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures").join(name);
	std::fs::read_to_string(path).unwrap().lines().map(str::to_owned).collect()
}
