//! The lesson's job runner (the `jobRunner` chat-handler.ts builds): every job runs on the outside
//! agent, and its finished steer goes to the wake pipeline.

use std::future::Future;
use std::path::Path;
use std::sync::Arc;
use std::task::Context;

use futures_util::future::BoxFuture;
use futures_util::task::noop_waker_ref;
use gs_agent::subagents::aborts::JobAborts;
use gs_agent::subagents::headless::{HeadlessApi, get_headless};
use gs_agent::subagents::runner::{JobHost, create_job_runner};
use gs_engine::bridge::Bridge;
use gs_engine::turn::faux::Engine;
use gs_engine::turn::models::agent_engine;
use gs_json::Json;
use gs_pdf::Pdf;
use gs_store::chats::ChatStore;
use gs_store::jobs::JobStore;

use crate::App;
use crate::jobs::deliver_job_result;

struct AppJobs(Arc<App>);

impl JobHost for AppJobs {
	fn job_store(&self) -> &JobStore {
		&self.0.stores.jobs
	}

	fn chat_store(&self) -> &ChatStore {
		&self.0.stores.chats
	}

	fn bridge(&self) -> &Bridge {
		&self.0.bridge
	}

	fn pdf(&self) -> &Pdf {
		&self.0.pdf
	}

	fn job_aborts(&self) -> &JobAborts {
		&self.0.jobs.aborts
	}

	fn tmp_dir(&self) -> &Path {
		&self.0.paths.tmp
	}

	fn headless(&self) -> Arc<dyn HeadlessApi> {
		get_headless(&self.0.pdf)
	}

	fn engine_for(&self, _role: &str) -> Option<Engine> {
		Some(agent_engine(&self.0.bridge))
	}

	fn deliver(&self, steer: Json) -> BoxFuture<'static, Result<(), String>> {
		deliver_job_result(&self.0, steer);
		Box::pin(async { Ok(()) })
	}
}

/// Runs a job's helper agent in the background. `input` rides along when the spawn happens
/// before the tool call is saved. Like Node's `void runJob()`, the job runs here up to its first
/// wait (a job that fails its checks has failed when this returns), then goes on in the
/// background.
pub fn run_job(app: &Arc<App>, job_id: &str, input: Option<Json>) {
	let runner = create_job_runner(Arc::new(AppJobs(app.clone())));
	let mut job = Box::pin(runner.run_job(job_id.to_owned(), input));
	if job.as_mut().poll(&mut Context::from_waker(noop_waker_ref())).is_pending() {
		tokio::spawn(job);
	}
}
