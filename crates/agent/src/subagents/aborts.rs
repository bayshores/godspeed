//! Who can actually kill a running background job.
//!
//! The runner registers one abort per running job; the abort endpoint fires it. Abort is a real
//! kill: it ends the job's model call at once, not at the next loop check. The endpoint keeps
//! the books (status, the abort steer); the runner only unwinds.

use std::collections::HashMap;

use gs_engine::turn::abort::Abort;
use parking_lot::Mutex;

/// The live jobs' aborts, by job id (one per server, shared by the runner and the endpoint).
#[derive(Default)]
pub struct JobAborts {
	live: Mutex<HashMap<String, Abort>>,
}

impl JobAborts {
	/// The runner registers its abort at job start (a second call replaces it).
	pub fn register_job_abort(&self, job_id: &str, abort: Abort) {
		self.live.lock().insert(job_id.to_owned(), abort);
	}

	/// The runner unregisters once the job settled or unwound.
	pub fn unregister_job_abort(&self, job_id: &str) {
		self.live.lock().remove(job_id);
	}
}

/// True while the job's loop is executing. A "running" record with a live registration belongs
/// to a loop this process owns (never re-spawn beside it); without one it is an orphan of a
/// process death. The registration spans computation and cleanup only, not the delivery.
pub fn is_job_live(aborts: &JobAborts, job_id: &str) -> bool {
	aborts.live.lock().contains_key(job_id)
}

/// Aborts a running job's loop. False when no loop of that job is executing.
pub fn fire_job_abort(aborts: &JobAborts, job_id: &str) -> bool {
	let Some(abort) = aborts.live.lock().remove(job_id) else { return false };
	abort.abort();
	true
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_fired_abort_kills_once_and_ends_liveness() {
		let aborts = JobAborts::default();
		let abort = Abort::new();
		assert!(!fire_job_abort(&aborts, "job_1"), "nothing registered");
		aborts.register_job_abort("job_1", abort.clone());
		assert!(is_job_live(&aborts, "job_1"));
		assert!(fire_job_abort(&aborts, "job_1"));
		assert!(abort.is_aborted());
		assert!(!is_job_live(&aborts, "job_1"));
		assert!(!fire_job_abort(&aborts, "job_1"), "a second fire finds nothing");
	}

	#[test]
	fn unregister_ends_liveness_without_aborting() {
		let aborts = JobAborts::default();
		let abort = Abort::new();
		aborts.register_job_abort("job_1", abort.clone());
		aborts.unregister_job_abort("job_1");
		assert!(!is_job_live(&aborts, "job_1"));
		assert!(!abort.is_aborted());
	}
}
