//! Creating, editing and deleting a space, and moving a lesson between spaces (spaces.ts).

use std::collections::HashSet;
use std::sync::Arc;

use gs_base::locks::LockKey;
use gs_base::clock;
use gs_core::contracts::chat::extracts_facts;
use gs_core::contracts::space::parse_space_scope;
use gs_core::graph::graph_deletion::ChatDeleteMode;
use gs_json::Json;

use super::space_card::apply_space_card;
use super::files::{files_of, source_id_for, str_of};
use super::{SpaceFailure, SpaceOutcome, fail, no_space};
use crate::App;
use crate::graph::extraction::extraction;
use crate::graph::extraction_runs::{abort_extraction, extraction_statuses};
use crate::graph::graph::delete_chat_from_graph;
use crate::graph::topics::cancel_topic_grouping;
use crate::preps::prep_runs::cancel_prep_runs;
use crate::jobs::jobs::discard_chat_deliveries;
use crate::turns::chats::{quiesce_chat_for_rewrite, rewrite_blocker};
use crate::turns::turn_runs::clear_turn_failure;

/// How long a delete waits for the space's file imports to stop.
const IMPORT_WIND_DOWN_MS: i64 = 10_000;

/// The space scope a request names with `?space=<id|none>` (absent is No space): Some(None) for
/// No space, Some(Some(id)) for a space; None when malformed or the space doesn't exist.
pub fn request_space_scope(app: &App, raw: Option<&str>) -> Option<Option<String>> {
	let scope = parse_space_scope(raw)?;
	if let Some(id) = &scope
		&& app.stores.spaces.get_space(id).is_none()
	{
		return None;
	}
	Some(scope)
}

/// `patch` may hold `name`, `description`, `archived`, `signature` (null clears it), `icon`,
/// `color` and `rules`.
pub fn update_space(app: &App, id: &str, patch: &Json) -> SpaceOutcome<Json> {
	if app.stores.spaces.get_space(id).is_none() {
		return no_space();
	}
	app.stores.spaces.update_space(id, patch).map_err(SpaceFailure::thrown)
}

/// Closes the summary of the teacher's last round of work on a space (nothing happens while a
/// round is still going).
pub fn close_space_work(app: &App, id: &str) -> Result<(), String> {
	app.stores.spaces.close_work(id).map(|_| ())
}

fn lessons_of(app: &App, space_id: &str) -> Vec<Json> {
	app.stores.chats.list_chats().into_iter().filter(|c| c["spaceId"].as_str() == Some(space_id)).collect()
}

/// Deletes a space with its lessons, copied files and graph; the ids of the lessons removed.
/// Refused while any of its lessons has a turn or job running; extractions are aborted and waited
/// out. A linked folder on the learner's computer is untouched.
pub async fn delete_space(app: &Arc<App>, id: &str) -> SpaceOutcome<Vec<String>> {
	// On its own task: a request whose client goes away is dropped at its next await, and once the
	// waits have aborted the space's work the delete must still finish.
	let (app, id) = (app.clone(), id.to_owned());
	tokio::spawn(async move { run_delete_space(&app, &id).await }).await.unwrap_or_else(|err| Err(SpaceFailure::thrown(err.to_string())))
}

async fn run_delete_space(app: &Arc<App>, id: &str) -> SpaceOutcome<Vec<String>> {
	let Some(record) = app.stores.spaces.get_space(id) else { return no_space() };
	for lesson in lessons_of(app, id) {
		if let Some(blocker) = quiesce_chat_for_rewrite(app, str_of(&lesson, "id")).await {
			return fail(blocker.status, blocker.code, format!("{}: {}", str_of(&lesson, "title"), blocker.error));
		}
	}
	// The space's file imports: abort and wait them out. Aborted again on every pass, since the
	// queue can start the next file during the wait.
	let source_ids: HashSet<String> = files_of(&record).iter().map(|f| source_id_for(id, str_of(f, "id"))).collect();
	let deadline = clock::now_ms() + IMPORT_WIND_DOWN_MS;
	while extraction_statuses(app).iter().any(|run| run["chatId"].as_str().is_some_and(|c| source_ids.contains(c))) {
		for sid in &source_ids {
			abort_extraction(app, sid);
		}
		if clock::now_ms() > deadline {
			return fail(503, "extraction_winding_down", "The space's file imports are still stopping. Try again in a moment.");
		}
		clock::sleep(50).await;
	}
	let mut lesson_ids = Vec::new();
	{
		// Under the space lock, a stopped grouping run ends (its activity event) after the space
		// is gone, as it does after the TS sync block.
		let _guard = app.locks.lock(LockKey::Space(id));
		// Lessons may have started a turn, or been created in or moved out of the space, during the
		// waits above: read them again and hold each one's lock (a turn begins under it, a move
		// runs under it) through the removal. Taken in id order, as the lock order asks.
		let mut current = lessons_of(app, id);
		let mut lock_order: Vec<&str> = current.iter().map(|lesson| str_of(lesson, "id")).collect();
		lock_order.sort_unstable();
		let _lessons: Vec<_> = lock_order.into_iter().map(|lesson_id| app.locks.lock(LockKey::Chat(lesson_id))).collect();
		current.retain(|lesson| app.stores.chats.get_chat(str_of(lesson, "id")).is_some_and(|now| now["spaceId"].as_str() == Some(id)));
		for lesson in &current {
			let lesson_id = str_of(lesson, "id");
			if let Some(busy) = rewrite_blocker(app, lesson_id) {
				return fail(busy.status, busy.code, format!("{}: {}", str_of(lesson, "title"), busy.error));
			}
		}
		app.spaces.cancelled.lock().insert(id.to_owned());
		cancel_topic_grouping(app, id);
		cancel_prep_runs(app, id);
		for lesson in &current {
			let lesson_id = str_of(lesson, "id");
			app.stores.jobs.delete_jobs_for_chat(lesson_id);
			if app.stores.chats.delete_chat(lesson_id) {
				discard_chat_deliveries(app, lesson_id);
				clear_turn_failure(app, lesson_id);
				lesson_ids.push(lesson_id.to_owned());
			}
		}
		app.stores.spaces.delete_space(id).map_err(SpaceFailure::thrown)?;
	}
	app.stores.graphs.forget_graph_store(id);
	app.search.forget_space_search(id);
	app.spaces.folder_scans.lock().remove(id);
	app.spaces.seen_files.lock().remove(id);
	Ok(lesson_ids)
}

fn space_of(lesson: &Json) -> Option<&str> {
	lesson["spaceId"].as_str().filter(|c| !c.is_empty())
}

/// Moves a lesson to another space (or No space): its facts leave the old graph (a fact another
/// lesson or file also produced stays there) and are rebuilt in the new one by extraction over
/// the whole lesson. The lesson's space card follows. The space it is in now.
pub async fn move_chat_to_space(app: &Arc<App>, chat_id: &str, target: Option<&str>) -> SpaceOutcome<Option<String>> {
	// On its own task, like a space delete: once the wind-down has aborted the lesson's extraction,
	// the move finishes even if its request goes away.
	let (app, chat_id, target) = (app.clone(), chat_id.to_owned(), target.map(str::to_owned));
	tokio::spawn(async move { run_move(&app, &chat_id, target.as_deref()).await }).await.unwrap_or_else(|err| Err(SpaceFailure::thrown(err.to_string())))
}

async fn run_move(app: &Arc<App>, chat_id: &str, target: Option<&str>) -> SpaceOutcome<Option<String>> {
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return fail(404, "not_found", "No such lesson") };
	if target.is_some_and(|id| app.stores.spaces.get_space(id).is_none()) {
		return fail(404, "space_not_found", "No such space");
	}
	if space_of(&record) == target {
		return Ok(target.map(str::to_owned));
	}
	if let Some(blocker) = quiesce_chat_for_rewrite(app, chat_id).await {
		return fail(blocker.status, blocker.code, blocker.error);
	}
	// Space, then lesson, as the lock order asks. The target's lock keeps its delete from running
	// until the lesson is in it (the delete then sees it); the lesson's lock keeps a turn from
	// starting (or saving into the record) during the move. Both records are read again: the space
	// may have been deleted, or another move finished, during the wind-down.
	let _space = target.map(|id| app.locks.lock(LockKey::Space(id)));
	let _lesson = app.locks.lock(LockKey::Chat(chat_id));
	let target_space = match target {
		Some(id) => match app.stores.spaces.get_space(id) {
			Some(cls) => Some(cls),
			None => return fail(404, "space_not_found", "No such space"),
		},
		None => None,
	};
	if let Some(blocker) = rewrite_blocker(app, chat_id) {
		return fail(blocker.status, blocker.code, blocker.error);
	}
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return fail(404, "not_found", "No such lesson") };
	let from = space_of(&record);
	if from == target {
		return Ok(target.map(str::to_owned));
	}
	delete_chat_from_graph(app, from, chat_id, ChatDeleteMode::DeleteNodes).map_err(SpaceFailure::thrown)?;
	app.stores.chats.set_chat_space(chat_id, target).map_err(SpaceFailure::thrown)?;
	apply_space_card(app, chat_id, target_space.as_ref()).map_err(SpaceFailure::thrown)?;
	// Settings only for a lesson that extracts facts, as in Node: a read can save an old file anew.
	if extracts_facts(record["kind"].as_str()) && app.stores.settings.effective_settings().is_ok_and(|s| s["graph"]["enabled"].truthy()) {
		let (app, chat_id) = (app.clone(), chat_id.to_owned());
		tokio::spawn(async move {
			if let Err(err) = extraction(&app).run_extraction(&chat_id).await {
				eprintln!("[spaces] rebuild after move skipped for {chat_id}: {err}");
			}
		});
	}
	Ok(target.map(str::to_owned))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::turns::turn_liveness::begin_turn;

	#[test]
	fn a_turn_that_starts_while_a_move_waits_refuses_the_move() {
		let root = scratch_dir("move-turn");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&gs_json::json!({ "name": "Algebra" })).unwrap()["id"].as_str().unwrap().to_owned();
		let chat_id = app.stores.chats.create_chat("Sets", None, None, None).unwrap()["id"].as_str().unwrap().to_owned();
		// The learner's message is being written ahead of its turn.
		let writing = app.locks.lock(LockKey::Chat(&chat_id));
		let (moving, lesson, target) = (app.clone(), chat_id.clone(), space_id.clone());
		let moved = std::thread::spawn(move || {
			let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
			runtime.block_on(move_chat_to_space(&moving, &lesson, Some(&target))).map_err(|failure| failure.code)
		});
		std::thread::sleep(std::time::Duration::from_millis(100));
		assert!(begin_turn(&app, &chat_id));
		drop(writing);
		assert_eq!(moved.join().unwrap(), Err("turn_in_flight".to_owned()));
		assert!(app.stores.chats.get_chat(&chat_id).unwrap()["spaceId"].is_null());
	}

	#[test]
	fn a_move_into_a_space_deleted_while_it_waits_is_refused() {
		let root = scratch_dir("move-deleted");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&gs_json::json!({ "name": "Algebra" })).unwrap()["id"].as_str().unwrap().to_owned();
		let chat_id = app.stores.chats.create_chat("Sets", None, None, None).unwrap()["id"].as_str().unwrap().to_owned();
		// The space's delete holds it while the move arrives.
		let deleting = app.locks.lock(LockKey::Space(&space_id));
		let (moving, lesson, target) = (app.clone(), chat_id.clone(), space_id.clone());
		let moved = std::thread::spawn(move || {
			let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
			runtime.block_on(move_chat_to_space(&moving, &lesson, Some(&target))).map_err(|failure| failure.code)
		});
		std::thread::sleep(std::time::Duration::from_millis(100));
		app.stores.spaces.delete_space(&space_id).unwrap();
		drop(deleting);
		assert_eq!(moved.join().unwrap(), Err("space_not_found".to_owned()));
		assert!(app.stores.chats.get_chat(&chat_id).unwrap()["spaceId"].is_null());
		assert!(!app.paths.spaces.join(&space_id).exists());
	}
}
