//! The [Today] note: a hidden lesson message that tells the agent today's date, time and time
//! zone, then the space's open deadlines, the files added in the last few days (space info
//! apart, so the teacher knows it can read it), and the practice problems the learner needed
//! hints on lately. It is appended (never rewritten) right before the learner's message when the
//! lesson has none yet, the day changed, the part after the date changed, or a compaction cut
//! the last one out of the model's view.
//!
//! The time zone is the computer's (`TZ`), which is the only one the app ever passes.

use std::collections::HashMap;
use std::sync::LazyLock;

use gs_base::re::Re;
use gs_base::text::cmp16;
use gs_base::{locale, text, time};
use gs_json::Json;
use gs_json::js_text::num_text;

use super::new_files::{NEW_FILE_DAYS, is_recent};
use super::time_zone_names::generic_name;
use crate::contracts::space::{compare_deadlines, deadline_due_at};
use crate::messages::compaction_marks::{active_compaction_of, kept_index_for};
use crate::messages::native_messages::new_today_context_message;
use crate::study::progress::days_between;

/// Most file names on a Covers line before "and N more".
const MAX_COVERS: usize = 4;
/// Most new files listed by name.
const MAX_NEW_FILES: usize = 5;
/// Hinted problems from this many days back, at most MAX_HINTED of them.
const HINTED_DAYS: i64 = 14;
const MAX_HINTED: usize = 3;
/// A hinted problem's statement is cut to this many characters.
const HINTED_CHARS: usize = 140;

const WEEKDAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/// The wall clock in the computer's time zone.
#[derive(Debug, Clone, PartialEq)]
pub struct WallClock {
	/// YYYY-MM-DD
	pub day: String,
	/// HH:MM:SS, 24h
	pub time: String,
}

pub fn wall_clock(ms: i64) -> WallClock {
	let z = time::local(ms);
	WallClock { day: format!("{}-{:02}-{:02}", z.year(), z.month(), z.day()), time: format!("{:02}:{:02}:{:02}", z.hour(), z.minute(), z.second()) }
}

/// `wall_clock` of an ISO time, or `new Date(iso)`'s "Invalid time value" when it isn't one.
pub fn wall_clock_of_iso(iso: &str) -> Result<WallClock, String> {
	time::parse_date(iso).map(wall_clock).ok_or_else(|| "Invalid time value".to_owned())
}

/// "Pacific Time" for America/Los_Angeles; the IANA name when Intl has none.
pub fn time_zone_label() -> String {
	let zone = time::tz_name();
	generic_name(&zone).map_or(zone, str::to_owned)
}

/// `Number(text)` for the parts of a date or time.
fn number(part: Option<&str>) -> f64 {
	let Some(part) = part else { return f64::NAN };
	let trimmed = text::trim(part);
	match trimmed {
		"" => return 0.0,
		"Infinity" | "+Infinity" => return f64::INFINITY,
		"-Infinity" => return f64::NEG_INFINITY,
		_ => {}
	}
	for (prefix, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
		if let Some(digits) = trimmed.strip_prefix(prefix) {
			let values: Option<Vec<u32>> = digits.chars().map(|c| c.to_digit(radix)).collect();
			return values.filter(|v| !v.is_empty()).map_or(f64::NAN, |v| v.iter().fold(0.0, |n, &d| n * f64::from(radix) + f64::from(d)));
		}
	}
	// Rust also reads "inf" and "nan", which JavaScript does not.
	if !trimmed.chars().all(|c| c.is_ascii_digit() || matches!(c, '+' | '-' | '.' | 'e' | 'E')) {
		return f64::NAN;
	}
	trimmed.parse().unwrap_or(f64::NAN)
}

/// The weekday of `Date.UTC(y, m, d)`, None where V8 gives an invalid date (a part not finite,
/// a year or month beyond V8's range, or a time past 8.64e15 ms).
fn utc_weekday(y: f64, m: f64, d: f64) -> Option<&'static str> {
	if !(y.is_finite() && m.is_finite() && d.is_finite()) {
		return None;
	}
	// Date.UTC reads years 0 to 99 as 1900 to 1999.
	let year = if (0.0..=99.0).contains(&y.trunc()) { y.trunc() + 1900.0 } else { y.trunc() };
	let month = m.trunc();
	if !((-1e6..=1e6).contains(&year) && (-1e7..=1e7).contains(&month)) {
		return None;
	}
	let (year, month) = (year as i64, month as i64);
	let days = time::days_from_civil(year + month.div_euclid(12), month.rem_euclid(12) + 1, 1) as f64 + d.trunc() - 1.0;
	(days.abs() <= 1e8).then(|| WEEKDAYS[(days as i64 + 4).rem_euclid(7) as usize])
}

/// "Fri Oct 30" for 2026-10-30.
pub fn day_label(day: &str) -> String {
	let mut parts = day.split('-');
	let (y, m, d_part) = (number(parts.next()), number(parts.next()), parts.next());
	let d = number(d_part);
	let month = (m.fract() == 0.0 && (1.0..=12.0).contains(&m)).then(|| MONTHS[m as usize - 1]);
	// A missing part is `undefined` in the template, not NaN.
	let day_text = if d_part.is_none() { "undefined".to_owned() } else { num_text(d) };
	format!("{} {} {}", utc_weekday(y, m - 1.0, d).unwrap_or("undefined"), month.unwrap_or("undefined"), day_text)
}

/// The local calendar day of a moment, YYYY-MM-DD (the app runs on the learner's computer, so
/// local is the learner's day).
pub fn local_day(ms: i64) -> String {
	let z = time::local(ms);
	format!("{}-{:02}-{:02}", z.year(), z.month(), z.day())
}

/// "11:59 PM" for 23:59.
pub fn clock_label(time: &str) -> String {
	let mut parts = time.split(':');
	let (h, m) = (number(parts.next()), parts.next().map(|p| number(Some(p))));
	let hour12 = if h % 12.0 == 0.0 { 12.0 } else { h % 12.0 };
	let minutes = text::pad_start(&m.map_or_else(|| "undefined".to_owned(), num_text), 2, '0');
	format!("{}:{minutes} {}", num_text(hour12), if h < 12.0 { "AM" } else { "PM" })
}

/// "Fri Oct 30 11:59 PM", or just "Fri Oct 30" when the deadline has no time.
pub fn when_label(deadline: &Json) -> String {
	let day = day_label(deadline["date"].as_str().unwrap_or(""));
	match deadline["time"].as_str().filter(|t| !t.is_empty()) {
		Some(time) => format!("{day} {}", clock_label(time)),
		None => day,
	}
}

/// "today", "tomorrow" or "in 3 days".
pub fn relative_day(days: i64) -> String {
	match days {
		0 => "today".to_owned(),
		1 => "tomorrow".to_owned(),
		_ => format!("in {days} days"),
	}
}

/// An exam or interview happens at its time; the rest is due by it.
fn is_sitting(deadline: &Json) -> bool {
	matches!(deadline["kind"].as_str(), Some("exam" | "interview"))
}

fn covers_line(deadline: &Json, names: &HashMap<&str, &str>) -> Option<String> {
	let files: Vec<&str> = deadline["fileIds"].as_arr()?.iter().filter_map(|id| names.get(id.as_str()?).copied()).collect();
	if files.is_empty() {
		return None;
	}
	if files.len() <= MAX_COVERS {
		return Some(format!("  Covers: {}", files.join(", ")));
	}
	let shown = &files[..MAX_COVERS - 1];
	Some(format!("  Covers: {}, and {} more", shown.join(", "), files.len() - shown.len()))
}

/// The note's full text. `space` is the lesson's space as `{ deadlines, files, hinted? }` (None =
/// no space): files have `id`, `name`, `addedAt?` and `kind?`; hinted problems `statement` and
/// `at`.
pub fn today_note_text(now_ms: i64, space: Option<&Json>) -> String {
	let clock = wall_clock(now_ms);
	let year = clock.day.split('-').next().unwrap_or("");
	let head = format!("[Today] {} {year}, {} ({})", day_label(&clock.day), clock_label(&clock.time), time_zone_label());
	let empty = Vec::new();
	let list = |key: &str| space.and_then(|c| c[key].as_arr()).unwrap_or(&empty);
	let mut open: Vec<&Json> = list("deadlines").iter().filter(|d| !d["done"].truthy()).collect();
	open.sort_by(|a, b| compare_deadlines(a, b));
	let fresh = new_files_part(list("files"), now_ms);
	let hinted = hinted_part(list("hinted"), now_ms);
	if open.is_empty() {
		return [Some(head), fresh, hinted].into_iter().flatten().collect::<Vec<_>>().join("\n\n");
	}

	let now_stamp = format!("{}T{}", clock.day, clock.time);
	let due_stamp = |d: &Json| {
		let (date, time) = deadline_due_at(d);
		format!("{date}T{time}:00")
	};
	let (overdue, upcoming): (Vec<&Json>, Vec<&Json>) = open.into_iter().partition(|d| cmp16(&due_stamp(d), &now_stamp).is_lt());
	let names: HashMap<&str, &str> = list("files").iter().map(|f| (f["id"].as_str().unwrap_or(""), f["name"].as_str().unwrap_or(""))).collect();

	let mut lines = vec![head, String::new(), "Coming up in this space (not marked done):".to_owned()];
	let mut push = |line: String, d: &Json| {
		lines.push(line);
		if let Some(covers) = covers_line(d, &names) {
			lines.push(covers);
		}
	};
	let field = |d: &Json, key: &str| d[key].as_str().unwrap_or("").to_owned();
	for d in overdue {
		let due = if is_sitting(d) { "" } else { "due " };
		push(format!("- Overdue: {} ({}), was {due}{}", field(d, "name"), field(d, "kind"), when_label(d)), d);
	}
	for d in upcoming {
		let rel = relative_day(days_between(&clock.day, d["date"].as_str().unwrap_or("")));
		let due = if is_sitting(d) { "" } else { "due " };
		push(format!("- {} ({}), {due}{}, {rel}.", field(d, "name"), field(d, "kind"), when_label(d)), d);
	}
	if let Some(fresh) = fresh {
		lines.push(String::new());
		lines.push(fresh);
	}
	if let Some(hinted) = hinted {
		lines.push(String::new());
		lines.push(hinted);
	}
	lines.join("\n")
}

/// The practice problems the learner needed hints on lately, newest first; None when none.
fn hinted_part(hinted: &[Json], now_ms: i64) -> Option<String> {
	static SPACES: LazyLock<Re> = LazyLock::new(|| Re::new(r"\s+", "g"));
	let mut recent: Vec<&Json> =
		hinted.iter().filter(|h| h["at"].as_str().and_then(time::parse_date).is_some_and(|at| now_ms - at <= HINTED_DAYS * 86_400_000)).collect();
	recent.sort_by(|a, b| locale::compare(a["at"].as_str().unwrap_or(""), b["at"].as_str().unwrap_or("")).reverse());
	recent.truncate(MAX_HINTED);
	if recent.is_empty() {
		return None;
	}
	let short = |statement: &str| {
		let collapsed = SPACES.replace(statement, " ");
		let line = text::trim(&collapsed);
		if text::len16(line) <= HINTED_CHARS { line.to_owned() } else { format!("{}…", text::slice16(line, 0, Some(HINTED_CHARS as i64 - 1))) }
	};
	let mut lines = vec![format!("Practice problems the learner solved only with hints (last {HINTED_DAYS} days), worth coming back to:")];
	lines.extend(recent.iter().map(|h| {
		let day = h["at"].as_str().and_then(time::parse_date).map_or_else(String::new, |at| day_label(&wall_clock(at).day));
		format!("- \"{}\" ({day})", short(h["statement"].as_str().unwrap_or("")))
	}));
	Some(lines.join("\n"))
}

/// The new files, newest first: "New files (last 3 days): a, b, and 4 more" for study files,
/// then a space-info line the teacher may read; None when none.
fn new_files_part(files: &[Json], now_ms: i64) -> Option<String> {
	let added = |f: &Json| f["addedAt"].as_str().and_then(time::parse_date).unwrap_or(0);
	let mut fresh: Vec<&Json> = files.iter().filter(|f| is_recent(f["addedAt"].as_str(), now_ms)).collect();
	fresh.sort_by_key(|f| std::cmp::Reverse(added(f)));
	let list = |names: &[&str]| {
		if names.len() <= MAX_NEW_FILES { names.join(", ") } else { format!("{}, and {} more", names[..MAX_NEW_FILES].join(", "), names.len() - MAX_NEW_FILES) }
	};
	let names_of = |info: bool| -> Vec<&str> { fresh.iter().filter(|f| (f["kind"].as_str() == Some("info")) == info).map(|f| f["name"].as_str().unwrap_or("")).collect() };
	let (study, info) = (names_of(false), names_of(true));
	let mut lines = Vec::new();
	if !study.is_empty() {
		lines.push(format!("New files (last {NEW_FILE_DAYS} days): {}", list(&study)));
	}
	if !info.is_empty() {
		lines.push(format!("New space info (last {NEW_FILE_DAYS} days): {}. Read it when it might matter, like an exam change or an announcement.", list(&info)));
	}
	(!lines.is_empty()).then(|| lines.join("\n"))
}

/// Everything after the [Today] line: deadlines, new files and hinted problems ("" when none).
pub fn deadline_part_of(text: &str) -> &str {
	text.find('\n').map_or("", |at| &text[at + 1..])
}

/// The note to append before the learner's next message, or None when the last one still holds:
/// same local day, same deadline part, and still in the model's view (not cut by a compaction).
pub fn today_note_to_append(messages: &[Json], text: &str, day: &str) -> Option<Json> {
	let at = messages.iter().rposition(|m| m["role"].as_str() == Some("custom") && m["customType"].as_str() == Some("today-context"));
	if let Some(at) = at {
		let last = &messages[at];
		let kept = active_compaction_of(messages).and_then(|active| kept_index_for(messages, active));
		let in_view = kept.is_none_or(|k| k == 0 || at >= k);
		if in_view && last["details"]["day"].as_str() == Some(day) && deadline_part_of(last["content"].as_str().unwrap_or("")) == deadline_part_of(text) {
			return None;
		}
	}
	Some(new_today_context_message(text, day))
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	const NOON: i64 = 1_793_300_000_000;

	#[test]
	fn labels() {
		assert_eq!(day_label("2026-10-30"), "Fri Oct 30");
		assert_eq!(day_label("2026-13-30"), "Sat undefined 30");
		assert_eq!(day_label("junk"), "undefined undefined undefined");
		assert_eq!(day_label("2026-0.5-01"), "Thu undefined 1");
		assert_eq!(day_label("0x7EA-0b1010-1e1"), "Sat Oct 10");
		assert_eq!(day_label("Infinity-01-01"), "undefined Jan 1");
		assert_eq!(day_label("99999999999999999999-01-01"), "undefined Jan 1");
		assert_eq!(day_label("2026-01-99999999999"), "undefined Jan 99999999999");
		assert_eq!(clock_label("23:59"), "11:59 PM");
		assert_eq!(clock_label("00:05"), "12:05 AM");
		assert_eq!(clock_label("12:00:00"), "12:00 PM");
		assert_eq!(when_label(&json!({ "date": "2026-10-30" })), "Fri Oct 30");
		assert_eq!(when_label(&json!({ "date": "2026-10-30", "time": "09:30" })), "Fri Oct 30 9:30 AM");
	}

	#[test]
	fn the_note_lists_deadlines_and_new_files() {
		let now = time::parse_date("2026-10-30T12:00:00-07:00").unwrap();
		let space = json!({
			"deadlines": [
				{ "id": "d1", "name": "Midterm", "kind": "exam", "date": "2026-11-02", "fileIds": ["f1", "f2"] },
				{ "id": "d2", "name": "HW 1", "kind": "homework", "date": "2026-10-29", "time": "10:00", "fileIds": [] },
				{ "id": "d3", "name": "Done", "kind": "quiz", "date": "2026-10-31", "done": true, "fileIds": [] },
				{ "id": "d4", "name": "Larkspur onsite", "kind": "interview", "date": "2026-11-03", "time": "14:00", "fileIds": [] },
			],
			"files": [
				{ "id": "f1", "name": "L1.pdf", "addedAt": time::iso(now - 86_400_000), "kind": "study" },
				{ "id": "f2", "name": "L2.pdf", "addedAt": time::iso(now - 10 * 86_400_000), "kind": "study" },
				{ "id": "f3", "name": "Syllabus.pdf", "addedAt": time::iso(now - 3_600_000), "kind": "info" },
			],
		});
		let note = today_note_text(now, Some(&space));
		assert_eq!(
			note,
			"[Today] Fri Oct 30 2026, 12:00 PM (Pacific Time)\n\nComing up in this space (not marked done):\n- Overdue: HW 1 (homework), was due Thu Oct 29 10:00 AM\n- Midterm (exam), Mon Nov 2, in 3 days.\n  Covers: L1.pdf, L2.pdf\n- Larkspur onsite (interview), Tue Nov 3 2:00 PM, in 4 days.\n\nNew files (last 3 days): L1.pdf\nNew space info (last 3 days): Syllabus.pdf. Read it when it might matter, like an exam change or an announcement."
		);
		assert_eq!(today_note_text(now, None), "[Today] Fri Oct 30 2026, 12:00 PM (Pacific Time)");
	}

	#[test]
	fn a_note_is_appended_only_when_something_changed() {
		let text = "[Today] a\n\nrest";
		assert!(today_note_to_append(&[], text, "2026-10-30").is_some());
		let held = vec![new_today_context_message(text, "2026-10-30")];
		assert!(today_note_to_append(&held, text, "2026-10-30").is_none());
		assert!(today_note_to_append(&held, text, "2026-10-31").is_some());
		assert!(today_note_to_append(&held, "[Today] a\n\nother", "2026-10-30").is_some());
		assert_eq!(deadline_part_of("head"), "");
	}

	#[test]
	fn the_wall_clock_follows_the_time_zone() {
		let clock = wall_clock(NOON);
		assert_eq!(local_day(NOON), clock.day);
		assert_eq!(wall_clock_of_iso("nope"), Err("Invalid time value".to_owned()));
	}
}
