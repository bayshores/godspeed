//! Runs the learner's own coding agent, Claude Code or Codex, as a child process and speaks its
//! protocol: `codex app-server`'s JSON-RPC, or JSON lines with godspeed's Claude helper on the
//! Agent SDK. It knows nothing about lessons: a session takes input and godspeed's tools and
//! gives back the same events for both agents.

mod claude;
mod codex;
mod event;
#[cfg(any(test, feature = "fake"))]
pub mod fake;
mod health;
mod jsonrpc;
mod pipes;
pub mod process;
mod session;
#[cfg(test)]
mod test_peer;

pub use codex::agent::CodexLogin;
pub use event::{Ask, End, Part, SessionEvent, ToolCall, ToolReply, Usage, Verdict};
pub use health::{AgentHealth, Problem};
pub use session::{Runtime, Session, SessionSpec, ToolSpec};
