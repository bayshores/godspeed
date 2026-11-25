//! The background jobs: the agent they run on, the permission questions they wait on, the wake
//! pipeline and the activity feed.

pub mod asks;
pub mod job_agent;
mod lifecycle;
pub mod observability;
mod pump;
mod wake;

use std::sync::Arc;

use gs_agent::subagents::aborts::JobAborts;
use gs_agent::subagents::bg_llm_semaphore::BgLlmSlots;

pub use lifecycle::{AbortRefusal, abort_job, list_all_jobs, list_jobs};
pub use wake::{
	JobRespawn, TurnRunner, deliver_job_result, discard_chat_deliveries, live_agent, note_steers_durable, reconcile_user_steers, register_live_agent, set_job_respawn,
	set_turn_runner, settle_steers, steer_live_chat, unregister_live_agent,
};

/// The jobs' live state inside `App`.
#[derive(Default)]
pub struct JobsState {
	pub(crate) wake: parking_lot::Mutex<wake::Wake>,
	/// The running jobs' aborts: the job runner registers into it, the dock's END fires it.
	pub aborts: Arc<JobAborts>,
	/// The permits every job's agent session runs under.
	pub(crate) pool: BgLlmSlots,
	pub(crate) asks: asks::JobAsks,
}

#[cfg(test)]
#[path = "jobs_tests.rs"]
mod tests;
