//! The teacher in godspeed's terminal starts quiet: no first message goes to it. When a lesson
//! turn or a job the learner asked for waits for it while it sits idle (bridge's
//! `nudge_for_teacher`), godspeed has the shell type one short line to it, which sends it back to
//! waiting for work. When its terminal first reaches godspeed, the catch-up a wait would start
//! runs too, so godspeed's own jobs come for the helper.

use std::sync::Arc;

use gs_base::clock;

use crate::App;
use crate::turns::agent_catch_up::catch_up_for_agent;

/// How often the loop looks.
const LOOK_MS: i64 = 2_000;

/// What godspeed types to the quiet teacher; the folder's CLAUDE.md and AGENTS.md say what each
/// means.
pub const LESSON_WAITS: &str = "Your lesson is waiting.";
pub const JOB_WAITS: &str = "Your job is waiting.";

/// Runs while the shell does. Nothing runs without it.
pub fn start_teacher_nudges(app: &Arc<App>) {
	let Some(shell) = app.shell.clone() else { return };
	let app = app.clone();
	tokio::spawn(async move {
		let mut caught_up: Option<String> = None;
		loop {
			clock::sleep(LOOK_MS).await;
			let now = clock::now_ms();
			if let Some(terminal) = app.bridge.contacted_teacher_terminal()
				&& caught_up.as_deref() != Some(terminal.as_str())
			{
				caught_up = Some(terminal);
				catch_up_for_agent(&app, now);
			}
			if let Some((terminal, lesson)) = app.bridge.nudge_for_teacher(now) {
				let line = if lesson { LESSON_WAITS } else { JOB_WAITS };
				app.bridge.nudge_sent(&terminal, line, now);
				shell.send(&gs_shell_rpc::ToShell::Nudge { terminal, line: line.to_owned() });
			}
		}
	});
}
