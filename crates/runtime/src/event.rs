//! What a session tells godspeed while a turn runs, the same for both agents, and the answers
//! godspeed gives back.

use gs_json::Json;
use tokio::sync::oneshot;

/// A piece of what godspeed sends: the learner's words, a picture, or a tool's result.
#[derive(Clone, Debug, PartialEq)]
pub enum Part {
	Text(String),
	Image { mime: String, base64: String },
}

/// One call of a godspeed tool. `id` is the agent's own id for the call.
#[derive(Clone, Debug, PartialEq)]
pub struct ToolCall {
	pub id: String,
	pub name: String,
	pub args: Json,
}

/// godspeed's answer to a tool call. `ends_turn` ends the turn right after the agent has the
/// result, as a question for the learner does.
#[derive(Clone, Debug, PartialEq)]
pub struct ToolReply {
	pub content: Vec<Part>,
	pub is_error: bool,
	pub ends_turn: bool,
}

/// What the agent asks permission for.
#[derive(Clone, Debug, PartialEq)]
pub enum Ask {
	/// One of Claude Code's own tools (Bash, Edit, ...), with what it would run or change.
	Tool { name: String, input: Json },
	/// A shell command Codex wants to run.
	Command { command: String, cwd: String, reason: Option<String> },
	/// Files Codex wants to change.
	FileChange { reason: Option<String> },
	/// More file system or network access for Codex.
	Permissions { reason: Option<String>, permissions: Json },
	/// Questions Codex wants the learner to answer; an allowing verdict's message is the answer.
	Question { questions: Json },
	/// Input an MCP server asks for through Codex.
	Elicitation { server: String, message: String },
}

/// The learner's answer to an `Ask`. A refusal's message goes to the agent.
#[derive(Clone, Debug, PartialEq)]
pub struct Verdict {
	pub allow: bool,
	pub message: Option<String>,
}

/// One model call's tokens: everything it read (cached included), the cached part, and what it
/// wrote.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Usage {
	pub input: u64,
	pub cached: u64,
	pub output: u64,
}

/// How a turn ended. A turn ended by a tool reply's `ends_turn` counts as completed.
#[derive(Clone, Debug, PartialEq)]
pub enum End {
	Completed,
	Interrupted,
	Failed(String),
}

#[derive(Debug)]
pub enum SessionEvent {
	TurnStarted,
	TextDelta(String),
	/// The whole text of one message, after its deltas.
	TextDone(String),
	/// One of the agent's own tools (a command, a file edit, a web search), when it starts and
	/// when it is done. `name` and `input` are the agent's own: Claude Code's tool name and input,
	/// or Codex's item type and item.
	OwnTool { id: String, name: String, input: Json, done: bool },
	/// Every godspeed call of one model step, before any of them runs, so godspeed can check them
	/// together. Claude Code says a step's calls first; Codex never does.
	Calls(Vec<ToolCall>),
	/// A godspeed tool call; the turn waits until `reply` is answered.
	ToolCall { call: ToolCall, reply: oneshot::Sender<ToolReply> },
	/// A permission question; the agent waits until `reply` is answered.
	Approval { ask: Ask, reply: oneshot::Sender<Verdict> },
	Usage(Usage),
	Compacted,
	Ended(End),
}

/// What the agent hears when godspeed drops a tool call's reply without answering it.
pub(crate) const TOOL_DROPPED: &str = "godspeed stopped before this tool finished.";

/// What the agent hears when the learner refuses without saying why, or the question is dropped.
pub(crate) const REFUSED: &str = "The learner did not allow this.";
