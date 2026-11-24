//! One chat turn over the server-owned record (chat-handler.ts). POST /api/chat carries one input
//! event (text, answer, side, next, continue, opener-answer), never a client transcript; the wake
//! pipeline's steers come through here too. The event becomes record appends (written ahead, before
//! the turn runs), the agent is built from the record, and the turn runs as a background object
//! that views attach to through GET /api/chats/{id}/stream. The POST only acknowledges.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Weak};

use gs_base::events::EventKind;
use gs_base::locks::LockKey;
use gs_base::{ids, time};
use gs_core::contracts::chat::extracts_facts;
use gs_core::messages::app_notes::app_note_for;
use gs_core::messages::attachments::ChatAttachment;
use gs_core::messages::input_events::{About, ChatInput, ChatInputError, TurnInput, input_appends};
use gs_core::messages::native_messages::{dangling_question_of, has_probe_done, is_side_turn, retry_context};
use gs_core::messages::role::Role;
use gs_core::session::jobs::steer_delivered;
use gs_core::session::prices::CallUsage;
use gs_core::session::turn_cause::turn_cause;
use gs_engine::turn::agent::Agent;
use gs_engine::turn::call_ids::collect_tool_call_ids;
use gs_engine::turn::events::AgentEvent;
use gs_engine::turn::models::agent_engine;
use gs_engine::turn::ui_stream::{SettleError, TurnSpec, run_pi_turn};
use gs_json::{Json, json, stringify};
use parking_lot::Mutex;

use super::attachments::{AttachmentError, store_attachments};
use super::compaction::{CompactionDeps, ensure_compacted, kick_compaction, summarize_at_tokens};
use super::dismissal_park::apply_parked_dismissal;
use super::lesson_problems::problems_view;
use super::job_host::run_job;
use super::lesson_agent::{TurnAgent, build_lesson_agent};
use super::review::askable;
use super::turn_liveness::{begin_turn, end_turn, turn_started};
use super::turn_runs::{register_turn, remember_turn_failure, unregister_turn};
use super::turn_service::{persist_turn, trigger_extraction};
use super::turn_work;
use crate::App;
use crate::app::agent_actions::record_answer;
use crate::app::today_note::today_note_for;
use crate::graph::progress::lesson_ended;
use crate::spaces::space_actions::SendFirstMessage;
use crate::jobs::{note_steers_durable, reconcile_user_steers, register_live_agent, settle_steers, unregister_live_agent};

/// The live update window of a turn's stream.
const UPDATE_FLUSH_MS: i64 = 100;
const NOT_SAVED: &str = "Your input could not be saved. Please try again.";
/// Ask Teacher on a question from earlier that is no longer the open one.
pub const REVIEW_NOT_OPEN: &str = "That question from earlier is not open";

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

/// What a message to the old Talk chat answers.
const TALK_REPLACED: &str = "Talk was replaced by your agent's screen";

pub type ReplyFuture = Pin<Box<dyn Future<Output = ChatReply> + Send>>;

/// A new lesson's first message, sent as the learner's text; Err holds the refusal's body text.
pub fn send_first_message(app: &Arc<App>) -> SendFirstMessage {
	let app = app.clone();
	Arc::new(move |chat_id, text| {
		let sent = handle_chat_input(&app, &chat_id, TurnInput::Chat(ChatInput::Text { text, attachments: None, about: None }));
		Box::pin(async move {
			let reply = sent.await;
			if reply.ok() { Ok(()) } else { Err(reply.text()) }
		})
	})
}

/// The turn composition: one input event, its record appends, one agent turn in the background.
/// Also the wake pipeline's entry (`TurnInput::Steers`). Runs on its own task once polled: a
/// request whose client went away is dropped at its next await, and the learner's input must
/// still be saved and its turn run.
pub fn handle_chat_input(app: &Arc<App>, chat_id: &str, input: TurnInput) -> ReplyFuture {
	let (app, chat_id) = (app.clone(), chat_id.to_owned());
	Box::pin(async move { gs_base::tasks::spawn("chat", async move { run(&app, &chat_id, input).await }).await.unwrap_or_else(ChatReply::thrown) })
}

fn input_files(input: &TurnInput) -> Option<&[ChatAttachment]> {
	match input {
		TurnInput::Chat(ChatInput::Text { attachments, .. } | ChatInput::Answer { attachments, .. } | ChatInput::Side { attachments, .. }) => attachments.as_deref(),
		_ => None,
	}
}

async fn run(app: &Arc<App>, chat_id: &str, input: TurnInput) -> ChatReply {
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return ChatReply::error(404, "Unknown chat") };
	// An older build's Talk chat is kept as it was; the learner talks to the agent in its screen.
	if record["kind"].as_str() == Some("talk") {
		return ChatReply::error(404, TALK_REPLACED);
	}

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

	// The compaction gate: a record still over the threshold is shortened now, at once (no
	// model). It runs before the appends and begin_turn, and the record is read again after it.
	ensure_compacted(app, &compaction_deps(app, &effective), chat_id);

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

	// Ask Teacher on a question from earlier: it must still be askable, and its note carries it whole.
	let asked = match input {
		TurnInput::Chat(ChatInput::Text { about: Some(About::Review { of, .. }), .. }) => match askable(app, chat_id, &record, of) {
			Ok(Some(open)) => Some(open),
			Ok(None) => return Err(ChatReply::error(400, REVIEW_NOT_OPEN)),
			Err(err) => return Err(ChatReply::thrown(err)),
		},
		_ => None,
	};

	// A pick names one of the lesson's problems.
	if let TurnInput::Chat(ChatInput::Open { number }) = input {
		let view = problems_view(app, &record);
		if !view.is_some_and(|v| v["problems"].items().iter().any(|p| p["number"].as_str() == Some(number.as_str()))) {
			return Err(ChatReply::error(400, &format!("no problem numbered {number}")));
		}
	}

	// The wake carries every queued marker; one already in the record is a re-fire.
	let mut appends = match input {
		TurnInput::Steers(steers) => steers.iter().filter(|s| !steer_delivered(&messages, s["id"].str_or_empty())).cloned().collect(),
		TurnInput::Chat(chat) => input_appends(&record, chat, attachments).map_err(|ChatInputError(message)| ChatReply::error(400, &message))?,
	};

	// The [Today] note goes right before a learner message when the day, the open deadlines or a
	// compaction call for a fresh one. The app note goes there too.
	if let TurnInput::Chat(chat @ (ChatInput::Text { .. } | ChatInput::Next | ChatInput::Open { .. })) = input {
		let at = appends.len().saturating_sub(1);
		let notes = today_note_for(app, &record).into_iter().chain(app_note_for(&record, chat, asked.as_ref()));
		appends.splice(at..at, notes);
	}
	let mut merged: Vec<Json> = messages.iter().chain(&appends).cloned().collect();

	// An answer that leaves a sibling question waiting starts no turn: the last answer fires the
	// one reaction turn with every result next to its calls.
	let sibling_waits = matches!(input, TurnInput::Chat(ChatInput::Answer { .. })) && dangling_question_of(&merged).is_some();
	// The app note follows the batch's last answer, where the agent reads it with the answers; none
	// sits between two results of one call batch.
	if let TurnInput::Chat(chat @ ChatInput::Answer { .. }) = input
		&& !sibling_waits
		&& let Some(note) = app_note_for(&record, chat, None)
	{
		appends.push(note.clone());
		merged.push(note);
	}
	if let TurnInput::Chat(ChatInput::Answer { answer, .. }) = input
		&& sibling_waits
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
	turn_work::begin(app, chat_id, turn_cause(input, &messages));
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

	agent.subscribe(turn_work::listener(app, chat_id, record["spaceId"].as_str()));

	// One collector per turn, fed by the agent's finished assistant messages.
	let steps: Arc<Mutex<Vec<Json>>> = Arc::default();
	let sink = steps.clone();
	agent.subscribe(Arc::new(move |event: &AgentEvent| {
		if let AgentEvent::MessageEnd(message) = event
			&& Role::Assistant.is(message)
			&& message.get("usage").is_some()
			&& message["stopReason"].as_str() != Some("aborted")
		{
			sink.lock().push(CallUsage::from_model_usage(&message["usage"]).to_json());
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
		on_settle_error: Box::new(settlement_error_text),
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
fn settlement_error_text(err: &SettleError) -> String {
	match err {
		SettleError::NotSaved => err.to_string(),
		SettleError::Other(_) => "An error occurred.".to_owned(),
	}
}

fn model_id_of(model: &Json) -> String {
	format!("{}:{}", model["provider"].str_or_empty(), model["id"].str_or_empty())
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
	fn finished(&self, app: &Arc<App>, base: usize, turn_messages: &[Json], usage: Usage, extraction: Option<(Option<&str>, f64)>) -> Result<(), SettleError> {
		let chat_id = self.chat_id.as_str();
		let stamped = persist_turn(app, chat_id, base, turn_messages)?;
		let durable = app.stores.chats.get_chat(chat_id).and_then(|r| r["messages"].as_arr().cloned());
		note_steers_durable(app, chat_id, durable.as_deref().unwrap_or(&stamped));
		// The provenance message is the turn's first new assistant message.
		if let Some(response) = stamped.iter().find(|m| Role::Assistant.is(m))
			&& !usage.steps.is_empty()
		{
			let entry = json!({ "id": usage.id, "messageId": response["id"], "at": time::iso_now(), "model": usage.model, "steps": usage.steps.to_vec() });
			app.stores.chats.append_turn_usage(chat_id, &entry)?;
		}
		if let Some((scope, chunk_tokens)) = extraction {
			trigger_extraction(app, chat_id, scope, chunk_tokens);
		}
		apply_parked_dismissal(app, chat_id)?;
		if lesson_ended(app, chat_id) {
			crate::vault::queue_lesson(app, chat_id);
		}
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
	fn failed(&self, err: &SettleError, reported: Option<&str>) {
		let Some(app) = self.app.upgrade() else { return };
		let chat_id = self.chat_id.as_str();
		if let Err(park) = apply_parked_dismissal(&app, chat_id) {
			eprintln!("[chat {chat_id}] parked dismissal failed: {park}");
		}
		remember_turn_failure(&app, chat_id, reported.map_or_else(|| settlement_error_text(err), str::to_owned).as_str());
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

/// The settle kick: a lesson now over the threshold is shortened at once, and the quiet wait for
/// the model's summary starts again.
fn kick(app: &Arc<App>, chat_id: &str) {
	let weak = Arc::downgrade(app);
	let id = chat_id.to_owned();
	let build = Arc::new(move || {
		let app = weak.upgrade()?;
		app.stores.chats.get_chat(&id)?;
		let effective = app.stores.settings.effective_settings().ok()?;
		Some(compaction_deps(&app, &effective))
	});
	kick_compaction(app, build, chat_id);
}

/// The compaction settings for a lesson, shared by the turn-start gate and the settle kick.
fn compaction_deps(app: &Arc<App>, effective: &Json) -> CompactionDeps {
	let engine = agent_engine(&app.bridge);
	let threshold_tokens = summarize_at_tokens(effective, &engine.model);
	CompactionDeps { model_id: model_id_of(&engine.model), engine, threshold_tokens }
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

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::turns::turn_liveness::is_turn_running;
	use crate::turns::turn_runs::attach_turn;

	fn lesson(app: &App) -> String {
		app.stores.chats.create_chat("Sets", None, None, None, &[]).unwrap()["id"].as_str().unwrap().to_owned()
	}

	fn text(text: &str) -> TurnInput {
		TurnInput::Chat(ChatInput::Text { text: text.to_owned(), attachments: None, about: None })
	}

	fn saved(app: &App, chat_id: &str, text: &str) -> bool {
		app.stores.chats.get_chat(chat_id).is_some_and(|record| stringify(&record["messages"]).contains(text))
	}

	#[tokio::test(flavor = "multi_thread")]
	async fn a_turn_whose_start_panics_releases_its_chat() {
		let root = scratch_dir("chat-unstarted");
		let app = test_app(&root);
		let chat_id = lesson(&app);
		assert!(begin_turn(&app, &chat_id));
		let starting = gs_base::tasks::spawn("test", {
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

	#[test]
	fn a_pick_names_one_of_the_lessons_problems() {
		let root = scratch_dir("chat-open-pick");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Algorithms" })).unwrap()["id"].str_or_empty().to_owned();
		let sheet = json!({ "id": "f_test", "origin": "copied", "name": "Practice.pdf", "path": "p", "kind": "info", "contentFp": "x", "status": "ready", "addedAt": "t" });
		app.stores.spaces.save_files(&space_id, vec![sheet], &[]).unwrap();
		let deadline_id = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "HW6", "kind": "homework", "date": "2099-01-15" })).unwrap()["id"].str_or_empty().to_owned();
		let homework = app.stores.chats.create_chat("HW6", Some("homework"), Some(&space_id), Some(&deadline_id), &[]).unwrap();
		let on_files = app.stores.chats.create_chat("Practice", Some("study"), Some(&space_id), None, &["f_test".to_owned()]).unwrap();
		for chat in [homework, on_files] {
			let problems = super::super::lesson_problems::lesson_problem_list(&app, &chat).unwrap();
			assert_eq!(problems.post(&[json!({ "number": "2b", "title": "Sums", "text": "Sum 1 to n." })]), None);
			problems.mark_done("2b");
			let chat_id = chat["id"].str_or_empty().to_owned();
			let pick = |number: &str| TurnInput::Chat(ChatInput::Open { number: number.to_owned() });
			let refused = write_ahead(&app, &chat_id, &pick("7"), &[]).err().map(|reply| reply.status);
			assert_eq!(refused, Some(400));
			let opened = write_ahead(&app, &chat_id, &pick("2b"), &[]).err().map(|r| (r.status, format!("{:?}", r.body)));
			assert_eq!(opened, None, "a done one opens again");
			end_turn(&app, &chat_id);
			assert_eq!(custom_types(&app, &chat_id).last().map(String::as_str), Some("practice-next"), "{:?}", chat["kind"]);
		}
	}

	/// A stop a day ago that he kept going from an hour ago, then `tail`.
	fn resumed_lesson(app: &App, tail: Vec<Json>) -> String {
		let (day_ago, hour_ago) = (clock::now_ms() - 24 * 3_600_000, clock::now_ms() - 3_600_000);
		let mut messages = vec![
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "c1", "name": "conclude", "arguments": { "outcome": "solved" } }], "timestamp": day_ago }),
			json!({ "role": "toolResult", "toolCallId": "c1", "toolName": "conclude", "details": { "stop": { "kind": "problem", "activeMinutes": 30, "at": time::iso(day_ago) } }, "isError": false, "timestamp": day_ago }),
			json!({ "role": "custom", "customType": "keep-going", "content": "", "details": { "stopOf": "c1", "at": time::iso(hour_ago) }, "timestamp": hour_ago }),
		];
		messages.extend(tail);
		let chat_id = lesson(app);
		app.stores.chats.save_messages(&chat_id, &messages).unwrap();
		chat_id
	}

	fn custom_types(app: &App, chat_id: &str) -> Vec<String> {
		let record = app.stores.chats.get_chat(chat_id).unwrap();
		record["messages"].as_arr().unwrap().iter().map(|m| m["customType"].as_str().or(m["role"].as_str()).unwrap_or_default().to_owned()).collect()
	}

	#[test]
	fn the_app_note_goes_before_his_message_and_after_his_answer() {
		let root = scratch_dir("chat-app-note");
		let app = test_app(&root);
		let typed = resumed_lesson(&app, Vec::new());
		assert!(write_ahead(&app, &typed, &text("Where were we?"), &[]).is_ok());
		end_turn(&app, &typed);
		assert_eq!(custom_types(&app, &typed)[3..], ["today-context", "app-note", "user"]);

		let quiz = json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "q1", "name": "quiz", "arguments": {} }], "stopReason": "toolUse", "timestamp": clock::now_ms() });
		let answered = resumed_lesson(&app, vec![quiz]);
		let answer = TurnInput::Chat(ChatInput::Answer { tool_call_id: "q1".to_owned(), answer: json!({ "kind": "quiz", "dontKnow": true }), attachments: None });
		assert!(write_ahead(&app, &answered, &answer, &[]).is_ok());
		end_turn(&app, &answered);
		let types = custom_types(&app, &answered);
		assert_eq!(types[types.len() - 2..], ["toolResult", "app-note"]);
		let record = app.stores.chats.get_chat(&answered).unwrap();
		assert_eq!(record["messages"].as_arr().unwrap().last().unwrap()["content"], json!("[Resumed] He came back to this session after a stop."));
	}

	#[test]
	fn a_skipped_question_starts_the_turn() {
		let root = scratch_dir("chat-skip");
		let app = test_app(&root);
		let quiz = json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "q1", "name": "quiz", "arguments": {} }], "stopReason": "toolUse", "timestamp": clock::now_ms() });
		let chat_id = resumed_lesson(&app, vec![quiz]);
		let skip = TurnInput::Chat(ChatInput::Answer { tool_call_id: "q1".to_owned(), answer: json!({ "kind": "quiz", "dismissed": true }), attachments: None });
		assert!(write_ahead(&app, &chat_id, &skip, &[]).is_ok(), "a skip is owed a reaction like any answer");
		assert!(is_turn_running(&app, &chat_id));
		end_turn(&app, &chat_id);
		let record = app.stores.chats.get_chat(&chat_id).unwrap();
		let saved = record["messages"].as_arr().unwrap().iter().find(|m| m["toolCallId"].as_str() == Some("q1") && Role::ToolResult.is(m)).unwrap();
		assert_eq!(saved["details"]["dismissed"], json!(true));
		assert!(crate::app::agent_actions::recent_agent_actions(&app).is_empty(), "a skip is not logged as a wrong answer");
	}

	#[test]
	fn the_app_note_waits_for_the_last_answer_of_a_call_batch() {
		let root = scratch_dir("chat-app-note-batch");
		let app = test_app(&root);
		let both = json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "q1", "name": "quiz", "arguments": {} }, { "type": "toolCall", "id": "q2", "name": "quiz", "arguments": {} }], "stopReason": "toolUse", "timestamp": clock::now_ms() });
		let chat_id = resumed_lesson(&app, vec![both]);
		let answer = |id: &str| TurnInput::Chat(ChatInput::Answer { tool_call_id: id.to_owned(), answer: json!({ "kind": "quiz", "dontKnow": true }), attachments: None });
		assert!(write_ahead(&app, &chat_id, &answer("q1"), &[]).is_err(), "q2 still waits: no turn");
		assert_eq!(custom_types(&app, &chat_id)[3..], ["assistant", "toolResult"]);
		assert!(write_ahead(&app, &chat_id, &answer("q2"), &[]).is_ok());
		end_turn(&app, &chat_id);
		assert_eq!(custom_types(&app, &chat_id)[3..], ["assistant", "toolResult", "toolResult", "app-note"]);
	}

	#[tokio::test(flavor = "multi_thread")]
	async fn a_view_that_attaches_on_turn_started_gets_the_live_turn() {
		let root = scratch_dir("chat-started");
		let app = test_app(&root);
		let chat_id = lesson(&app);
		let mut events = app.events.subscribe();
		// The turn is held up after its input is saved, before its handle is registered.
		let held = app.jobs.wake.lock();
		let request = gs_base::tasks::spawn("test", handle_chat_input(&app, &chat_id, text("What is a set?")));
		std::thread::sleep(std::time::Duration::from_millis(200));
		assert!(std::iter::from_fn(|| events.try_recv().ok()).any(|e| e.kind == EventKind::TurnStarted));
		assert!(saved(&app, &chat_id, "What is a set?"));
		let attach = gs_base::tasks::spawn("test", {
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
