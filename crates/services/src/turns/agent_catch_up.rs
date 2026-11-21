//! What godspeed hands an agent by itself once it waits for work: lessons whose last stretch
//! never reached the graph (queued runs do not survive a restart), and a space with something to
//! check (a background run).

use std::collections::HashSet;
use std::sync::Arc;

use gs_base::{clock, time};
use gs_core::contracts::chat::extracts_facts;

use super::turn_liveness::is_turn_running;
use super::turn_service::{LEFTOVER_IDLE_MS, extract_when_idle, run_extraction, uncovered_tokens};
use crate::App;
use crate::spaces::space_checks::{check_spaces, check_spaces_now};

/// Once per agent session: extract what each lesson has left, now when it already sits idle, else
/// once it has (its timer died with the last run). A run that failed is tried again when the next
/// session waits; `runs.claim` keeps a lesson to one run at a time.
fn catch_up_lessons(app: &Arc<App>, session: &str, now: i64) -> Result<(), String> {
	if app.turns.lessons_caught_up.lock().contains(session) || !app.stores.settings.effective_settings()?["graph"]["enabled"].truthy() {
		return Ok(());
	}
	app.turns.lessons_caught_up.lock().insert(session.to_owned());
	let closed: HashSet<String> = app.stores.spaces.list_spaces().iter().filter(|c| c["closed"].truthy()).filter_map(|c| c["id"].as_str().map(str::to_owned)).collect();
	for summary in app.stores.chats.list_chats() {
		let Some(id) = summary["id"].as_str() else { continue };
		let Some(record) = app.stores.chats.get_chat(id) else { continue };
		let space_id = record["spaceId"].as_str().filter(|c| !c.is_empty());
		if !extracts_facts(record["kind"].as_str()) || space_id.is_some_and(|c| closed.contains(c)) || is_turn_running(app, id) {
			continue;
		}
		let scope = record["spaceId"].as_str();
		if uncovered_tokens(app, id, scope)? == 0.0 {
			continue;
		}
		let idle_for = time::parse_date(record["updatedAt"].str_or_empty()).map(|at| now - at);
		match idle_for {
			Some(idle) if idle < LEFTOVER_IDLE_MS => extract_when_idle(app, id, scope, LEFTOVER_IDLE_MS - idle),
			// NaN compares false in the TS, so an unreadable time extracts now.
			_ => run_extraction(app, id),
		}
	}
	Ok(())
}

/// The agent with this session id started waiting for work.
pub fn catch_up_for_agent(app: &Arc<App>, session: &str, now: i64) {
	let run = || -> Result<(), String> {
		catch_up_lessons(app, session, now)?;
		check_spaces(app, now);
		crate::vault::catch_up(app);
		Ok(())
	};
	if let Err(err) = run() {
		eprintln!("[catch-up] failed: {err}");
	}
}

/// A deadline was added: check its space now if an agent is working, or the quiet teacher in
/// godspeed's terminal, which godspeed wakes, is there.
pub fn ask_about_new_deadlines(app: &Arc<App>) {
	let now = clock::now_ms();
	if app.bridge.agent_teaching(now) || app.bridge.contacted_teacher_terminal().is_some() {
		check_spaces_now(app, now);
	}
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[tokio::test]
	async fn each_new_session_catches_up_once() {
		let root = scratch_dir("catch-up");
		let app = test_app(&root);
		let id = app.stores.chats.create_chat("t", None, None, None, &[]).unwrap()["id"].as_str().unwrap().to_owned();
		let taught = "A limit is the value a function approaches. ".repeat(20);
		let said = json!({ "id": "msg_a", "role": "assistant", "content": [{ "type": "text", "text": taught }], "stopReason": "stop", "timestamp": 1 });
		app.stores.chats.save_messages(&id, &[said]).unwrap();
		let now = clock::now_ms();
		let handed = |session: &str| {
			app.turns.leftover_timers.lock().clear();
			catch_up_lessons(&app, session, now).unwrap();
			app.turns.leftover_timers.lock().contains_key(&id)
		};
		assert!(handed("session-a"), "the first wait hands the lesson out");
		assert!(!handed("session-a"), "the same session waiting again does not");
		assert!(handed("session-b"), "a new session tries the lesson again");
	}
}
