//! One background job on the learner's own agent: a session of its own that is not kept, the
//! job's input, godspeed's tools for the job run through a `ToolHost`, and the agent's last text
//! as what the job made. It ends with the agent's turn (after an optional follow-up turn), at
//! Stop, past its model-call cap, or after 10 minutes without a word from the agent.

use std::fmt;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_base::clock;
use gs_json::{Json, json};
use gs_runtime::{Ask, End, Part, Runtime, Session, SessionEvent, SessionSpec, ToolCall, ToolReply, Usage, Verdict};

use super::abort::Abort;
use super::tool_host::{Reply, ToolHost};

/// How long the agent may say nothing before the job fails.
const IDLE_MS: i64 = 10 * 60_000;

/// Why a job's run ended without a result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunError {
	/// The job's abort fired.
	Aborted,
	/// The agent or the run failed, with the message.
	Failed(String),
}

impl fmt::Display for RunError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			RunError::Aborted => f.write_str("aborted"),
			RunError::Failed(message) => f.write_str(message),
		}
	}
}

/// Called with each model call's tokens.
type OnUsage = Arc<dyn Fn(Usage) + Send + Sync>;
/// Called before a godspeed tool runs, with its name and arguments. An `Err` ends the job with
/// that failure before the tool runs.
pub type OnToolStart = Arc<dyn Fn(&str, &Json) -> Result<(), String> + Send + Sync>;
/// Called when one of the agent's own tools starts, with its name and input.
type OnOwnTool = Arc<dyn Fn(&str, &Json) + Send + Sync>;
/// The learner's answer to one of the agent's permission questions.
pub type Approve = Arc<dyn Fn(Ask) -> BoxFuture<'static, Verdict> + Send + Sync>;
/// Asked once, when the first turn ends, with its last text: input for one more turn, or None.
pub type FollowUp = Box<dyn FnOnce(&str) -> Option<Vec<Part>> + Send>;

/// One job's session: what it opens with and sends, and what hears it run.
pub struct OneOff {
	pub instructions: String,
	pub input: Vec<Part>,
	pub host: ToolHost,
	/// The folder the agent works in; None is a folder of the job's own, which the job agent
	/// makes (`run_once` is given the folder to use).
	pub cwd: Option<PathBuf>,
	/// Model calls allowed. Past it the agent is stopped, and the text so far is the result.
	pub max_calls: usize,
	pub abort: Abort,
	pub on_usage: Option<OnUsage>,
	pub on_tool_start: Option<OnToolStart>,
	pub on_own_tool: Option<OnOwnTool>,
	/// None refuses every permission question.
	pub approve: Option<Approve>,
	pub follow_up: Option<FollowUp>,
}

impl OneOff {
	pub fn new(instructions: String, input: Vec<Part>, host: ToolHost, max_calls: usize, abort: Abort) -> OneOff {
		OneOff { instructions, input, host, cwd: None, max_calls, abort, on_usage: None, on_tool_start: None, on_own_tool: None, approve: None, follow_up: None }
	}
}

/// A job's end: the agent's last text, and whether the model-call cap stopped it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finished {
	pub text: String,
	pub capped: bool,
}

/// What a running job keeps between events.
struct Run {
	job: OneOff,
	calls: usize,
	text: String,
	capped: bool,
}

/// Runs `job` in a new session on `runtime`, working in `cwd`, to its end.
pub async fn run_once(runtime: &Runtime, cwd: &Path, job: OneOff) -> Result<Finished, RunError> {
	if job.abort.is_aborted() {
		return Err(RunError::Aborted);
	}
	let spec = SessionSpec { cwd: cwd.to_path_buf(), read_dirs: Vec::new(), model: None, instructions: job.instructions.clone(), tools: job.host.specs(), resume: None, persist: false };
	let abort = job.abort.clone();
	let session = tokio::select! {
		biased;
		() = abort.aborted() => return Err(RunError::Aborted),
		opened = runtime.open(spec) => opened.map_err(RunError::Failed)?,
	};
	let mut run = Run { job, calls: 0, text: String::new(), capped: false };
	let mut input = std::mem::take(&mut run.job.input);
	let mut follow_up = run.job.follow_up.take();
	loop {
		session.send(&input).await.map_err(RunError::Failed)?;
		run.turn(&session).await?;
		if run.capped {
			break;
		}
		match follow_up.take().and_then(|follow_up| follow_up(&run.text)) {
			Some(more) => input = more,
			None => break,
		}
	}
	Ok(Finished { text: run.text, capped: run.capped })
}

/// Stops the running turn; the session closes when it is dropped.
async fn interrupt(session: &Session) {
	if let Err(err) = session.interrupt().await {
		eprintln!("[job] the agent could not be stopped: {err}");
	}
}

/// Runs `work` unless the job is stopped first: then the agent is stopped too.
async fn unless_aborted<T>(abort: &Abort, session: &Session, work: impl Future<Output = T>) -> Result<T, RunError> {
	tokio::select! {
		biased;
		() = abort.aborted() => {
			interrupt(session).await;
			Err(RunError::Aborted)
		}
		out = work => Ok(out),
	}
}

impl Run {
	/// One turn, to its end.
	async fn turn(&mut self, session: &Session) -> Result<(), RunError> {
		let abort = self.job.abort.clone();
		loop {
			let event = unless_aborted(&abort, session, clock::within(IDLE_MS, session.next())).await?;
			let Some(event) = event else {
				interrupt(session).await;
				return Err(RunError::Failed(format!("the agent said nothing for {} minutes", IDLE_MS / 60_000)));
			};
			let Some(event) = event else { return Err(RunError::Failed("the agent stopped".to_owned())) };
			match event {
				SessionEvent::TextDone(text) if !self.capped => self.text = text,
				SessionEvent::OwnTool { name, input, done: false, .. } => {
					if let Some(on_own_tool) = &self.job.on_own_tool {
						on_own_tool(&name, &input);
					}
				}
				SessionEvent::ToolCall { call, reply } if !self.capped => {
					let answer = self.call(session, call).await?;
					let _ = reply.send(answer);
				}
				SessionEvent::Approval { ask, reply } => {
					let verdict = match (&self.job.approve, self.capped) {
						(Some(approve), false) => unless_aborted(&abort, session, approve(ask)).await?,
						_ => Verdict { allow: false, message: None },
					};
					let _ = reply.send(verdict);
				}
				SessionEvent::Usage(usage) => self.used(session, usage).await,
				SessionEvent::Ended(End::Completed) => return Ok(()),
				SessionEvent::Ended(End::Interrupted) if self.capped => return Ok(()),
				SessionEvent::Ended(End::Interrupted) => return Err(RunError::Aborted),
				SessionEvent::Ended(End::Failed(why)) => return Err(RunError::Failed(why)),
				_ => {}
			}
		}
	}

	/// One model call done: counted, and past the cap the agent is stopped.
	async fn used(&mut self, session: &Session, usage: Usage) {
		self.calls += 1;
		if let Some(on_usage) = &self.job.on_usage {
			on_usage(usage);
		}
		if self.calls > self.job.max_calls && !self.capped {
			self.capped = true;
			interrupt(session).await;
		}
	}

	/// Runs one godspeed tool call: the agent's answer.
	async fn call(&mut self, session: &Session, call: ToolCall) -> Result<ToolReply, RunError> {
		if let Some(on_tool_start) = &self.job.on_tool_start
			&& let Err(why) = on_tool_start(&call.name, &call.args)
		{
			interrupt(session).await;
			return Err(RunError::Failed(why));
		}
		let block = json!({ "type": "toolCall", "id": call.id, "name": call.name, "arguments": call.args });
		let abort = self.job.abort.clone();
		let out = unless_aborted(&abort, session, self.job.host.call(&block, Reply { before: &[], message: &Json::Null }, &abort)).await?;
		Ok(out.agent_reply())
	}
}

#[cfg(test)]
#[path = "job_session_tests.rs"]
mod tests;
