//! Turns on the learner's own agent: a lesson turn (`session_turn`) and a one-off job session
//! (`job_session`), with their messages, tool calls, aborts, stream events and usage estimates.

pub mod abort;
mod call_queue;
pub mod call_ids;
pub mod events;
pub mod job_session;
pub mod messages;
pub mod record;
pub mod session_turn;
pub mod tool;
pub mod tool_execute;
pub mod tool_host;
pub mod ui_stream;
pub mod validate;
