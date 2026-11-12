//! One chat turn over the server-owned record (chat-handler.ts). POST /api/chat carries one input
//! event (text, answer, side, thinking, next, continue), never a client transcript; the wake
//! pipeline's steers come through here too. The event becomes record appends (written ahead, before
//! the turn runs), the agent is built from the record, and the turn runs as a background object
//! that views attach to through GET /api/chats/{id}/stream. The POST only acknowledges.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Weak};

use gs_agent::teacher::prompt_segments::AgentKind;
use gs_agent::teacher::teacher_agent::compose_instructions;
use gs_base::events::EventKind;
use gs_base::locks::LockKey;
use gs_base::{ids, text, time};
use gs_core::contracts::chat::extracts_facts;
use gs_core::messages::attachments::ChatAttachment;
use gs_core::messages::input_events::{ChatInput, ChatInputError, TurnInput, input_appends};
use gs_core::messages::native_messages::{dangling_question_of, has_probe_done, is_side_turn, retry_context};
use gs_core::session::compaction::effective_threshold_tokens;
use gs_core::session::jobs::steer_delivered;
use gs_engine::turn::agent::Agent;
use gs_engine::turn::call_ids::collect_tool_call_ids;
use gs_engine::turn::events::AgentEvent;
use gs_engine::turn::models::agent_engine;
use gs_engine::turn::ui_stream::{TurnSpec, run_pi_turn};
use gs_json::{Json, json, stringify};
use parking_lot::Mutex;

use super::attachments::{AttachmentError, store_attachments};
use super::compaction::{CompactionDeps, ensure_compacted, kick_compaction, or_zero};
use super::dismissal_park::apply_parked_dismissal;
use super::job_host::run_job;
use super::lesson_agent::{TurnAgent, build_lesson_agent};
use super::turn_liveness::{begin_turn, end_turn, is_turn_running, turn_started};
use super::turn_runs::{register_turn, remember_turn_failure, unregister_turn};
use super::turn_service::{PERSISTENCE_ERROR, persist_turn, trigger_extraction};
use crate::App;
use crate::app::agent_actions::record_answer;
use crate::app::today_note::today_note_for;
use crate::spaces::space_actions::SendFirstMessage;
use crate::jobs::{note_steers_durable, reconcile_user_steers, register_live_agent, settle_steers, unregister_live_agent};

/// The live update window of a turn's stream.
const UPDATE_FLUSH_MS: i64 = 100;
const NOT_SAVED: &str = "Your input could not be saved. Please try again.";

/// What a turn request answers, like the TS `Response`.
#[derive(Clone, Debug, PartialEq)]
pub struct ChatReply {
	pub status: u16,
	pub body: ReplyBody,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ReplyBody {
	Json(Json),
	Text(String),
	/// A throw: the route's empty 500.
	Empty,
}

impl ChatReply {
	fn json(status: u16, body: Json) -> ChatReply {
		ChatReply { status, body: ReplyBody::Json(body) }
	}

	fn error(status: u16, message: &str) -> ChatReply {
		ChatReply::json(status, json!({ "error": message }))
	}

	fn ok_json() -> ChatReply {
		ChatReply::json(200, json!({ "ok": true }))
	}

	fn thrown(err: impl std::fmt::Display) -> ChatReply {
		eprintln!("chat turn error: {err}");
		ChatReply { status: 500, body: ReplyBody::Empty }
	}

	/// `Response.ok`.
	pub fn ok(&self) -> bool {
		(200..300).contains(&self.status)
	}

	/// `await response.text()`.
	pub fn text(&self) -> String {
		match &self.body {
			ReplyBody::Json(body) => stringify(body),
			ReplyBody::Text(text) => text.clone(),
			ReplyBody::Empty => String::new(),
		}
	}
}

pub type ReplyFuture = Pin<Box<dyn Future<Output = ChatReply> + Send>>;

/// A new lesson's first message, sent as the learner's text; Err holds the refusal's body text.
pub fn send_first_message(app: &Arc<App>) -> SendFirstMessage {
	let app = app.clone();
	Arc::new(move |chat_id, text| {
		let sent = handle_chat_input(&app, &chat_id, TurnInput::Chat(ChatInput::Text { text, attachments: None }));
		Box::pin(async move {
			let reply = sent.await;
			if reply.ok() { Ok(()) } else { Err(reply.text()) }
		})
	})
}

/// The turn composition: one input event, its record appends, one agent turn in the background.
/// Also the wake pipeline's entry (`TurnInput::Steers`). Runs on its own task once polled: a
/// request whose client went away is dropped at its next await (the compaction gate can wait
/// minutes), and the learner's input must still be saved and its turn run.
pub fn handle_chat_input(app: &Arc<App>, chat_id: &str, input: TurnInput) -> ReplyFuture {
	let (app, chat_id) = (app.clone(), chat_id.to_owned());
	Box::pin(async move { tokio::spawn(async move { run(&app, &chat_id, input).await }).await.unwrap_or_else(ChatReply::thrown) })
}

fn input_files(input: &TurnInput) -> Option<&[ChatAttachment]> {
	match input {
		TurnInput::Chat(ChatInput::Text { attachments, .. } | ChatInput::Answer { attachments, .. } | ChatInput::Side { attachments, .. } | ChatInput::Thinking { attachments, .. }) => attachments.as_deref(),
		_ => None,
	}
}

async fn run(app: &Arc<App>, chat_id: &str, input: TurnInput) -> ChatReply {
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return ChatReply::error(404, "Unknown chat") };

	// The learner's files first: nothing may run between the record read below and the
	// write-ahead.
	let mut attachments = Vec::new();
	if let Some(files) = input_files(&input) {
		let mut save = |name: &str, bytes: &[u8]| app.stores.chats.save_attachment(chat_id, name, bytes).map(|p| p.to_string_lossy().into_owned());
		match store_attachments(files, &mut save) {
			Ok(parts) => attachments = parts,
			Err(AttachmentError::Input(err)) => return ChatReply::error(400, &err.0),
			Err(AttachmentError::Save(err)) => return ChatReply::thrown(err),
		}
	}
	let effective = match app.stores.settings.effective_settings() {
		Ok(effective) => effective,
		Err(err) => return ChatReply::thrown(err),
	};

	// The compaction gate: nothing model-facing for this chat runs beside a compaction. It runs
	// before the appends and begin_turn, and the record is read again after it.
	let deps = compaction_deps(app, &record, &effective);
	let gate_app = app.clone();
	let gate_chat = chat_id.to_owned();
	ensure_compacted(app, &deps, chat_id, move || !is_turn_running(&gate_app, &gate_chat)).await;

	let accepted = match write_ahead(app, chat_id, &input, &attachments) {
		Ok(accepted) => accepted,
		Err(reply) => return reply,
	};
	let unstarted = Unstarted { app, chat_id };
	match start_turn(app, chat_id, &input, &effective, accepted) {
		Ok(()) => {
			std::mem::forget(unstarted);
			ChatReply::ok_json()
		}
		Err(err) => {
			drop(unstarted);
			eprintln!("[chat {chat_id}] turn failed to start: {err}");
			ChatReply::error(500, "Failed to start the turn")
		}
	}
}

/// A turn that began but never started, however `start_turn` ends (a panic included): nothing
/// settles it, so this releases the chat. Left marked, it would refuse every later turn, delete
/// and move, and a view attaching to it would wait for good.
struct Unstarted<'a> {
	app: &'a Arc<App>,
	chat_id: &'a str,
}

impl Drop for Unstarted<'_> {
	fn drop(&mut self) {
		let (app, chat_id) = (self.app, self.chat_id);
		if let Err(park) = apply_parked_dismissal(app, chat_id) {
			eprintln!("[chat {chat_id}] parked dismissal failed: {park}");
		}
		end_turn(app, chat_id);
		unregister_live_agent(app, chat_id);
	}
}

/// The input as it landed: the record it was read from, its appends and the saved list.
struct Accepted {
	record: Json,
	appends: Vec<Json>,
	merged: Vec<Json>,
}

/// Turns the input into record appends and writes them ahead of the turn, under the chat's lock.
/// Err is the answer to send back (refusals, the deferred answer, the 409).
fn write_ahead(app: &Arc<App>, chat_id: &str, input: &TurnInput, attachments: &[Json]) -> Result<Accepted, ChatReply> {
	let _guard = app.locks.lock(LockKey::Chat(chat_id));
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return Err(ChatReply::error(404, "Unknown chat")) };
	let messages = record["messages"].as_arr().cloned().unwrap_or_default();

	// The wake carries every queued marker; one already in the record is a re-fire.
	let mut appends = match input {
		TurnInput::Steers(steers) => steers.iter().filter(|s| !steer_delivered(&messages, s["id"].as_str().unwrap_or_default())).cloned().collect(),
		TurnInput::Chat(chat) => input_appends(&record, chat, attachments).map_err(|ChatInputError(message)| ChatReply::error(400, &message))?,
	};

	// The [Today] note goes right before a learner message when the day, the open deadlines or a
	// compaction call for a fresh one.
	if matches!(input, TurnInput::Chat(ChatInput::Text { .. } | ChatInput::Thinking { .. } | ChatInput::Next))
		&& let Some(note) = today_note_for(app, &record)
	{
		let at = appends.len().saturating_sub(1);
		appends.insert(at, note);
	}
	let merged: Vec<Json> = messages.iter().chain(&appends).cloned().collect();

	// An answer that leaves a sibling question waiting starts no turn: the last answer fires the
	// one reaction turn with every result next to its calls.
	if let TurnInput::Chat(ChatInput::Answer { answer, .. }) = input
		&& dangling_question_of(&merged).is_some()
	{
		if let Err(err) = app.stores.chats.save_messages(chat_id, &merged) {
			eprintln!("[chat {chat_id}] write-ahead persist failed: {err}");
			return Err(ChatReply { status: 500, body: ReplyBody::Text(NOT_SAVED.to_owned()) });
		}
		record_answer(app, &record, answer);
		app.events.emit(EventKind::RecordChanged, json!({ "chatId": chat_id }));
		return Err(ChatReply::ok_json());
	}

	// One turn per chat: a second request means a stale client raced a live one.
	if !begin_turn(app, chat_id) {
		eprintln!("[chat {chat_id}] turn already in flight — request rejected");
		return Err(ChatReply::error(409, "A turn is already running for this session"));
	}
	if let Err(err) = app.stores.chats.save_messages(chat_id, &merged) {
		eprintln!("[chat {chat_id}] write-ahead persist failed: {err}");
		// The begun turn is announced and settled, as Node's begin and end did.
		turn_started(app, chat_id);
		end_turn(app, chat_id);
		return Err(ChatReply { status: 500, body: ReplyBody::Text(NOT_SAVED.to_owned()) });
	}
	turn_started(app, chat_id);
	if let TurnInput::Chat(ChatInput::Answer { answer, .. }) = input {
		record_answer(app, &record, answer);
	}
	note_steers_durable(app, chat_id, &merged);
	Ok(Accepted { record, appends, merged })
}

/// Builds the turn's agent and starts the turn as a background object.
fn start_turn(app: &Arc<App>, chat_id: &str, input: &TurnInput, effective: &Json, accepted: Accepted) -> Result<(), String> {
	let Accepted { record, appends, merged } = accepted;
	// A continue (Try again) runs again from before a failed or stopped reply.
	let context: Vec<Json> = if matches!(input, TurnInput::Chat(ChatInput::Continue)) { retry_context(&merged).to_vec() } else { merged.clone() };
	let persist_base = context.len();
	let side_turn = is_side_turn(&context);
	let engine = agent_engine(&app.bridge);
	let model_id = model_id_of(&engine.model);
	let teaching = has_probe_done(&merged);
	let agent = build_lesson_agent(app, &record, effective, TurnAgent { chat_id: chat_id.to_owned(), messages: context, teaching, side_turn, engine: engine.clone() });

	// One collector per turn, fed by the agent's finished assistant messages.
	let steps: Arc<Mutex<Vec<Json>>> = Arc::default();
	let sink = steps.clone();
	agent.subscribe(Arc::new(move |event: &AgentEvent| {
		if let AgentEvent::MessageEnd(message) = event
			&& message["role"].as_str() == Some("assistant")
			&& message.get("usage").is_some()
			&& message["stopReason"].as_str() != Some("aborted")
		{
			sink.lock().push(call_usage(&message["usage"]));
		}
	}));

	// Registered before the turn starts, so markers pending for the chat ride its first call. A
	// side turn takes no job results: they wait for the answer turn.
	if !side_turn {
		let wake_ids = matches!(input, TurnInput::Steers(_)).then(|| appends.iter().filter_map(|m| m["id"].as_str().map(str::to_owned)).collect());
		let allow_deferred = !matches!(input, TurnInput::Steers(_) | TurnInput::Chat(ChatInput::Continue));
		register_live_agent(app, chat_id, &agent, allow_deferred, wake_ids.as_ref())?;
	}

	let settle = Settle { app: Arc::downgrade(app), chat_id: chat_id.to_owned(), agent: Arc::downgrade(&agent) };
	let failure = settle.clone();
	let finish = settle.clone();
	let kind = record["kind"].as_str().map(str::to_owned);
	let scope = record["spaceId"].as_str().map(str::to_owned);
	let extracts = extracts_facts(kind.as_deref()) && effective["graph"]["enabled"].truthy();
	let chunk_tokens = effective["graph"]["extractionChunkTokens"].as_f64().unwrap_or_default();
	let turn_usage_id = ids::uuid();
	let handle = run_pi_turn(TurnSpec {
		agent: agent.clone(),
		on_error: Box::new({
			let chat_id = chat_id.to_owned();
			move |err| {
				eprintln!("[chat {chat_id}] turn error: {err}");
				"An error occurred.".to_owned()
			}
		}),
		on_settle_error: Box::new(|err| settlement_error_text(err).to_owned()),
		on_settle_failure: Box::new(move |err, reported| failure.failed(err, reported)),
		on_finish: Box::new(move |turn_messages| {
			let Some(app) = finish.app.upgrade() else { return Ok(()) };
			let steps = steps.lock().clone();
			let usage = Usage { id: &turn_usage_id, model: &model_id, steps: &steps };
			finish.finished(&app, persist_base, &turn_messages, usage, extracts.then_some((scope.as_deref(), chunk_tokens)))
		}),
		used_tool_call_ids: collect_tool_call_ids(&merged),
		update_flush_ms: UPDATE_FLUSH_MS,
	});
	register_turn(app, chat_id, handle.clone());
	handle.start();
	Ok(())
}

/// What views see when settlement failed.
fn settlement_error_text(err: &str) -> &str {
	if err == PERSISTENCE_ERROR { err } else { "An error occurred." }
}

fn model_id_of(model: &Json) -> String {
	format!("{}:{}", model["provider"].as_str().unwrap_or_default(), model["id"].as_str().unwrap_or_default())
}

/// One model call's usage as the turn log stores it; optional counts are saved as 0.
fn call_usage(usage: &Json) -> Json {
	json!({
		"inputTokens": usage["input"],
		"outputTokens": usage["output"],
		"cacheReadTokens": usage["cacheRead"],
		"cacheWriteTokens": usage["cacheWrite"],
		"cacheWrite1hTokens": or_zero(&usage["cacheWrite1h"]),
		"reasoningTokens": or_zero(&usage["reasoning"]),
	})
}

struct Usage<'a> {
	id: &'a str,
	model: &'a str,
	steps: &'a [Json],
}

/// The turn's settle paths. Weak links: the running turn must not keep the app or its own agent
/// alive.
#[derive(Clone)]
struct Settle {
	app: Weak<App>,
	chat_id: String,
	agent: Weak<Agent>,
}

impl Settle {
	/// Persist and finish, in the order that makes "turn-settled" imply durable truth: persist,
	/// usage, extraction, the parked dismissal, then end_turn and unregister, then the steers, then
	/// the compaction kick.
	fn finished(&self, app: &Arc<App>, base: usize, turn_messages: &[Json], usage: Usage, extraction: Option<(Option<&str>, f64)>) -> Result<(), String> {
		let chat_id = self.chat_id.as_str();
		let stamped = persist_turn(app, chat_id, base, turn_messages)?;
		let durable = app.stores.chats.get_chat(chat_id).and_then(|r| r["messages"].as_arr().cloned());
		note_steers_durable(app, chat_id, durable.as_deref().unwrap_or(&stamped));
		// The provenance message is the turn's first new assistant message.
		if let Some(response) = stamped.iter().find(|m| m["role"].as_str() == Some("assistant"))
			&& !usage.steps.is_empty()
		{
			let entry = json!({ "id": usage.id, "messageId": response["id"], "at": time::iso_now(), "model": usage.model, "steps": usage.steps.to_vec() });
			app.stores.chats.append_turn_usage(chat_id, &entry)?;
		}
		if let Some((scope, chunk_tokens)) = extraction {
			trigger_extraction(app, chat_id, scope, chunk_tokens);
		}
		apply_parked_dismissal(app, chat_id)?;
		end_turn(app, chat_id);
		unregister_turn(app, chat_id);
		unregister_live_agent(app, chat_id);
		let agent = self.agent.upgrade();
		settle_steers(app, chat_id, &stamped, false, agent.as_ref());
		reconcile_user_steers(app, chat_id, &stamped);
		kick(app, chat_id);
		Ok(())
	}

	/// Settlement failed: release the chat and keep a notice for a view that attaches late.
	fn failed(&self, err: &str, reported: Option<&str>) {
		let Some(app) = self.app.upgrade() else { return };
		let chat_id = self.chat_id.as_str();
		if let Err(park) = apply_parked_dismissal(&app, chat_id) {
			eprintln!("[chat {chat_id}] parked dismissal failed: {park}");
		}
		remember_turn_failure(&app, chat_id, reported.unwrap_or_else(|| settlement_error_text(err)));
		end_turn(&app, chat_id);
		unregister_turn(&app, chat_id);
		unregister_live_agent(&app, chat_id);
		// The save may have landed before later bookkeeping failed: reconcile against what is on disk.
		let persisted = app.stores.chats.get_chat(chat_id).and_then(|r| r["messages"].as_arr().cloned()).unwrap_or_default();
		reconcile_user_steers(&app, chat_id, &persisted);
		let agent = self.agent.upgrade();
		settle_steers(&app, chat_id, &persisted, true, agent.as_ref());
	}
}

/// The settle kick: a record now over threshold starts its summary during the learner's pause.
fn kick(app: &Arc<App>, chat_id: &str) {
	let deps = app.stores.chats.get_chat(chat_id).and_then(|fresh| {
		let effective = app.stores.settings.effective_settings().ok()?;
		Some(compaction_deps(app, &fresh, &effective))
	});
	kick_compaction(app, deps, chat_id, !is_turn_running(app, chat_id));
}

/// The agent the next turn builds for this record.
fn agent_kind_of(record: &Json) -> AgentKind {
	match record["kind"].as_str() {
		Some("practice") => AgentKind::Practice,
		Some("talk") => AgentKind::Talk,
		Some("study") => AgentKind::Study,
		Some("homework") => AgentKind::Homework,
		_ if has_probe_done(record["messages"].as_arr().map_or(&[][..], Vec::as_slice)) => AgentKind::Teacher,
		_ => AgentKind::Prober,
	}
}

/// The compaction settings for a lesson, shared by the turn-start gate and the settle kick.
fn compaction_deps(app: &Arc<App>, record: &Json, effective: &Json) -> CompactionDeps {
	let engine = agent_engine(&app.bridge);
	let agent_kind = agent_kind_of(record);
	// A study session teaches; homework practices.
	let kind = match agent_kind {
		AgentKind::Teacher | AgentKind::Study => "teach",
		AgentKind::Prober => "probe",
		AgentKind::Homework | AgentKind::Practice => "practice",
		AgentKind::Talk => "talk",
	};
	let threshold_tokens = effective_threshold_tokens(effective["compaction"]["thresholdTokens"].as_f64(), engine.model["contextWindow"].as_f64());
	let system_prompt_tokens = (text::len16(&compose_instructions(agent_kind, &app.stores.prompt_overrides)) as f64 / 4.0).ceil();
	CompactionDeps { model_id: model_id_of(&engine.model), engine, kind, threshold_tokens, system_prompt_tokens }
}

/// Wires the wake pipeline to this composition at start-up: its steers run turns through
/// `handle_chat_input`, and crash recovery respawns orphaned jobs through the job runner.
pub(crate) fn wire(app: &Arc<App>) {
	let weak = Arc::downgrade(app);
	crate::jobs::set_job_respawn(
		app,
		Arc::new(move |job_id: String| {
			if let Some(app) = weak.upgrade() {
				run_job(&app, &job_id, None);
			}
		}),
	);
	let weak = Arc::downgrade(app);
	crate::jobs::set_turn_runner(
		app,
		Arc::new(move |chat_id: String, input: Json| {
			let weak = weak.clone();
			Box::pin(async move {
				let Some(app) = weak.upgrade() else { return 500 };
				let steers = input["steers"].as_arr().cloned().unwrap_or_default();
				handle_chat_input(&app, &chat_id, TurnInput::Steers(steers)).await.status
			})
		}),
	);
}

#[cfg(test)]
mod tests {
	use gs_base::clock;
	use tokio::sync::watch;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::turns::turn_runs::attach_turn;

	fn lesson(app: &App) -> String {
		app.stores.chats.create_chat("Sets", None, None, None).unwrap()["id"].as_str().unwrap().to_owned()
	}

	fn text(text: &str) -> TurnInput {
		TurnInput::Chat(ChatInput::Text { text: text.to_owned(), attachments: None })
	}

	fn saved(app: &App, chat_id: &str, text: &str) -> bool {
		app.stores.chats.get_chat(chat_id).is_some_and(|record| stringify(&record["messages"]).contains(text))
	}

	#[tokio::test(flavor = "multi_thread")]
	async fn a_message_whose_request_goes_away_during_a_compaction_is_still_saved() {
		let root = scratch_dir("chat-gone");
		let app = test_app(&root);
		let chat_id = lesson(&app);
		let (done, running) = watch::channel(false);
		app.turns.compactions.lock().insert(chat_id.clone(), running);
		// The window closes while the request waits out the compaction.
		let request = handle_chat_input(&app, &chat_id, text("What is a set?"));
		tokio::select! {
			_ = request => panic!("the request ended before the compaction"),
			() = clock::sleep(100) => {}
		}
		app.turns.compactions.lock().remove(&chat_id);
		done.send(true).unwrap();
		for _ in 0..200 {
			if saved(&app, &chat_id, "What is a set?") {
				break;
			}
			clock::sleep(10).await;
		}
		assert!(saved(&app, &chat_id, "What is a set?"));
	}

	#[tokio::test(flavor = "multi_thread")]
	async fn a_turn_whose_start_panics_releases_its_chat() {
		let root = scratch_dir("chat-unstarted");
		let app = test_app(&root);
		let chat_id = lesson(&app);
		assert!(begin_turn(&app, &chat_id));
		let starting = tokio::spawn({
			let (app, chat_id) = (app.clone(), chat_id.clone());
			async move {
				let _unstarted = Unstarted { app: &app, chat_id: &chat_id };
				panic!("the agent could not be built");
			}
		});
		assert!(starting.await.unwrap_err().is_panic());
		assert!(!is_turn_running(&app, &chat_id));
		assert!(attach_turn(&app, &chat_id).await.is_none());
	}

	#[cfg(unix)]
	#[test]
	fn a_write_ahead_that_cannot_save_still_announces_its_turn() {
		use std::os::unix::fs::PermissionsExt;
		let root = scratch_dir("chat-not-saved");
		let app = test_app(&root);
		let chat_id = lesson(&app);
		let mut events = app.events.subscribe();
		// The record stays readable, but nothing new can be written beside it.
		let set_mode = |mode| std::fs::set_permissions(&app.paths.chats, std::fs::Permissions::from_mode(mode)).unwrap();
		set_mode(0o555);
		let written = write_ahead(&app, &chat_id, &text("What is a set?"), &[]).err().map(|reply| reply.status);
		set_mode(0o755);
		assert_eq!(written, Some(500));
		let turn_events: Vec<EventKind> = std::iter::from_fn(|| events.try_recv().ok()).map(|e| e.kind).filter(|kind| matches!(kind, EventKind::TurnStarted | EventKind::TurnSettled)).collect();
		assert_eq!(turn_events, [EventKind::TurnStarted, EventKind::TurnSettled]);
		assert!(!is_turn_running(&app, &chat_id));
	}

	#[tokio::test(flavor = "multi_thread")]
	async fn a_view_that_attaches_on_turn_started_gets_the_live_turn() {
		let root = scratch_dir("chat-started");
		let app = test_app(&root);
		let chat_id = lesson(&app);
		let mut events = app.events.subscribe();
		// The turn is held up after its input is saved, before its handle is registered.
		let held = app.jobs.wake.lock();
		let request = tokio::spawn(handle_chat_input(&app, &chat_id, text("What is a set?")));
		std::thread::sleep(std::time::Duration::from_millis(200));
		assert!(std::iter::from_fn(|| events.try_recv().ok()).any(|e| e.kind == EventKind::TurnStarted));
		assert!(saved(&app, &chat_id, "What is a set?"));
		let attach = tokio::spawn({
			let (app, chat_id) = (app.clone(), chat_id.clone());
			async move { attach_turn(&app, &chat_id).await.is_some() }
		});
		std::thread::sleep(std::time::Duration::from_millis(100));
		assert!(!attach.is_finished());
		drop(held);
		assert!(request.await.unwrap().ok());
		assert!(attach.await.unwrap());
	}
}
