//! Search over one space's files for the lesson and cheat-sheet agents (searchSpaceFiles and
//! readPassage in search-index.ts): the space record is read at call time, so new files count.

use std::path::Path;
use std::sync::Arc;

use gs_agent::tools::space::SpaceSearch;
use gs_json::Json;
use gs_pdf::may_hold_broken_formulas;

use super::files::{files_of, str_of};
use super::space_card::space_file_path;
use super::text_cache::read_kept_pages;
use crate::App;
use crate::app::reading_pages::is_pdf;

/// The space's files, as the search reads them (none when the space is gone).
fn space_files(app: &App, space_id: &str) -> Vec<Json> {
	app.stores.spaces.get_space(space_id).and_then(|record| record["files"].as_arr().cloned()).unwrap_or_default()
}

/// With `formula_notes` (a lesson's with the `pdf` tool on) a result that shows a PDF page whose
/// formulas may read broken says so.
pub fn space_search(app: &Arc<App>, space_id: &str, formula_notes: bool) -> SpaceSearch {
	let (search_app, search_space) = (app.clone(), space_id.to_owned());
	let (read_app, read_space) = (app.clone(), space_id.to_owned());
	SpaceSearch {
		search_files: Box::new(move |query, limit| {
			let (app, space_id) = (search_app.clone(), search_space.clone());
			Box::pin(async move {
				let (found, hits) = app.search.search_space_files(&space_id, &space_files(&app, &space_id), &query, limit).await?;
				Ok(if formula_notes { with_formula_notes(&app, &space_id, found, &hits) } else { found })
			})
		}),
		read_passage: Box::new(move |at| {
			let text = read_app.search.read_passage(&read_space, &space_files(&read_app, &read_space), &at);
			if formula_notes { with_formula_notes(&read_app, &read_space, text, &read_app.search.passages_at(&read_space, &at)) } else { text }
		}),
	}
}

/// `text`, then a line for each PDF with a page among `passages` whose formulas may read broken and
/// that has no kept copy yet: the teacher has it looked at with `pdf` first, and the reader keeps it.
fn with_formula_notes(app: &App, space_id: &str, text: String, passages: &[Json]) -> String {
	let Some(record) = app.stores.spaces.get_space(space_id) else { return text };
	let mut out = text;
	for file in files_of(&record).iter().filter(|f| is_pdf(Path::new(str_of(f, "name")))) {
		let kept = read_kept_pages(app, space_id, str_of(file, "id"), str_of(file, "contentFp"));
		let unkept = |p: &Json| (p["from"].as_f64().unwrap_or(0.0) as u32..=p["to"].as_f64().unwrap_or(0.0) as u32).any(|page| !kept.contains_key(&page));
		let mut pages: Vec<&str> = passages.iter().filter(|p| p["fileId"].as_str() == Some(str_of(file, "id")) && unkept(p) && may_hold_broken_formulas(str_of(p, "text"))).map(|p| str_of(p, "range")).collect();
		pages.dedup();
		let Some(path) = space_file_path(app, &record, file).filter(|_| !pages.is_empty()) else { continue };
		out.push_str(&format!("\n\nFormulas on {} of {} may read broken here. Before you teach from them, have the page looked at with `pdf` (path: {path}).", pages.join(", "), str_of(file, "name")));
	}
	out
}
