//! What godspeed hands an agent by itself once it waits for work: lessons whose last stretch
//! never reached the graph (queued runs do not survive a restart), and a space with something to
//! check (a background run).

use std::collections::HashSet;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use gs_base::{clock, time};
use gs_core::contracts::chat::extracts_facts;

use super::turn_liveness::is_turn_running;
use super::turn_service::{LEFTOVER_IDLE_MS, extract_when_idle, run_extraction, uncovered_tokens};
use crate::App;
use crate::spaces::space_checks::{check_spaces, check_spaces_now};

/// Once per app run: extract what each lesson has left, now when it already sits idle, else once
/// it has (its timer died with the last run).
fn catch_up_lessons(app: &Arc<App>, now: i64) -> Result<(), String> {
	if app.turns.lessons_caught_up.load(Ordering::SeqCst) || !app.stores.settings.effective_settings()?["graph"]["enabled"].truthy() {
		return Ok(());
	}
	app.turns.lessons_caught_up.store(true, Ordering::SeqCst);
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

/// The agent started waiting for work.
pub fn catch_up_for_agent(app: &Arc<App>, now: i64) {
	let run = || -> Result<(), String> {
		catch_up_lessons(app, now)?;
		check_spaces(app, now);
		Ok(())
	};
	if let Err(err) = run() {
		eprintln!("[catch-up] failed: {err}");
	}
}

/// A deadline was added: check its space now if an agent is working.
pub fn ask_about_new_deadlines(app: &Arc<App>) {
	let now = clock::now_ms();
	if app.bridge.agent_teaching(now) {
		check_spaces_now(app, now);
	}
}
