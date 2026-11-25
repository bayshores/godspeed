//! What every background job runs on: a one-off session on the learner's own agent
//! (`gs_engine::turn::job_session`), started once the pool has a permit for it and an agent is
//! picked. The server implements it; tests run jobs straight on a stand-in agent.

use futures_util::future::BoxFuture;
use gs_engine::turn::job_session::{Finished, OneOff, RunError};

/// Which jobs the pool lets in first.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Priority {
	/// A learner waits on it: they asked for it on a page, or an open lesson waits on it.
	Waited,
	/// godspeed's own upkeep.
	Own,
}

pub trait JobAgent: Send + Sync {
	/// Runs `job` to its end. `label` names it in the log ("Topic grouping: CSE 21").
	fn run<'a>(&'a self, job: OneOff, priority: Priority, label: &'a str) -> BoxFuture<'a, Result<Finished, RunError>>;
}
