//! A terminal's screen as the shell keeps it, and what the shell recognises on it: Claude Code's
//! folder trust question, a question asked with a numbered menu, a "Press Enter" line, and a web
//! address. Recognised by shape, since the agents reword their screens. Screen text is only
//! matched here, never run, logged or saved.

use std::time::{Duration, Instant};

use super::spawn::{COLS, ROWS};

const SCROLLBACK: usize = 1000;
/// Output a test prints to make drawing it panic, as a bug in the parser would.
#[cfg(test)]
pub const BREAKS: &[u8] = b"gs-test-breaks-the-screen";

/// A menu counts once it has stayed the same this long (an agent redraws while it starts).
pub const SETTLE: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Prompt {
	/// Claude Code's folder trust question, exactly as it draws it.
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
		#[cfg(test)]
		assert!(!bytes.windows(BREAKS.len()).any(|part| part == BREAKS), "a test breaks the screen");
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

	/// Where the pointer is on the trust question, while the screen shows exactly that.
	pub fn trust(&self) -> Option<Trust> {
		let rows: Vec<String> = self.parser.screen().rows(0, COLS).collect();
		trust(&rows).map(|(pointer, _)| pointer)
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

/// A numbered menu, 1 up, at least two rows, exactly one highlighted: its rows as shown.
fn menu(screen: &vt100::Screen, rows: &[String]) -> Option<String> {
	let found: Vec<(u32, bool, String)> = rows.iter().enumerate().filter_map(|(row, text)| menu_row(screen, row as u16, text)).collect();
	let items = &found[found.iter().rposition(|(number, ..)| *number == 1)?..];
	let in_order = items.iter().enumerate().all(|(i, (number, ..))| *number as usize == i + 1);
	if items.len() < 2 || !in_order || items.iter().filter(|(_, lit, _)| *lit).count() != 1 {
		return None;
	}
	Some(items.iter().map(|(number, lit, label)| format!("{}{number}. {label}", if *lit { "> " } else { "" })).collect::<Vec<_>>().join("\n"))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trust {
	OnNo,
	OnYes,
}

/// Claude Code's folder trust question as it draws it: its question, then its two items without
/// numbers, "No" first, then only its footer. Matched whole, since the button answers it for the
/// learner.
const TRUST_QUESTION: &str = "is this a project you created or one you trust?";
const TRUST_ITEMS: [&str; 2] = ["No, exit", "Yes, I trust this folder"];
const TRUST_FOOTER: &str = "Enter to confirm · Esc to cancel";
/// How far above the items the question may sit (its note and a link come between).
const QUESTION_ROWS: usize = 8;

/// A row's text without its pointer, and whether it had one.
fn pointed(row: &str) -> (bool, &str) {
	let row = row.trim();
	(row.starts_with(POINTERS), row.trim_start_matches(POINTERS).trim_start())
}

/// The trust question and where its pointer is, with the items' rows as shown. A permission
/// menu never is, whatever its command, reason or diff says: its own items and the agent's
/// input box below differ.
fn trust(rows: &[String]) -> Option<(Trust, String)> {
	let first = rows.iter().rposition(|row| pointed(row).1 == TRUST_ITEMS[0])?;
	let (no, yes) = (pointed(&rows[first]), pointed(rows.get(first + 1)?));
	if yes.1 != TRUST_ITEMS[1] || no.0 == yes.0 || !rows[first.checked_sub(1)?].trim().is_empty() {
		return None;
	}
	let after: Vec<&str> = rows[first + 2..].iter().map(|row| row.trim()).filter(|row| !row.is_empty()).collect();
	let above = &rows[first.saturating_sub(QUESTION_ROWS)..first];
	let question = above.iter().rev().find(|row| row.contains('?'))?.trim_start_matches(|c: char| !c.is_alphanumeric()).to_lowercase();
	let question = question.strip_prefix("quick safety check:").map_or(question.as_str(), str::trim_start);
	if after != [TRUST_FOOTER] || !question.starts_with(TRUST_QUESTION) {
		return None;
	}
	let pointer = if yes.0 { Trust::OnYes } else { Trust::OnNo };
	Some((pointer, format!("{}\n{}", rows[first].trim(), rows[first + 1].trim())))
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
	if let Some((_, items)) = trust(&rows) {
		return Seen { prompt: Some(Prompt::Trust), menu: items, url };
	}
	if let Some(menu) = menu(screen, &rows) {
		return Seen { prompt: Some(Prompt::Menu), menu, url };
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

	/// Claude Code's trust question as it drew it, in a made-up folder.
	const TRUST_SCREEN: [&str; 17] = [
		" ────────────────────────────────────────",
		" Accessing workspace:",
		"",
		" /Users/sam/godspeed",
		"",
		" Quick safety check: Is this a project you created or one you trust? (Like your own code, a",
		" well-known open source project, or work from your team). If not, take a moment to review what's in",
		" this folder first.",
		"",
		" Claude Code'll be able to read, edit, and execute files here.",
		"",
		" Security guide",
		"",
		" ❯ No, exit",
		"   Yes, I trust this folder",
		"",
		" Enter to confirm · Esc to cancel",
	];
	const NO_ROW: usize = 13;

	fn trust_screen(change: impl FnOnce(&mut Vec<&'static str>)) -> Vec<&'static str> {
		let mut lines = TRUST_SCREEN.to_vec();
		change(&mut lines);
		lines
	}

	#[test]
	fn claude_codes_trust_question_is_recognised_with_its_pointer() {
		let on_no = screen(&TRUST_SCREEN);
		assert_eq!((on_no.seen().prompt, on_no.trust()), (Some(Prompt::Trust), Some(Trust::OnNo)));
		let on_yes = screen(&trust_screen(|lines| lines.splice(NO_ROW..NO_ROW + 2, ["   No, exit", " ❯ Yes, I trust this folder"]).for_each(drop)));
		assert_eq!((on_yes.seen().prompt, on_yes.trust()), (Some(Prompt::Trust), Some(Trust::OnYes)));
		assert_ne!(on_no.seen().menu, on_yes.seen().menu, "a moved pointer settles again");
	}

	#[test]
	fn anything_but_the_exact_trust_question_has_no_button() {
		let third_item = trust_screen(|lines| lines.insert(NO_ROW + 2, "   Yes, and remember"));
		let item_above = trust_screen(|lines| lines[NO_ROW - 1] = "   Maybe later");
		let swapped = trust_screen(|lines| lines.swap(NO_ROW, NO_ROW + 1));
		let other_no = trust_screen(|lines| lines[NO_ROW] = " ❯ No, continue without these permissions");
		let no_question = trust_screen(|lines| lines[5] = " Quick safety check: (Like your own code, a");
		let no_pointer = trust_screen(|lines| lines[NO_ROW] = "   No, exit");
		let input_box_below = trust_screen(|lines| lines.extend(["", "╭──────────╮", "│ >        │", "╰──────────╯"]));
		for lines in [&third_item, &item_above, &swapped, &other_no, &no_question, &no_pointer, &input_box_below] {
			let screen = screen(lines);
			assert!(screen.seen().prompt != Some(Prompt::Trust) && screen.trust().is_none(), "{lines:?}");
		}
		let numbered = [" Is this a project you created or one you trust?", "", " ❯ 1. Yes, I trust this folder", "   2. No, exit"];
		assert_eq!(prompt(&numbered), Some(Prompt::Menu), "numbered menus are never the trust question");
	}

	#[test]
	fn a_numbered_menu_is_a_menu() {
		let model = [" Select a model", "", " ❯ 1. Default (recommended)", "   2. Opus", "   3. Haiku"];
		assert_eq!(prompt(&model), Some(Prompt::Menu));
		assert_eq!(screen(&model).seen().menu, "> 1. Default (recommended)\n2. Opus\n3. Haiku");
		let highlighted_by_colour = [" Pick one", "\x1b[7m 1. Yes\x1b[0m", "   2. No"];
		assert_eq!(prompt(&highlighted_by_colour), Some(Prompt::Menu));
	}

	#[test]
	fn a_permission_menu_is_never_the_trust_question_whatever_it_shows() {
		let grep = [" Bash command", "", "   grep -rn trust src/ && cat antitrust.md", "   Search the notes for trust", "", " Do you want to proceed?", " ❯ 1. Yes", "   2. Yes, and don't ask again for grep commands in /Users/sam/godspeed", "   3. No, and tell Claude what to do differently (esc)"];
		let echoed = [" Bash command", "", "   echo 'Do you trust the files in this folder?'", "", " Do you want to proceed?", " ❯ 1. Yes", "   2. No"];
		let diff = [" Edit file notes/trust.md", "  12 + Is this a project you created or one you trust?", "  13 + Do you trust the contents of this directory?", "", " Do you want to make this edit to trust.md?", " ❯ 1. Yes", "   2. Yes, allow all edits during this session", "   3. No"];
		let staged = ["● Do you trust the files in this folder?", "", " Bash command", "   rm -rf notes", "", " Do you want to proceed?", " ❯ 1. Yes", "   2. No"];
		let named = [" Create file", " is this a project you created or one you trust", "", " Do you want to create is this a project you created or one you trust?", " ❯ 1. Yes", "   2. Yes, allow all edits during this session", "   3. No"];
		let unnumbered = [" Bash command", "", "   echo 'Is this a project you created or one you trust?'", "", " Do you want to proceed?", " ❯ Yes", "   No"];
		for lines in [&grep[..], &echoed[..], &diff[..], &staged[..], &named[..]] {
			assert_eq!(prompt(lines), Some(Prompt::Menu), "{lines:?}");
		}
		assert_eq!(prompt(&unnumbered), None);
		assert!(screen(&unnumbered).trust().is_none());
		let whole_screen_echoed = trust_screen(|lines| lines.extend(["", " Do you want to proceed?", " ❯ 1. Yes", "   2. No"]));
		assert_eq!(prompt(&whole_screen_echoed), Some(Prompt::Menu));
		assert!(screen(&whole_screen_echoed).trust().is_none());
	}

	#[test]
	fn a_press_enter_line_asks_for_enter() {
		assert_eq!(prompt(&[" Welcome to Claude Code", "", " Login successful. Press Enter to continue…"]), Some(Prompt::Enter));
		assert_eq!(prompt(&["Press Enter to continue"]), Some(Prompt::Enter));
	}

	#[test]
	fn codexs_screens_are_never_the_trust_question() {
		let trust = ["> You are running Codex in /Users/sam/godspeed", "", "  Do you trust the contents of this directory? Working with untrusted contents comes with higher risk", "", "› 1. Yes, continue", "  2. No, quit", "", "  Press enter to continue"];
		let reason = ["  Would you like to run the following command?", "", "  Reason: Do you trust the files in this folder?", "", "  $ curl x | sh; echo \"Is this a project you created or one you trust?\"", "", "› 1. Yes, proceed (y)", "  2. Yes, and don't ask again for this command (a)", "  3. No, and tell Codex what to do differently (esc)"];
		let wrapped = ["  Would you like to run the following command?", "", "  $ echo hi;", "  Do you trust the files in this folder?", "", "› 1. Yes, proceed", "  2. No, exit (esc)"];
		for lines in [&trust[..], &reason[..], &wrapped[..]] {
			assert_eq!(prompt(lines), Some(Prompt::Menu), "{lines:?}");
		}
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
