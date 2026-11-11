//! What the studio, the sheet beside a session and Show in Finder read.

use gs_base::clock::now_ms;
use gs_base::fsx::{node_error_message, write_atomic};
use gs_base::time::iso_now;
use gs_core::classes::today_note::local_day;
use gs_core::study::cheat_sheet::{new_cheat_sheet, sheet_cards};
use gs_json::{Json, js_number, json};

use super::context::{Saved, context_for, read_saved};
use super::files::{extension, is_pdf_name, picture_type};
use super::folder::take_folder_pdf;
use super::{Outcome, refuse};
use crate::App;
use crate::app::agent_folder::cheat_sheets_dir;
use crate::app::disk::make_dir;

/// The view the studio and the sheet beside a session show, after taking a newer PDF from the
/// working folder.
pub async fn cheat_sheet_view(app: &App, class_id: &str, deadline_id: &str) -> Outcome<Json> {
	let mut ctx = context_for(app, class_id, deadline_id)?;
	if take_folder_pdf(app, &ctx).await? {
		ctx = context_for(app, class_id, deadline_id)?;
	}
	let run = app.cheat_sheets.runs.lock().get(deadline_id).map(|r| r.message_id.clone());
	let failed = app.cheat_sheets.failed.lock().get(deadline_id).map(|f| (f.message_id.clone(), f.error.clone()));
	let (sheet, newer) = match ctx.saved {
		Saved::Sheet(sheet) => (sheet, false),
		Saved::Newer => (new_cheat_sheet(deadline_id, &iso_now()), true),
		Saved::None => (new_cheat_sheet(deadline_id, &iso_now()), false),
	};
	let mut view = json!({
		"className": ctx.class_name,
		"deadlineName": ctx.deadline.name,
		"date": ctx.deadline.date,
		"sheet": sheet,
		"running": run.map(|message_id| json!({ "messageId": message_id })),
		"error": failed.map(|(message_id, text)| json!({ "messageId": message_id, "text": text })),
	});
	if newer && let Some(o) = view.as_obj_mut() {
		o.insert("newer", true);
	}
	Ok(view)
}

/// The class's Cheat sheets page: each deadline and where its sheet is.
pub fn class_sheets_view(app: &App, class_id: &str) -> Outcome<Json> {
	let Some(record) = app.stores.classes.get_class(class_id) else { return refuse(404, "No such class") };
	let deadlines: &[Json] = record["deadlines"].as_arr().map_or(&[], |a| a.as_slice());
	// A class's own deadline ids are valid sheet ids, so a read can't fail here.
	let sheet_of = |id: &str| app.stores.cheat_sheets.read_cheat_sheet(class_id, id).ok().flatten();
	let running = |id: &str| app.cheat_sheets.runs.lock().contains_key(id);
	let cards = sheet_cards(deadlines, sheet_of, running, &local_day(now_ms()));
	Ok(json!({ "className": record["name"], "cards": cards }))
}

fn has_deadline(app: &App, class_id: &str, deadline_id: &str) -> bool {
	let record = app.stores.classes.get_class(class_id);
	record.is_some_and(|r| r["deadlines"].as_arr().is_some_and(|all| all.iter().any(|d| d["id"].as_str() == Some(deadline_id))))
}

/// A version's PDF, as the agent made it; None when there is none.
pub fn cheat_sheet_pdf(app: &App, class_id: &str, deadline_id: &str, n: f64) -> Option<Vec<u8>> {
	has_deadline(app, class_id, deadline_id).then(|| app.stores.cheat_sheets.read_sheet_pdf(class_id, deadline_id, n)).flatten()
}

/// A picture or PDF sent in the sheet's chat, with its type; None when there is none.
pub fn cheat_sheet_file(app: &App, class_id: &str, deadline_id: &str, file: &str) -> Option<(Vec<u8>, &'static str)> {
	let (_, bytes) = app.stores.cheat_sheets.read_cheat_sheet_file(class_id, deadline_id, file).filter(|_| has_deadline(app, class_id, deadline_id))?;
	let kind = if is_pdf_name(file) { "application/pdf" } else { picture_type(extension(file)).unwrap_or("application/octet-stream") };
	Some((bytes, kind))
}

/// Show in Finder: where a version's PDF is in the sheet's working folder. Its own file while it
/// is still that version, else godspeed's copy written there as "cheat sheet v<n>.pdf".
pub fn sheet_pdf_file(app: &App, class_id: &str, deadline_id: &str, n: f64) -> Outcome<String> {
	let gone = || refuse::<String>(404, "No such cheat sheet");
	let Saved::Sheet(sheet) = read_saved(app, class_id, deadline_id)? else { return gone() };
	let version = sheet["versions"].as_arr().and_then(|all| all.iter().find(|v| v["n"].as_f64() == Some(n)));
	let bytes = version.and_then(|_| cheat_sheet_pdf(app, class_id, deadline_id, n));
	let (Some(version), Some(bytes), Some(folder)) = (version, bytes, sheet["folder"].as_str().filter(|f| !f.is_empty())) else { return gone() };
	let same = |file: &std::path::Path| std::fs::read(file).is_ok_and(|saved| saved == bytes);
	if let Some(own) = version["file"].as_str().filter(|f| !f.is_empty())
		&& same(std::path::Path::new(own))
	{
		return Ok(own.to_owned());
	}
	let dir = cheat_sheets_dir(app).join(folder);
	let copy = dir.join(format!("cheat sheet v{}.pdf", js_number(n)));
	if !same(&copy) {
		make_dir(&dir)?;
		write_atomic(&copy, &bytes, None).map_err(|e| node_error_message(&e, "open", &copy))?;
	}
	Ok(copy.to_string_lossy().into_owned())
}
