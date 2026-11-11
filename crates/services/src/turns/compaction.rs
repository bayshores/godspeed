//! The compaction service (compaction.ts): the trigger plumbing around core's cuts and markers.
//!
//! Question and problem poses end their runs, so the learner's thinking pause is always between
//! runs and compaction never touches a live one:
//!
//! - settle kick: a turn settled over threshold, so the summary starts now in the background;
//! - turn-start gate: every turn first waits out a running compaction for its chat, and compacts
//!   inside the request when the record is still over threshold.
//!
//! The summary is written by the session's own engine (a zero-tool, one-turn helper run); its
//! usage lands in the chat's turn log keyed by the marker's id.

use std::sync::Arc;

use gs_agent::subagents::pi_run::{SubagentRunOptions, run_subagent};
use gs_base::events::EventKind;
use gs_base::locks::LockKey;
use gs_base::{ids, text, time};
use gs_core::messages::compaction_marks::active_compaction_of;
use gs_core::messages::native_messages::to_llm_messages;
use gs_core::session::compaction::{KEEP_RECENT_TOKENS, build_compaction_prompt, compaction_cut_index, estimate_context_tokens, estimate_tokens, new_compaction_marker, plan_tree_to_text, serialize_for_summary};
use gs_engine::turn::faux::Engine;
use gs_json::{Json, json};
use tokio::sync::watch;

use crate::App;

/// The summarizer's system prompt: operational framing, not doctrine.
const SUMMARIZER_SYSTEM_PROMPT: &str = "You are the session-compaction summarizer for a tutoring agent. You receive the transcript span to summarize and write exactly the summary the instructions demand — nothing else, no preamble, no meta-commentary.";

/// What a compaction needs from its host (the chat handler builds it per chat).
#[derive(Clone)]
pub struct CompactionDeps {
	/// The chat's conversation engine, also the summarizer's.
	pub engine: Engine,
	/// `provider:id` of the engine.
	pub model_id: String,
	/// "teach", "practice", "probe" or "talk" (the summary's wording).
	pub kind: &'static str,
	/// min(settings threshold, context window - reserve).
	pub threshold_tokens: f64,
	/// The composed system prompt's estimate (chars / 4).
	pub system_prompt_tokens: f64,
}

pub fn compaction_in_flight(app: &App, chat_id: &str) -> bool {
	app.turns.compactions.lock().contains_key(chat_id)
}

/// Waits out a running compaction for the chat, if any.
pub async fn await_compaction(app: &App, chat_id: &str) {
	let running = app.turns.compactions.lock().get(chat_id).cloned();
	if let Some(mut done) = running {
		let _ = done.wait_for(|finished| *finished).await;
	}
}

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

fn messages_of(record: &Json) -> Vec<Json> {
	record["messages"].as_arr().cloned().unwrap_or_default()
}

fn over_threshold(app: &App, deps: &CompactionDeps, chat_id: &str) -> bool {
	app.stores.chats.get_chat(chat_id).is_some_and(|record| projected_context_tokens(&messages_of(&record), deps.system_prompt_tokens) > deps.threshold_tokens)
}

/// The gate: waits out a running compaction, then compacts now if the record is still over
/// threshold (the caller's request waits). `can_start` false: a turn owns the chat, start none.
pub async fn ensure_compacted(app: &Arc<App>, deps: &CompactionDeps, chat_id: &str, can_start: impl Fn() -> bool) {
	await_compaction(app, chat_id).await;
	if !can_start() || !over_threshold(app, deps, chat_id) {
		return;
	}
	let running = app.turns.compactions.lock().get(chat_id).cloned();
	if let Some(mut done) = running {
		let _ = done.wait_for(|finished| *finished).await;
		return;
	}
	let done = register(app, chat_id);
	compact(app, deps, chat_id).await;
	finish(app, chat_id, done);
}

/// The settle kick (fire and forget): starts the summary now when the record is over threshold.
pub fn kick_compaction(app: &Arc<App>, deps: Option<CompactionDeps>, chat_id: &str, can_start: bool) {
	if compaction_in_flight(app, chat_id) {
		return;
	}
	let Some(deps) = deps.filter(|_| can_start) else { return };
	if !over_threshold(app, &deps, chat_id) {
		return;
	}
	let done = register(app, chat_id);
	let (app, chat_id) = (app.clone(), chat_id.to_owned());
	tokio::spawn(async move {
		compact(&app, &deps, &chat_id).await;
		finish(&app, &chat_id, done);
	});
}

fn register(app: &App, chat_id: &str) -> watch::Sender<bool> {
	let (tx, rx) = watch::channel(false);
	app.turns.compactions.lock().insert(chat_id.to_owned(), rx);
	tx
}

fn finish(app: &App, chat_id: &str, done: watch::Sender<bool>) {
	app.turns.compactions.lock().remove(chat_id);
	let _ = done.send(true);
}

/// One compaction: reads the record fresh, cuts, summarizes, appends the marker, records usage.
async fn compact(app: &Arc<App>, deps: &CompactionDeps, chat_id: &str) {
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return };
	let messages = messages_of(&record);
	let tokens_before = projected_context_tokens(&messages, deps.system_prompt_tokens);
	if tokens_before <= deps.threshold_tokens {
		return;
	}
	let cut = compaction_cut_index(&messages, KEEP_RECENT_TOKENS);
	if cut == 0 || cut >= messages.len() {
		return;
	}
	let previous = active_compaction_of(&messages);
	let prev_kept = previous.and_then(|p| {
		let id = p["details"]["firstKeptMessageId"].as_str()?;
		messages.iter().position(|m| m["id"].as_str() == Some(id))
	});
	// The cut cannot get past the previous kept boundary: summarizing the same span again
	// cannot shrink anything.
	if previous.is_some() && prev_kept.is_some_and(|kept| cut <= kept) {
		eprintln!("[chat {chat_id}] compaction skipped — the kept tail alone exceeds the threshold (raise it or shrink the tail)");
		return;
	}
	let (span_start, prior_summary) = match (previous, prev_kept) {
		(Some(previous), Some(kept)) if kept > 0 => (kept, Some(previous["content"].as_str().unwrap_or_default().to_owned())),
		_ => (0, None),
	};
	let span_text = serialize_for_summary(&messages[span_start..cut]);
	let full_span = match prior_summary {
		Some(prior) => format!("[SYSTEM NOTE — prior compaction summary, still authoritative where not superseded]\n{prior}\n\n{span_text}"),
		None => span_text,
	};
	let tree = record.get("tree").filter(|t| !t.is_null());
	let prompt = build_compaction_prompt(&full_span, plan_tree_to_text(tree, &messages).as_deref(), deps.kind);

	app.events.emit(EventKind::CompactionChanged, json!({ "chatId": chat_id, "running": true }));
	if let Err(err) = summarize_and_mark(app, deps, chat_id, &prompt, &messages[cut], tokens_before).await {
		eprintln!("[chat {chat_id}] compaction failed: {err}");
	}
	app.events.emit(EventKind::CompactionChanged, json!({ "chatId": chat_id, "running": false }));
}

async fn summarize_and_mark(app: &Arc<App>, deps: &CompactionDeps, chat_id: &str, prompt: &str, first_kept: &Json, tokens_before: f64) -> Result<(), String> {
	let (summary, usage) = summarize(app, prompt, &deps.engine).await?;
	let trimmed = text::trim(&summary);
	// An empty summary is a refusal artifact: leave the record honest.
	if trimmed.is_empty() {
		return Ok(());
	}
	let at = time::iso_now();
	let marker_id = {
		let _guard = app.locks.lock(LockKey::Chat(chat_id));
		// Other writers may have saved meanwhile, and the cut is keyed by id.
		let Some(fresh) = app.stores.chats.get_chat(chat_id) else { return Ok(()) };
		let mut messages = messages_of(&fresh);
		if !messages.iter().any(|m| m["id"] == first_kept["id"]) {
			return Ok(());
		}
		let details = json!({ "firstKeptMessageId": first_kept["id"], "tokensBefore": tokens_before, "model": deps.model_id, "at": at });
		let marker = new_compaction_marker(trimmed, &details);
		let marker_id = marker["id"].clone();
		messages.push(marker);
		app.stores.chats.save_messages(chat_id, &messages)?;
		marker_id
	};
	let step = json!({
		"inputTokens": usage["input"],
		"outputTokens": usage["output"],
		"cacheReadTokens": usage["cacheRead"],
		"cacheWriteTokens": usage["cacheWrite"],
		"cacheWrite1hTokens": or_zero(&usage["cacheWrite1h"]),
		"reasoningTokens": or_zero(&usage["reasoning"]),
	});
	let entry = json!({ "id": ids::uuid(), "messageId": marker_id, "at": at, "model": deps.model_id, "steps": [step] });
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
