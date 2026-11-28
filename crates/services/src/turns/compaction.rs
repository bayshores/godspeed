//! The compaction service (compaction.ts): the trigger plumbing around core's cuts and markers. A
//! turn never waits on a summary:
//!
//! - shorten: once the lesson's transcript (`lesson_tokens`) is past the threshold godspeed cuts the record and writes its own short version of what
//!   it dropped (`local_summary`), at once and without a model, at the turn-start gate and when a
//!   turn settles;
//! - refine: once the chat has been quiet for REFINE_QUIET_MS, the learner's agent writes the real
//!   summary (a job with no tools and one turn) and it takes the local version's place. A turn
//!   that starts meanwhile goes ahead on the local version.
//!
//! Shortening only runs between turns, so it never touches a live run.

use std::sync::Arc;

use gs_agent::subagents::pi_run::{SubagentRunOptions, run_subagent};
use gs_base::events::EventKind;
use gs_base::locks::LockKey;
use gs_base::tasks::detach;
use gs_base::{clock, ids, text, time};
use gs_core::messages::compaction_marks::active_compaction_of;
use gs_core::session::prices::CallUsage;
use gs_core::session::compaction::{
	KEEP_RECENT_TOKENS, build_compaction_prompt, compaction_cut_index, compaction_span, effective_threshold_tokens, lesson_tokens, local_summary, new_compaction_marker, plan_tree_to_text,
	serialize_for_summary,
};
use gs_json::{Json, json};

use super::turn_liveness::is_turn_running;
use crate::App;
use crate::jobs::job_agent::job_agent;

/// The summarizer's system prompt: operational framing, not doctrine.
const SUMMARIZER_SYSTEM_PROMPT: &str = "You are the session-compaction summarizer for a tutoring agent. You receive the transcript span to summarize and write exactly the summary the instructions demand — nothing else, no preamble, no meta-commentary.";

/// How long a chat sits quiet before its model writes the real summary.
const REFINE_QUIET_MS: i64 = 5 * 60_000;

/// What a compaction needs from its host (the chat handler builds it per chat).
#[derive(Clone)]
pub(crate) struct CompactionDeps {
	/// `provider:id` of the lesson's model, also the summarizer's.
	pub model_id: String,
	/// min(the fixed threshold, context window - reserve).
	pub threshold_tokens: f64,
}

/// The token count at which a lesson on `model` is summarized, under the effective settings.
pub fn summarize_at_tokens(effective: &Json, model: &Json) -> f64 {
	effective_threshold_tokens(effective["compaction"]["thresholdTokens"].as_f64(), model["contextWindow"].as_f64())
}

/// Builds a chat's deps from its record as it is then; none when the chat is gone.
type BuildDeps = Arc<dyn Fn() -> Option<CompactionDeps> + Send + Sync>;

/// Cuts the record and adds godspeed's own short version of what was cut, when the lesson's
/// transcript is over the threshold. Never while a turn owns the chat.
fn shorten(app: &App, deps: &CompactionDeps, chat_id: &str) -> Result<(), String> {
	// A turn begins under the chat's lock, so this check holds until the save.
	let _guard = app.locks.lock(LockKey::Chat(chat_id));
	if is_turn_running(app, chat_id) {
		return Ok(());
	}
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return Ok(()) };
	let messages = record["messages"].items();
	let tokens_before = lesson_tokens(messages);
	if tokens_before <= deps.threshold_tokens {
		return Ok(());
	}
	let cut = compaction_cut_index(messages, KEEP_RECENT_TOKENS);
	if cut == 0 || cut >= messages.len() {
		return Ok(());
	}
	// The span runs from the previous kept boundary to the cut; the previous summary rides along.
	// When the cut can't move past that boundary, the kept tail alone carries the projection, and
	// shortening again can't help. Said once per boundary, not at every turn.
	let previous = active_compaction_of(messages);
	let prev_kept = previous.and_then(|p| messages.iter().position(|m| m["id"] == p["details"]["firstKeptMessageId"]));
	if let (Some(_), Some(kept)) = (previous, prev_kept)
		&& cut <= kept
	{
		let boundary = (chat_id.to_owned(), gs_json::stringify(&messages[kept]["id"]));
		if app.turns.compaction_skips.lock().insert(boundary) {
			eprintln!("[chat {chat_id}] compaction skipped: the kept tail alone exceeds the threshold");
		}
		return Ok(());
	}
	let start = prev_kept.filter(|&kept| kept > 0);
	let prior_summary = start.and(previous).map(|p| p["content"].str_or_empty());
	let tree = record.get("tree").filter(|t| !t.is_null());
	let summary = local_summary(&messages[start.unwrap_or(0)..cut], prior_summary, plan_tree_to_text(tree, messages).as_deref());
	let details = json!({ "firstKeptMessageId": messages[cut]["id"], "tokensBefore": tokens_before, "at": time::iso_now(), "local": true });
	let mut saved = messages.to_vec();
	saved.push(new_compaction_marker(&summary, &details));
	app.stores.chats.save_messages(chat_id, &saved)?;
	app.events.emit(EventKind::RecordChanged, json!({ "chatId": chat_id }));
	Ok(())
}

fn shorten_logged(app: &App, deps: &CompactionDeps, chat_id: &str) {
	if let Err(err) = shorten(app, deps, chat_id) {
		eprintln!("[chat {chat_id}] shortening the lesson failed: {err}");
	}
}

/// The turn-start gate: a turn starts on a record that fits.
pub(crate) fn ensure_compacted(app: &App, deps: &CompactionDeps, chat_id: &str) {
	shorten_logged(app, deps, chat_id);
}

/// The settle kick: shortens now if the turn pushed the lesson over, and (re)starts the quiet wait
/// for the real summary.
pub(crate) fn kick_compaction(app: &Arc<App>, build_deps: BuildDeps, chat_id: &str) {
	let Some(deps) = build_deps() else { return };
	shorten_logged(app, &deps, chat_id);
	refine_when_quiet(app, build_deps, chat_id, REFINE_QUIET_MS);
}

/// Refines after `delay_ms` on the app clock; a later call starts the wait again, and a turn
/// running then pushes it back.
fn refine_when_quiet(app: &Arc<App>, build_deps: BuildDeps, chat_id: &str, delay_ms: i64) {
	let number = {
		let mut count = app.turns.refine_count.lock();
		*count += 1;
		*count
	};
	app.turns.refine_timers.lock().insert(chat_id.to_owned(), number);
	let (app, chat_id) = (app.clone(), chat_id.to_owned());
	detach("chat", async move {
		clock::sleep(delay_ms).await;
		{
			let mut timers = app.turns.refine_timers.lock();
			if timers.get(&chat_id) != Some(&number) {
				return;
			}
			timers.remove(&chat_id);
		}
		let Some(deps) = build_deps() else { return };
		if is_turn_running(&app, &chat_id) {
			return refine_when_quiet(&app, build_deps, &chat_id, REFINE_QUIET_MS);
		}
		refine(&app, &deps, &chat_id).await;
	});
}

/// The chat's refine while it runs, listed in `app.turns.refining` until dropped.
struct Refining<'a> {
	app: &'a App,
	chat_id: &'a str,
}

impl Drop for Refining<'_> {
	fn drop(&mut self) {
		self.app.turns.refining.lock().remove(self.chat_id);
	}
}

/// Replaces the chat's local shortening with the model's summary of the same messages. Keeps the
/// record as it is when the summary fails or comes back empty, or when a newer marker took over.
async fn refine(app: &Arc<App>, deps: &CompactionDeps, chat_id: &str) {
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return };
	let messages = record["messages"].items();
	let Some(marker) = active_compaction_of(messages).filter(|m| m["details"]["local"].truthy()).cloned() else { return };
	let Some(covered) = compaction_span(messages, &marker) else { return };
	let span_text = serialize_for_summary(covered.span);
	let full_span = match covered.prior_summary.filter(|prior| !prior.is_empty()) {
		Some(prior) => format!("[SYSTEM NOTE — prior compaction summary, still authoritative where not superseded]\n{prior}\n\n{span_text}"),
		None => span_text,
	};
	let tree = record.get("tree").filter(|t| !t.is_null());
	let prompt = build_compaction_prompt(&full_span, plan_tree_to_text(tree, messages).as_deref());
	if !app.turns.refining.lock().insert(chat_id.to_owned()) {
		return;
	}
	let _refining = Refining { app, chat_id };
	if let Err(err) = summarize_and_replace(app, deps, chat_id, &prompt, &marker).await {
		// The local version stays; the next quiet stretch tries again.
		eprintln!("[chat {chat_id}] the lesson summary failed: {err}");
	}
}

async fn summarize_and_replace(app: &Arc<App>, deps: &CompactionDeps, chat_id: &str, prompt: &str, marker: &Json) -> Result<(), String> {
	let (summary, usage) = summarize(app, prompt).await?;
	let trimmed = text::trim(&summary);
	// An empty summary is a refusal artifact.
	if trimmed.is_empty() {
		return Ok(());
	}
	{
		let _guard = app.locks.lock(LockKey::Chat(chat_id));
		// Turns and other writers save while the summary is written.
		let Some(fresh) = app.stores.chats.get_chat(chat_id) else { return Ok(()) };
		let messages = fresh["messages"].items();
		if active_compaction_of(messages).map(|m| &m["id"]) != Some(&marker["id"]) {
			return Ok(());
		}
		let mut details = marker["details"].clone();
		if let Some(o) = details.as_obj_mut() {
			o.insert("model", deps.model_id.as_str());
			o.insert("local", false);
		}
		let mut refined = new_compaction_marker(trimmed, &details);
		if let Some(o) = refined.as_obj_mut() {
			o.insert("id", marker["id"].clone());
			o.insert("timestamp", marker["timestamp"].clone());
		}
		let replaced: Vec<Json> = messages.iter().map(|m| if m["id"] == marker["id"] { refined.clone() } else { m.clone() }).collect();
		app.stores.chats.save_messages(chat_id, &replaced)?;
	}
	// A real model call on the session's own engine: usage keys to the marker.
	let step = CallUsage::from_model_usage(&usage).to_json();
	let entry = json!({ "id": ids::uuid(), "messageId": marker["id"], "at": time::iso_now(), "model": deps.model_id, "steps": [step] });
	app.stores.chats.append_turn_usage(chat_id, &entry)?;
	app.events.emit(EventKind::RecordChanged, json!({ "chatId": chat_id }));
	Ok(())
}

/// The one-shot summary call: zero tools, one turn, text out, with the last call's usage.
async fn summarize(app: &Arc<App>, prompt: &str) -> Result<(String, Json), String> {
	let usage = Arc::new(parking_lot::Mutex::new(json!({ "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } })));
	let sink = usage.clone();
	let mut options = SubagentRunOptions::new("Summary".to_owned(), SUMMARIZER_SYSTEM_PROMPT, Json::from(prompt), 1);
	options.on_usage = Some(Arc::new(move |u: &Json, _model: &str| *sink.lock() = u.clone()));
	let result = run_subagent(job_agent(app).as_ref(), Vec::new(), options).await.map_err(|err| err.to_string())?;
	let usage = usage.lock().clone();
	Ok((result.text, usage))
}

#[cfg(test)]
mod tests {
	use gs_core::contracts::chat::COMPACTED_HISTORY_HEADER;
	use gs_core::messages::native_messages::new_user_message;
	use gs_core::messages::role::is_custom;
	use gs_engine::turn::messages::agent_model;
	use gs_runtime::Usage;
	use gs_runtime::fake::{FakeAgent, FakeStep};

	use super::*;
	use crate::app::agents::use_runtime;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::turns::turn_liveness::{begin_turn, end_turn};

	fn big(label: &str) -> Json {
		new_user_message(&format!("{label}: {}", "x".repeat(100 * 1024)), &[])
	}

	/// A lesson whose record projects far over any test threshold.
	fn over_threshold_chat(app: &App) -> String {
		let chat = app.stores.chats.create_chat("Sets", None, None, None, &[]).unwrap();
		let id = chat["id"].as_str().unwrap().to_owned();
		app.stores.chats.save_messages(&id, &[big("m1"), big("m2"), big("m3"), new_user_message("recent", &[])]).unwrap();
		id
	}

	#[test]
	fn the_summary_point_is_the_setting_cut_to_fit_the_models_window() {
		let model = |window: f64| {
			let mut model = agent_model();
			model.set("contextWindow", window);
			model
		};
		let setting = |tokens: f64| json!({ "compaction": { "thresholdTokens": tokens } });
		assert_eq!(summarize_at_tokens(&setting(90_000.0), &model(1_000_000.0)), 90_000.0);
		assert_eq!(summarize_at_tokens(&setting(90_000.0), &model(50_000.0)), effective_threshold_tokens(Some(90_000.0), Some(50_000.0)));
		assert_eq!(summarize_at_tokens(&json!({}), &model(1_000_000.0)), effective_threshold_tokens(None, Some(1_000_000.0)));
	}

	fn deps(threshold_tokens: f64) -> CompactionDeps {
		CompactionDeps { model_id: "agent:outside-agent".to_owned(), threshold_tokens }
	}

	/// The learner's agent, writing `summaries` one turn each.
	fn summarizer(app: &Arc<App>, summaries: &[&str]) {
		let turns = summaries.iter().map(|summary| vec![FakeStep::Usage(Usage { input: 9_000, cached: 0, output: 200 }), FakeStep::Text((*summary).to_owned())]);
		use_runtime(app, FakeAgent::new(turns.collect()).runtime());
	}

	fn markers(app: &App, chat_id: &str) -> Vec<Json> {
		app.stores.chats.get_chat(chat_id).unwrap()["messages"].items().iter().filter(|m| is_custom(m, "compaction")).cloned().collect()
	}

	fn active(app: &App, chat_id: &str) -> Option<Json> {
		active_compaction_of(app.stores.chats.get_chat(chat_id).unwrap()["messages"].items()).cloned()
	}

	fn add(app: &App, chat_id: &str, more: &[Json]) {
		let mut messages = app.stores.chats.get_chat(chat_id).unwrap()["messages"].items().to_vec();
		messages.extend(more.iter().cloned());
		app.stores.chats.save_messages(chat_id, &messages).unwrap();
	}

	#[test]
	fn over_the_threshold_a_local_marker_lands_at_once() {
		let root = scratch_dir("compaction-shorten");
		let app = test_app(&root);
		let chat_id = over_threshold_chat(&app);
		let mut events = app.events.subscribe();
		ensure_compacted(&app, &deps(40_000.0), &chat_id);
		let marker = active(&app, &chat_id).expect("the marker landed");
		assert_eq!(marker["details"]["local"], Json::Bool(true));
		assert!(marker["content"].as_str().unwrap().contains("godspeed shortened the earlier part"));
		assert!(marker["details"]["tokensBefore"].as_f64().unwrap() > 40_000.0);
		assert!(lesson_tokens(app.stores.chats.get_chat(&chat_id).unwrap()["messages"].items()) < 40_000.0);
		let changed: Vec<Json> = std::iter::from_fn(|| events.try_recv().ok()).filter(|e| e.kind == EventKind::RecordChanged).map(|e| e.payload).collect();
		assert_eq!(changed, [json!({ "chatId": chat_id })]);
	}

	/// About 1,000 tokens of a teacher's reply.
	fn reply_of_1k(label: &str) -> Json {
		json!({ "id": format!("msg_{label}"), "role": "assistant", "content": [{ "type": "text", "text": format!("{label} {}", "y".repeat(4_000)) }], "stopReason": "stop", "usage": { "input": 60_000, "output": 500 }, "timestamp": 1 })
	}

	/// One turn of about 1,000 tokens: a short answer and the reply.
	fn turn_of_1k(label: &str) -> [Json; 2] {
		[new_user_message(&format!("{label} answer"), &[]), reply_of_1k(label)]
	}

	fn lesson_of(app: &App, chat_id: &str) -> f64 {
		lesson_tokens(app.stores.chats.get_chat(chat_id).unwrap()["messages"].items())
	}

	#[test]
	fn a_shortened_lesson_has_room_and_the_next_turns_add_no_marker_until_it_is_over_again() {
		let root = scratch_dir("compaction-room");
		let app = test_app(&root);
		let chat_id = app.stores.chats.create_chat("Sets", None, None, None, &[]).unwrap()["id"].as_str().unwrap().to_owned();
		let opening: Vec<Json> = (0..45).flat_map(|i| turn_of_1k(&format!("t{i}"))).collect();
		app.stores.chats.save_messages(&chat_id, &opening).unwrap();
		let deps = deps(40_000.0);
		ensure_compacted(&app, &deps, &chat_id);
		assert_eq!(markers(&app, &chat_id).len(), 1);
		assert!(lesson_of(&app, &chat_id) <= 30_000.0, "at least 10k of room: {}", lesson_of(&app, &chat_id));
		let mut first_over = None;
		for i in 0..20 {
			add(&app, &chat_id, &turn_of_1k(&format!("n{i}")));
			let over = lesson_of(&app, &chat_id) > 40_000.0;
			let before = markers(&app, &chat_id).len();
			ensure_compacted(&app, &deps, &chat_id);
			let added = markers(&app, &chat_id).len() - before;
			assert_eq!(added, usize::from(over), "turn {i}: a marker only past the threshold");
			if over && first_over.is_none() {
				first_over = Some(i);
			}
		}
		assert!(first_over.is_none_or(|i| i >= 10), "only {first_over:?} turns fit");
	}

	#[test]
	fn a_lesson_under_the_threshold_is_not_cut_whatever_its_usage_says() {
		let root = scratch_dir("compaction-opening");
		let app = test_app(&root);
		let chat_id = app.stores.chats.create_chat("Sets", None, None, None, &[]).unwrap()["id"].as_str().unwrap().to_owned();
		let card = json!({ "name": "Sets", "files": [] });
		let mut messages = vec![gs_core::messages::native_messages::new_space_context_message(&card)];
		messages.extend((0..30).flat_map(|i| turn_of_1k(&format!("t{i}"))));
		app.stores.chats.save_messages(&chat_id, &messages).unwrap();
		ensure_compacted(&app, &deps(40_000.0), &chat_id);
		assert!(active(&app, &chat_id).is_none(), "every reply reports 60k of usage, but the lesson is about 30k");
	}

	#[test]
	fn under_the_threshold_or_while_a_turn_runs_nothing_happens() {
		let root = scratch_dir("compaction-noop");
		let app = test_app(&root);
		let chat_id = over_threshold_chat(&app);
		ensure_compacted(&app, &deps(10_000_000.0), &chat_id);
		assert!(begin_turn(&app, &chat_id));
		ensure_compacted(&app, &deps(40_000.0), &chat_id);
		end_turn(&app, &chat_id);
		assert!(active(&app, &chat_id).is_none());
	}

	#[tokio::test]
	async fn the_settle_kick_shortens_once() {
		let root = scratch_dir("compaction-kick");
		let app = test_app(&root);
		let chat_id = over_threshold_chat(&app);
		let build: BuildDeps = Arc::new(|| Some(deps(40_000.0)));
		kick_compaction(&app, build.clone(), &chat_id);
		kick_compaction(&app, build, &chat_id);
		kick_compaction(&app, Arc::new(|| None), &chat_id);
		assert_eq!(markers(&app, &chat_id).len(), 1);
		assert_eq!(app.turns.refine_timers.lock().len(), 1);
	}

	#[test]
	fn a_second_shortening_carries_the_first_forward() {
		let root = scratch_dir("compaction-chained");
		let app = test_app(&root);
		let chat_id = over_threshold_chat(&app);
		let deps = deps(40_000.0);
		ensure_compacted(&app, &deps, &chat_id);
		add(&app, &chat_id, &[big("m9"), big("m10"), big("m11")]);
		ensure_compacted(&app, &deps, &chat_id);
		assert_eq!(markers(&app, &chat_id).len(), 2);
		let content = active(&app, &chat_id).unwrap()["content"].as_str().unwrap().to_owned();
		let before_that = content.find("## Before that\n").expect("the first summary rides along");
		assert!(content[before_that..].contains("godspeed shortened"));
	}

	#[tokio::test]
	async fn the_model_summary_replaces_the_local_one_in_place_with_its_usage() {
		let root = scratch_dir("compaction-refine");
		let app: Arc<App> = test_app(&root);
		let chat_id = over_threshold_chat(&app);
		summarizer(&app, &[" SUMMARY: the learner knows X. "]);
		let deps = deps(40_000.0);
		ensure_compacted(&app, &deps, &chat_id);
		let local = active(&app, &chat_id).unwrap();
		refine(&app, &deps, &chat_id).await;
		let refined = active(&app, &chat_id).unwrap();
		assert_eq!((&refined["id"], &refined["timestamp"]), (&local["id"], &local["timestamp"]));
		assert_eq!(refined["content"], json!(format!("{COMPACTED_HISTORY_HEADER}\n\nSUMMARY: the learner knows X.")));
		let details = refined["details"].as_obj().unwrap();
		assert_eq!(details.keys().map(String::as_str).collect::<Vec<_>>(), ["firstKeptMessageId", "tokensBefore", "at", "local", "model"]);
		assert_eq!((&refined["details"]["local"], &refined["details"]["model"]), (&json!(false), &json!("agent:outside-agent")));
		assert_eq!(refined["details"]["firstKeptMessageId"], local["details"]["firstKeptMessageId"]);
		let turns = app.stores.chats.get_chat(&chat_id).unwrap()["turns"].clone();
		assert_eq!(turns.as_arr().map(Vec::len), Some(1));
		assert_eq!((&turns[0]["messageId"], &turns[0]["model"]), (&local["id"], &json!("agent:outside-agent")));
		assert_eq!(turns[0]["steps"][0]["inputTokens"], json!(9_000));
		// A refined marker is not summarized again (the agent has nothing left to say).
		refine(&app, &deps, &chat_id).await;
		assert_eq!(active(&app, &chat_id).unwrap(), refined);
	}

	#[tokio::test]
	async fn a_failure_or_an_empty_summary_keeps_the_local_one() {
		let root = scratch_dir("compaction-kept");
		let app: Arc<App> = test_app(&root);
		let chat_id = over_threshold_chat(&app);
		let fails = vec![FakeStep::Fail("overloaded".to_owned())];
		let empty = vec![FakeStep::Text("  ".to_owned())];
		use_runtime(&app, FakeAgent::new(vec![fails, empty]).runtime());
		let deps = deps(40_000.0);
		ensure_compacted(&app, &deps, &chat_id);
		refine(&app, &deps, &chat_id).await;
		refine(&app, &deps, &chat_id).await;
		assert_eq!(active(&app, &chat_id).unwrap()["details"]["local"], json!(true));
		assert!(app.stores.chats.get_chat(&chat_id).unwrap()["turns"].as_arr().is_none_or(Vec::is_empty));
		assert!(app.turns.refining.lock().is_empty());
	}
}
