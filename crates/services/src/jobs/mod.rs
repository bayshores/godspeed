//! jobs.ts (the wake pipeline) and observability.ts (the activity feed).

mod lifecycle;
pub mod observability;
mod pump;
mod wake;

use std::sync::Arc;

use gs_agent::subagents::aborts::JobAborts;

pub use lifecycle::{AbortRefusal, abort_job, list_all_jobs, list_jobs};
pub use wake::{
	JobRespawn, TurnRunner, deliver_job_result, discard_chat_deliveries, live_agent, note_steers_durable, reconcile_user_steers, register_live_agent, set_job_respawn,
	set_turn_runner, settle_steers, steer_live_chat, unregister_live_agent,
};

/// The wake pipeline's live state inside `App`.
#[derive(Default)]
pub struct JobsState {
	pub(crate) wake: parking_lot::Mutex<wake::Wake>,
	/// The running jobs' aborts: the job runner registers into it, the dock's END fires it.
	pub aborts: Arc<JobAborts>,
}

#[cfg(test)]
#[path = "jobs_tests.rs"]
mod tests;
