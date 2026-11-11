//! A sheet's working folder: made when its first request needs it, and a PDF the learner changes
//! there comes in as a new version.

use std::collections::HashSet;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use gs_agent::subagents::cheat_sheet_writer::TakenPdf;
use gs_base::fsx::node_error_message;
use gs_base::locks::LockKey;
use gs_base::time::iso_now;
use gs_core::classes::class_shortcuts::unique_name;
use gs_base::text::cmp16;
use gs_core::study::cheat_sheet::{current_version, newer_folder_pdf, sheet_folder_name, with_version};
use gs_json::{Json, js_number, json};

use super::cheat_sheet_pdf::take_sheet_pdf;
use super::context::{Context, Saved, sheet_now};
use super::Outcome;
use crate::App;
use crate::app::agent_folder::cheat_sheets_dir;
use crate::app::disk::make_dir;

pub(super) struct Folder {
	pub sheet: Json,
	pub path: PathBuf,
	pub files: Vec<String>,
}

/// The names in a folder (UTF-8, lossy), in directory order.
fn names(dir: &std::path::Path) -> std::io::Result<Vec<String>> {
	std::fs::read_dir(dir)?.map(|entry| Ok(entry?.file_name().to_string_lossy().into_owned())).collect()
}

/// The sheet's working folder, made if missing: the one it was given at its first request, else
/// a new one named for the class and deadline.
pub(super) fn working_folder(app: &App, ctx: &Context, sheet: &Json) -> Result<Folder, String> {
	let root = cheat_sheets_dir(app);
	make_dir(&root)?;
	let mut taken: HashSet<String> = names(&root).map_err(|e| node_error_message(&e, "scandir", &root))?.iter().map(|n| n.to_lowercase()).collect();
	let name = match sheet["folder"].as_str().filter(|f| !f.is_empty()) {
		Some(folder) => folder.to_owned(),
		None => unique_name(&sheet_folder_name(&ctx.class_name, &ctx.deadline.name), &mut taken),
	};
	let dir = root.join(&name);
	make_dir(&dir)?;
	let mut files: Vec<String> = names(&dir).map_err(|e| node_error_message(&e, "scandir", &dir))?.into_iter().filter(|n| !n.starts_with('.')).collect();
	files.sort_by(|a, b| cmp16(a, b));
	let mut sheet = sheet.clone();
	if sheet["folder"].as_str().is_none_or(str::is_empty)
		&& let Some(o) = sheet.as_obj_mut()
	{
		o.insert("folder", name);
	}
	Ok(Folder { sheet, path: dir, files })
}

/// A PDF in the working folder newer than the current version (the learner changed the sheet
/// outside godspeed, say in their agent's own chat) is kept as a new version, after the same
/// checks as one the agent sends. Not while the agent works on the sheet; each file is looked at
/// once. True when a version was added.
pub(super) async fn take_folder_pdf(app: &App, ctx: &Context) -> Outcome<bool> {
	let Saved::Sheet(sheet) = &ctx.saved else { return Ok(false) };
	let Some(folder) = ctx.saved.folder() else { return Ok(false) };
	if app.cheat_sheets.runs.lock().contains_key(&ctx.deadline.id) {
		return Ok(false);
	}
	let dir = cheat_sheets_dir(app).join(folder);
	let Ok(listed) = names(&dir) else { return Ok(false) };
	let mut files: Vec<(String, f64)> = listed
		.into_iter()
		.filter_map(|name| {
			let stat = std::fs::metadata(dir.join(&name)).ok().filter(|s| s.is_file())?;
			let ms = stat.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_secs_f64() * 1000.0;
			Some((name, ms))
		})
		.collect();
	files.sort_by(|a, b| cmp16(&a.0, &b.0));
	let at = current_version(sheet).and_then(|v| v["at"].as_str());
	let Some(pick) = newer_folder_pdf(&files, at) else { return Ok(false) };
	let mtime = files.iter().find(|f| f.0 == pick).map_or(f64::NAN, |f| f.1);
	let key = format!("{}/{pick} {}", dir.to_string_lossy(), js_number(mtime));
	if !app.cheat_sheets.folder_seen.lock().insert(key) {
		return Ok(false);
	}
	let pdf = match take_sheet_pdf(app, &dir, &pick).await {
		Ok(pdf) => pdf,
		Err(why) => {
			eprintln!("[cheat-sheet {}] {pick} in the working folder can't be the sheet: {why}", ctx.deadline.id);
			return Ok(false);
		}
	};
	Ok(keep_folder_version(app, ctx, &pdf)?)
}

/// Saves the folder's PDF as the newest version, unless the newest already is that file.
fn keep_folder_version(app: &App, ctx: &Context, pdf: &TakenPdf) -> Result<bool, String> {
	let _guard = app.locks.lock(LockKey::Class(&ctx.class_id));
	let now = sheet_now(app, ctx)?;
	let id = &ctx.deadline.id;
	if let Some(n) = current_version(&now).and_then(|v| v["n"].as_f64())
		&& app.stores.cheat_sheets.read_sheet_pdf(&ctx.class_id, id, n).is_some_and(|saved| saved == pdf.bytes)
	{
		return Ok(false);
	}
	let version = json!({ "prompt": "", "at": iso_now(), "pages": pdf.pages, "file": pdf.file, "fromFolder": true });
	let (next, dropped) = with_version(&now, &version);
	let n = current_version(&next).and_then(|v| v["n"].as_f64()).unwrap_or(1.0);
	app.stores.cheat_sheets.save_sheet_pdf(&ctx.class_id, id, n, &pdf.bytes)?;
	app.stores.cheat_sheets.write_cheat_sheet(&ctx.class_id, &next)?;
	app.stores.cheat_sheets.remove_sheet_pdfs(&ctx.class_id, id, &dropped)?;
	Ok(true)
}
