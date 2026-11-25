//! The lesson's job runner: every job runs on the learner's agent, asks the lesson that started it
//! to allow what it needs, and its finished steer goes to the wake pipeline.

use std::future::Future;
use std::path::Path;
use std::sync::Arc;
use std::task::Context;

use futures_util::future::BoxFuture;
use futures_util::task::noop_waker_ref;
use gs_base::tasks::detach;
use gs_agent::subagents::aborts::JobAborts;
use gs_agent::subagents::headless::{HeadlessApi, get_headless};
use gs_agent::subagents::job_agent::JobAgent;
use gs_agent::subagents::runner::{JobHost, KeptPages, create_job_runner};
use gs_engine::turn::job_session::Approve;
use gs_json::Json;
use gs_pdf::Pdf;
use gs_store::chats::ChatStore;
use gs_store::jobs::JobStore;

use super::turn_work;
use crate::App;
use crate::jobs::asks::{AskedOn, approve_on};
use crate::jobs::job_agent::job_agent;
use crate::jobs::{deliver_job_result, live_agent};
use crate::spaces::{keep_page, kept_pages_at};

struct AppJobs(Arc<App>);

impl JobHost for AppJobs {
	fn job_store(&self) -> &JobStore {
		&self.0.stores.jobs
	}

	fn chat_store(&self) -> &ChatStore {
		&self.0.stores.chats
	}

	fn job_agent(&self) -> Arc<dyn JobAgent> {
		job_agent(&self.0)
	}

	fn approve(&self, chat_id: &str) -> Approve {
		approve_on(&self.0, AskedOn::Lesson(chat_id.to_owned()))
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
		get_headless(&self.0.pdf, self.0.shell.as_ref())
	}

	fn search_key(&self) -> Option<String> {
		self.0.stores.search_key.read_search_key()
	}

	fn deliver(&self, steer: Json) -> BoxFuture<'static, Result<(), String>> {
		deliver_job_result(&self.0, steer);
		Box::pin(async { Ok(()) })
	}

	fn kept_pages(&self, path: &Path) -> BoxFuture<'static, Option<KeptPages>> {
		let (app, path) = (self.0.clone(), path.to_owned());
		Box::pin(async move { kept_pages_at(&app, &path).await })
	}

	fn keep_page(&self, file: &KeptPages, page: u32, markdown: &str) -> Result<(), String> {
		keep_page(&self.0, file, page, markdown)
	}

	fn job_activity(&self, job_id: &str, line: &str) {
		turn_work::job_activity(&self.0, job_id, line);
	}
}

/// Runs a job's agent in the background. `input` rides along when the spawn happens
/// before the tool call is saved. Like Node's `void runJob()`, the job runs here up to its first
/// wait (a job that fails its checks has failed when this returns), then goes on in the
/// background once its lesson's running turn has called the model again.
pub fn run_job(app: &Arc<App>, job_id: &str, input: Option<Json>) {
	let runner = create_job_runner(Arc::new(AppJobs(app.clone())));
	let mut job = Box::pin(runner.run_job(job_id.to_owned(), input));
	if job.as_mut().poll(&mut Context::from_waker(noop_waker_ref())).is_pending() {
		let turn = app.stores.jobs.get_job(job_id).and_then(|j| live_agent(app, j["chatId"].as_str()?)).filter(|agent| agent.is_running()).map(|agent| agent.next_model_call());
		detach("job", async move {
			if let Some(turn) = turn {
				turn.await;
			}
			job.await;
		});
	}
}
