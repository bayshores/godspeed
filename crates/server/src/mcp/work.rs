//! The work loop's tools: wait_for_work, respond and read_work. Every lesson turn, helper job
//! and graph-fact run parks its model request on the bridge; the agent takes it, answers it,
//! repeats.

use std::future::{Future, poll_fn};
use std::pin::pin;
use std::sync::Arc;
use std::task::Poll;

use gs_base::clock;
use gs_base::text::len16;
use gs_core::spaces::space_tools::lesson_started_last_turn;
use gs_core::session::work_pages::{WORK_PAGE_BYTES, page_blocks};
use gs_engine::bridge::{AgentReply, ReplyCall, WaitOptions, WorkView};
use gs_json::{Json, Obj, json, stringify};
use gs_services::App;
use gs_services::spaces::citations::check_cites;

use super::caller::{agent_id_of, in_claude_code};
use super::reply::{failure, result, text_block};
use super::tools::ToolCall;

/// Codex's default MCP tool timeout is 60 s, so the default wait stays under it. A client with
/// a longer timeout (Codex started from the godspeed folder) may ask for longer waits, which
/// saves it a model turn each.
const DEFAULT_WAIT_S: f64 = 45.0;
const MAX_WAIT_S: f64 = 600.0;
/// respond's wait for a follow-up when the agent names none.
const RESPOND_DEFAULT_WAIT_S: f64 = 30.0;
/// A message text this long goes in its own plain-text block, where its line breaks and quotes
/// cost nothing; shorter ones stay in the JSON.
const LONG_TEXT_CHARS: usize = 1_000;

fn wait_ms(seconds: Option<f64>) -> i64 {
	(seconds.unwrap_or(DEFAULT_WAIT_S).clamp(1.0, MAX_WAIT_S) * 1000.0) as i64
}

/// The backup teacher's waiter always says --backup and stays on no lesson.
pub(super) fn waiter_hint(lesson_id: Option<&str>, backup: bool) -> String {
	let flags = match lesson_id.filter(|l| !l.is_empty()) {
		_ if backup => " --backup".to_owned(),
		Some(lesson) => format!(" --lesson {lesson}"),
		None => String::new(),
	};
	format!(
		"Wait with the waiter, not by calling wait_for_work yourself: run node .godspeed/wait-for-work.mjs{flags} in the background (CLAUDE.md in the godspeed folder has the exact command) and end your turn. It costs no tokens and wakes you when work arrives."
	)
}

fn idle(caller: Option<&str>, backup: bool) -> Json {
	let note = if in_claude_code(caller) {
		format!("Nothing to do right now. {}", waiter_hint(None, backup))
	} else {
		"Nothing to do right now. Call wait_for_work again to keep waiting (the learner may be reading or answering).".to_owned()
	};
	json!({ "status": "idle", "note": note })
}

/// A work item as text blocks: compact JSON naming its conversation, then its instructions and
/// long message texts as plain text, where line breaks, quotes and LaTeX backslashes need no
/// escaping.
fn describe(app: &App, view: &WorkView) -> Vec<String> {
	let mut envelope = Obj::new();
	envelope.insert("status", "work");
	envelope.insert("workId", view.work_id.as_str());
	if let Some(chat) = app.stores.chats.get_chat(&view.conversation) {
		envelope.insert("lessonId", chat["id"].clone());
		envelope.insert("lessonTitle", chat["title"].clone());
		envelope.insert("kind", if chat["kind"].is_null() { Json::from("teach") } else { chat["kind"].clone() });
	} else if let Some(label) = &view.label {
		envelope.insert("kind", "background task");
		envelope.insert("task", label.as_str());
	} else {
		envelope.insert("kind", "background task (a helper job or knowledge-graph run)");
	}
	envelope.insert("continued", view.continued);
	if let Some(earlier) = view.instructions_as_in.as_deref().filter(|w| !w.is_empty()) {
		envelope.insert("instructionsAsIn", earlier);
	}
	if let Some(tools) = &view.tools {
		envelope.insert("tools", tools.clone());
	}
	if let Some(names) = &view.tools_as_before {
		envelope.insert("toolsAsBefore", names.clone());
	}
	let mut texts: Vec<String> = Vec::new();
	let messages: Vec<Json> = view
		.messages
		.iter()
		.map(|m| match m["text"].as_str() {
			Some(text) if len16(text) >= LONG_TEXT_CHARS => {
				texts.push(format!("[text {}]\n{text}", texts.len() + 1));
				let mut short = m.clone();
				if let Some(o) = short.as_obj_mut() {
					o.insert("text", format!("[text {}]", texts.len()));
				}
				short
			}
			_ => m.clone(),
		})
		.collect();
	envelope.insert("messages", messages);
	if let Some(images) = view.images.as_ref().filter(|i| !i.is_empty()) {
		envelope.insert("imageCount", images.len());
	}
	if view.instructions_as_in.is_some() || view.tools_as_before.is_some() {
		envelope.insert("note", "You already have what instructionsAsIn and toolsAsBefore point at. If you lost it, call read_work with this workId and full: true.");
	}
	let mut blocks = vec![stringify(&Json::Obj(envelope))];
	if let Some(instructions) = view.instructions.as_deref().filter(|i| !i.is_empty()) {
		blocks.push(format!("Instructions (your system prompt for this conversation; follow them exactly):\n\n{instructions}"));
	}
	blocks.extend(texts);
	blocks
}

/// A work item as a tool result: its text blocks, then its images as real MCP images (the
/// "[image N]" markers point at them in order). A long item sends page 1 after a short header.
fn work_result(app: &App, view: &WorkView) -> Json {
	let images = view.images.iter().flatten().map(|image| json!({ "type": "image", "data": image["data"], "mimeType": image["mimeType"] }));
	let pages = page_blocks(&describe(app, view), WORK_PAGE_BYTES);
	app.bridge.set_work_pages(&view.work_id, pages.clone());
	let count = pages.len();
	let mut content: Vec<Json> = Vec::new();
	if count > 1 {
		let note = format!("This work item is long, so it comes in {count} pages. Below is page 1. Read pages 2 to {count} with read_work before you respond.");
		let header = json!({ "status": "work", "workId": view.work_id, "page": 1, "pages": count, "note": note });
		content.push(text_block(&stringify(&header)));
	}
	content.extend(pages.into_iter().next().unwrap_or_default().iter().map(|b| text_block(b)));
	content.extend(images);
	json!({ "content": content })
}

/// Runs a wait's first step at once (its first look at the queue and its check-in), as calling
/// the TS async function does, then `meanwhile`, then the rest of the wait.
async fn started_then<T>(wait: impl Future<Output = T>, meanwhile: impl FnOnce()) -> T {
	let mut wait = pin!(wait);
	let first = poll_fn(|cx| Poll::Ready(wait.as_mut().poll(cx))).await;
	meanwhile();
	match first {
		Poll::Ready(value) => value,
		Poll::Pending => wait.await,
	}
}

pub async fn wait_for_work(call: &ToolCall<'_>, args: &Json) -> Json {
	let app = call.app;
	let lesson_id = args["lesson_id"].as_str().filter(|l| !l.is_empty());
	if let Some(lesson) = lesson_id
		&& app.stores.chats.get_chat(lesson).is_none()
	{
		return failure(&format!("No lesson \"{lesson}\". Use list_lessons."));
	}
	let agent = agent_id_of(call.meta);
	let full = args["full_context"].as_bool() == Some(true);
	// The backup teacher's waiter (wait-for-work.mjs --backup).
	if call.meta["godspeed/backup"] == Json::Bool(true) {
		let opts = WaitOptions { agent, full, backup: true, ..WaitOptions::default() };
		return match app.bridge.wait_for_work(wait_ms(args["timeout_seconds"].as_f64()), opts).await {
			Some(view) => work_result(app, &view),
			None => result(&idle(call.caller, true)),
		};
	}
	app.bridge.stay_on(agent.as_deref(), lesson_id);
	let opts = WaitOptions { conversation: lesson_id.map(str::to_owned), agent, full, and_background: true, backup: false };
	// Waiting counts the agent as working at once, so what godspeed queues for it now (catch-up)
	// reaches this same wait.
	let wait = app.bridge.wait_for_work(wait_ms(args["timeout_seconds"].as_f64()), opts);
	let view = started_then(wait, || gs_services::turns::agent_catch_up::catch_up_for_agent(app, clock::now_ms())).await;
	match view {
		Some(view) => work_result(app, &view),
		None => result(&idle(call.caller, false)),
	}
}

/// Ends the hold on a conversation when respond stops waiting, however it stops.
struct Release<'a> {
	app: &'a App,
	conversation: String,
}

impl Drop for Release<'_> {
	fn drop(&mut self) {
		self.app.bridge.release_conversation(&self.conversation);
	}
}

pub async fn respond(call: &ToolCall<'_>, args: &Json) -> Json {
	let app = call.app;
	let follow_up_ms = (args["wait_seconds"].as_f64().unwrap_or(RESPOND_DEFAULT_WAIT_S) * 1000.0) as i64;
	let tool_calls = args["tool_calls"].as_arr().into_iter().flatten().map(|c| ReplyCall { name: c["name"].as_str().unwrap_or_default().to_owned(), arguments: c["arguments"].clone() });
	// Checked before it is stored, so the stored text and the seen-mark fingerprint agree.
	let (text, removed) = args["text"].as_str().map(|text| check_cites(app, text)).unzip();
	let removed_marks = match removed.filter(|r| !r.is_empty()) {
		Some(removed) => format!("Removed source marks that don't point at a passage of a space file: {}. Use ids from search_space_files.", removed.join(", ")),
		None => String::new(),
	};
	let with_removed = |note: String| if removed_marks.is_empty() { note } else { format!("{removed_marks} {note}") };
	let reply = AgentReply { text, tool_calls: tool_calls.collect() };
	let answered = match app.bridge.respond_to_work(args["work_id"].as_str().unwrap_or_default(), reply, follow_up_ms) {
		Ok(answered) => answered,
		Err(error) => return failure(&with_removed(error)),
	};
	// The Talk chat has no page to go to; its replies show in the panel.
	if let Some(lesson) = app.stores.chats.get_chat(&answered.conversation).filter(|l| l["kind"].as_str() != Some("talk")) {
		note_replying(app, call.caller, &lesson);
	}
	let backup = app.bridge.is_backup_agent(answered.agent.as_deref());
	let next = {
		let _release = Release { app, conversation: answered.conversation.clone() };
		let opts = WaitOptions { conversation: Some(answered.conversation.clone()), agent: answered.agent.clone(), backup, ..WaitOptions::default() };
		app.bridge.wait_for_work(follow_up_ms, opts).await
	};
	if let Some(next) = next {
		let mut work = work_result(app, &next);
		if !removed_marks.is_empty()
			&& let Some(content) = work.as_obj_mut().and_then(|w| w.get_mut("content")).and_then(Json::as_arr_mut)
		{
			content.insert(0, text_block(&removed_marks));
		}
		return work;
	}
	let note = turn_complete_note(app, call.caller, &answered.conversation, answered.agent.as_deref(), backup);
	result(&json!({ "status": "turn_complete", "note": with_removed(note) }))
}

fn note_replying(app: &Arc<App>, caller: Option<&str>, lesson: &Json) {
	let id = lesson["id"].as_str().unwrap_or_default();
	let action = json!({
		"label": format!("Replying in {}", lesson["title"].as_str().unwrap_or_default()),
		"spaceId": lesson["spaceId"],
		"target": { "kind": "lesson", "id": id },
		"page": format!("/chat/{id}"),
	});
	gs_services::app::agent_actions::note_agent_action(app, caller, &action);
}

/// The note when no follow-up came: where the agent goes next. The backup stays on no lesson.
fn turn_complete_note(app: &App, caller: Option<&str>, conversation: &str, agent: Option<&str>, backup: bool) -> String {
	let chat = app.stores.chats.get_chat(conversation);
	let claude_code = in_claude_code(caller);
	// A Talk reply goes on to the lesson it just started, else back to the lesson the agent was
	// staying on, not to Talk alone.
	let talk = chat.as_ref().is_some_and(|c| c["kind"].as_str() == Some("talk"));
	let started = chat.as_ref().filter(|_| talk).and_then(|c| lesson_started_last_turn(c["messages"].as_arr().map_or(&[][..], Vec::as_slice)));
	if let Some(started) = started.as_deref().filter(|_| !backup) {
		app.bridge.stay_on(agent, Some(started));
	}
	let lesson_id = if talk { started.clone().or_else(|| app.bridge.staying_on(agent)) } else { chat.as_ref().and_then(|c| c["id"].as_str().map(str::to_owned)) };
	let lesson_id = lesson_id.filter(|l| !l.is_empty());
	let wait = if claude_code {
		waiter_hint(lesson_id.as_deref(), backup)
	} else {
		let stay = lesson_id.as_deref().map(|l| format!(" (lesson_id \"{l}\" to stay on this lesson)")).unwrap_or_default();
		format!("Call wait_for_work to continue{stay}.")
	};
	match &chat {
		None => format!("The task step is done. {}", if claude_code { waiter_hint(None, false) } else { "Call wait_for_work for more.".to_owned() }),
		Some(_) if talk => format!("Your reply is in Talk.{} {wait}", if started.is_some() { " The lesson you started is waiting for you." } else { "" }),
		Some(_) => format!("Your turn is done. The learner is reading and will answer in the godspeed window. {wait}"),
	}
}

pub fn read_work(call: &ToolCall<'_>, args: &Json) -> Json {
	let app = call.app;
	let work_id = args["work_id"].as_str().unwrap_or_default();
	if args["full"].as_bool() == Some(true) {
		return match app.bridge.full_work_view(work_id) {
			Ok(view) => work_result(app, &view),
			Err(error) => failure(&error),
		};
	}
	let Some(page) = args["page"].as_i64() else { return failure("Give the page to read, or full: true.") };
	let (blocks, pages) = match app.bridge.read_work_page(work_id, page) {
		Ok(read) => read,
		Err(error) => return failure(&error),
	};
	let note = if (page as usize) < pages { format!("Next: read_work page {}.", page + 1) } else { "That was the last page. Answer with respond.".to_owned() };
	let header = result(&json!({ "workId": work_id, "page": page, "pages": pages, "note": note }));
	let mut content = header["content"].as_arr().cloned().unwrap_or_default();
	content.extend(blocks.iter().map(|b| text_block(b)));
	json!({ "content": content })
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn waits_are_clamped_like_the_ts() {
		assert_eq!(wait_ms(None), 45_000);
		assert_eq!(wait_ms(Some(0.0)), 1_000);
		assert_eq!(wait_ms(Some(601.0)), 600_000);
	}

	#[test]
	fn hints_name_the_lesson() {
		assert!(waiter_hint(Some("chat_a"), false).contains("wait-for-work.mjs --lesson chat_a in the background"));
		assert!(waiter_hint(None, false).contains("wait-for-work.mjs in the background"));
		assert_eq!(idle(Some("Codex"), true)["note"], json!("Nothing to do right now. Call wait_for_work again to keep waiting (the learner may be reading or answering)."));
	}

	#[test]
	fn the_backup_waits_with_backup_never_on_a_lesson() {
		assert!(waiter_hint(Some("chat_a"), true).contains("wait-for-work.mjs --backup in the background"));
		assert!(idle(Some("Claude Code"), true)["note"].as_str().unwrap().starts_with("Nothing to do right now. Wait with the waiter, not by calling wait_for_work yourself: run node .godspeed/wait-for-work.mjs --backup in"));
	}

	#[tokio::test]
	async fn a_ready_wait_still_runs_the_step_between() {
		let mut ran = false;
		assert_eq!(started_then(async { 7 }, || ran = true).await, 7);
		assert!(ran);
	}
}
