//! A terminal's screen as the shell keeps it, and what the shell recognises on it: a question
//! asked with a numbered menu, the folder trust question among those, a "Press Enter" line, and
//! a web address. Recognised by shape, since the agents reword their screens. Screen text is only
//! matched here, never run, logged or saved.

use std::time::{Duration, Instant};

use super::spawn::{COLS, ROWS};

const SCROLLBACK: usize = 1000;

/// A menu counts once it has stayed the same this long (an agent redraws while it starts).
pub const SETTLE: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Prompt {
	/// The folder trust question, with its "Yes" row highlighted.
	Trust,
	/// A "Press Enter" line.
	Enter,
	/// Any other numbered menu with a highlighted row.
	Menu,
}

impl Prompt {
	pub fn name(self) -> &'static str {
		match self {
			Prompt::Trust => "trust",
			Prompt::Enter => "enter",
			Prompt::Menu => "menu",
		}
	}
}

/// Answers to the questions a program asks its terminal. They cannot wait for the page: a hidden
/// terminal has no page, and Windows' console waits for the cursor position before it starts.
#[derive(Default)]
pub struct Replies(Vec<u8>);

impl vt100::Callbacks for Replies {
	fn unhandled_csi(&mut self, screen: &mut vt100::Screen, i1: Option<u8>, _: Option<u8>, params: &[&[u16]], c: char) {
		let first = params.first().and_then(|p| p.first()).copied().unwrap_or(0);
		match (i1, c, first) {
			(None, 'n', 6) => {
				let (row, col) = screen.cursor_position();
				self.0.extend(format!("\x1b[{};{}R", row + 1, col + 1).bytes());
			}
			(None, 'n', 5) => self.0.extend(b"\x1b[0n"),
			(None, 'c', 0) => self.0.extend(b"\x1b[?1;2c"),
			_ => {}
		}
	}
}

/// What the page's own terminal answers to the same questions; the shell already did.
pub fn is_reply(data: &str) -> bool {
	let Some(body) = data.strip_prefix("\x1b[") else { return false };
	let digits = |text: &str| !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit() || b == b';');
	match body.as_bytes().last() {
		Some(b'R') => body[..body.len() - 1].split_once(';').is_some_and(|(row, col)| digits(row) && digits(col)),
		Some(b'c') => body.strip_prefix('?').is_some_and(|rest| digits(&rest[..rest.len() - 1])),
		Some(b'n') => body == "0n",
		_ => false,
	}
}

pub struct Screen {
	parser: vt100::Parser<Replies>,
}

impl Default for Screen {
	fn default() -> Screen {
		let size = |n: u16| std::num::NonZeroU16::new(n).expect("a terminal has rows and columns");
		Screen { parser: vt100::Parser::new_with_callbacks(size(ROWS), size(COLS), SCROLLBACK, Replies::default()) }
	}
}

impl Screen {
	/// Draws the program's output; the answers it asked for, to write back to it.
	pub fn process(&mut self, bytes: &[u8]) -> Vec<u8> {
		self.parser.process(bytes);
		std::mem::take(&mut self.parser.callbacks_mut().0)
	}

	/// What redraws this screen in an empty terminal.
	pub fn snapshot(&self) -> String {
		self.parser.screen().state_formatted()
	}

	pub fn bracketed_paste(&self) -> bool {
		self.parser.screen().bracketed_paste()
	}

	pub fn seen(&self) -> Seen {
		seen(self.parser.screen())
	}

	#[cfg(test)]
	pub fn text(&self) -> String {
		self.parser.screen().contents()
	}
}

/// What the screen shows now. `menu` is the recognised question's rows, to tell whether it
/// stayed the same.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Seen {
	pub prompt: Option<Prompt>,
	pub menu: String,
	pub url: bool,
}

const POINTERS: [char; 6] = ['❯', '›', '>', '▶', '➤', '→'];

/// A menu row: "❯ 1. Yes, proceed". The number, whether the row is highlighted, and its text.
fn menu_row(screen: &vt100::Screen, row: u16, text: &str) -> Option<(u32, bool, String)> {
	let trimmed = text.trim_start();
	let pointed = trimmed.starts_with(POINTERS);
	let rest = if pointed { trimmed.trim_start_matches(POINTERS).trim_start() } else { trimmed };
	let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
	if !(1..=2).contains(&digits) {
		return None;
	}
	let after = rest[digits..].strip_prefix(['.', ')'])?;
	let label = after.strip_prefix(' ')?.trim();
	if label.is_empty() {
		return None;
	}
	let inverse = (0..COLS).filter_map(|col| screen.cell(row, col)).any(|cell| cell.inverse() && cell.has_contents());
	Some((rest[..digits].parse().ok()?, pointed || inverse, label.to_owned()))
}

/// A numbered menu, 1 up, at least two rows, exactly one highlighted: its rows and the
/// highlighted row's text.
fn menu(screen: &vt100::Screen, rows: &[String]) -> Option<(String, String)> {
	let found: Vec<(u32, bool, String)> = rows.iter().enumerate().filter_map(|(row, text)| menu_row(screen, row as u16, text)).collect();
	let start = found.iter().rposition(|(number, ..)| *number == 1)?;
	let items = &found[start..];
	let in_order = items.iter().enumerate().all(|(i, (number, ..))| *number as usize == i + 1);
	let highlighted: Vec<&String> = items.iter().filter(|(_, lit, _)| *lit).map(|(.., label)| label).collect();
	if items.len() < 2 || !in_order || highlighted.len() != 1 {
		return None;
	}
	let shown = items.iter().map(|(number, lit, label)| format!("{}{number}. {label}", if *lit { "> " } else { "" })).collect::<Vec<_>>().join("\n");
	Some((shown, highlighted[0].clone()))
}

/// "Press Enter" opening one of the last lines, or a sentence in it ("Login successful. Press
/// Enter to continue"); never mid-sentence, as in an agent's own words.
fn asks_for_enter(rows: &[String]) -> Option<String> {
	let last: Vec<&String> = rows.iter().rev().filter(|row| !row.trim().is_empty()).take(3).collect();
	last.into_iter().find(|row| {
		let lower = row.trim().trim_start_matches(|c: char| !c.is_alphanumeric()).to_lowercase();
		lower.starts_with("press enter") || [". ", "! "].iter().any(|end| lower.contains(&format!("{end}press enter")))
	}).map(|row| row.trim().to_owned())
}

fn seen(screen: &vt100::Screen) -> Seen {
	let rows: Vec<String> = screen.rows(0, COLS).collect();
	let url = rows.iter().any(|row| row.contains("https://") || row.contains("http://"));
	if let Some((shown, highlighted)) = menu(screen, &rows) {
		let trust = highlighted.starts_with("Yes") && rows.iter().any(|row| row.to_lowercase().contains("trust"));
		return Seen { prompt: Some(if trust { Prompt::Trust } else { Prompt::Menu }), menu: shown, url };
	}
	match asks_for_enter(&rows) {
		Some(line) => Seen { prompt: Some(Prompt::Enter), menu: line, url },
		None => Seen { prompt: None, menu: String::new(), url },
	}
}

/// Holds a question back until it has stayed the same for `SETTLE`.
#[derive(Default)]
pub struct Settle {
	seen: Seen,
	since: Option<Instant>,
}

impl Settle {
	pub fn update(&mut self, seen: Seen, now: Instant) {
		if seen.prompt != self.seen.prompt || seen.menu != self.seen.menu {
			self.since = Some(now);
		}
		self.seen = seen;
	}

	/// The question to show now, and whether the screen has a web address.
	pub fn shown(&self, now: Instant) -> (Option<Prompt>, bool) {
		let settled = self.since.is_some_and(|since| now.duration_since(since) >= SETTLE);
		(self.seen.prompt.filter(|_| settled), self.seen.url)
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The screen the lines draw, with `\x1b[7m` for a highlighted row as some menus do.
	fn screen(lines: &[&str]) -> Screen {
		let mut screen = Screen::default();
		screen.process(lines.join("\r\n").as_bytes());
		screen
	}

	fn prompt(lines: &[&str]) -> Option<Prompt> {
		screen(lines).seen().prompt
	}

	#[test]
	fn both_claude_code_trust_questions_and_codexs_are_the_trust_question() {
		let older = [" Do you trust the files in this folder?", "", " /Users/sam/godspeed", "", " ❯ 1. Yes, proceed", "   2. No, exit", "", " Enter to confirm · Esc to exit"];
		let newer = [" Quick safety check", " Is this a project you created or one you trust?", "", " ❯ 1. Yes, I trust this folder", "   2. No, exit"];
		let codex = ["> You are running Codex in /Users/sam/godspeed", "", "  Do you trust the contents of this directory? Working with untrusted contents comes with higher risk", "", "› 1. Yes, continue", "  2. No, quit", "", "  Press enter to continue"];
		for lines in [&older[..], &newer[..], &codex[..]] {
			assert_eq!(prompt(lines), Some(Prompt::Trust), "{lines:?}");
		}
		let highlighted_by_colour = [" Do you trust the files in this folder?", "\x1b[7m 1. Yes, proceed\x1b[0m", "   2. No, exit"];
		assert_eq!(prompt(&highlighted_by_colour), Some(Prompt::Trust));
	}

	#[test]
	fn a_menu_on_no_or_without_trust_is_only_a_menu() {
		assert_eq!(prompt(&[" Do you trust the files in this folder?", "   1. Yes, proceed", " ❯ 2. No, exit"]), Some(Prompt::Menu));
		let model = [" Select a model", "", " ❯ 1. Default (recommended)", "   2. Opus", "   3. Haiku"];
		assert_eq!(prompt(&model), Some(Prompt::Menu));
		assert_eq!(screen(&model).seen().menu, "> 1. Default (recommended)\n2. Opus\n3. Haiku");
	}

	#[test]
	fn a_press_enter_line_asks_for_enter() {
		assert_eq!(prompt(&[" Welcome to Claude Code", "", " Login successful. Press Enter to continue…"]), Some(Prompt::Enter));
		assert_eq!(prompt(&["Press Enter to continue"]), Some(Prompt::Enter));
	}

	#[test]
	fn lists_shell_prompts_and_words_about_enter_are_not_questions() {
		let answer = ["● Here is the plan:", "  1. Read the notes", "  2. Write the quiz", "  3. Mark it", "", "> "];
		let shell = ["sam@mac godspeed % ls", "1. notes.md  2. quiz.md", "sam@mac godspeed % "];
		let words = ["● Type your answer, then press Enter to send it.", "", "> "];
		let one_row = [" ❯ 1. Yes, proceed"];
		for lines in [&answer[..], &shell[..], &words[..], &one_row[..]] {
			assert_eq!(prompt(lines), None, "{lines:?}");
		}
	}

	#[test]
	fn a_web_address_on_the_screen_is_noticed() {
		assert!(screen(&["Browser didn't open? Use the url below to sign in:", "https://claude.ai/oauth/authorize?code=true"]).seen().url);
		assert!(!screen(&["Signing in…"]).seen().url);
	}

	#[test]
	fn a_question_shows_once_it_stayed_the_same_for_two_seconds() {
		let start = Instant::now();
		let mut settle = Settle::default();
		let menu = screen(&[" ❯ 1. Yes", "   2. No"]).seen();
		settle.update(menu.clone(), start);
		assert_eq!(settle.shown(start + Duration::from_millis(1900)), (None, false));
		settle.update(menu.clone(), start + Duration::from_millis(1900));
		assert_eq!(settle.shown(start + SETTLE), (Some(Prompt::Menu), false));
		let moved = screen(&["   1. Yes", " ❯ 2. No"]).seen();
		settle.update(moved, start + SETTLE);
		assert_eq!(settle.shown(start + SETTLE), (None, false), "a redrawn menu starts over");
		settle.update(Seen::default(), start + SETTLE * 3);
		assert_eq!(settle.shown(start + SETTLE * 4), (None, false));
	}

	#[test]
	fn the_shell_answers_the_terminal_questions_and_drops_the_pages_answers() {
		let mut screen = Screen::default();
		assert_eq!(screen.process(b"ab\x1b[6n"), b"\x1b[1;3R");
		assert_eq!(screen.process(b"\x1b[c\x1b[5n\x1b[>c"), b"\x1b[?1;2c\x1b[0n");
		for reply in ["\x1b[12;40R", "\x1b[?1;2c", "\x1b[?62;22c", "\x1b[0n"] {
			assert!(is_reply(reply), "{reply:?}");
		}
		for typed in ["\x1b[A", "\x1b", "a", "\x1b[R", "\x1b[200~x\x1b[201~", "\x1b[3n", "\x1b[;R"] {
			assert!(!is_reply(typed), "{typed:?}");
		}
	}
}
