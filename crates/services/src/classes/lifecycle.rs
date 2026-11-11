//! Creating, editing and deleting a class, and moving a lesson between classes (classes.ts).

use std::collections::HashSet;
use std::sync::Arc;

use gs_base::locks::LockKey;
use gs_base::clock;
use gs_core::contracts::chat::extracts_facts;
use gs_core::contracts::class::parse_class_scope;
use gs_core::graph::graph_deletion::{ChatDeleteMode, delete_chat_traces};
use gs_json::Json;

use super::class_card::apply_class_card;
use super::files::{files_of, source_id_for, str_of};
use super::{ClassFailure, ClassOutcome, fail, no_class};
use crate::App;
use crate::graph::extraction::extraction;
use crate::graph::extraction_runs::{abort_extraction, extraction_statuses};
use crate::graph::graph::graph_store_for;
use crate::graph::topics::cancel_topic_grouping;
use crate::jobs::jobs::discard_chat_deliveries;
use crate::turns::chats::{quiesce_chat_for_rewrite, running_work_blocker};
use crate::turns::turn_runs::clear_turn_failure;

/// How long a delete waits for the class's file imports to stop.
const IMPORT_WIND_DOWN_MS: i64 = 10_000;

/// The class scope a request names with `?class=<id|none>` (absent is No class): Some(None) for
/// No class, Some(Some(id)) for a class; None when malformed or the class doesn't exist.
pub fn request_class_scope(app: &App, raw: Option<&str>) -> Option<Option<String>> {
	let scope = parse_class_scope(raw)?;
	if let Some(id) = &scope
		&& app.stores.classes.get_class(id).is_none()
	{
		return None;
	}
	Some(scope)
}

pub fn list_classes(app: &App) -> Vec<Json> {
	app.stores.classes.list_classes()
}

pub fn get_class(app: &App, id: &str) -> Option<Json> {
	app.stores.classes.get_class(id)
}

/// `init` holds `name` and optionally `description`, `signature` and `icon`.
pub fn create_class(app: &App, init: &Json) -> Result<Json, String> {
	app.stores.classes.create_class(init)
}

/// `patch` may hold `name`, `description`, `archived`, `signature` (null clears it), `icon` and
/// `rules`.
pub fn update_class(app: &App, id: &str, patch: &Json) -> ClassOutcome<Json> {
	if app.stores.classes.get_class(id).is_none() {
		return no_class();
	}
	app.stores.classes.update_class(id, patch).map_err(ClassFailure::thrown)
}

fn lessons_of(app: &App, class_id: &str) -> Vec<Json> {
	app.stores.chats.list_chats().into_iter().filter(|c| c["classId"].as_str() == Some(class_id)).collect()
}

/// Deletes a class with its lessons, copied files and graph; the ids of the lessons removed.
/// Refused while any of its lessons has a turn or job running; extractions are aborted and waited
/// out. A linked folder on the learner's computer is untouched.
pub async fn delete_class(app: &Arc<App>, id: &str) -> ClassOutcome<Vec<String>> {
	let Some(record) = app.stores.classes.get_class(id) else { return no_class() };
	for lesson in lessons_of(app, id) {
		if let Some(blocker) = quiesce_chat_for_rewrite(app, str_of(&lesson, "id")).await {
			return fail(blocker.status, blocker.code, format!("{}: {}", str_of(&lesson, "title"), blocker.error));
		}
	}
	// The class's file imports: abort and wait them out. Aborted again on every pass, since the
	// queue can start the next file during the wait.
	let source_ids: HashSet<String> = files_of(&record).iter().map(|f| source_id_for(id, str_of(f, "id"))).collect();
	let deadline = clock::now_ms() + IMPORT_WIND_DOWN_MS;
	while extraction_statuses(app).iter().any(|run| run["chatId"].as_str().is_some_and(|c| source_ids.contains(c))) {
		for sid in &source_ids {
			abort_extraction(app, sid);
		}
		if clock::now_ms() > deadline {
			return fail(503, "extraction_winding_down", "The class's file imports are still stopping. Try again in a moment.");
		}
		clock::sleep(50).await;
	}
	// Lessons may have started a turn, or been created in or moved out of the class, during the
	// waits above: read them again, with no await before the removal.
	let current = lessons_of(app, id);
	for lesson in &current {
		let lesson_id = str_of(lesson, "id");
		if let Some(busy) = running_work_blocker(app, lesson_id) {
			return fail(busy.status, busy.code, format!("{}: {}", str_of(lesson, "title"), busy.error));
		}
		if extraction_statuses(app).iter().any(|run| run["chatId"].as_str() == Some(lesson_id)) {
			return fail(503, "extraction_winding_down", format!("{}: This lesson is still finishing its graph work. Try again in a moment.", str_of(lesson, "title")));
		}
	}
	let mut lesson_ids = Vec::new();
	{
		// Under the class lock, a stopped grouping run ends (its activity event) after the class
		// is gone, as it does after the TS sync block.
		let _guard = app.locks.lock(LockKey::Class(id));
		app.classes.cancelled.lock().insert(id.to_owned());
		cancel_topic_grouping(app, id);
		for lesson in &current {
			let lesson_id = str_of(lesson, "id");
			app.stores.jobs.delete_jobs_for_chat(lesson_id);
			if app.stores.chats.delete_chat(lesson_id) {
				discard_chat_deliveries(app, lesson_id);
				clear_turn_failure(app, lesson_id);
				lesson_ids.push(lesson_id.to_owned());
			}
		}
		app.stores.classes.delete_class(id).map_err(ClassFailure::thrown)?;
	}
	app.stores.graphs.forget_graph_store(id);
	app.search.forget_class_search(id);
	app.classes.folder_scans.lock().remove(id);
	app.classes.seen_files.lock().remove(id);
	Ok(lesson_ids)
}

/// Moves a lesson to another class (or No class): its facts leave the old graph (a fact another
/// lesson or file also produced stays there) and are rebuilt in the new one by extraction over
/// the whole lesson. The lesson's class card follows. The class it is in now.
pub async fn move_chat_to_class(app: &Arc<App>, chat_id: &str, target: Option<&str>) -> ClassOutcome<Option<String>> {
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return fail(404, "not_found", "No such lesson") };
	let target_class = match target {
		Some(id) => match app.stores.classes.get_class(id) {
			Some(cls) => Some(cls),
			None => return fail(404, "class_not_found", "No such class"),
		},
		None => None,
	};
	let from = record["classId"].as_str().filter(|c| !c.is_empty());
	if from == target {
		return Ok(target.map(str::to_owned));
	}
	if let Some(blocker) = quiesce_chat_for_rewrite(app, chat_id).await {
		return fail(blocker.status, blocker.code, blocker.error);
	}
	{
		let _guard = app.locks.lock(LockKey::Graph(from));
		delete_chat_traces(graph_store_for(app, from).as_ref(), chat_id, ChatDeleteMode::DeleteNodes).map_err(ClassFailure::thrown)?;
	}
	app.stores.chats.set_chat_class(chat_id, target).map_err(ClassFailure::thrown)?;
	apply_class_card(app, chat_id, target_class.as_ref()).map_err(ClassFailure::thrown)?;
	let graph_on = app.stores.settings.effective_settings().is_ok_and(|s| s["graph"]["enabled"].truthy());
	if extracts_facts(record["kind"].as_str()) && graph_on {
		let (app, chat_id) = (app.clone(), chat_id.to_owned());
		tokio::spawn(async move {
			if let Err(err) = extraction(&app).run_extraction(&chat_id).await {
				eprintln!("[classes] rebuild after move skipped for {chat_id}: {err}");
			}
		});
	}
	Ok(target.map(str::to_owned))
}
