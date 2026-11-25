//! Typing into an agent's input box for the learner: the trust answer, clearing a blocked line, and
//! sending a line once the box reads it back.

use std::time::{Duration, Instant};

use super::screen::Trust;
use super::{Agent, Terminal};

/// How long the trust button waits for the pointer to reach "Yes" after its Down key.
const TRUST_MOVE: Duration = Duration::from_secs(1);
/// How long a blocked line has to come back into Claude Code's input.
const LINE_BACK: Duration = Duration::from_secs(3);

/// Enter on the trust question once its pointer reached "Yes"; nothing if the screen changed.
pub(super) fn enter_on_yes(terminal: &Terminal) {
	let deadline = Instant::now() + TRUST_MOVE;
	while Instant::now() < deadline {
		std::thread::sleep(Duration::from_millis(20));
		let trust = terminal.state().screen.trust();
		match trust {
			Some(Trust::OnYes) => {
				let _ = terminal.write(b"\r");
				return;
			}
			Some(Trust::OnNo) => {}
			None => return,
		}
	}
}

/// Waits for the blocked line to come back into Claude Code's input, then takes it out a row at
/// a time: Ctrl+U clears the row, Backspace joins the row above. Each key only while what is
/// left is still the start of that line, so nothing the learner typed since is touched.
pub(super) fn clear_input(terminal: &Terminal, line: &str) {
	let squash = |text: &str| text.split_whitespace().collect::<String>();
	let line = squash(line);
	let deadline = Instant::now() + LINE_BACK;
	let mut cleared = false;
	while Instant::now() < deadline {
		std::thread::sleep(Duration::from_millis(30));
		let Some(input) = terminal.state().screen.input().map(|input| squash(&input)) else { continue };
		if !cleared {
			if input == line {
				let _ = terminal.write(b"\x15");
				cleared = true;
			}
			continue;
		}
		if input.is_empty() || !line.starts_with(&input) {
			return;
		}
		let _ = terminal.write(b"\x7f\x15");
	}
}

/// The agent's input box, as its own screen shows it.
fn input_of(terminal: &Terminal) -> Option<String> {
	let state = terminal.state();
	match terminal.agent {
		Agent::Claude => state.screen.input(),
		Agent::Codex => state.screen.codex_input(),
	}
}

/// Types the line and sends it only once the box reads exactly that line, so it never sends what
/// the learner had typed there: otherwise the line is taken out again. True when it was sent.
pub(super) fn type_line(terminal: &Terminal, line: &str) -> bool {
	let squash = |text: &str| text.split_whitespace().collect::<String>();
	if terminal.write(line.as_bytes()).is_err() {
		return false;
	}
	std::thread::sleep(Duration::from_millis(300));
	if input_of(terminal).is_some_and(|text| squash(&text) == squash(line)) {
		return terminal.write(b"\r").is_ok();
	}
	let _ = terminal.write("\x7f".repeat(line.chars().count()).as_bytes());
	false
}
