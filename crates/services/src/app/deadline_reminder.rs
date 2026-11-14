//! Deadline reminders: at most one system notification a day, for the soonest open deadline 3
//! days away or less. The server decides and the desktop shell shows it, so there is none without
//! the shell. It runs 10 seconds after the start, then every day at 9:00 local time, and only
//! while godspeed runs; data/reminders.json keeps the day of the last one.

use std::sync::Arc;

use gs_base::{clock, num, time};
use gs_core::contracts::space::deadline_due_at;
use gs_core::spaces::today_note::{local_day, relative_day};
use gs_core::study::progress::days_between;
use gs_json::Json;
use gs_shell_rpc::ToShell;

use crate::App;
use crate::graph::progress::progress_for;
use crate::spaces::list_open_deadlines;

const START_DELAY_MS: i64 = 10_000;
const DAY_MS: i64 = 24 * 60 * 60 * 1000;
const REMIND_AT: &str = "09:00";
const MOST_DAYS_AWAY: i64 = 3;

/// A notification's words.
#[derive(Debug, PartialEq)]
struct Reminder {
	title: String,
	body: String,
}

/// The reminder for the first of `deadlines` (soonest first, as `list_open_deadlines` gives them,
/// each with its `spaceName`) that is not done, not yet due at `now_ms` and at most 3 days away.
/// `ready_of` gives that deadline's readiness, 0 to 1, when it is known.
fn reminder_text(deadlines: &[Json], now_ms: i64, ready_of: impl FnOnce(&Json) -> Option<f64>) -> Option<Reminder> {
	let today = local_day(now_ms);
	let (deadline, days) = deadlines.iter().filter(|d| !d["done"].truthy() && due_at(d).is_some_and(|due| due > now_ms)).find_map(|d| {
		let days = days_between(&today, d["date"].as_str()?);
		(days <= MOST_DAYS_AWAY).then_some((d, days))
	})?;
	let title = format!("{} is {}", deadline["name"].as_str().unwrap_or(""), relative_day(days));
	let space = deadline["spaceName"].as_str().unwrap_or("");
	let body = match ready_of(deadline) {
		Some(ready) => format!("{space}. You are {}% ready.", num::math_round(ready * 100.0)),
		None => format!("{space}."),
	};
	Some(Reminder { title, body })
}

/// The local moment a deadline is due: its time, or 23:59.
fn due_at(deadline: &Json) -> Option<i64> {
	let (date, at) = deadline_due_at(deadline);
	time::parse_date(&format!("{date}T{at}"))
}

/// Checks once 10 seconds after the start, then every day at 9:00.
pub fn start_deadline_reminders(app: &Arc<App>) {
	let app = app.clone();
	tokio::spawn(async move {
		clock::sleep(START_DELAY_MS).await;
		loop {
			remind(&app, clock::now_ms());
			clock::sleep_until(next_check_at(clock::now_ms())).await;
		}
	});
}

/// The next 9:00 local time after `now_ms`.
fn next_check_at(now_ms: i64) -> i64 {
	let at = |day: &str| time::parse_date(&format!("{day}T{REMIND_AT}"));
	let Some(today) = at(&local_day(now_ms)) else { return now_ms + DAY_MS };
	if today > now_ms {
		return today;
	}
	// A day later is the next date's 8:00 to 10:00, even on a clock change.
	at(&local_day(today + DAY_MS)).unwrap_or(now_ms + DAY_MS)
}

/// Sends the day's reminder, unless there is no shell, the setting is off, one went out today
/// already, or no deadline is close.
fn remind(app: &App, now_ms: i64) {
	let Some(shell) = &app.shell else { return };
	if !reminders_on(app) {
		return;
	}
	let today = local_day(now_ms);
	if app.stores.reminders.last_reminder_day().as_deref() == Some(today.as_str()) {
		return;
	}
	let Some(reminder) = reminder_text(&list_open_deadlines(app), now_ms, |d| ready_of(app, d)) else { return };
	if let Err(err) = app.stores.reminders.set_last_reminder_day(&today) {
		eprintln!("[reminders] could not save the reminder day: {err}");
	}
	shell.send(&ToShell::Notify { title: reminder.title, body: reminder.body });
}

/// Only an explicit `general.deadlineReminders: false` turns them off.
fn reminders_on(app: &App) -> bool {
	let record = app.stores.settings.read_settings().ok().flatten();
	record.is_none_or(|r| r["general"]["deadlineReminders"].as_bool() != Some(false))
}

/// How ready the learner is for a deadline, as the space's Progress shows it.
fn ready_of(app: &App, deadline: &Json) -> Option<f64> {
	let progress = progress_for(app, deadline["spaceId"].as_str()?, None).ok()??;
	progress["deadlines"].as_arr()?.iter().find(|d| d["id"] == deadline["id"])?["ready"].as_f64()
}

#[cfg(test)]
mod tests {
	use std::io::Write;

	use gs_base::config::Paths;
	use gs_json::json;
	use gs_shell_rpc::{ShellLink, read_lines};
	use parking_lot::Mutex;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::spaces::add_space_deadline;

	/// 9:00 local time on a fixed day.
	fn nine() -> i64 {
		time::parse_date("2026-11-13T09:00").unwrap()
	}

	fn day_after(days: i64) -> String {
		local_day(nine() + days * DAY_MS)
	}

	fn deadline(name: &str, days: i64, time: Option<&str>) -> Json {
		let mut d = json!({ "id": name, "name": name, "date": day_after(days), "done": false, "spaceName": "Algebra" });
		if let (Some(at), Some(obj)) = (time, d.as_obj_mut()) {
			obj.insert("time", at);
		}
		d
	}

	fn text(deadlines: &[Json], ready: Option<f64>) -> Option<(String, String)> {
		reminder_text(deadlines, nine(), |_| ready).map(|r| (r.title, r.body))
	}

	#[test]
	fn the_soonest_close_deadline_is_named_with_how_ready_the_learner_is() {
		let list = [deadline("Quiz 2", 2, None), deadline("Midterm", 3, None)];
		assert_eq!(text(&list, Some(0.4)), Some(("Quiz 2 is in 2 days".into(), "Algebra. You are 40% ready.".into())));
		assert_eq!(text(&list[1..], Some(0.4)).unwrap().0, "Midterm is in 3 days");
		assert_eq!(text(&[deadline("Quiz 2", 1, None)], None).unwrap().0, "Quiz 2 is tomorrow");
	}

	#[test]
	fn unknown_readiness_leaves_only_the_space() {
		assert_eq!(text(&[deadline("Quiz 2", 2, None)], None).unwrap().1, "Algebra.");
	}

	#[test]
	fn done_far_and_past_deadlines_get_no_reminder() {
		let mut done = deadline("Quiz 1", 1, None);
		done.as_obj_mut().unwrap().insert("done", true);
		assert_eq!(text(&[done], None), None);
		assert_eq!(text(&[deadline("Final", 4, None)], None), None);
		assert_eq!(text(&[deadline("Quiz 0", -1, None)], None), None);
	}

	#[test]
	fn a_deadline_with_a_time_counts_until_that_time() {
		let list = [deadline("Lab", 0, Some("08:30")), deadline("Homework 3", 0, Some("17:00"))];
		assert_eq!(text(&list, Some(1.0)), Some(("Homework 3 is today".into(), "Algebra. You are 100% ready.".into())));
	}

	#[test]
	fn checks_come_at_nine() {
		assert_eq!(next_check_at(nine() - 60_000), nine());
		assert_eq!(next_check_at(nine()), time::parse_date(&format!("{}T09:00", day_after(1))).unwrap());
	}

	/// The lines a shell would read.
	#[derive(Clone, Default)]
	struct Shell(Arc<Mutex<Vec<u8>>>);

	impl Write for Shell {
		fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
			self.0.lock().extend_from_slice(buf);
			Ok(buf.len())
		}
		fn flush(&mut self) -> std::io::Result<()> {
			Ok(())
		}
	}

	impl Shell {
		fn sent(&self) -> Vec<ToShell> {
			read_lines::<ToShell>(&self.0.lock()[..]).map(Result::unwrap).collect()
		}
	}

	fn app_with_shell(root: &std::path::Path) -> (Arc<App>, Shell) {
		let shell = Shell::default();
		for name in ["data", "home", "tmp", "res"] {
			std::fs::create_dir_all(root.join(name)).unwrap();
		}
		let app = App::new(Paths::new(root.join("data"), root.join("home"), root.join("tmp"), root.join("res")), Some(ShellLink::new(shell.clone())));
		(app, shell)
	}

	fn add_quiz(app: &App) {
		let space = app.stores.spaces.create_space(&json!({ "name": "Algebra" })).unwrap();
		add_space_deadline(app, space["id"].as_str().unwrap(), &json!({ "kind": "quiz", "name": "Quiz 2", "date": day_after(2) })).unwrap();
	}

	#[test]
	fn one_reminder_a_day_however_often_godspeed_starts() {
		let root = scratch_dir("reminder-once");
		let (app, shell) = app_with_shell(&root);
		add_quiz(&app);
		remind(&app, nine());
		remind(&app, nine() + 60_000);
		assert_eq!(shell.sent(), [ToShell::Notify { title: "Quiz 2 is in 2 days".into(), body: "Algebra.".into() }]);
		assert_eq!(app.stores.reminders.last_reminder_day(), Some(day_after(0)));
		remind(&app, nine() + DAY_MS);
		assert_eq!(shell.sent().len(), 2);
	}

	#[test]
	fn the_switch_off_or_no_shell_sends_and_saves_nothing() {
		let root = scratch_dir("reminder-off");
		let (app, shell) = app_with_shell(&root);
		add_quiz(&app);
		gs_base::fsx::write_text_atomic(&app.paths.settings_file, r#"{"version":3,"general":{"deadlineReminders":false}}"#).unwrap();
		remind(&app, nine());
		assert!(shell.sent().is_empty());
		let plain = test_app(&root);
		std::fs::remove_file(&plain.paths.settings_file).unwrap();
		remind(&plain, nine());
		assert!(!root.join("data/reminders.json").exists());
	}
}
