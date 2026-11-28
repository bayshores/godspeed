//! The menu bar countdown's words (Mac): the time left to the nearest deadline that is open and
//! not yet due, and a menu row for each of the next few. The shell only draws them.

use gs_base::text::one_line;
use gs_base::time::{DAY_MS, HOUR_MS, MINUTE_MS};
use gs_json::Json;

use crate::contracts::space::{due_at, is_upcoming};
use crate::spaces::today_note::{due_sentence, local_day};
use crate::study::progress::days_between;

/// Rows the menu shows.
const ROWS: usize = 5;
/// A deadline's name is cut to this many characters.
const NAME_MAX: usize = 40;

/// "3d" from 24 hours left on (calendar days, as the deadline's page counts them), "5h" from an
/// hour on, else "45m". None without a deadline to count to. `deadlines` come soonest first.
pub fn countdown_title(deadlines: &[Json], now_ms: i64) -> Option<String> {
	let deadline = deadlines.iter().find(|d| is_upcoming(d, now_ms))?;
	let left = due_at(deadline)? - now_ms;
	Some(if left >= DAY_MS {
		format!("{}d", days_between(&local_day(now_ms), deadline["date"].str_or_empty()))
	} else if left >= HOUR_MS {
		format!("{}h", left / HOUR_MS)
	} else {
		format!("{}m", (left / MINUTE_MS).max(1))
	})
}

/// The menu's rows as `(text, page)`: the next 5 deadlines, soonest first, each with its own
/// page. Two rows with the same name each add their space, so the learner can tell them apart.
pub fn countdown_rows(deadlines: &[Json], now_ms: i64) -> Vec<(String, String)> {
	let today = local_day(now_ms);
	let shown: Vec<(&Json, String)> = deadlines.iter().filter(|d| is_upcoming(d, now_ms)).take(ROWS).map(|d| (d, one_line(d["name"].str_or_empty(), NAME_MAX))).collect();
	shown
		.iter()
		.map(|(d, name)| {
			let twins = shown.iter().filter(|(_, other)| other == name).count() > 1;
			let name = if twins { format!("{name} ({})", d["spaceName"].str_or_empty()) } else { name.clone() };
			let text = due_sentence(&name, days_between(&today, d["date"].str_or_empty()));
			(text, format!("/space/deadline/{}?space={}", d["id"].str_or_empty(), d["spaceId"].str_or_empty()))
		})
		.collect()
}

#[cfg(test)]
mod tests {
	use gs_base::time;
	use gs_json::json;

	use super::*;

	/// 9:00 local time on a fixed day.
	fn nine() -> i64 {
		time::parse_date("2026-11-13T09:00").unwrap()
	}

	fn deadline(name: &str, days: i64, at: Option<&str>) -> Json {
		let mut d = json!({ "id": format!("dl_{name}"), "name": name, "date": local_day(nine() + days * DAY_MS), "done": false, "spaceId": "spc_1", "spaceName": "Algebra" });
		if let (Some(at), Some(obj)) = (at, d.as_obj_mut()) {
			obj.insert("time", at);
		}
		d
	}

	fn title(d: Json, now_ms: i64) -> Option<String> {
		countdown_title(&[d], now_ms)
	}

	#[test]
	fn the_title_counts_days_then_hours_then_minutes() {
		assert_eq!(title(deadline("Final", 5, None), nine()).as_deref(), Some("5d"));
		assert_eq!(title(deadline("Quiz", 1, Some("08:59")), nine()).as_deref(), Some("23h"), "23 h 59 min left");
		assert_eq!(title(deadline("Quiz", 1, Some("10:00")), nine()).as_deref(), Some("1d"), "tomorrow, 25 h away");
		assert_eq!(title(deadline("Lab", 0, Some("09:59")), nine()).as_deref(), Some("59m"));
		assert_eq!(title(deadline("Lab", 0, Some("09:00")), nine() - 30_000).as_deref(), Some("1m"), "30 s left");
		assert_eq!(countdown_title(&[], nine()), None);
	}

	#[test]
	fn done_and_past_deadlines_are_skipped() {
		let mut done = deadline("Quiz 1", 0, Some("10:00"));
		done.as_obj_mut().unwrap().insert("done", true);
		let list = [done, deadline("Lab", 0, Some("08:30")), deadline("Midterm", 2, None)];
		assert_eq!(countdown_title(&list, nine()).as_deref(), Some("2d"));
		assert_eq!(countdown_rows(&list, nine()), [("Midterm is in 2 days".to_owned(), "/space/deadline/dl_Midterm?space=spc_1".to_owned())]);
		assert_eq!(countdown_title(&list[..2], nine()), None);
	}

	#[test]
	fn the_menu_shows_the_next_five() {
		let list: Vec<Json> = (0..6).map(|n| deadline(&format!("Homework {n}"), n, None)).collect();
		let texts: Vec<String> = countdown_rows(&list, nine()).into_iter().map(|(text, _)| text).collect();
		assert_eq!(texts, ["Homework 0 is today", "Homework 1 is tomorrow", "Homework 2 is in 2 days", "Homework 3 is in 3 days", "Homework 4 is in 4 days"]);
	}

	#[test]
	fn rows_with_the_same_name_add_their_space() {
		let mut physics = deadline("Homework 3", 1, Some("12:00"));
		physics.as_obj_mut().unwrap().insert("spaceName", "Physics");
		let list = [deadline("Homework 3", 1, Some("10:00")), physics, deadline("Quiz 2", 2, None)];
		let texts: Vec<String> = countdown_rows(&list, nine()).into_iter().map(|(text, _)| text).collect();
		assert_eq!(texts, ["Homework 3 (Algebra) is tomorrow", "Homework 3 (Physics) is tomorrow", "Quiz 2 is in 2 days"]);
	}

	#[test]
	fn a_long_name_is_cut() {
		let rows = countdown_rows(&[deadline(&"Chapter ".repeat(8), 1, None)], nine());
		assert_eq!(rows[0].0, format!("{}… is tomorrow", "Chapter ".repeat(5).trim_end()));
	}
}
