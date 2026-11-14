//! "Where you left off": part of godspeed's MCP instructions, built each time an agent connects,
//! so an agent started in any folder knows the learner's spaces, their unfinished setup, last
//! lessons, next deadlines and saved notes. It is trimmed to fit a length budget, least
//! important lines first.

use std::collections::HashMap;

use gs_base::{locale, text};
use gs_json::Json;

use super::space_setup::SETUP_HOW;
use super::today_note::{clock_label, day_label, today_note_text, wall_clock, wall_clock_of_iso, when_label};
use gs_base::text::cmp16;
use crate::contracts::space::{compare_deadlines, deadline_due_at};

const LAST_LESSONS: usize = 5;
const NEXT_DEADLINES: usize = 5;

pub struct BriefingSpace {
	pub id: String,
	pub name: String,
	pub closed: bool,
	pub deadlines: Vec<Json>,
	pub missing_setup: Vec<String>,
}

pub struct BriefingLesson {
	pub id: String,
	pub title: String,
	pub space_id: Option<String>,
	pub updated_at: String,
	pub waiting: bool,
}

pub struct BriefingInput {
	pub now_ms: i64,
	pub spaces: Vec<BriefingSpace>,
	pub lessons: Vec<BriefingLesson>,
	/// Agent notes: `id`, `text`, `spaceId?`, `createdAt`.
	pub notes: Vec<Json>,
	/// The longest the briefing may be: some clients cut the instructions it ends up in.
	pub max_chars: usize,
}

#[derive(Clone, Copy)]
enum Section {
	Lessons,
	Deadlines,
	Notes,
	Spaces,
	Setup,
}

impl Section {
	/// How many were left out, with its name in singular or plural.
	fn left_out(self, n: usize) -> String {
		let (one, many) = match self {
			Section::Lessons => ("lesson", "lessons"),
			Section::Deadlines => ("deadline", "deadlines"),
			Section::Notes => ("note", "notes"),
			Section::Spaces => ("space", "spaces"),
			Section::Setup => ("space's setup", "spaces' setup"),
		};
		format!("{n} {}", if n == 1 { one } else { many })
	}
}

/// The space's name when a space id is given and the space is known (an empty name counts as
/// none, as in JavaScript).
fn name_of<'a>(names: &HashMap<&'a str, &'a str>, space_id: Option<&str>) -> Option<&'a str> {
	space_id.and_then(|id| names.get(id).copied()).filter(|name| !name.is_empty())
}

/// Err is the error `new Date(iso)` raises for a time that isn't one.
pub fn agent_briefing(input: &BriefingInput) -> Result<String, String> {
	let BriefingInput { now_ms, spaces, lessons, notes, max_chars } = input;
	let names: HashMap<&str, &str> = spaces.iter().map(|c| (c.id.as_str(), c.name.as_str())).collect();
	let day = |iso: &str| wall_clock_of_iso(iso).map(|c| day_label(&c.day));
	let moment = |iso: &str| wall_clock_of_iso(iso).map(|c| format!("{} {}", day_label(&c.day), clock_label(&c.time)));

	let active: Vec<&BriefingSpace> = spaces.iter().filter(|c| !c.closed).collect();
	let space_lines: Vec<String> = active.iter().map(|c| format!("- {} (space_id \"{}\")", c.name, c.id)).collect();
	let setup_lines: Vec<String> =
		active.iter().filter(|c| !c.missing_setup.is_empty()).map(|c| format!("- {} (space_id \"{}\"): no {}", c.name, c.id, c.missing_setup.join(", no "))).collect();

	let mut recent: Vec<&BriefingLesson> = lessons.iter().collect();
	recent.sort_by(|a, b| locale::compare(&b.updated_at, &a.updated_at));
	let lesson_lines = recent
		.into_iter()
		.take(LAST_LESSONS)
		.map(|l| {
			let space = name_of(&names, l.space_id.as_deref()).unwrap_or("No space");
			let waiting = if l.waiting { ", waiting for the learner's answer" } else { "" };
			Ok(format!("- {} ({space}), last active {}, lesson_id \"{}\"{waiting}", l.title, moment(&l.updated_at)?, l.id))
		})
		.collect::<Result<Vec<String>, String>>()?;

	let clock = wall_clock(*now_ms);
	let now_stamp = format!("{}T{}", clock.day, clock.time);
	let mut open: Vec<(&Json, &str)> = active.iter().flat_map(|c| c.deadlines.iter().filter(|d| !d["done"].truthy()).map(|d| (d, c.name.as_str()))).collect();
	open.sort_by(|a, b| compare_deadlines(a.0, b.0));
	let deadline_lines: Vec<String> = open
		.into_iter()
		.take(NEXT_DEADLINES)
		.map(|(d, space_name)| {
			let (date, time) = deadline_due_at(d);
			let overdue = cmp16(&format!("{date}T{time}:00"), &now_stamp).is_lt();
			format!("- {space_name}: {} ({}), {} {}", d["name"].as_str().unwrap_or(""), d["kind"].as_str().unwrap_or(""), if overdue { "overdue, was due" } else { "due" }, when_label(d))
		})
		.collect();

	let note_lines = notes
		.iter()
		.map(|n| {
			let space = name_of(&names, n["spaceId"].as_str()).map_or_else(String::new, |c| format!("{c}, "));
			Ok(format!("- {} ({space}saved {}, note_id \"{}\")", n["text"].as_str().unwrap_or(""), day(n["createdAt"].as_str().unwrap_or(""))?, n["id"].as_str().unwrap_or("")))
		})
		.collect::<Result<Vec<String>, String>>()?;

	let now_text = today_note_text(*now_ms, None);
	let now_text = now_text.strip_prefix("[Today] ").unwrap_or(&now_text);
	let mut left = [0usize; 5];
	let render = |left: &[usize; 5]| {
		let [lessons_left, deadlines_left, notes_left, spaces_left, setup_left] = *left;
		let mut lines = vec!["## Where you left off".to_owned(), String::new(), format!("Now: {now_text}.")];
		let kept_setup = &setup_lines[..setup_lines.len() - setup_left];
		if !kept_setup.is_empty() {
			lines.push(String::new());
			lines.push("Space setup to finish (do this before calling wait_for_work):".to_owned());
			lines.extend(kept_setup.iter().cloned());
			lines.push(SETUP_HOW.to_owned());
		}
		let kept_spaces = &space_lines[..space_lines.len() - spaces_left];
		let section = |lines: &mut Vec<String>, title: &str, kept: &[String]| {
			lines.push(String::new());
			lines.push(title.to_owned());
			lines.extend(kept.iter().cloned());
		};
		if space_lines.is_empty() {
			lines.push(String::new());
			lines.push("Spaces: none yet.".to_owned());
		} else if !kept_spaces.is_empty() {
			section(&mut lines, "Spaces:", kept_spaces);
		}
		let kept_lessons = &lesson_lines[..lesson_lines.len() - lessons_left];
		if !kept_lessons.is_empty() {
			section(&mut lines, "Last lessons (newest first):", kept_lessons);
		}
		let kept_deadlines = &deadline_lines[..deadline_lines.len() - deadlines_left];
		if !kept_deadlines.is_empty() {
			section(&mut lines, "Next deadlines (not marked done):", kept_deadlines);
		}
		let kept_notes = &note_lines[notes_left.min(note_lines.len())..];
		if note_lines.is_empty() {
			lines.push(String::new());
			lines.push("Notes saved with remember: none yet.".to_owned());
		} else if !kept_notes.is_empty() {
			section(&mut lines, "Notes saved with remember (oldest first):", kept_notes);
		}
		let sections = [Section::Lessons, Section::Deadlines, Section::Notes, Section::Spaces, Section::Setup];
		let cut: Vec<String> = sections.iter().zip(left.iter().copied()).filter(|(_, n)| *n > 0).map(|(s, n)| s.left_out(n)).collect();
		if !cut.is_empty() {
			lines.push(String::new());
			lines.push(format!("Left out to fit: {}. Use list_lessons / read_space for lessons and deadlines.", cut.join(", ")));
		}
		lines.join("\n")
	};

	// Lessons and deadlines go first: list_lessons and read_space bring them back, while notes
	// live only here. Spaces go only when nothing else is left, and unfinished setup after
	// them: the agent should act on it first.
	let drop_order = [
		(0, lesson_lines.len()),
		(1, deadline_lines.len()),
		(2, note_lines.len()),
		(3, space_lines.len()),
		(4, setup_lines.len()),
	]
	.into_iter()
	.flat_map(|(section, n)| std::iter::repeat_n(section, n));
	let mut out = render(&left);
	for section in drop_order {
		if text::len16(&out) <= *max_chars {
			break;
		}
		left[section] += 1;
		out = render(&left);
	}
	Ok(out)
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn input(max_chars: usize) -> BriefingInput {
		let now_ms = gs_base::time::parse_date("2026-10-30T12:00:00-07:00").unwrap();
		BriefingInput {
			now_ms,
			spaces: vec![
				BriefingSpace {
					id: "cls_a".into(),
					name: "CSE 21".into(),
					closed: false,
					deadlines: vec![json!({ "id": "d", "name": "Midterm", "kind": "exam", "date": "2026-11-02", "fileIds": [] })],
					missing_setup: vec!["icon".into(), "signature".into()],
				},
				BriefingSpace { id: "cls_b".into(), name: "Old".into(), closed: true, deadlines: vec![], missing_setup: vec![] },
			],
			lessons: vec![
				BriefingLesson { id: "l1".into(), title: "Sets".into(), space_id: Some("cls_a".into()), updated_at: "2026-10-29T20:00:00.000Z".into(), waiting: true },
				BriefingLesson { id: "l2".into(), title: "Free talk".into(), space_id: None, updated_at: "2026-10-28T20:00:00.000Z".into(), waiting: false },
			],
			notes: vec![json!({ "id": "n1", "text": "Prefers short answers", "spaceId": "cls_a", "createdAt": "2026-10-27T20:00:00.000Z" })],
			max_chars,
		}
	}

	#[test]
	fn the_whole_briefing_fits_when_there_is_room() {
		let text = agent_briefing(&input(10_000)).unwrap();
		assert!(text.starts_with("## Where you left off\n\nNow: Fri Oct 30 2026, 12:00 PM (Pacific Time).\n\nSpace setup to finish"));
		assert!(text.contains("- CSE 21 (space_id \"cls_a\"): no icon, no signature\n"));
		assert!(text.contains("- Sets (CSE 21), last active Thu Oct 29 1:00 PM, lesson_id \"l1\", waiting for the learner's answer\n"));
		assert!(text.contains("- Free talk (No space), last active"));
		assert!(text.contains("- CSE 21: Midterm (exam), due Mon Nov 2\n"));
		assert!(text.ends_with("- Prefers short answers (CSE 21, saved Tue Oct 27, note_id \"n1\")"));
	}

	#[test]
	fn lines_are_left_out_least_important_first() {
		let full = agent_briefing(&input(10_000)).unwrap();
		let text = agent_briefing(&input(text::len16(&full) - 5)).unwrap();
		assert!(text.contains("Left out to fit: "), "{text}");
		assert!(!text.contains("lesson_id \"l2\"") && text.contains("note_id \"n1\""));
	}

	#[test]
	fn a_bad_time_is_an_error() {
		let mut bad = input(10_000);
		bad.lessons[0].updated_at = "soon".into();
		assert_eq!(agent_briefing(&bad), Err("Invalid time value".to_owned()));
	}
}
