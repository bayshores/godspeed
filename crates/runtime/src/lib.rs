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
mod login;
mod models;
mod pending;
mod pipes;
pub mod process;
mod session;
#[cfg(all(test, unix))]
mod stand_ins;
#[cfg(test)]
mod test_peer;
mod update;

pub use event::{Ask, End, Part, SessionEvent, ToolCall, ToolReply, Usage, Verdict};
pub use health::{AgentHealth, Check, Outcome, Problem, Row};
pub use login::{Login, LoginControl};
pub use models::Model;
pub use session::{Runtime, Session, SessionSpec, ToolSpec};
pub use update::Update;
