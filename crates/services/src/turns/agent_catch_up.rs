//! What godspeed does by itself at the server's start: lessons whose last stretch never reached
//! the graph (queued runs do not survive a restart) are extracted, and lessons left with new
//! answers queue their notes.

use std::collections::HashSet;
use std::sync::Arc;

use gs_base::{clock, time};
use gs_core::contracts::chat::extracts_facts;

use super::turn_liveness::is_turn_running;
use super::turn_service::{LEFTOVER_IDLE_MS, extract_when_idle, run_extraction, uncovered_tokens};
use crate::App;

/// Extracts what each lesson has left: now when it already sits idle, else once it has (its timer
/// died with the last run). `runs.claim` keeps a lesson to one run at a time.
fn catch_up_lessons(app: &Arc<App>, now: i64) -> Result<(), String> {
	if !app.stores.settings.effective_settings()?["graph"]["enabled"].truthy() {
		return Ok(());
	}
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

/// At the server's start.
pub fn catch_up(app: &Arc<App>) {
	if let Err(err) = catch_up_lessons(app, clock::now_ms()) {
		eprintln!("[catch-up] failed: {err}");
	}
	crate::vault::catch_up(app);
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[tokio::test]
	async fn a_lesson_with_text_the_graph_has_not_seen_is_handed_out_each_time() {
		let root = scratch_dir("catch-up");
		let app = test_app(&root);
		let id = app.stores.chats.create_chat("t", None, None, None, &[]).unwrap()["id"].as_str().unwrap().to_owned();
		let taught = "A limit is the value a function approaches. ".repeat(20);
		let said = json!({ "id": "msg_a", "role": "assistant", "content": [{ "type": "text", "text": taught }], "stopReason": "stop", "timestamp": 1 });
		app.stores.chats.save_messages(&id, &[said]).unwrap();
		let handed = || {
			app.turns.leftover_timers.lock().clear();
			catch_up_lessons(&app, clock::now_ms()).unwrap();
			app.turns.leftover_timers.lock().contains_key(&id)
		};
		assert!(handed(), "the start hands the lesson out");
		assert!(handed(), "and so does the next call, in case the first run failed");
	}
}
