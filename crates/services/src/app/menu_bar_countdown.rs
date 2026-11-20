//! The menu bar countdown (Mac): the shell's menu bar item shows the time left to the nearest
//! open deadline, and its menu the next few. The server decides the words and sends them each
//! time they change; nothing runs without the shell. `general.menuBarCountdown: false` removes it.

use std::sync::Arc;

use gs_base::clock;
use gs_base::events::{Event, EventKind};
use gs_base::tasks::detach;
use gs_core::spaces::menu_bar_countdown::{countdown_rows, countdown_title};
use gs_json::Json;
use gs_shell_rpc::{CountdownRow, ShellLink, ToShell};
use tokio::sync::mpsc::UnboundedReceiver;

use crate::App;
use crate::app::settings_record::general_switch_on;
use crate::spaces::list_open_deadlines;

const MINUTE_MS: i64 = 60 * 1000;

/// Only the Mac has the item.
pub fn start_menu_bar_countdown(app: &Arc<App>) {
	if !cfg!(target_os = "macos") {
		return;
	}
	let Some(shell) = app.shell.clone() else { return };
	let events = app.events.subscribe();
	detach("menu-bar-countdown", run(app.clone(), shell, events));
}

/// Sends the item's words at the start and whenever they change. It looks again when spaces
/// change, when settings are saved, and at each whole minute: a short wait that then reads the
/// wall clock, since timers stop while the computer sleeps. The store keeps no copy of the
/// spaces, so this keeps its own list and reads the records again only when they change.
async fn run(app: Arc<App>, shell: ShellLink, mut events: UnboundedReceiver<Event>) {
	let mut deadlines = list_open_deadlines(&app);
	let mut on = general_switch_on(&app, "menuBarCountdown");
	let mut last_sent = None;
	loop {
		let now = clock::now_ms();
		let message = if on { countdown(&deadlines, now) } else { ToShell::MenuBarCountdownOff };
		if last_sent.as_ref() != Some(&message) {
			shell.send(&message);
			last_sent = Some(message);
		}
		tokio::select! {
			event = events.recv() => {
				let Some(event) = event else { return };
				// A burst of changes reads the records once.
				let mut changed = event.kind == EventKind::SpacesChanged;
				while let Ok(event) = events.try_recv() {
					changed |= event.kind == EventKind::SpacesChanged;
				}
				if changed {
					deadlines = list_open_deadlines(&app);
				}
			}
			() = app.misc.settings_saved.notified() => on = general_switch_on(&app, "menuBarCountdown"),
			() = clock::sleep_until(now - now.rem_euclid(MINUTE_MS) + MINUTE_MS) => {}
		}
	}
}

fn countdown(deadlines: &[Json], now_ms: i64) -> ToShell {
	let rows = countdown_rows(deadlines, now_ms).into_iter().map(|(text, page)| CountdownRow { text, page }).collect();
	ToShell::MenuBarCountdown { title: countdown_title(deadlines, now_ms), rows }
}

#[cfg(test)]
mod tests {
	use gs_core::spaces::today_note::local_day;
	use gs_json::json;
	use gs_shell_rpc::read_lines;
	use tokio::sync::mpsc;

	use super::*;
	use crate::app::patch_settings_section;
	use crate::app::test_support::{scratch_dir, test_app_with_shell};
	use crate::spaces::add_space_deadline;

	const DAY_MS: i64 = 24 * 60 * 60 * 1000;

	/// The next line the server wrote to the shell, or None when none comes within a moment.
	async fn next(lines: &mut mpsc::UnboundedReceiver<Vec<u8>>) -> Option<ToShell> {
		let line = clock::within(300, lines.recv()).await??;
		read_lines::<ToShell>(&line[..]).next()?.ok()
	}

	fn logo_alone() -> Option<ToShell> {
		Some(ToShell::MenuBarCountdown { title: None, rows: vec![] })
	}

	#[tokio::test]
	async fn it_sends_at_the_start_and_again_only_when_the_deadlines_change() {
		let root = scratch_dir("countdown-changes");
		let (app, mut lines) = test_app_with_shell(&root);
		let space = app.stores.spaces.create_space(&json!({ "name": "Algebra" })).unwrap();
		let space_id = space["id"].as_str().unwrap().to_owned();
		tokio::spawn(run(app.clone(), app.shell.clone().unwrap(), app.events.subscribe()));
		assert_eq!(next(&mut lines).await, logo_alone(), "no deadline yet");

		let in_two_days = local_day(clock::now_ms() + 2 * DAY_MS);
		let added = add_space_deadline(&app, &space_id, &json!({ "kind": "quiz", "name": "Quiz 2", "date": in_two_days })).unwrap();
		let Some(ToShell::MenuBarCountdown { title, rows }) = next(&mut lines).await else { panic!("a countdown") };
		assert_eq!(title.as_deref(), Some("2d"));
		assert_eq!(rows, [CountdownRow { text: "Quiz 2 is in 2 days".into(), page: format!("/space/deadline/{}?space={space_id}", added["id"].str_or_empty()) }]);

		app.events.emit(EventKind::ChatsChanged, json!({}));
		app.events.emit(EventKind::SpacesChanged, json!({}));
		assert_eq!(next(&mut lines).await, None, "the same words are not sent again");
	}

	#[tokio::test]
	async fn the_switch_off_removes_the_item_once() {
		let root = scratch_dir("countdown-off");
		let (app, mut lines) = test_app_with_shell(&root);
		tokio::spawn(run(app.clone(), app.shell.clone().unwrap(), app.events.subscribe()));
		assert_eq!(next(&mut lines).await, logo_alone());

		patch_settings_section(&app, "general", &json!({ "menuBarCountdown": false })).unwrap();
		assert_eq!(next(&mut lines).await, Some(ToShell::MenuBarCountdownOff));
		patch_settings_section(&app, "general", &json!({ "sounds": false })).unwrap();
		assert_eq!(next(&mut lines).await, None, "off is sent once");

		patch_settings_section(&app, "general", &json!({ "menuBarCountdown": true })).unwrap();
		assert_eq!(next(&mut lines).await, logo_alone());
	}
}
