//! Deadline reminders: at most one system notification a day, for the soonest open deadline 3
//! days away or less. The server decides and the desktop shell shows it, so there is none without
//! the shell. It checks 10 seconds after the start, then every 10 minutes, and sends from 9:00
//! local time on, only while godspeed runs; data/reminders.json keeps the day of the last one.

use std::sync::Arc;

use gs_base::{clock, num, time};
use gs_core::contracts::space::deadline_due_at;
use gs_core::spaces::today_note::{local_day, relative_day};
use gs_core::study::homework::problems_done;
use gs_core::study::progress::days_between;
use gs_json::Json;
use gs_shell_rpc::ShellLink;

use crate::App;
use crate::graph::progress::progress_for;
use crate::spaces::list_open_deadlines;

const START_DELAY_MS: i64 = 10_000;
/// Short waits that each look at the wall clock: the timer stops while the computer sleeps, so a
/// computer that slept through 9:00 still sends within 10 minutes of waking.
const WAKE_MS: i64 = 10 * 60 * 1000;
const REMIND_AT: &str = "09:00";
const MOST_DAYS_AWAY: i64 = 3;

/// A notification's words.
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
	// As the app counts it: problems first, readiness for a deadline without problems.
	let body = if let Some(problems) = problems_done(&deadline["problems"]) {
		format!("{space}. {} of {} problems done.", problems["done"].as_i64().unwrap_or(0), problems["total"].as_i64().unwrap_or(0))
	} else if let Some(ready) = ready_of(deadline) {
		format!("{space}. You are {}% ready.", num::math_round(ready * 100.0))
	} else {
		format!("{space}.")
	};
	Some(Reminder { title, body })
}

/// The local moment a deadline is due: its time, or 23:59.
fn due_at(deadline: &Json) -> Option<i64> {
	let (date, at) = deadline_due_at(deadline);
	time::parse_date(&format!("{date}T{at}"))
}

/// Whether the day's reminder is due at `now_ms`: none went out today (`last_day` is the day of
/// the last one), and this is the check after the start or 9:00 has passed.
fn is_due(now_ms: i64, last_day: Option<&str>, at_start: bool) -> bool {
	let today = local_day(now_ms);
	if last_day == Some(today.as_str()) {
		return false;
	}
	at_start || time::parse_date(&format!("{today}T{REMIND_AT}")).is_none_or(|nine| now_ms >= nine)
}

/// Checks 10 seconds after the start, then every 10 minutes. Nothing runs without the shell.
pub fn start_deadline_reminders(app: &Arc<App>) {
	let Some(shell) = app.shell.clone() else { return };
	let app = app.clone();
	tokio::spawn(async move {
		clock::sleep(START_DELAY_MS).await;
		let mut at_start = true;
		loop {
			remind(&app, &shell, clock::now_ms(), at_start).await;
			at_start = false;
			clock::sleep(WAKE_MS).await;
		}
	});
}

/// Sends the day's reminder, unless the setting is off, it is not due, or no deadline is close.
/// The day counts as reminded only once the shell handed the notification to the system; while
/// the window has the focus it does not, and a later check tries again.
async fn remind(app: &App, shell: &ShellLink, now_ms: i64, at_start: bool) {
	if !reminders_on(app) || !is_due(now_ms, app.stores.reminders.last_reminder_day().as_deref(), at_start) {
		return;
	}
	let Some(reminder) = reminder_text(&list_open_deadlines(app), now_ms, |d| ready_of(app, d)) else { return };
	match shell.notify(&reminder.title, &reminder.body).await {
		Ok(true) => {
			if let Err(err) = app.stores.reminders.set_last_reminder_day(&local_day(now_ms)) {
				eprintln!("[reminders] could not save the reminder day: {err}");
			}
		}
		Ok(false) => {}
		Err(err) => eprintln!("[reminders] the shell did not answer: {err}"),
	}
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
	use gs_shell_rpc::{ToServer, ToShell, read_lines};
	use tokio::sync::mpsc;

	use super::*;
	use crate::app::test_support::scratch_dir;
	use crate::spaces::add_space_deadline;

	const DAY_MS: i64 = 24 * 60 * 60 * 1000;

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
	fn a_deadline_with_problems_counts_the_problems_done() {
		let mut homework = deadline("Homework 3", 2, None);
		homework.as_obj_mut().unwrap().insert("problems", json!([{ "id": "p1", "done": true }, { "id": "p2", "done": false }, { "id": "p3" }]));
		assert_eq!(text(&[homework], Some(0.0)).unwrap().1, "Algebra. 1 of 3 problems done.");
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
	fn one_is_due_from_nine_on_once_a_day() {
		let yesterday = day_after(-1);
		let today = day_after(0);
		assert!(!is_due(nine() - 60_000, Some(&yesterday), false), "before 9:00");
		assert!(is_due(nine() - 60_000, Some(&yesterday), true), "before 9:00, just after the start");
		assert!(is_due(nine(), Some(&yesterday), false), "at 9:00");
		assert!(is_due(nine(), None, false), "the first one ever");
		assert!(!is_due(nine() + 60_000, Some(&today), false), "already sent today");
		assert!(!is_due(nine() + 60_000, Some(&today), true), "already sent today, just after the start");
		assert!(is_due(nine() + 10 * 60 * 60 * 1000, Some(&yesterday), false), "woke at 19:00 after sleeping through 9:00");
	}

	/// Hands each line the server writes to the shell to the test.
	struct Lines(mpsc::UnboundedSender<Vec<u8>>);

	impl Write for Lines {
		fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
			let _ = self.0.send(buf.to_vec());
			Ok(buf.len())
		}
		fn flush(&mut self) -> std::io::Result<()> {
			Ok(())
		}
	}

	fn app_with_shell(root: &std::path::Path) -> (Arc<App>, mpsc::UnboundedReceiver<Vec<u8>>) {
		let (tx, rx) = mpsc::unbounded_channel();
		for name in ["data", "home", "tmp", "res"] {
			std::fs::create_dir_all(root.join(name)).unwrap();
		}
		let app = App::new(Paths::new(root.join("data"), root.join("home"), root.join("tmp"), root.join("res")), Some(ShellLink::new(Lines(tx))));
		(app, rx)
	}

	fn add_quiz(app: &App) {
		let space = app.stores.spaces.create_space(&json!({ "name": "Algebra" })).unwrap();
		add_space_deadline(app, space["id"].as_str().unwrap(), &json!({ "kind": "quiz", "name": "Quiz 2", "date": day_after(2) })).unwrap();
	}

	/// Runs one check at `now_ms` (not the one after the start). The shell answers `shown` to a
	/// notification; the answer is what it was asked to show.
	async fn check(app: &Arc<App>, lines: &mut mpsc::UnboundedReceiver<Vec<u8>>, now_ms: i64, shown: bool) -> Option<(String, String)> {
		let mut task = tokio::spawn({
			let app = app.clone();
			async move { remind(&app, app.shell.as_ref().unwrap(), now_ms, false).await }
		});
		tokio::select! {
			line = lines.recv() => {
				let Some(Ok(ToShell::Notify { id, title, body })) = read_lines::<ToShell>(&line.unwrap()[..]).next() else { panic!("a notify request") };
				app.shell.as_ref().unwrap().receive(ToServer::NotifyDone { id, shown });
				task.await.unwrap();
				Some((title, body))
			}
			done = &mut task => {
				done.unwrap();
				None
			}
		}
	}

	#[tokio::test]
	async fn one_reminder_a_day_however_often_it_checks() {
		let root = scratch_dir("reminder-once");
		let (app, mut lines) = app_with_shell(&root);
		add_quiz(&app);
		assert_eq!(check(&app, &mut lines, nine(), true).await, Some(("Quiz 2 is in 2 days".into(), "Algebra.".into())));
		assert_eq!(app.stores.reminders.last_reminder_day(), Some(day_after(0)));
		assert_eq!(check(&app, &mut lines, nine() + 60_000, true).await, None);
		assert!(check(&app, &mut lines, nine() + DAY_MS, true).await.is_some());
	}

	#[tokio::test]
	async fn a_notification_not_shown_is_tried_again_at_the_next_check() {
		let root = scratch_dir("reminder-focused");
		let (app, mut lines) = app_with_shell(&root);
		add_quiz(&app);
		assert!(check(&app, &mut lines, nine(), false).await.is_some());
		assert_eq!(app.stores.reminders.last_reminder_day(), None);
		assert!(check(&app, &mut lines, nine() + WAKE_MS, true).await.is_some());
		assert_eq!(app.stores.reminders.last_reminder_day(), Some(day_after(0)));
	}

	#[tokio::test]
	async fn the_switch_off_sends_and_saves_nothing() {
		let root = scratch_dir("reminder-off");
		let (app, mut lines) = app_with_shell(&root);
		add_quiz(&app);
		gs_base::fsx::write_text_atomic(&app.paths.settings_file, r#"{"version":3,"general":{"deadlineReminders":false}}"#).unwrap();
		assert_eq!(check(&app, &mut lines, nine(), true).await, None);
		assert!(!root.join("data/reminders.json").exists());
	}
}
