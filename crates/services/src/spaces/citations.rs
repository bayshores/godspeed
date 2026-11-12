//! Source marks, server side (src/backend/server/citations.ts): checks the marks in a teacher
//! reply before it is stored, and serves what a click on a space file source shows (the passage
//! text and the PDF page). The marks themselves are core `messages::citations`.

use std::path::Path;
use std::sync::Arc;

use gs_core::messages::citations::{CiteMark, file_cite_mark, replace_cite_marks};
use gs_json::{Json, json};
use gs_search::chunks::range_point;
use gs_search::index::PassageRef;

use super::space_card::space_file_path;
use crate::App;
use crate::app::reading_pages::{ReadingError, is_pdf, mtime_ms, parse_page, render_pdf_page};

/// Whose file this is: the space record that holds it and the file itself.
fn find_file(app: &App, file_id: &str) -> Option<(Json, Json)> {
	app.stores.spaces.list_space_records().into_iter().find_map(|record| {
		let file = record["files"].as_arr()?.iter().find(|f| f["id"].as_str() == Some(file_id))?.clone();
		Some((record, file))
	})
}

fn name_of(file: &Json) -> &str {
	file["name"].as_str().unwrap_or_default()
}

/// The text with every space file mark checked, and the marks that point at nothing. A passage id
/// becomes the stored mark (file, place, file name); a mark that points at nothing is taken out and
/// listed once. Web marks stay as written.
pub fn check_cites(app: &App, text: &str) -> (String, Vec<String>) {
	let mut removed: Vec<String> = Vec::new();
	let checked = replace_cite_marks(text, |mark| {
		let (file_id, at) = match mark {
			CiteMark::Web { url } => return format!("[[{url}]]"),
			CiteMark::Passage { passage_id } => (passage_id[..passage_id.find(':').unwrap_or(passage_id.len())].to_owned(), PassageRef::Passage(passage_id)),
			CiteMark::File { file_id, range, .. } => (file_id.clone(), PassageRef::Place { file_id, range }),
		};
		if let Some((record, file)) = find_file(app, &file_id)
			&& let Some(passage) = app.search.passages_at(record["id"].as_str().unwrap_or_default(), &at).into_iter().next()
		{
			let range = match &at {
				PassageRef::Passage(_) => passage["range"].as_str().unwrap_or_default().to_owned(),
				PassageRef::Place { range, .. } => range.clone(),
			};
			return file_cite_mark(&file_id, &range, name_of(&file));
		}
		let bad = match at {
			PassageRef::Passage(id) => id,
			PassageRef::Place { range, .. } => format!("{file_id}/{range}"),
		};
		if !removed.contains(&bad) {
			removed.push(bad);
		}
		String::new()
	});
	(checked, removed)
}

/// What a click on a space file source shows: `{ name, range, page, text }`, where `page` is the
/// PDF page to show as an image (when the file is a PDF still on disk) and `text` the passage text
/// ("" when the file is not indexed).
pub fn cited_passage(app: &App, file_id: &str, range: &str) -> Result<Json, ReadingError> {
	let (record, file) = find_file(app, file_id).ok_or(ReadingError::Refused(404, "No space has that file"))?;
	let on_disk = space_file_path(app, &record, &file);
	let page = if is_pdf(Path::new(name_of(&file))) && on_disk.is_some_and(|p| Path::new(&p).exists()) { range_point(range) } else { None };
	let at = PassageRef::Place { file_id: file_id.to_owned(), range: range.to_owned() };
	let text = app.search.passages_at(record["id"].as_str().unwrap_or_default(), &at).iter().map(|p| p["text"].as_str().unwrap_or_default().to_owned()).collect::<Vec<_>>().join("\n");
	if page.is_none() && text.is_empty() {
		return Err(ReadingError::Refused(404, "No passage at that place"));
	}
	Ok(json!({ "name": file["name"], "range": range, "page": page.map_or(Json::Null, Json::from), "text": text }))
}

/// One page of a cited space PDF as a PNG; `page` is the address's text, read like `Number`.
pub async fn cited_page(app: &App, file_id: &str, page: &str) -> Result<Arc<Vec<u8>>, ReadingError> {
	let Some(page) = parse_page(page) else { return Err(ReadingError::Refused(400, "page must be a whole number from 1")) };
	let on_disk = find_file(app, file_id).filter(|(_, file)| is_pdf(Path::new(name_of(file)))).and_then(|(record, file)| space_file_path(app, &record, &file));
	let Some(on_disk) = on_disk else { return Err(ReadingError::Refused(404, "No PDF for that file")) };
	let meta = tokio::fs::metadata(&on_disk).await.ok().filter(std::fs::Metadata::is_file).ok_or(ReadingError::Refused(404, "No PDF for that file"))?;
	render_pdf_page(app, Path::new(&on_disk), mtime_ms(&meta), page).await
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	const NOTES: &str = "f_aaaaaaaaaaaa";
	const SLIDES: &str = "f_bbbbbbbbbbbb";
	const GONE: &str = "f_cccccccccccc";
	const TALK: &str = "f_dddddddddddd";

	/// A space with a text file, a PDF and a transcript, and a search table of their passages
	/// written by hand (made-up text; the index is never built under test).
	fn make_space(app: &App) {
		let record = app.stores.spaces.create_space(&json!({ "name": "Made-up Space" })).unwrap();
		let id = record["id"].as_str().unwrap();
		let dir = app.stores.spaces.files_dir(id).unwrap();
		std::fs::create_dir_all(&dir).unwrap();
		std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/fixtures/sample-3page.pdf"), dir.join("slides.pdf")).unwrap();
		crate::app::disk::write_file_atomic(&dir.join("notes.txt"), "line one\nline two\n").unwrap();
		let file = |id: &str, name: &str| json!({ "id": id, "origin": "copied", "name": name, "path": name, "kind": "study", "contentFp": "0", "status": "ready", "addedAt": "2026-01-01T00:00:00.000Z" });
		app.stores.spaces.save_files(id, vec![file(NOTES, "notes.txt"), file(SLIDES, "slides.pdf"), file(TALK, "lecture.srt")], &[]).unwrap();
		let rows = json!([
			{ "id": format!("{NOTES}:1"), "fileId": NOTES, "range": "lines 1–2", "from": 1, "to": 2, "text": "line one line two", "hash": "h1" },
			{ "id": format!("{SLIDES}:1"), "fileId": SLIDES, "range": "p. 2", "from": 2, "to": 2, "text": "Page two says hello.", "hash": "h2" },
			// A transcript's place is rounded down, so its number is before the passage starts.
			{ "id": format!("{TALK}:1"), "fileId": TALK, "range": "12:30–13:40", "from": 750.5, "to": 820, "text": "So a heap is a tree.", "hash": "h3" },
		]);
		let table = json!({ "format": 1, "model": "Snowflake/snowflake-arctic-embed-xs", "rows": rows, "files": { NOTES: { "fp": "0", "extent": "2 lines" }, SLIDES: { "fp": "0", "extent": "3 pages" } } });
		let search = app.paths.data.join("spaces").join(id).join("search");
		crate::app::disk::write_file_atomic(&search.join("passages.json"), &stringify(&table)).unwrap();
		gs_base::fsx::write_atomic(&search.join("passages.f32"), &[0u8; 3 * 384 * 4], None).unwrap();
	}

	#[test]
	fn marks_are_checked_against_the_space_passages() {
		let root = scratch_dir("cites-check");
		let app = test_app(&root);
		make_space(&app);
		assert_eq!(check_cites(&app, &format!("Page two says hello. [[{SLIDES}:1]]")), (format!("Page two says hello. [[{SLIDES}/p. 2/slides.pdf]]"), vec![]));
		let stored = format!("Heaps. [[{TALK}/12:30–13:40/lecture.srt]]");
		assert_eq!(check_cites(&app, &format!("Heaps. [[{TALK}:1]]")), (stored.clone(), vec![]));
		assert_eq!(check_cites(&app, &stored), (stored, vec![]));
		assert_eq!(check_cites(&app, &format!("A. [[{NOTES}:9]] B. [[{NOTES}:9]] C. [[{GONE}:1]]")), ("A.  B.  C. ".to_owned(), vec![format!("{NOTES}:9"), format!("{GONE}:1")]));
		assert_eq!(check_cites(&app, &format!("Yes. [[{SLIDES}/p. 2/old name.pdf]]")), (format!("Yes. [[{SLIDES}/p. 2/slides.pdf]]"), vec![]));
		assert_eq!(check_cites(&app, &format!("Yes. [[{SLIDES}/p. 3/slides.pdf]]")), ("Yes. ".to_owned(), vec![format!("{SLIDES}/p. 3")]));
		for text in ["See this. [[https://example.com/page]]", "Nothing here, only [brackets] and a list a[[0]] in code `[[x]]`."] {
			assert_eq!(check_cites(&app, text), (text.to_owned(), vec![]));
		}
	}

	#[test]
	fn a_click_shows_the_passage_and_the_pdf_page() {
		let root = scratch_dir("cites-passage");
		let app = test_app(&root);
		make_space(&app);
		let shown = |file_id: &str, range: &str| cited_passage(&app, file_id, range).map(|v| stringify(&v));
		assert_eq!(shown(NOTES, "lines 1–2"), Ok(r#"{"name":"notes.txt","range":"lines 1–2","page":null,"text":"line one line two"}"#.to_owned()));
		assert_eq!(shown(SLIDES, "p. 2"), Ok(r#"{"name":"slides.pdf","range":"p. 2","page":2,"text":"Page two says hello."}"#.to_owned()));
		assert_eq!(shown(SLIDES, "p. 3"), Ok(r#"{"name":"slides.pdf","range":"p. 3","page":3,"text":""}"#.to_owned()));
		assert_eq!(shown(NOTES, "lines 50–60"), Err(ReadingError::Refused(404, "No passage at that place")));
		assert_eq!(shown(GONE, "p. 1"), Err(ReadingError::Refused(404, "No space has that file")));
		assert_eq!(shown("not-an-id", "p. 1"), Err(ReadingError::Refused(404, "No space has that file")));
	}

	#[tokio::test]
	async fn a_page_needs_a_whole_number_and_a_pdf_on_disk() {
		let root = scratch_dir("cites-page");
		let app = test_app(&root);
		make_space(&app);
		let page = |file_id: &'static str, n: &'static str| {
			let app = app.clone();
			async move { cited_page(&app, file_id, n).await.map(|_| ()) }
		};
		assert_eq!(page(SLIDES, "0").await, Err(ReadingError::Refused(400, "page must be a whole number from 1")));
		assert_eq!(page(SLIDES, "1.5").await, Err(ReadingError::Refused(400, "page must be a whole number from 1")));
		assert_eq!(page(NOTES, "1").await, Err(ReadingError::Refused(404, "No PDF for that file")));
		assert_eq!(page(GONE, "1").await, Err(ReadingError::Refused(404, "No PDF for that file")));
	}
}
