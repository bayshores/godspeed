//! The agent loop: messages, tool calls, steering, aborts, stream events and usage estimates
//! (@earendil-works/pi-agent-core, pi-ai's faux provider), and a lesson turn on the learner's own
//! agent session (`session_turn`).

pub mod abort;
pub mod agent;
mod agent_loop;
pub mod call_ids;
pub mod events;
pub mod faux;
pub mod messages;
pub mod models;
pub mod record;
pub mod session_turn;
pub mod tool;
mod tool_batch;
pub mod tool_execute;
pub mod tool_host;
pub mod transcript;
pub mod ui_stream;
mod usage;
pub mod validate;
