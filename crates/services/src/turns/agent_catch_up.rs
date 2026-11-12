//! What godspeed hands an agent by itself once it waits for work (agent-catch-up.ts): lessons
//! whose last stretch never reached the graph (queued runs do not survive a restart), and
//! deadlines with nothing linked (a request from godspeed in Talk, sent only once Talk has been
//! quiet for a while, so it never cuts into a conversation).

use std::collections::HashSet;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use gs_base::{clock, time};
use gs_core::spaces::deadline_requests::{asked_deadline_ids, coverage_request, talk_quiet, unlinked_deadlines};
use gs_core::spaces::today_note::local_day;
use gs_core::contracts::chat::{TALK_CHAT_ID, extracts_facts};
use gs_core::messages::input_events::TurnInput;

use super::chat_handler::handle_chat_input;
use super::talk::talk_chat;
use super::turn_liveness::is_turn_running;
use super::turn_service::{LEFTOVER_IDLE_MS, extract_when_idle, run_extraction, uncovered_tokens};
use crate::App;

/// Once per app run: extract what each lesson has left, now when it already sits idle, else once
/// it has (its timer died with the last run).
fn catch_up_lessons(app: &Arc<App>, now: i64) -> Result<(), String> {
	if app.turns.lessons_caught_up.load(Ordering::SeqCst) || !app.stores.settings.effective_settings()?["graph"]["enabled"].truthy() {
		return Ok(());
	}
	app.turns.lessons_caught_up.store(true, Ordering::SeqCst);
	let archived: HashSet<String> = app.stores.spaces.list_spaces().iter().filter(|c| c["archived"].truthy()).filter_map(|c| c["id"].as_str().map(str::to_owned)).collect();
	for summary in app.stores.chats.list_chats() {
		let Some(id) = summary["id"].as_str() else { continue };
		let Some(record) = app.stores.chats.get_chat(id) else { continue };
		let space_id = record["spaceId"].as_str().filter(|c| !c.is_empty());
		if !extracts_facts(record["kind"].as_str()) || space_id.is_some_and(|c| archived.contains(c)) || is_turn_running(app, id) {
			continue;
		}
		let scope = record["spaceId"].as_str();
		if uncovered_tokens(app, id, scope)? == 0.0 {
			continue;
		}
		let idle_for = time::parse_date(record["updatedAt"].as_str().unwrap_or_default()).map(|at| now - at);
		match idle_for {
			Some(idle) if idle < LEFTOVER_IDLE_MS => extract_when_idle(app, id, scope, LEFTOVER_IDLE_MS - idle),
			// NaN compares false in the TS, so an unreadable time extracts now.
			_ => run_extraction(app, id),
		}
	}
	Ok(())
}

/// Asks in Talk about deadlines with nothing linked (each once), once Talk is quiet.
fn ask_about_deadlines(app: &Arc<App>, now: i64) -> Result<(), String> {
	if app.turns.asking_deadlines.load(Ordering::SeqCst) || is_turn_running(app, TALK_CHAT_ID) {
		return Ok(());
	}
	let talk = app.stores.chats.get_chat(TALK_CHAT_ID);
	if !talk_quiet(talk.as_ref(), now) {
		return Ok(());
	}
	let asked = asked_deadline_ids(talk.as_ref().and_then(|t| t["messages"].as_arr()).map_or(&[][..], Vec::as_slice));
	let deadlines = unlinked_deadlines(&app.stores.spaces.list_space_records(), &local_day(now), &asked);
	if deadlines.is_empty() {
		return Ok(());
	}
	talk_chat(app)?;
	// One request at a time: two agents that start waiting together both get here.
	if app.turns.asking_deadlines.swap(true, Ordering::SeqCst) {
		return Ok(());
	}
	let sent = handle_chat_input(app, TALK_CHAT_ID, TurnInput::Steers(vec![coverage_request(&deadlines)]));
	let app = app.clone();
	tokio::spawn(async move {
		let reply = sent.await;
		if !reply.ok() {
			eprintln!("[catch-up] deadline request not sent ({}): {}", reply.status, reply.text());
		}
		app.turns.asking_deadlines.store(false, Ordering::SeqCst);
	});
	Ok(())
}

/// The agent started waiting for work.
pub fn catch_up_for_agent(app: &Arc<App>, now: i64) {
	let run = || -> Result<(), String> {
		catch_up_lessons(app, now)?;
		ask_about_deadlines(app, now)
	};
	if let Err(err) = run() {
		eprintln!("[catch-up] failed: {err}");
	}
}

/// A deadline was added: ask about it now if an agent is working.
pub fn ask_about_new_deadlines(app: &Arc<App>) {
	let now = clock::now_ms();
	if !app.bridge.agent_teaching(now) {
		return;
	}
	if let Err(err) = ask_about_deadlines(app, now) {
		eprintln!("[catch-up] failed: {err}");
	}
}
