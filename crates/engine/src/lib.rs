//! The turn engine that replaces pi-agent-core and pi-ai, and the bridge that hands every model
//! call to the outside agent.
//!
//! How a lesson turn runs:
//! 1. Build an [`turn::agent::Agent`] from [`turn::agent::AgentOptions`] with the engine from
//!    [`turn::models::agent_engine`], the system prompt, the [`turn::tool::Tool`]s and the record.
//! 2. Wrap it in [`turn::ui_stream::run_pi_turn`] (runPiTurn). The handle does not run yet:
//!    register the turn (so a Stop or a second view finds it), then call `start()`.
//! 3. Each model request parks on the [`bridge::Bridge`] as a work item until the agent takes it
//!    with `wait_for_work` and answers with `respond_to_work`; the answer becomes the assistant
//!    message, its tool calls run, and the loop asks again until the reply has no tool calls.
//!
//! Background jobs call [`turn::faux::stream`] (pi's streamSimple) or run an `Agent` directly,
//! naming their conversation with `Bridge::label_conversation` so the agent sees what it is.
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
