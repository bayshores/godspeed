//! The compaction service (compaction.ts): the trigger plumbing around core's cuts and markers. A
//! turn never waits on a summary:
//!
//! - shorten: past the threshold godspeed cuts the record and writes its own short version of what
//!   it dropped (`local_summary`), at once and without a model, at the turn-start gate and when a
//!   turn settles;
//! - refine: once the chat has been quiet for REFINE_QUIET_MS, the session's own model writes the
//!   real summary (a zero-tool, one-turn helper run) and it takes the local version's place. A
//!   turn that starts meanwhile goes ahead on the local version.
//!
//! Shortening only runs between turns, so it never touches a live run.

use std::sync::Arc;

use gs_agent::subagents::pi_run::{SubagentRunOptions, run_subagent};
use gs_base::events::EventKind;
use gs_base::locks::LockKey;
use gs_base::{clock, ids, text, time};
use gs_core::messages::compaction_marks::active_compaction_of;
use gs_core::messages::input_events::messages_of;
use gs_core::messages::native_messages::to_llm_messages;
use gs_core::session::compaction::{
	KEEP_RECENT_TOKENS, build_compaction_prompt, compaction_cut_index, compaction_span, estimate_context_tokens, estimate_tokens, local_summary, new_compaction_marker, plan_tree_to_text,
	serialize_for_summary,
};
use gs_engine::turn::faux::Engine;
use gs_json::{Json, json};

use super::turn_liveness::is_turn_running;
use crate::App;

/// The summarizer's system prompt: operational framing, not doctrine.
const SUMMARIZER_SYSTEM_PROMPT: &str = "You are the session-compaction summarizer for a tutoring agent. You receive the transcript span to summarize and write exactly the summary the instructions demand — nothing else, no preamble, no meta-commentary.";

/// How long a chat sits quiet before its model writes the real summary.
const REFINE_QUIET_MS: i64 = 5 * 60_000;

/// What a compaction needs from its host (the chat handler builds it per chat).
#[derive(Clone)]
pub struct CompactionDeps {
	/// The chat's conversation engine, also the summarizer's.
	pub engine: Engine,
	/// `provider:id` of the engine.
	pub model_id: String,
	/// "teach", "practice", "probe" or "talk" (the summary's wording).
	pub kind: &'static str,
	/// min(the fixed threshold, context window - reserve).
	pub threshold_tokens: f64,
	/// The composed system prompt's estimate (chars / 4).
	pub system_prompt_tokens: f64,
}

/// Builds a chat's deps from its record as it is then; none when the chat is gone.
pub type BuildDeps = Arc<dyn Fn() -> Option<CompactionDeps> + Send + Sync>;

/// What the next model call would carry: the last provider-reported usage plus an estimate of
/// what came after it; without a usable anchor, the estimate over the cut-honoring projection
/// plus the system prompt the anchor would have counted.
pub fn projected_context_tokens(messages: &[Json], system_prompt_tokens: f64) -> f64 {
	let est = estimate_context_tokens(messages);
	if est.last_usage_index.is_some() {
		return est.tokens;
	}
	estimate_tokens(&to_llm_messages(messages)) + system_prompt_tokens
}

/// Cuts the record and adds godspeed's own short version of what was cut, when it projects over
/// the threshold. Never while a turn owns the chat.
fn shorten(app: &App, deps: &CompactionDeps, chat_id: &str) -> Result<(), String> {
	// A turn begins under the chat's lock, so this check holds until the save.
	let _guard = app.locks.lock(LockKey::Chat(chat_id));
	if is_turn_running(app, chat_id) {
		return Ok(());
	}
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return Ok(()) };
	let messages = messages_of(&record);
	let tokens_before = projected_context_tokens(messages, deps.system_prompt_tokens);
	if tokens_before <= deps.threshold_tokens {
		return Ok(());
	}
	let cut = compaction_cut_index(messages, KEEP_RECENT_TOKENS);
	if cut == 0 || cut >= messages.len() {
		return Ok(());
	}
	// The span runs from the previous kept boundary to the cut; the previous summary rides along.
	// When the cut can't move past that boundary, the kept tail alone carries the projection, and
	// shortening again can't help.
	let previous = active_compaction_of(messages);
	let prev_kept = previous.and_then(|p| messages.iter().position(|m| m["id"] == p["details"]["firstKeptMessageId"]));
	if let (Some(_), Some(kept)) = (previous, prev_kept)
		&& cut <= kept
	{
		eprintln!("[chat {chat_id}] compaction skipped — the kept tail alone exceeds the threshold (raise it or shrink the tail)");
		return Ok(());
	}
	let start = prev_kept.filter(|&kept| kept > 0);
	let prior_summary = start.and(previous).map(|p| p["content"].as_str().unwrap_or_default());
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
pub fn ensure_compacted(app: &App, deps: &CompactionDeps, chat_id: &str) {
	shorten_logged(app, deps, chat_id);
}

/// The settle kick: shortens now if the turn pushed the lesson over, and (re)starts the quiet wait
/// for the real summary.
pub fn kick_compaction(app: &Arc<App>, build_deps: BuildDeps, chat_id: &str) {
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
	tokio::spawn(async move {
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
pub async fn refine(app: &Arc<App>, deps: &CompactionDeps, chat_id: &str) {
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return };
	let messages = messages_of(&record);
	let Some(marker) = active_compaction_of(messages).filter(|m| m["details"]["local"].truthy()).cloned() else { return };
	let Some(covered) = compaction_span(messages, &marker) else { return };
	let span_text = serialize_for_summary(covered.span);
	let full_span = match covered.prior_summary.filter(|prior| !prior.is_empty()) {
		Some(prior) => format!("[SYSTEM NOTE — prior compaction summary, still authoritative where not superseded]\n{prior}\n\n{span_text}"),
		None => span_text,
	};
	let tree = record.get("tree").filter(|t| !t.is_null());
	let prompt = build_compaction_prompt(&full_span, plan_tree_to_text(tree, messages).as_deref(), deps.kind);
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
	let (summary, usage) = summarize(app, prompt, &deps.engine).await?;
	let trimmed = text::trim(&summary);
	// An empty summary is a refusal artifact.
	if trimmed.is_empty() {
		return Ok(());
	}
	{
		let _guard = app.locks.lock(LockKey::Chat(chat_id));
		// Turns and other writers save while the summary is written.
		let Some(fresh) = app.stores.chats.get_chat(chat_id) else { return Ok(()) };
		let messages = messages_of(&fresh);
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
	let step = json!({
		"inputTokens": usage["input"],
		"outputTokens": usage["output"],
		"cacheReadTokens": usage["cacheRead"],
		"cacheWriteTokens": usage["cacheWrite"],
		"cacheWrite1hTokens": or_zero(&usage["cacheWrite1h"]),
		"reasoningTokens": or_zero(&usage["reasoning"]),
	});
	let entry = json!({ "id": ids::uuid(), "messageId": marker["id"], "at": time::iso_now(), "model": deps.model_id, "steps": [step] });
	app.stores.chats.append_turn_usage(chat_id, &entry)?;
	app.events.emit(EventKind::RecordChanged, json!({ "chatId": chat_id }));
	Ok(())
}

/// `value ?? 0`.
pub(super) fn or_zero(value: &Json) -> Json {
	if value.is_null() { json!(0) } else { value.clone() }
}

/// The one-shot summary call: zero tools, one turn, text out, with the last call's usage.
async fn summarize(app: &Arc<App>, prompt: &str, engine: &Engine) -> Result<(String, Json), String> {
	let usage = Arc::new(parking_lot::Mutex::new(json!({ "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } })));
	let sink = usage.clone();
	let mut options = SubagentRunOptions::new(SUMMARIZER_SYSTEM_PROMPT, Json::from(prompt), 1);
	options.engine = Some(engine.clone());
	options.on_usage = Some(Arc::new(move |u: &Json| *sink.lock() = u.clone()));
	let result = run_subagent(&app.bridge, Vec::new(), options).await.map_err(|err| err.to_string())?;
	let usage = usage.lock().clone();
	Ok((result.text, usage))
}

#[cfg(test)]
mod tests {
	use gs_core::contracts::chat::COMPACTED_HISTORY_HEADER;
	use gs_core::messages::native_messages::new_user_message;
	use gs_engine::turn::faux::{Scripted, faux_model};
	use gs_engine::turn::messages::{faux_assistant_message, text_block};

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::turns::turn_liveness::{begin_turn, end_turn};

	fn big(label: &str) -> Json {
		new_user_message(&format!("{label}: {}", "x".repeat(100 * 1024)), &[])
	}

	/// A lesson whose record projects far over any test threshold.
	fn over_threshold_chat(app: &App) -> String {
		let chat = app.stores.chats.create_chat("Sets", None, None, None).unwrap();
		let id = chat["id"].as_str().unwrap().to_owned();
		app.stores.chats.save_messages(&id, &[big("m1"), big("m2"), big("m3"), new_user_message("recent", &[])]).unwrap();
		id
	}

	fn deps(threshold_tokens: f64, script: &Arc<Scripted>) -> CompactionDeps {
		let engine = Engine { model: faux_model("faux", "faux", "test", "Test", 1_000_000.0, 32_000.0), respond: script.clone() };
		CompactionDeps { engine, model_id: "faux:test".to_owned(), kind: "teach", threshold_tokens, system_prompt_tokens: 100.0 }
	}

	fn summary_reply(script: &Arc<Scripted>, summary: &str) {
		script.reply(faux_assistant_message(vec![text_block(summary)], "stop"));
	}

	fn markers(app: &App, chat_id: &str) -> Vec<Json> {
		messages_of(&app.stores.chats.get_chat(chat_id).unwrap()).iter().filter(|m| m["customType"].as_str() == Some("compaction")).cloned().collect()
	}

	fn active(app: &App, chat_id: &str) -> Option<Json> {
		active_compaction_of(messages_of(&app.stores.chats.get_chat(chat_id).unwrap())).cloned()
	}

	fn add(app: &App, chat_id: &str, more: &[Json]) {
		let mut messages = messages_of(&app.stores.chats.get_chat(chat_id).unwrap()).to_vec();
		messages.extend(more.iter().cloned());
		app.stores.chats.save_messages(chat_id, &messages).unwrap();
	}

	#[test]
	fn over_the_threshold_a_local_marker_lands_at_once() {
		let root = scratch_dir("compaction-shorten");
		let app = test_app(&root);
		let chat_id = over_threshold_chat(&app);
		let mut events = app.events.subscribe();
		ensure_compacted(&app, &deps(40_000.0, &Scripted::new()), &chat_id);
		let marker = active(&app, &chat_id).expect("the marker landed");
		assert_eq!(marker["details"]["local"], Json::Bool(true));
		assert!(marker["content"].as_str().unwrap().contains("godspeed shortened the earlier part"));
		assert!(marker["details"]["tokensBefore"].as_f64().unwrap() > 40_000.0);
		assert!(projected_context_tokens(messages_of(&app.stores.chats.get_chat(&chat_id).unwrap()), 100.0) < 40_000.0);
		let changed: Vec<Json> = std::iter::from_fn(|| events.try_recv().ok()).filter(|e| e.kind == EventKind::RecordChanged).map(|e| e.payload).collect();
		assert_eq!(changed, [json!({ "chatId": chat_id })]);
	}

	#[test]
	fn under_the_threshold_or_while_a_turn_runs_nothing_happens() {
		let root = scratch_dir("compaction-noop");
		let app = test_app(&root);
		let chat_id = over_threshold_chat(&app);
		ensure_compacted(&app, &deps(10_000_000.0, &Scripted::new()), &chat_id);
		assert!(begin_turn(&app, &chat_id));
		ensure_compacted(&app, &deps(40_000.0, &Scripted::new()), &chat_id);
		end_turn(&app, &chat_id);
		assert!(active(&app, &chat_id).is_none());
	}

	#[tokio::test]
	async fn the_settle_kick_shortens_once() {
		let root = scratch_dir("compaction-kick");
		let app = test_app(&root);
		let chat_id = over_threshold_chat(&app);
		let script = Scripted::new();
		let build: BuildDeps = Arc::new(move || Some(deps(40_000.0, &script)));
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
		let deps = deps(40_000.0, &Scripted::new());
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
		let script = Scripted::new();
		let deps = deps(40_000.0, &script);
		ensure_compacted(&app, &deps, &chat_id);
		let local = active(&app, &chat_id).unwrap();
		summary_reply(&script, " SUMMARY: the learner knows X. ");
		refine(&app, &deps, &chat_id).await;
		let refined = active(&app, &chat_id).unwrap();
		assert_eq!((&refined["id"], &refined["timestamp"]), (&local["id"], &local["timestamp"]));
		assert_eq!(refined["content"], json!(format!("{COMPACTED_HISTORY_HEADER}\n\nSUMMARY: the learner knows X.")));
		let details = refined["details"].as_obj().unwrap();
		assert_eq!(details.keys().map(String::as_str).collect::<Vec<_>>(), ["firstKeptMessageId", "tokensBefore", "at", "local", "model"]);
		assert_eq!((&refined["details"]["local"], &refined["details"]["model"]), (&json!(false), &json!("faux:test")));
		assert_eq!(refined["details"]["firstKeptMessageId"], local["details"]["firstKeptMessageId"]);
		let turns = app.stores.chats.get_chat(&chat_id).unwrap()["turns"].clone();
		assert_eq!(turns.as_arr().map(Vec::len), Some(1));
		assert_eq!((&turns[0]["messageId"], &turns[0]["model"]), (&local["id"], &json!("faux:test")));
		// A refined marker is not summarized again (the script has nothing left to answer).
		refine(&app, &deps, &chat_id).await;
		assert_eq!(active(&app, &chat_id).unwrap(), refined);
	}

	#[tokio::test]
	async fn a_failure_or_an_empty_summary_keeps_the_local_one() {
		let root = scratch_dir("compaction-kept");
		let app: Arc<App> = test_app(&root);
		let chat_id = over_threshold_chat(&app);
		let script = Scripted::new();
		let deps = deps(40_000.0, &script);
		ensure_compacted(&app, &deps, &chat_id);
		refine(&app, &deps, &chat_id).await;
		summary_reply(&script, "  ");
		refine(&app, &deps, &chat_id).await;
		assert_eq!(active(&app, &chat_id).unwrap()["details"]["local"], json!(true));
		assert!(app.stores.chats.get_chat(&chat_id).unwrap()["turns"].as_arr().is_none_or(Vec::is_empty));
		assert!(app.turns.refining.lock().is_empty());
	}
}
