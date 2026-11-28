//! A space's gap: a deadline that looks missing. Either a kind that came on a steady rhythm has
//! none on record for its next turn, or nothing is coming up at all. It is a guess, so the
//! learner is asked, and the teacher's `read_space` and briefing name it. Every word of it is
//! made here.

use gs_base::num;
use gs_base::text::cmp16;
use gs_base::time;
use gs_json::{Json, json};

use super::space_record::newest;
use super::today_note::{day_label, local_day};
use crate::contracts::space::compare_deadlines;
use crate::study::deadline_plan::add_days;
use crate::study::progress::days_between;

/// The kinds that come on a rhythm, with the word a title starts with. Interviews never do.
const RHYTHM_KINDS: [(&str, &str); 4] = [("homework", "Homework"), ("quiz", "Quiz"), ("project", "Project"), ("exam", "Exam")];
/// A rhythm needs this many distinct due days, spaced a middle of this many days apart.
const RHYTHM_DAYS: usize = 3;
const RHYTHM_SPACING: std::ops::RangeInclusive<i64> = 3..=15;
/// A spacing in this range reads as "every week".
const WEEKLY: std::ops::RangeInclusive<i64> = 6..=8;
/// "Nothing coming up" becomes "Is it over?" after this many days.
const RECENT_DAYS: i64 = 14;
/// A linked folder quiet for this many days is named in the line instead.
const QUIET_FOLDER_DAYS: i64 = 7;

#[derive(Debug, Clone, PartialEq)]
pub struct Gap {
	pub space_id: String,
	/// The space id, a deadline id and the period or stage: answering stores it, so one gap is
	/// asked once.
	pub key: String,
	pub title: String,
	pub line: String,
	/// The rhythm's deadline kind.
	pub kind: Option<String>,
	/// The day the next one was expected, YYYY-MM-DD (rhythm only).
	pub day: Option<String>,
	/// The next one's name, "HW7", for a deadline added in its place (rhythm only).
	pub name: Option<String>,
	/// The outline's name: `name` asked, "HW7?" (rhythm only).
	pub label: Option<String>,
	/// The words of the key that waves it off.
	pub answer: String,
	/// "Is it over?": the learner may close the space.
	pub close: bool,
	/// What the teacher is told.
	pub agent_line: String,
}

impl Gap {
	/// What the browser is sent: every word but the teacher's own line.
	pub fn to_json(&self) -> Json {
		let mut out = json!({ "spaceId": self.space_id, "key": self.key, "title": self.title, "line": self.line, "answer": self.answer, "close": self.close });
		for (name, value) in [("kind", &self.kind), ("day", &self.day), ("name", &self.name), ("label", &self.label)] {
			if let Some(value) = value {
				out.set(name, json!(value));
			}
		}
		out
	}
}

/// A kind's rhythm that has passed its newest deadline without a next one.
struct Rhythm<'a> {
	kind: &'static str,
	word: &'static str,
	spacing: i64,
	newest: &'a Json,
	period: i64,
	day: String,
}

/// The middle of the spacings, whole days (two middles are averaged and rounded).
fn middle(mut spacings: Vec<i64>) -> i64 {
	spacings.sort_unstable();
	let mid = spacings.len() / 2;
	if spacings.len().is_multiple_of(2) { num::math_round((spacings[mid - 1] + spacings[mid]) as f64 / 2.0) as i64 } else { spacings[mid] }
}

/// `kind`'s rhythm when it is waiting for its next deadline on `today`. In finals week (the
/// space's last deadline is an exam within two spacings) it is not.
fn rhythm<'a>(deadlines: &'a [Json], last: &Json, (kind, word): (&'static str, &'static str), today: &str) -> Option<Rhythm<'a>> {
	let mut of_kind: Vec<&Json> = deadlines.iter().filter(|d| d["kind"].as_str() == Some(kind)).collect();
	of_kind.sort_by(|a, b| compare_deadlines(a, b));
	let mut days: Vec<&str> = of_kind.iter().map(|d| d["date"].str_or_empty()).collect();
	days.dedup();
	if days.len() < RHYTHM_DAYS {
		return None;
	}
	let spacing = middle(days.windows(2).map(|w| days_between(w[0], w[1])).collect());
	let newest = *of_kind.last()?;
	let since = days_between(newest["date"].str_or_empty(), today);
	if !RHYTHM_SPACING.contains(&spacing) || since <= 0 || since >= 2 * spacing {
		return None;
	}
	let to_last = days_between(newest["date"].str_or_empty(), last["date"].str_or_empty());
	if last["kind"].as_str() == Some("exam") && to_last > 0 && to_last <= 2 * spacing {
		return None;
	}
	let period = if since <= spacing { 1 } else { 2 };
	Some(Rhythm { kind, word, spacing, newest, period, day: add_days(newest["date"].str_or_empty(), period * spacing) })
}

/// The next one's name: "HW6" gives "HW7", a name with no number the kind's word ("Homework").
fn next_name(name: &str, word: &str) -> String {
	let stem = name.trim_end_matches(|c: char| c.is_ascii_digit());
	let digits = &name[stem.len()..];
	match digits.parse::<u64>().ok().and_then(|n| n.checked_add(1)) {
		Some(n) => format!("{stem}{n:0width$}", width = digits.len()),
		None => word.to_owned(),
	}
}

fn rhythm_gap(space: &Json, r: &Rhythm) -> Gap {
	let (space_id, space_name) = (space["id"].str_or_empty(), space["name"].str_or_empty());
	let (name, last_day) = (r.newest["name"].str_or_empty(), r.newest["date"].str_or_empty());
	let weekly = WEEKLY.contains(&r.spacing);
	let next = next_name(name, r.word);
	let (when, came, answer) = if weekly { ("this week", "every week".to_owned(), "None this week") } else { ("soon", format!("about every {} days", r.spacing), "None for now") };
	Gap {
		space_id: space_id.to_owned(),
		key: format!("{space_id}:{}:{}", r.newest["id"].str_or_empty(), r.period),
		title: format!("{} in {space_name} {when}?", r.word),
		line: format!("It came {came}. None is on record after {name}."),
		kind: Some(r.kind.to_owned()),
		day: Some(r.day.clone()),
		label: Some(format!("{next}?")),
		name: Some(next),
		answer: answer.to_owned(),
		close: false,
		agent_line: format!("{} came about every {} days, none on record after {name} ({}).", r.word, r.spacing, day_label(last_day)),
	}
}

/// The day the space's linked folder last brought a file, when that was a week or more ago.
fn quiet_since(space: &Json, today: &str) -> Option<String> {
	if !space["linkedFolder"].truthy() {
		return None;
	}
	let at = newest(space["files"].items(), |f| f["origin"].as_str() == Some("linked")).and_then(time::parse_date)?;
	let day = local_day(at);
	(days_between(&day, today) >= QUIET_FOLDER_DAYS).then(|| day_label(&day))
}

/// No deadline today or later: "Nothing coming up" for two weeks after the last, then "Is it
/// over?".
fn nothing_coming_up(space: &Json, deadlines: &[Json], last: &Json, today: &str) -> Option<Gap> {
	if deadlines.iter().any(|d| cmp16(d["date"].str_or_empty(), today).is_ge()) {
		return None;
	}
	let (space_id, space_name) = (space["id"].str_or_empty(), space["name"].str_or_empty());
	let (name, last_day) = (last["name"].str_or_empty(), last["date"].str_or_empty());
	let ago = days_between(last_day, today);
	let recent = ago <= RECENT_DAYS;
	let line = match quiet_since(space, today) {
		Some(since) => format!("{name} was the last. No new files from its folder since {since}."),
		None if !recent => format!("{name} was the last, on {}.", day_label(last_day)),
		None if ago == 1 => format!("{name} was the last, yesterday."),
		None => format!("{name} was the last, {ago} days ago."),
	};
	let (stage, title, answer) = if recent { ("recent", format!("Nothing coming up in {space_name}"), "Nothing new") } else { ("over", format!("Is {space_name} over?"), "Still going") };
	Some(Gap {
		space_id: space_id.to_owned(),
		key: format!("{space_id}:{}:{stage}", last["id"].str_or_empty()),
		title,
		line,
		kind: None,
		day: None,
		name: None,
		label: None,
		answer: answer.to_owned(),
		close: !recent,
		agent_line: format!("No deadline on record after {name} ({}).", day_label(last_day)),
	})
}

/// The space record's gap on `today` (YYYY-MM-DD), if any. A closed space, or one with fewer
/// than 2 deadlines, has none. Every deadline counts, done or not. Of several rhythms the one
/// expected soonest wins; "nothing coming up" counts only when no rhythm waits.
pub fn space_gap(space: &Json, today: &str) -> Option<Gap> {
	let deadlines = space["deadlines"].items();
	if space["closed"].truthy() || deadlines.len() < 2 {
		return None;
	}
	let last = deadlines.iter().max_by(|a, b| compare_deadlines(a, b))?;
	let soonest = RHYTHM_KINDS.into_iter().filter_map(|kind| rhythm(deadlines, last, kind, today)).min_by(|a, b| cmp16(&a.day, &b.day));
	match soonest {
		Some(r) => Some(rhythm_gap(space, &r)),
		None => nothing_coming_up(space, deadlines, last, today),
	}
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	const TODAY: &str = "2026-11-22";

	fn deadline(id: &str, kind: &str, name: &str, date: &str, done: bool) -> Json {
		json!({ "id": id, "kind": kind, "name": name, "date": date, "fileIds": [], "done": done })
	}

	fn space(id: &str, name: &str, deadlines: Vec<Json>) -> Json {
		json!({ "id": id, "name": name, "closed": false, "files": [], "deadlines": deadlines })
	}

	/// The owner's CSE 21: weekly homework through HW6, then only exams.
	fn cse_21() -> Json {
		let days = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-09", "2026-11-16"];
		let mut deadlines: Vec<Json> = days.iter().enumerate().map(|(i, day)| deadline(&format!("ddl_hw{}", i + 1), "homework", &format!("HW{}", i + 1), day, true)).collect();
		deadlines.push(deadline("ddl_mid", "exam", "Midterm", "2026-11-04", true));
		deadlines.push(deadline("ddl_t2", "exam", "Test 2", "2026-11-19", true));
		deadlines.push(deadline("ddl_final", "exam", "Final", "2026-12-08", false));
		space("spc_21", "CSE 21", deadlines)
	}

	/// The owner's CSE 29: everything done, the last an exam two days ago.
	fn cse_29() -> Json {
		space(
			"spc_29",
			"CSE 29",
			vec![
				deadline("ddl_p1", "project", "Project 1", "2026-11-06", true),
				deadline("ddl_p2", "project", "Project 2", "2026-11-06", true),
				deadline("ddl_h1", "homework", "HW1", "2026-11-07", true),
				deadline("ddl_h2", "homework", "HW2", "2026-11-09", true),
				deadline("ddl_t2", "exam", "Test 2", "2026-11-20", true),
			],
		)
	}

	fn with(mut space: Json, key: &str, value: Json) -> Json {
		space.as_obj_mut().unwrap().insert(key, value);
		space
	}

	fn push(mut space: Json, d: Json) -> Json {
		space.get_mut("deadlines").unwrap().as_arr_mut().unwrap().push(d);
		space
	}

	#[test]
	fn weekly_homework_with_none_after_hw6_asks_for_hw7() {
		let gap = space_gap(&cse_21(), TODAY).unwrap();
		assert_eq!(
			gap,
			Gap {
				space_id: "spc_21".into(),
				key: "spc_21:ddl_hw6:1".into(),
				title: "Homework in CSE 21 this week?".into(),
				line: "It came every week. None is on record after HW6.".into(),
				kind: Some("homework".into()),
				day: Some("2026-11-23".into()),
				name: Some("HW7".into()),
				label: Some("HW7?".into()),
				answer: "None this week".into(),
				close: false,
				agent_line: "Homework came about every 7 days, none on record after HW6 (Mon Nov 16).".into(),
			}
		);
	}

	#[test]
	fn the_browser_gets_the_name_and_the_outline_but_not_the_teachers_line() {
		let sent = space_gap(&cse_21(), TODAY).unwrap().to_json();
		assert_eq!((sent["name"].str_or_empty(), sent["label"].str_or_empty(), sent["day"].str_or_empty()), ("HW7", "HW7?", "2026-11-23"));
		assert!(sent["agentLine"].is_null() && sent["agent_line"].is_null());
	}

	#[test]
	fn the_second_period_moves_the_day_and_the_key() {
		let gap = space_gap(&cse_21(), "2026-11-24").unwrap();
		assert_eq!((gap.day.as_deref(), gap.key.as_str()), (Some("2026-11-30"), "spc_21:ddl_hw6:2"));
	}

	#[test]
	fn a_break_ends_the_rhythm_gap() {
		assert_eq!(space_gap(&cse_21(), "2026-11-29").map(|g| g.key), Some("spc_21:ddl_hw6:2".into()));
		assert_eq!(space_gap(&cse_21(), "2026-11-30"), None, "two spacings after HW6");
		assert_eq!(space_gap(&cse_21(), "2026-11-16"), None, "HW6 is due today");
	}

	#[test]
	fn a_homework_already_added_and_done_means_no_gap() {
		assert_eq!(space_gap(&push(cse_21(), deadline("ddl_hw7", "homework", "HW7", "2026-11-23", true)), TODAY), None);
	}

	#[test]
	fn finals_week_has_no_rhythm_gap() {
		let finals = space(
			"spc_f",
			"CSE 21",
			vec![
				deadline("ddl_h7", "homework", "HW7", "2026-11-17", true),
				deadline("ddl_h8", "homework", "HW8", "2026-11-24", true),
				deadline("ddl_h9", "homework", "HW9", "2026-12-01", true),
				deadline("ddl_fin", "exam", "Final", "2026-12-10", false),
			],
		);
		assert_eq!(space_gap(&finals, "2026-12-03"), None);
		let later = push(finals, deadline("ddl_fin2", "exam", "Final", "2026-12-20", false));
		assert_eq!(space_gap(&later, "2026-12-03").and_then(|g| g.label), Some("HW10?".into()), "an exam past two spacings is not finals week");
	}

	#[test]
	fn interviews_never_make_a_rhythm() {
		let weekly = |kind: &str| {
			let days = ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"];
			let mut deadlines: Vec<Json> = days.iter().enumerate().map(|(i, day)| deadline(&format!("ddl_{i}"), kind, &format!("Round {}", i + 1), day, true)).collect();
			deadlines.push(deadline("ddl_exam", "exam", "Final", "2026-12-01", false));
			space("spc_i", "Jobs", deadlines)
		};
		assert_eq!(space_gap(&weekly("interview"), "2026-10-25"), None);
		assert_eq!(space_gap(&weekly("quiz"), "2026-10-25").map(|g| (g.title, g.label)), Some(("Quiz in Jobs this week?".into(), Some("Round 5?".into()))));
	}

	#[test]
	fn a_closed_space_or_one_with_fewer_than_two_deadlines_has_none() {
		assert_eq!(space_gap(&with(cse_21(), "closed", json!(true)), TODAY), None);
		assert_eq!(space_gap(&space("spc_1", "Solo", vec![deadline("ddl_1", "homework", "HW1", "2026-11-01", false)]), TODAY), None);
	}

	#[test]
	fn same_day_deadlines_count_as_one_day() {
		let two_days = space(
			"spc_s",
			"Stats",
			vec![
				deadline("ddl_a", "homework", "HW1a", "2026-11-01", true),
				deadline("ddl_b", "homework", "HW1b", "2026-11-01", true),
				deadline("ddl_c", "homework", "HW2", "2026-11-08", true),
				deadline("ddl_x", "exam", "Final", "2026-12-10", false),
			],
		);
		assert_eq!(space_gap(&two_days, "2026-11-10"), None);
	}

	#[test]
	fn a_slower_rhythm_says_how_often_and_the_soonest_kind_wins() {
		let mut slow = space(
			"spc_10",
			"Physics",
			vec![
				deadline("ddl_1", "homework", "Problem Set 1", "2026-10-01", true),
				deadline("ddl_2", "homework", "Problem Set 2", "2026-10-11", true),
				deadline("ddl_3", "homework", "Problem Set 3", "2026-10-21", true),
			],
		);
		let gap = space_gap(&slow, "2026-10-25").unwrap();
		assert_eq!((gap.title.as_str(), gap.line.as_str(), gap.answer.as_str()), ("Homework in Physics soon?", "It came about every 10 days. None is on record after Problem Set 3.", "None for now"));
		assert_eq!((gap.name.as_deref(), gap.label.as_deref(), gap.day.as_deref()), (Some("Problem Set 4"), Some("Problem Set 4?"), Some("2026-10-31")));
		for (i, day) in ["2026-10-06", "2026-10-13", "2026-10-20"].iter().enumerate() {
			slow = push(slow, deadline(&format!("ddl_q{i}"), "quiz", "Quiz", day, true));
		}
		let quiz = space_gap(&slow, "2026-10-25").unwrap();
		assert_eq!((quiz.day.as_deref(), quiz.name.as_deref(), quiz.label.as_deref()), (Some("2026-10-27"), Some("Quiz"), Some("Quiz?")), "a name with no number gives the kind's word");
	}

	#[test]
	fn nothing_coming_up_asks_for_two_weeks_then_asks_if_it_is_over() {
		let gap = space_gap(&cse_29(), TODAY).unwrap();
		assert_eq!(
			gap,
			Gap {
				space_id: "spc_29".into(),
				key: "spc_29:ddl_t2:recent".into(),
				title: "Nothing coming up in CSE 29".into(),
				line: "Test 2 was the last, 2 days ago.".into(),
				kind: None,
				day: None,
				name: None,
				label: None,
				answer: "Nothing new".into(),
				close: false,
				agent_line: "No deadline on record after Test 2 (Fri Nov 20).".into(),
			}
		);
		assert_eq!(space_gap(&cse_29(), "2026-11-21").map(|g| g.line), Some("Test 2 was the last, yesterday.".into()));
		assert_eq!(space_gap(&cse_29(), "2026-12-04").map(|g| g.key), Some("spc_29:ddl_t2:recent".into()));
		let over = space_gap(&cse_29(), "2026-12-05").unwrap();
		assert_eq!((over.key.as_str(), over.title.as_str(), over.line.as_str(), over.answer.as_str(), over.close), ("spc_29:ddl_t2:over", "Is CSE 29 over?", "Test 2 was the last, on Fri Nov 20.", "Still going", true));
	}

	#[test]
	fn a_quiet_linked_folder_is_named_in_the_line() {
		let linked = |added: &str| with(with(cse_29(), "linkedFolder", json!("/Drive/CSE 29")), "files", json!([{ "id": "f1", "origin": "linked", "addedAt": added }, { "id": "f2", "origin": "copied", "addedAt": "2026-11-21T18:00:00.000Z" }]));
		assert_eq!(space_gap(&linked("2026-11-09T18:00:00.000Z"), TODAY).map(|g| g.line), Some("Test 2 was the last. No new files from its folder since Mon Nov 9.".into()));
		assert_eq!(space_gap(&linked("2026-11-16T18:00:00.000Z"), TODAY).map(|g| g.line), Some("Test 2 was the last, 2 days ago.".into()), "six days is not quiet");
		assert_eq!(space_gap(&linked("2026-11-09T18:00:00.000Z"), "2026-12-05").map(|g| g.line), Some("Test 2 was the last. No new files from its folder since Mon Nov 9.".into()));
	}

	#[test]
	fn the_next_name_counts_up_or_falls_back_to_the_kind() {
		assert_eq!(next_name("HW6", "Homework"), "HW7");
		assert_eq!(next_name("Problem Set 3", "Homework"), "Problem Set 4");
		assert_eq!(next_name("Lab 09", "Project"), "Lab 10");
		assert_eq!(next_name("Lab 01", "Project"), "Lab 02");
		assert_eq!(next_name("Essay", "Homework"), "Homework");
	}

	#[test]
	fn no_words_hold_a_dash_or_a_dot_divider() {
		let words = |g: Gap| [g.title, g.line, g.answer, g.name.unwrap_or_default(), g.label.unwrap_or_default()];
		for gap in [space_gap(&cse_21(), TODAY), space_gap(&cse_29(), TODAY), space_gap(&cse_29(), "2026-12-05")] {
			for text in words(gap.unwrap()) {
				assert!(!text.contains('\u{2014}') && !text.contains(" \u{b7} "), "{text}");
			}
		}
	}
}
