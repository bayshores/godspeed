//! The agent background jobs run on: the learner's picked agent, on the same runtime as lessons,
//! one session per job. A job waits until an agent is picked, then for one of the pool's permits.

use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_agent::subagents::bg_llm_semaphore::with_bg_llm_slot;
use gs_agent::subagents::job_agent::{JobAgent, Priority};
use gs_base::ids::uuid_hex;
use gs_engine::turn::abort::Abort;
use gs_engine::turn::job_session::{Finished, OneOff, RunError, run_once};

use crate::App;
use crate::app::agent_folder::picked_agent;
use crate::app::agents::runtime;

struct AppJobAgent(Arc<App>);

/// The agent the server's jobs run on.
pub fn job_agent(app: &Arc<App>) -> Arc<dyn JobAgent> {
	Arc::new(AppJobAgent(app.clone()))
}

impl JobAgent for AppJobAgent {
	fn run<'a>(&'a self, job: OneOff, priority: Priority, label: &'a str) -> BoxFuture<'a, Result<Finished, RunError>> {
		Box::pin(async move {
			let app = &self.0;
			let abort = job.abort.clone();
			if !agent_picked(app, &abort).await {
				return Err(RunError::Aborted);
			}
			let ran = with_bg_llm_slot(&app.jobs.pool, priority, Some(&abort), || async {
				// A job with no folder of its own works in a new empty one, removed after.
				let (folder, made) = match &job.cwd {
					Some(folder) => (folder.clone(), false),
					None => (app.paths.tmp.join("godspeed-jobs").join(uuid_hex("job", 12)), true),
				};
				if let Err(err) = std::fs::create_dir_all(&folder) {
					return Err(RunError::Failed(format!("the job's folder could not be made: {err}")));
				}
				let result = run_once(&runtime(app), &folder, job).await;
				if made && let Err(err) = std::fs::remove_dir_all(&folder) {
					eprintln!("[job {label}] its folder {} could not be removed: {err}", folder.display());
				}
				result
			})
			.await;
			let result = ran.unwrap_or(Err(RunError::Aborted));
			if let Err(RunError::Failed(why)) = &result {
				eprintln!("[job {label}] failed: {why}");
			}
			result
		})
	}
}

/// Waits until the learner has picked an agent; false when the job stopped first.
async fn agent_picked(app: &App, abort: &Abort) -> bool {
	loop {
		let notified = app.agents.picked.notified();
		tokio::pin!(notified);
		notified.as_mut().enable();
		if picked_agent(app).is_some() {
			return true;
		}
		tokio::select! {
			() = notified => {}
			() = abort.aborted() => return false,
		}
	}
}
