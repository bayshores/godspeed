//! The turn engine that replaces pi-agent-core and pi-ai, and the bridge that hands every model
//! call to the outside agent.
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
//! Background jobs park their model requests on the [`bridge::Bridge`] as work items until the
//! outside agent takes them with `wait_for_work` and answers with `respond_to_work`: they call
//! [`turn::faux::stream`] (pi's streamSimple) or run an [`turn::agent::Agent`], naming their
//! conversation with `Bridge::label_conversation` so the agent sees what it is.
//!
//! Names follow the TypeScript: `prompt`/`continue_run` (prompt/continue), `steer`/`follow_up`,
//! `respond_to_work`, `read_work_page`, `claimed_lessons`. Times and timers use the app clock
//! (gs_base::clock), so a clock that jumps ahead reaches the 30 s tool timeout and the 10 minute
//! claim timeout.
//!
//! Left out because nothing in the app uses them: a tool's `label`, tool progress updates
//! (`tool_execution_update`), the model identity line and pi's prompt cache. Partial replies
//! stream as one update per content block instead of pi's random chunk sizes; the last update
//! of each block is the same.

pub mod bridge;
pub mod turn;
