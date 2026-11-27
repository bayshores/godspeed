//! The agent background jobs run on: the lessons' agent, on the same runtime, one session per
//! job. A job waits only for one of the pool's permits.

use std::path::PathBuf;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_agent::subagents::bg_llm_semaphore::with_bg_llm_slot;
use gs_agent::subagents::job_agent::{JobAgent, Priority};
use gs_base::fsx;
use gs_engine::turn::job_session::{Finished, OneOff, RunError, run_once};

use crate::App;
use crate::app::agents::runtime;

struct AppJobAgent(Arc<App>);

/// A job's own work folder, removed when the job ends or is dropped.
struct WorkDir {
	dir: PathBuf,
	label: String,
}

impl Drop for WorkDir {
	fn drop(&mut self) {
		if let Err(err) = std::fs::remove_dir_all(&self.dir) {
			eprintln!("[job {}] its folder {} could not be removed: {err}", self.label, self.dir.display());
		}
	}
}

/// The agent the server's jobs run on.
pub fn job_agent(app: &Arc<App>) -> Arc<dyn JobAgent> {
	Arc::new(AppJobAgent(app.clone()))
}

impl JobAgent for AppJobAgent {
	fn run<'a>(&'a self, job: OneOff, priority: Priority, label: &'a str) -> BoxFuture<'a, Result<Finished, RunError>> {
		Box::pin(async move {
			let app = &self.0;
			let abort = job.abort.clone();
			let ran = with_bg_llm_slot(&app.jobs.pool, priority, Some(&abort), || async {
				// A job with no folder of its own works in a new empty one, removed after.
				let not_made = |err: String| RunError::Failed(format!("the job's folder could not be made: {err}"));
				let (folder, _own) = match &job.cwd {
					Some(folder) => {
						std::fs::create_dir_all(folder).map_err(|err| not_made(err.to_string()))?;
						(folder.clone(), None)
					}
					None => {
						let dir = fsx::make_temp_dir(&app.paths.tmp, "godspeed-job-").map_err(not_made)?;
						(dir.clone(), Some(WorkDir { dir, label: label.to_owned() }))
					}
				};
				run_once(&runtime(app), &folder, job).await
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

#[cfg(test)]
mod tests {
	use std::collections::HashSet;

	use gs_engine::turn::abort::Abort;
	use gs_engine::turn::tool_host::ToolHost;
	use gs_runtime::Part;
	use gs_runtime::fake::{FakeAgent, FakeStep};

	use super::*;
	use crate::app::agents::use_runtime;
	use crate::app::test_support::{scratch_dir, test_app};

	fn job(abort: &Abort) -> OneOff {
		OneOff::new("You read a file.".to_owned(), vec![Part::Text("Read it.".to_owned())], ToolHost::new(Vec::new(), None, HashSet::new()), 5, abort.clone())
	}

	#[tokio::test]
	async fn a_job_runs_on_the_lessons_agent_in_a_folder_of_its_own() {
		let root = scratch_dir("job-agent");
		let app = test_app(&root);
		let agent = FakeAgent::default();
		agent.push(vec![FakeStep::Text("Read.".to_owned())]);
		use_runtime(&app, agent.runtime());
		let abort = Abort::new();
		assert_eq!(job_agent(&app).run(job(&abort), Priority::Own, "Reading").await.map(|done| done.text), Ok("Read.".to_owned()));
		let left = std::fs::read_dir(&app.paths.tmp).unwrap().filter_map(Result::ok).filter(|entry| entry.file_name().to_string_lossy().starts_with("godspeed-job-")).count();
		assert_eq!(left, 0, "its folder is removed");
	}
}
