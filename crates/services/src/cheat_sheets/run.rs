//! The requests behind a sheet's chat: a message is kept, then the agent answers it, maybe with a
//! new PDF (kept as the newest version) and rules.

use std::sync::Arc;

use gs_agent::subagents::cheat_sheet_writer::{SheetReply, SheetRequest, reply_on_sheet};
use gs_agent::tools::space::search_tools;
use gs_base::ids::uuid;
use gs_base::locks::LockKey;
use gs_base::text::{len16, trim};
use gs_base::time::iso_now;
use gs_core::messages::attachments::{ChatAttachment, is_pdf_type};
use gs_core::study::cheat_sheet::{PROMPT_MAX, cheat_sheet_request_text, current_version, new_cheat_sheet, region_problem, with_message, with_rules, with_version, without_rule};
use gs_engine::turn::abort::Abort;
use gs_engine::turn::models::agent_engine;
use gs_json::{Json, json};

use super::cheat_sheet_pdf::take_sheet_pdf;
use super::context::{Context, Saved, context_for, read_saved, sheet_now};
use super::files::{files_for_agent, keep_files};
use super::folder::working_folder;
use super::{BUSY, Failed, NEWER, Outcome, Running, Stop, changed, refuse};
use crate::App;
use crate::spaces::citations::check_cites;
use crate::spaces::space_search::space_search;

/// A message as the route parsed it.
pub struct AskInput {
	pub text: String,
	pub attachments: Option<Vec<ChatAttachment>>,
	pub region: Option<Json>,
}

fn items(v: &Json) -> &[Json] {
	v.as_arr().map_or(&[], |a| a.as_slice())
}

/// A message in the sheet's chat: kept, then the agent answers it. Pictures go to the agent as
/// pictures, PDFs as a note with their path.
pub fn ask(app: &Arc<App>, space_id: &str, deadline_id: &str, input: AskInput) -> Outcome<()> {
	let text = trim(&input.text);
	let attachments = input.attachments.unwrap_or_default();
	if text.is_empty() && attachments.is_empty() {
		return refuse(400, "Say what you want to ask or change.");
	}
	if len16(text) > PROMPT_MAX {
		return refuse(400, format!("Keep it under {PROMPT_MAX} characters."));
	}
	if attachments.iter().any(|a| !is_pdf_type(&a.mime_type) && !a.mime_type.starts_with("image/")) {
		return refuse(400, "Send pictures or PDFs.");
	}
	// One request at a time per sheet: the checks and the start happen under one lock.
	let _guard = app.locks.lock(LockKey::Space(space_id));
	let mut ctx = context_for(app, space_id, deadline_id)?;
	if matches!(ctx.saved, Saved::Newer) {
		return refuse(409, NEWER);
	}
	if app.cheat_sheets.runs.lock().contains_key(deadline_id) {
		return refuse(409, BUSY);
	}
	let sheet = sheet_now(app, &ctx)?;
	if let Some(wrong) = input.region.as_ref().and_then(|r| region_problem(r, items(&sheet["versions"]))) {
		return refuse(400, wrong);
	}
	let files = keep_files(app, space_id, deadline_id, &attachments)?;
	let mut message = gs_json::Obj::new();
	message.insert("id", uuid());
	message.insert("role", "you");
	message.insert("text", text);
	message.insert("at", iso_now());
	if !files.is_empty() {
		message.insert("files", files);
	}
	if let Some(region) = &input.region {
		message.insert("region", region.clone());
	}
	let message = Json::Obj(message);
	app.stores.cheat_sheets.write_cheat_sheet(space_id, &with_message(&sheet, &message))?;
	ctx.saved = read_saved(app, space_id, deadline_id)?;
	start_run(app, &ctx, message["id"].as_str().unwrap_or(""))
}

/// Try again: the message the last request failed on, sent again.
pub fn retry(app: &Arc<App>, space_id: &str, deadline_id: &str) -> Outcome<()> {
	let _guard = app.locks.lock(LockKey::Space(space_id));
	let failed = app.cheat_sheets.failed.lock().get(deadline_id).map(|f| f.message_id.clone());
	let Some(message_id) = failed else { return refuse(409, "Nothing to try again.") };
	let ctx = context_for(app, space_id, deadline_id)?;
	start_run(app, &ctx, &message_id)
}

/// Stop the request the agent is working on.
pub fn stop(app: &App, deadline_id: &str) {
	if let Some(run) = app.cheat_sheets.runs.lock().get(deadline_id) {
		run.abort.abort();
	}
}

/// Delete one of the sheet's rules.
pub fn remove_rule(app: &App, space_id: &str, deadline_id: &str, text: &str) -> Outcome<()> {
	let _guard = app.locks.lock(LockKey::Space(space_id));
	let ctx = context_for(app, space_id, deadline_id)?;
	if matches!(ctx.saved, Saved::Newer) {
		return refuse(409, NEWER);
	}
	let sheet = sheet_now(app, &ctx)?;
	app.stores.cheat_sheets.write_cheat_sheet(space_id, &without_rule(&sheet, text))?;
	changed(app, deadline_id);
	Ok(())
}

/// Ends a run when its task does, however it ends: the run is forgotten and the change announced.
struct RunEnd {
	app: Arc<App>,
	deadline_id: String,
}

impl Drop for RunEnd {
	fn drop(&mut self) {
		self.app.cheat_sheets.runs.lock().remove(&self.deadline_id);
		changed(&self.app, &self.deadline_id);
	}
}

/// Runs one request: the agent answers the message. Refused while another runs; its end is
/// announced. The caller holds the space lock.
fn start_run(app: &Arc<App>, ctx: &Context, message_id: &str) -> Outcome<()> {
	let id = ctx.deadline.id.clone();
	if app.cheat_sheets.runs.lock().contains_key(&id) {
		return refuse(409, BUSY);
	}
	if matches!(ctx.saved, Saved::Newer) {
		return refuse(409, NEWER);
	}
	let folder = sheet_now(app, ctx).and_then(|sheet| working_folder(app, ctx, &sheet)).map_err(|e| Stop::Refuse(500, format!("Couldn't make the cheat sheet's folder: {e}")))?;
	// Saved now, so a retry or a renamed deadline keeps the same folder.
	if folder.sheet["folder"].as_str() != ctx.saved.folder() {
		app.stores.cheat_sheets.write_cheat_sheet(&ctx.space_id, &folder.sheet)?;
	}
	let messages = items(&folder.sheet["messages"]);
	let index = messages.iter().position(|m| m["id"].as_str() == Some(message_id));
	let Some((index, message)) = index.map(|i| (i, &messages[i])).filter(|(_, m)| m["role"].as_str() == Some("you")) else { return refuse(409, "That message is gone.") };
	let abort = Abort::new();
	app.cheat_sheets.runs.lock().insert(id.clone(), Running { message_id: message_id.to_owned(), abort: abort.clone() });
	app.cheat_sheets.failed.lock().remove(&id);
	changed(app, &id);

	let title = format!("{} {}", ctx.space_name, ctx.deadline.name);
	let text = cheat_sheet_request_text(&json!({
		"title": title,
		"date": ctx.deadline.date,
		"spaceNotes": ctx.space_notes,
		"infoFiles": ctx.info_files,
		"rules": folder.sheet["rules"],
		"topics": ctx.topics,
		"mistakes": ctx.mistakes,
		"folder": { "path": folder.path.to_string_lossy(), "files": folder.files },
		"versions": folder.sheet["versions"],
		"earlier": &messages[..index],
		"message": message,
	}));
	let parts = files_for_agent(app, &ctx.space_id, &id, items(&message["files"]));
	let prompt = if parts.is_empty() { Json::from(text) } else { Json::from([vec![json!({ "type": "text", "text": text })], parts].concat()) };
	let (task_app, folder_path) = (app.clone(), folder.path.clone());
	let request = SheetRequest {
		title,
		prompt,
		lookups: search_tools(space_search(app, &ctx.space_id)),
		check_text: Box::new({
			let app = app.clone();
			// Cheat sheets are not asked to quote: a quote that does not hold is dropped quietly.
			move |text| {
				let checked = check_cites(&app, text);
				(checked.text, checked.removed)
			}
		}),
		take_pdf: Box::new(move |path| {
			let (app, folder) = (task_app.clone(), folder_path.clone());
			Box::pin(async move { take_sheet_pdf(&app, &folder, &path).await })
		}),
		engine: agent_engine(&app.bridge),
		signal: abort.clone(),
	};
	let answer = Answer { app: app.clone(), space_id: ctx.space_id.clone(), deadline_id: id, message_id: message_id.to_owned(), asked: message["text"].as_str().unwrap_or("").to_owned() };
	tokio::spawn(async move {
		let _end = RunEnd { app: answer.app.clone(), deadline_id: answer.deadline_id.clone() };
		let done = match reply_on_sheet(&answer.app.bridge, request).await {
			Ok(reply) => keep_reply(&answer, reply),
			Err(err) => Err(err.to_string()),
		};
		if let Err(error) = done {
			if abort.is_aborted() {
				return;
			}
			eprintln!("[cheat-sheet {}] request failed: {error}", answer.deadline_id);
			answer.app.cheat_sheets.failed.lock().insert(answer.deadline_id.clone(), Failed { message_id: answer.message_id.clone(), error });
		}
	});
	Ok(())
}

/// What a finished request needs to write its answer.
struct Answer {
	app: Arc<App>,
	space_id: String,
	deadline_id: String,
	message_id: String,
	/// The message the agent answers.
	asked: String,
}

/// Writes the agent's answer: the PDF as the newest version, the new rules, the reply.
fn keep_reply(answer: &Answer, reply: SheetReply) -> Result<(), String> {
	let Answer { app, space_id, deadline_id, asked, .. } = answer;
	let _guard = app.locks.lock(LockKey::Space(space_id));
	let at = iso_now();
	let store = &app.stores.cheat_sheets;
	let mut sheet = match read_saved(app, space_id, deadline_id)? {
		Saved::Sheet(sheet) => sheet,
		_ => new_cheat_sheet(deadline_id, &at),
	};
	let mut version = None;
	if let Some(pdf) = &reply.pdf {
		let (next, dropped) = with_version(&sheet, &json!({ "prompt": asked, "at": at, "pages": pdf.pages, "file": pdf.file }));
		let n = current_version(&next).and_then(|v| v["n"].as_f64()).unwrap_or(1.0);
		store.save_sheet_pdf(space_id, deadline_id, n, &pdf.bytes)?;
		store.remove_sheet_pdfs(space_id, deadline_id, &dropped)?;
		sheet = next;
		version = Some(n);
	}
	let (kept, added) = with_rules(&sheet, &reply.rules, &at);
	let mut message = gs_json::Obj::new();
	message.insert("id", uuid());
	message.insert("role", "agent");
	message.insert("text", reply.text);
	message.insert("at", at.as_str());
	if let Some(n) = version {
		message.insert("version", n);
	}
	if !added.is_empty() {
		message.insert("rules", added);
	}
	let mut sheet = with_message(&kept, &Json::Obj(message));
	if let Some(o) = sheet.as_obj_mut() {
		o.insert("updatedAt", at);
	}
	store.write_cheat_sheet(space_id, &sheet)
}
