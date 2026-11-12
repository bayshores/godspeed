//! The activity log: what changed lately, and who did it. Every MCP tool that changes something
//! records one action here, as do the app (a linked folder's new files) and the learner (answers,
//! deadlines saved in the app). The newest `ACTIONS_MAX` are saved to disk and served by
//! GET /api/agent-actions; each new one goes out as the "agent-action" event so Follow can open
//! the page an agent changed.

use std::sync::LazyLock;

use gs_base::events::EventKind;
use gs_base::re::Re;
use gs_base::{clock, ids, text, time};
use gs_json::{Json, Obj, json};

use crate::App;

const ACTIONS_MAX: usize = 200;
/// The same label on the same target within this window updates the newest entry instead of
/// adding one (a lesson turn calls respond many times).
const COALESCE_MS: i64 = 2 * 60_000;
const LABEL_MAX: usize = 80;
/// The `agent` of the app's own entries, which the teacher never flies to.
const APP_SOURCE: &str = "godspeed";
/// The `agent` of what the learner did in the app.
const LEARNER_SOURCE: &str = "you";

/// Read from disk on first use, so the log survives a restart.
fn with_list<R>(app: &App, f: impl FnOnce(&mut Vec<Json>) -> R) -> R {
	let mut guard = app.misc.actions.lock();
	f(guard.get_or_insert_with(|| app.stores.agent_actions.read_agent_actions()))
}

/// A failed save keeps the list in memory and never fails the change.
fn save(app: &App, list: &[Json]) {
	if let Err(err) = app.stores.agent_actions.write_agent_actions(list) {
		eprintln!("[agent-action] saving failed: {err}");
	}
}

/// A label cut to a readable length.
fn short_label(raw: &str) -> String {
	static SPACES: LazyLock<Re> = LazyLock::new(|| Re::new(r"\s+", "g"));
	let spaced = SPACES.replace(raw, " ");
	let one = text::trim(&spaced);
	if text::len16(one) > LABEL_MAX { format!("{}…", text::trim_end(&text::slice16(one, 0, Some(LABEL_MAX as i64 - 1)))) } else { one.to_owned() }
}

fn same_target(a: &Json, b: &Json) -> bool {
	match (a.is_null(), b.is_null()) {
		(true, true) => true,
		(false, false) => a["kind"] == b["kind"] && a["id"] == b["id"],
		_ => false,
	}
}

/// The entry was made less than `COALESCE_MS` ago.
fn is_recent(entry: &Json, now: i64) -> bool {
	entry["at"].as_str().and_then(time::parse_date).is_some_and(|at| now - at < COALESCE_MS)
}

/// Change the newest entry in place (it adds up several events) and announce it again.
fn update_newest(app: &App, list: &mut [Json], label: Option<&str>, now: i64) -> Json {
	let Some(last) = list.last_mut() else { return Json::Null };
	if let Some(obj) = last.as_obj_mut() {
		if let Some(label) = label {
			obj.insert("label", label);
		}
		obj.insert("at", time::iso(now));
	}
	save(app, list);
	list.last().cloned().unwrap_or(Json::Null)
}

/// Record one action and announce it. A repeat of the newest action (same label, agent and
/// target, within `COALESCE_MS`) only refreshes its time and is not announced again. `input` has
/// `label`, `spaceId`, `target`, `page` and optionally `removed` and `open`.
fn record_agent_action(app: &App, agent: Option<&str>, input: &Json, now: i64) -> Json {
	let label = short_label(input["label"].as_str().unwrap_or_default());
	let agent = agent.map(text::trim).filter(|a| !a.is_empty()).unwrap_or("Your agent");
	let removed = input["removed"].truthy();
	with_list(app, |list| {
		let repeat = !removed
			&& list.last().is_some_and(|last| last["label"].as_str() == Some(&label) && last["agent"].as_str() == Some(agent) && same_target(&last["target"], &input["target"]) && is_recent(last, now));
		if repeat {
			return update_newest(app, list, None, now);
		}
		let mut action = Obj::new();
		action.insert("id", ids::uuid_hex("act", 12));
		action.insert("at", time::iso(now));
		action.insert("agent", agent);
		action.insert("label", label);
		action.insert("spaceId", input["spaceId"].clone());
		action.insert("target", input["target"].clone());
		action.insert("page", input["page"].clone());
		if removed {
			action.insert("removed", true);
		}
		if input["open"].truthy() {
			action.insert("open", true);
		}
		let action = Json::Obj(action);
		list.push(action.clone());
		if list.len() > ACTIONS_MAX {
			list.drain(..list.len() - ACTIONS_MAX);
		}
		save(app, list);
		app.events.emit(EventKind::AgentAction, action.clone());
		action
	})
}

/// The newest entry changes in place and goes out again.
fn extend_newest(app: &App, label: &str, now: i64) {
	let action = with_list(app, |list| update_newest(app, list, Some(label), now));
	app.events.emit(EventKind::AgentAction, action);
}

/// Record what an outside agent changed, for the teacher's panel.
pub fn note_agent_action(app: &App, caller: Option<&str>, change: &Json) {
	record_agent_action(app, caller, change, clock::now_ms());
}

/// A linked folder's new files, as the app's own entry: "Added 3 files from Google Drive". Scans
/// a few minutes apart add to the newest such entry.
pub fn record_folder_files(app: &App, space_id: &str, count: usize, from: &str) {
	static LABEL: LazyLock<Re> = LazyLock::new(|| Re::new(r"^Added (\d+) files? from (.+)$", ""));
	let now = clock::now_ms();
	let label = |n: usize| format!("Added {n} {} from {from}", if n == 1 { "file" } else { "files" });
	let merged = with_list(app, |list| {
		let last = list.last()?;
		let found = (last["agent"].as_str() == Some(APP_SOURCE) && last["spaceId"].as_str() == Some(space_id) && is_recent(last, now))
			.then(|| LABEL.captures(last["label"].as_str().unwrap_or_default()))
			.flatten()?;
		(found.get(2).as_deref() == Some(from)).then(|| found.get(1).and_then(|n| n.parse::<usize>().ok()).map(|n| n + count))?
	});
	match merged {
		Some(total) => extend_newest(app, &label(total), now),
		None => {
			record_agent_action(app, Some(APP_SOURCE), &json!({ "label": label(count), "spaceId": space_id, "target": null, "page": "/space/files" }), now);
		}
	}
}

/// Right and total answers in an answer entry's label.
fn answer_tally(label: &str) -> Option<(usize, usize)> {
	static MANY: LazyLock<Re> = LazyLock::new(|| Re::new(r"^Answered (\d+) of (\d+) right$", ""));
	match label {
		"Answered right" => Some((1, 1)),
		"Answered wrong" | "Didn't know" => Some((0, 1)),
		_ => {
			let found = MANY.captures(label)?;
			Some((found.get(1)?.parse().ok()?, found.get(2)?.parse().ok()?))
		}
	}
}

/// A graded answer (quiz questions; others are graded by the agent later) as the learner's
/// entry. Answers to a lesson's questions in a row add up: "Answered 2 of 3 right".
pub fn record_answer(app: &App, lesson: &Json, answer: &Json) {
	if answer["kind"].as_str() != Some("quiz") {
		return;
	}
	let dont_know = answer["dontKnow"].truthy();
	let right = !dont_know && answer["correct"].as_bool() == Some(true);
	let now = clock::now_ms();
	let lesson_id = lesson["id"].as_str().unwrap_or_default();
	let target = json!({ "kind": "lesson", "id": lesson_id });
	let sum = with_list(app, |list| {
		let last = list.last()?;
		(last["agent"].as_str() == Some(LEARNER_SOURCE) && same_target(&last["target"], &target) && is_recent(last, now)).then(|| answer_tally(last["label"].as_str().unwrap_or_default())).flatten()
	});
	if let Some((so_far, total)) = sum {
		extend_newest(app, &format!("Answered {} of {} right", so_far + usize::from(right), total + 1), now);
		return;
	}
	let label = if dont_know {
		"Didn't know"
	} else if right {
		"Answered right"
	} else {
		"Answered wrong"
	};
	record_agent_action(app, Some(LEARNER_SOURCE), &json!({ "label": label, "spaceId": lesson["spaceId"], "target": target, "page": format!("/chat/{lesson_id}") }), now);
}

/// A deadline the learner saved in the app, with the verbs the agent's entries use: "Added Test
/// 2", "Moved Test 2", "Marked Test 2 done". `change` is "added" or the saved patch.
pub fn record_deadline_change(app: &App, space_id: &str, deadline: &Json, change: &Json) {
	let name = deadline["name"].as_str().unwrap_or_default();
	let label = match change.as_obj() {
		None => format!("Added {name}"),
		Some(patch) if patch.contains_key("done") => format!("Marked {name} {}", if patch.get("done").is_some_and(Json::truthy) { "done" } else { "not done" }),
		Some(patch) => {
			let moved = !patch.is_empty() && patch.keys().all(|key| key == "date" || key == "time");
			format!("{} {name}", if moved { "Moved" } else { "Changed" })
		}
	};
	let target = json!({ "kind": "deadline", "id": deadline["id"] });
	record_agent_action(app, Some(LEARNER_SOURCE), &json!({ "label": label, "spaceId": space_id, "target": target, "page": "/" }), clock::now_ms());
}

/// The saved actions, newest first.
pub fn recent_agent_actions(app: &App) -> Vec<Json> {
	with_list(app, |list| list.iter().rev().cloned().collect())
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	fn labels(app: &App) -> Vec<String> {
		recent_agent_actions(app).iter().map(|a| a["label"].as_str().unwrap_or_default().to_owned()).collect()
	}

	fn lesson_action(label: &str) -> Json {
		json!({ "label": label, "spaceId": null, "target": { "kind": "lesson", "id": "chat_a" }, "page": "/chat/chat_a" })
	}

	#[test]
	fn an_action_is_stored_in_order_announced_and_saved() {
		let root = scratch_dir("actions-store");
		let app = test_app(&root);
		let mut events = app.events.subscribe();
		let action = record_agent_action(&app, Some("  Claude Code "), &json!({ "label": "Adding\n  HW 5", "spaceId": "cls_a", "target": null, "page": "/", "open": true }), 1_000);
		assert!(action["id"].as_str().unwrap().starts_with("act_"));
		assert_eq!(
			stringify(&json!({ "agent": action["agent"], "label": action["label"], "at": action["at"], "open": action["open"] })),
			r#"{"agent":"Claude Code","label":"Adding HW 5","at":"1970-01-01T00:00:01.000Z","open":true}"#
		);
		assert_eq!(events.try_recv().unwrap().payload, action);
		assert_eq!(app.stores.agent_actions.read_agent_actions(), vec![action]);
	}

	#[test]
	fn a_repeat_inside_two_minutes_only_refreshes_the_time() {
		let root = scratch_dir("actions-repeat");
		let app = test_app(&root);
		let first = record_agent_action(&app, None, &lesson_action("Replying in Limits"), 1_000);
		let mut events = app.events.subscribe();
		let again = record_agent_action(&app, None, &lesson_action("Replying in Limits"), 61_000);
		assert_eq!((again["id"].clone(), again["agent"].as_str(), again["at"].as_str()), (first["id"].clone(), Some("Your agent"), Some("1970-01-01T00:01:01.000Z")));
		assert!(events.try_recv().is_err());
		record_agent_action(&app, None, &lesson_action("Replying in Limits"), 200_000);
		record_agent_action(&app, Some("Codex"), &lesson_action("Replying in Limits"), 201_000);
		assert_eq!(labels(&app).len(), 3);
	}

	#[test]
	fn a_removed_target_is_never_merged_and_long_labels_are_cut() {
		let root = scratch_dir("actions-removed");
		let app = test_app(&root);
		let removed = json!({ "label": "Removed HW 5", "spaceId": null, "target": null, "page": "/", "removed": true });
		record_agent_action(&app, None, &removed, 1_000);
		record_agent_action(&app, None, &removed, 2_000);
		let long = record_agent_action(&app, None, &lesson_action(&"word ".repeat(30)), 3_000);
		assert_eq!(text::len16(long["label"].as_str().unwrap()), LABEL_MAX);
		assert!(long["label"].as_str().unwrap().ends_with("word…"));
		assert_eq!(labels(&app).len(), 3);
	}

	#[test]
	fn only_the_newest_two_hundred_are_kept() {
		let root = scratch_dir("actions-max");
		let app = test_app(&root);
		for n in 0..205 {
			record_agent_action(&app, None, &json!({ "label": format!("Step {n}"), "spaceId": null, "target": null, "page": "/" }), 1_000 + n);
		}
		let kept = labels(&app);
		assert_eq!((kept.len(), kept[0].as_str(), kept[199].as_str()), (200, "Step 204", "Step 5"));
	}

	#[test]
	fn new_folder_files_join_the_newest_entry_from_the_same_place() {
		let root = scratch_dir("actions-folder");
		let app = test_app(&root);
		record_folder_files(&app, "cls_a", 1, "Google Drive");
		record_folder_files(&app, "cls_a", 2, "Google Drive");
		assert_eq!(labels(&app), ["Added 3 files from Google Drive"]);
		record_folder_files(&app, "cls_a", 1, "a folder");
		record_folder_files(&app, "cls_b", 2, "a folder");
		assert_eq!(labels(&app), ["Added 2 files from a folder", "Added 1 file from a folder", "Added 3 files from Google Drive"]);
		// Another space's same label only refreshes the newest entry, as the old server did.
		record_folder_files(&app, "cls_c", 2, "a folder");
		assert_eq!(labels(&app).len(), 3);
	}

	#[test]
	fn answers_in_a_row_add_up() {
		let root = scratch_dir("actions-answers");
		let app = test_app(&root);
		let lesson = json!({ "id": "chat_a", "spaceId": "cls_a" });
		record_answer(&app, &lesson, &json!({ "kind": "quiz", "correct": true }));
		assert_eq!(labels(&app), ["Answered right"]);
		record_answer(&app, &lesson, &json!({ "kind": "quiz", "correct": false }));
		record_answer(&app, &lesson, &json!({ "kind": "quiz", "correct": true, "dontKnow": true }));
		record_answer(&app, &lesson, &json!({ "kind": "open", "text": "x" }));
		assert_eq!(labels(&app), ["Answered 1 of 3 right"]);
		record_answer(&app, &json!({ "id": "chat_b" }), &json!({ "kind": "quiz", "dontKnow": true }));
		assert_eq!(labels(&app)[0], "Didn't know");
		assert_eq!(recent_agent_actions(&app)[0]["page"].as_str(), Some("/chat/chat_b"));
	}

	#[test]
	fn deadline_changes_use_the_agents_verbs() {
		let root = scratch_dir("actions-deadlines");
		let app = test_app(&root);
		let deadline = json!({ "id": "ddl_a", "name": "Test 2" });
		for change in [json!("added"), json!({ "date": "2026-11-12", "time": "10:00" }), json!({ "name": "Quiz 2" }), json!({ "done": true }), json!({ "done": false }), json!({})] {
			record_deadline_change(&app, "cls_a", &deadline, &change);
		}
		assert_eq!(labels(&app), ["Changed Test 2", "Marked Test 2 not done", "Marked Test 2 done", "Changed Test 2", "Moved Test 2", "Added Test 2"]);
		assert_eq!(stringify(&recent_agent_actions(&app)[5]["target"]), r#"{"kind":"deadline","id":"ddl_a"}"#);
	}

	#[test]
	fn the_log_comes_back_after_a_restart() {
		let root = scratch_dir("actions-restart");
		let app = test_app(&root);
		note_agent_action(&app, Some("Codex"), &lesson_action("Reading syllabus.pdf"));
		let again = test_app(&root);
		assert_eq!(labels(&again), ["Reading syllabus.pdf"]);
	}
}
