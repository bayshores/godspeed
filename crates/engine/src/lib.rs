//! The turn engine that replaces pi-agent-core and pi-ai: lesson turns and background jobs, each
//! on its own session of the learner's agent.
//!
//! How a lesson turn runs:
//! 1. Build a [`turn::session_turn::SessionTurn`] with an opener for the lesson's agent session
//!    (gs-runtime), its [`turn::tool_host::ToolHost`] and its text check.
//! 2. Wrap it in [`turn::ui_stream::run_pi_turn`]. The handle does not run yet: register the
//!    turn (so a Stop, a steer or a second view finds it), then call `start()`.
//! 3. The session streams the agent's words, its godspeed tool calls (each run by the host) and
//!    its permission questions; [`turn::record::TranscriptBuilder`] turns them into the record's
//!    messages and the stream's events.
//!
//! Times and timers use the app clock (gs_base::clock), so a clock that jumps ahead reaches the
//! 30 s tool timeout and a quiet job's 10 minute limit.
//!
//! Left out because nothing in the app uses them: a tool's `label`, tool progress updates
//! (`tool_execution_update`), the model identity line and pi's prompt cache. Partial replies
//! stream as one update per content block instead of pi's random chunk sizes; the last update
//! of each block is the same.

pub mod turn;
