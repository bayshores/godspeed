//! jobs.ts (the wake pipeline) and observability.ts (the activity feed).

#[allow(clippy::module_inception)]
pub mod jobs;
pub mod observability;

use std::sync::Arc;

use gs_agent::subagents::aborts::JobAborts;

pub use jobs::{
	JobRespawn, TurnRunner, deliver_job_result, discard_chat_deliveries, live_agent, note_steers_durable, reconcile_user_steers, register_live_agent, set_job_respawn,
	set_turn_runner, settle_steers, steer_live_chat, unregister_live_agent,
};

/// The wake pipeline's live state inside `App`.
#[derive(Default)]
pub struct JobsState {
	pub(crate) wake: parking_lot::Mutex<jobs::Wake>,
	/// The running jobs' aborts: the job runner registers into it, the dock's END fires it.
	pub aborts: Arc<JobAborts>,
}
