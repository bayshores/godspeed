//! Source marks, server side: checks the marks in a teacher
//! reply before it is stored, and serves what a click on a space file source shows (the passage
//! text and the PDF page). The marks themselves are core `messages::citations`.

use std::path::Path;
use std::sync::Arc;

use gs_core::messages::citations::{CheckedMarks, CiteMark, DroppedQuote, cut_unreadable_quotes, file_cite_mark, replace_cite_marks};
use gs_base::text;
use gs_core::contracts::space::{extension_of, plain_text_extensions};
use gs_core::messages::quote_find::{check_quote, find_once};
use gs_json::{Json, json};
use gs_search::chunks::{range_point, unix_lines};
use gs_search::index::PassageRef;

use super::space_card::space_file_path;
use crate::App;
use crate::app::reading_pages::{CACHE_LIMIT, ReadingError, TEXT_MAX_BYTES, is_pdf, mtime_ms, parse_page, render_pdf_page};

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

/// The text of the passages at `at`, joined as a click shows them.
fn passage_text(passages: &[Json]) -> String {
	passages.iter().map(|p| p["text"].as_str().unwrap_or_default().to_owned()).collect::<Vec<_>>().join("\n")
}

/// The text with every space file mark checked. A passage id becomes the stored mark (file, place,
/// file name, and its quote with single spaces when the quoted words are found once in that
/// passage); a mark that
/// points at nothing is taken out and listed once, and a quote that does not hold is dropped and
/// listed once. Web marks stay as written.
pub fn check_cites(app: &App, text: &str) -> CheckedMarks {
	let (text, mut dropped) = cut_unreadable_quotes(text);
	let mut removed: Vec<String> = Vec::new();
	let checked = replace_cite_marks(&text, |mark| {
		let (file_id, at, quote) = match mark {
			CiteMark::Web { url } => return format!("[[{url}]]"),
			CiteMark::Passage { passage_id, quote } => (passage_id[..passage_id.find(':').unwrap_or(passage_id.len())].to_owned(), PassageRef::Passage(passage_id), quote),
			CiteMark::File { file_id, range, quote, .. } => (file_id.clone(), PassageRef::Place { file_id, range }, quote),
		};
		let written = match &at {
			PassageRef::Passage(id) => id.clone(),
			PassageRef::Place { range, .. } => format!("{file_id}/{range}"),
		};
		if let Some((record, file)) = find_file(app, &file_id) {
			let passages = app.search.passages_at(record["id"].as_str().unwrap_or_default(), &at);
			if let Some(passage) = passages.first() {
				let range = match &at {
					PassageRef::Passage(_) => passage["range"].as_str().unwrap_or_default().to_owned(),
					PassageRef::Place { range, .. } => range.clone(),
				};
				let quote = quote.filter(|quote| match check_quote(&passage_text(&passages), quote) {
					Ok(_) => true,
					Err(miss) => {
						let drop = DroppedQuote { mark: written.clone(), quote: quote.clone(), miss };
						if !dropped.contains(&drop) {
							dropped.push(drop);
						}
						false
					}
				});
				let quote = quote.map(|q| q.split_whitespace().collect::<Vec<_>>().join(" "));
				return file_cite_mark(&file_id, &range, name_of(&file), quote.as_deref());
			}
		}
		if !removed.contains(&written) {
			removed.push(written);
		}
		String::new()
	});
	CheckedMarks { text: checked, removed, dropped }
}

/// What a click on a space file source shows: `{ name, range, page, text, marks }`, where `page`
/// is the PDF page to show as an image (when the file is a PDF still on disk), `text` the passage
/// text ("" when the file is not indexed), and `marks` where `quote` sits (null without a quote or
/// when it is not found once).
pub async fn cited_passage(app: &App, file_id: &str, range: &str, quote: Option<&str>) -> Result<Json, ReadingError> {
	let (record, file) = find_file(app, file_id).ok_or(ReadingError::Refused(404, "No space has that file"))?;
	let on_disk = space_file_path(app, &record, &file).filter(|p| Path::new(p).exists());
	let page = if is_pdf(Path::new(name_of(&file))) && on_disk.is_some() { range_point(range) } else { None };
	let at = PassageRef::Place { file_id: file_id.to_owned(), range: range.to_owned() };
	let passages = app.search.passages_at(record["id"].as_str().unwrap_or_default(), &at);
	let text = passage_text(&passages);
	if page.is_none() && text.is_empty() {
		return Err(ReadingError::Refused(404, "No passage at that place"));
	}
	let marks = match (quote, on_disk) {
		(None, _) => None,
		(Some(quote), Some(on_disk)) if page.is_some() => page_marks(app, Path::new(&on_disk), page.unwrap_or_default() as u32, quote).await,
		(Some(quote), on_disk) if reads_as_lines(name_of(&file)) => match on_disk {
			Some(on_disk) => line_marks(Path::new(&on_disk), &passages, quote).await,
			None => None,
		},
		(Some(quote), _) => find_once(&text, quote).ok().map(|(start, end)| json!({ "kind": "passage", "start": start, "end": end })),
	};
	Ok(json!({ "name": file["name"], "range": range, "page": page.map_or(Json::Null, Json::from), "text": text, "marks": marks.unwrap_or(Json::Null) }))
}

/// Plain text and code: their passages' lines are the file's own lines.
fn reads_as_lines(name: &str) -> bool {
	let ext = extension_of(name);
	ext.is_empty() || plain_text_extensions().any(|e| e == ext)
}

/// `{ kind: "page", boxes }` on PDF page `page`, cached by file version.
async fn page_marks(app: &App, on_disk: &Path, page: u32, quote: &str) -> Option<Json> {
	let meta = tokio::fs::metadata(on_disk).await.ok()?;
	let key = format!("{}:{}:{page}:{quote}", on_disk.display(), mtime_ms(&meta));
	if let Some((_, marks)) = app.misc.quote_boxes.lock().iter().find(|(cached, _)| *cached == key) {
		return Some(marks.clone()).filter(|m| !m.is_null());
	}
	let owned = quote.to_owned();
	let boxes = app.pdf.quote_boxes(on_disk, page, move |text| find_once(text, &owned).ok()).await.unwrap_or_default();
	let fraction = |v: f64| Json::from((v * 1e5).round() / 1e5);
	let marks = if boxes.is_empty() {
		Json::Null
	} else {
		json!({ "kind": "page", "boxes": boxes.iter().map(|b| json!({ "x": fraction(b.x), "y": fraction(b.y), "w": fraction(b.w), "h": fraction(b.h) })).collect::<Json>() })
	};
	let mut cache = app.misc.quote_boxes.lock();
	cache.push_back((key, marks.clone()));
	if cache.len() > CACHE_LIMIT {
		cache.pop_front();
	}
	Some(marks).filter(|m| !m.is_null())
}

/// Lines shown around a quote in a text or code file.
const SHOWN_LINES: usize = 12;

/// `{ kind: "lines", first, lines, spans }`: the 12 lines of the file centred on the quote's first
/// line, read from the file itself (a passage's stored text is trimmed), and the quote's place on
/// each of its lines in UTF-16 units. The quote is looked for in the passage's lines only.
async fn line_marks(on_disk: &Path, passages: &[Json], quote: &str) -> Option<Json> {
	tokio::fs::metadata(on_disk).await.ok().filter(|m| m.is_file() && m.len() <= TEXT_MAX_BYTES)?;
	let raw = tokio::fs::read(on_disk).await.ok()?;
	let all = unix_lines(&text::from_utf8_lossy(&raw));
	let lines: Vec<&str> = all.split('\n').collect();
	let bound = |key: &'static str| passages.iter().filter_map(move |p| p[key].as_f64()).map(|n| n as usize);
	let (from, to) = (bound("from").min()?.max(1), bound("to").max()?.min(lines.len()));
	let passage = lines.get(from - 1..to)?.join("\n");
	let (start, end) = find_once(&passage, quote).ok()?;
	// The quote's lines and columns, counted from the passage's first line.
	let mut spans = Vec::new();
	let mut at = 0;
	for (i, line) in lines[from - 1..to].iter().enumerate() {
		let len = text::len16(line);
		let (line_start, line_end) = (at, at + len);
		at = line_end + 1;
		if line_end < start || line_start >= end {
			continue;
		}
		let indent = text::len16(line) - text::len16(text::trim_start(line));
		let first = if start >= line_start { start - line_start } else { indent };
		let last = end.min(line_end) - line_start;
		if last > first {
			spans.push((from + i, first, last));
		}
	}
	let marked = spans.first()?.0;
	let last_line = lines.len() - usize::from(lines.last() == Some(&""));
	let shown_end = (marked.saturating_sub(SHOWN_LINES / 2 - 1).max(1) + SHOWN_LINES - 1).min(last_line);
	let shown_start = shown_end.saturating_sub(SHOWN_LINES - 1).max(1);
	let shown: Json = lines[shown_start - 1..shown_end].iter().map(|l| Json::from(*l)).collect();
	let spans: Json = spans.into_iter().filter(|(line, ..)| (shown_start..=shown_end).contains(line)).map(|(line, start, end)| json!({ "line": line, "start": start, "end": end })).collect();
	Some(json!({ "kind": "lines", "first": shown_start, "lines": shown, "spans": spans }))
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
	use gs_core::messages::quote_find::QuoteMiss;
	use gs_json::stringify;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	const NOTES: &str = "f_aaaaaaaaaaaa";
	const SLIDES: &str = "f_bbbbbbbbbbbb";
	const GONE: &str = "f_cccccccccccc";
	const TALK: &str = "f_dddddddddddd";
	const CODE: &str = "f_eeeeeeeeeeee";
	const DOC: &str = "f_ffffffffffff";

	/// A made-up lab file, 22 lines; line 15 prints a pointer and the one after it.
	const ARRAYS_C: &str = "// Lab 3: arrays\n// made-up example\n\n\n\n\n\n\n\n#include <stdio.h>\n\nint main(void) {\n\tint scores[4] = {90, 72, 85, 64};\n\tint *p = scores;\n\tprintf(\"%p %p\\n\", (void *)p, (void *)(p + 1));\n\tprintf(\"%d %d\\n\", *p, *(p + 1));\n\tfor (int i = 0; i < 4; i++) {\n\t\tprintf(\"%d\\n\", *(p + i));\n\t}\n\treturn 0;\n}\n// end\n";

	/// A space with a text file, a PDF, a transcript, a C file and a Word file, and a search table
	/// of their passages written by hand (made-up text; the index is never built under test).
	fn make_space(app: &App) {
		let record = app.stores.spaces.create_space(&json!({ "name": "Made-up Space" })).unwrap();
		let id = record["id"].as_str().unwrap();
		let dir = app.stores.spaces.files_dir(id).unwrap();
		std::fs::create_dir_all(&dir).unwrap();
		std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/fixtures/sample-3page.pdf"), dir.join("slides.pdf")).unwrap();
		crate::app::disk::write_file_atomic(&dir.join("notes.txt"), "line one\nline two\n").unwrap();
		crate::app::disk::write_file_atomic(&dir.join("arrays.c"), ARRAYS_C).unwrap();
		let file = |id: &str, name: &str| json!({ "id": id, "origin": "copied", "name": name, "path": name, "kind": "study", "contentFp": "0", "status": "ready", "addedAt": "2026-01-01T00:00:00.000Z" });
		let files = vec![file(NOTES, "notes.txt"), file(SLIDES, "slides.pdf"), file(TALK, "lecture.srt"), file(CODE, "arrays.c"), file(DOC, "heaps.docx")];
		app.stores.spaces.save_files(id, files, &[]).unwrap();
		let rows = json!([
			{ "id": format!("{NOTES}:1"), "fileId": NOTES, "range": "lines 1–2", "from": 1, "to": 2, "text": "line one line two", "hash": "h1" },
			{ "id": format!("{SLIDES}:1"), "fileId": SLIDES, "range": "p. 2", "from": 2, "to": 2, "text": "Physics page: force equals mass times acceleration", "hash": "h2" },
			// A transcript's place is rounded down, so its number is before the passage starts.
			{ "id": format!("{TALK}:1"), "fileId": TALK, "range": "12:30–13:40", "from": 750.5, "to": 820, "text": "So a heap is a tree.", "hash": "h3" },
			{ "id": format!("{CODE}:1"), "fileId": CODE, "range": "lines 1–22", "from": 1, "to": 22, "text": gs_base::text::trim(ARRAYS_C), "hash": "h4" },
			{ "id": format!("{DOC}:1"), "fileId": DOC, "range": "lines 1–2", "from": 1, "to": 2, "text": "A heap keeps the smallest key on top.\nSo a heap is a tree, and a heap is quick.", "hash": "h5" },
		]);
		let table = json!({ "format": 1, "model": "Snowflake/snowflake-arctic-embed-xs", "rows": rows, "files": { NOTES: { "fp": "0", "extent": "2 lines" }, SLIDES: { "fp": "0", "extent": "3 pages" } } });
		let search = app.paths.data.join("spaces").join(id).join("search");
		crate::app::disk::write_file_atomic(&search.join("passages.json"), &stringify(&table)).unwrap();
		gs_base::fsx::write_atomic(&search.join("passages.f32"), &[0u8; 5 * 384 * 4], None).unwrap();
	}

	#[test]
	fn marks_are_checked_against_the_space_passages() {
		let root = scratch_dir("cites-check");
		let app = test_app(&root);
		make_space(&app);
		let check = |text: &str| {
			let checked = check_cites(&app, text);
			assert_eq!(checked.dropped, [], "{text}");
			(checked.text, checked.removed)
		};
		assert_eq!(check(&format!("Force. [[{SLIDES}:1]]")), (format!("Force. [[{SLIDES}/p. 2/slides.pdf]]"), vec![]));
		let stored = format!("Heaps. [[{TALK}/12:30–13:40/lecture.srt]]");
		assert_eq!(check(&format!("Heaps. [[{TALK}:1]]")), (stored.clone(), vec![]));
		assert_eq!(check(&stored), (stored, vec![]));
		assert_eq!(check(&format!("A. [[{NOTES}:9]] B. [[{NOTES}:9]] C. [[{GONE}:1]]")), ("A.  B.  C. ".to_owned(), vec![format!("{NOTES}:9"), format!("{GONE}:1")]));
		assert_eq!(check(&format!("Yes. [[{SLIDES}/p. 2/old name.pdf]]")), (format!("Yes. [[{SLIDES}/p. 2/slides.pdf]]"), vec![]));
		assert_eq!(check(&format!("Yes. [[{SLIDES}/p. 3/slides.pdf]]")), ("Yes. ".to_owned(), vec![format!("{SLIDES}/p. 3")]));
		for text in ["See this. [[https://example.com/page]]", "Nothing here, only [brackets] and a list a[[0]] in code `[[x]]`."] {
			assert_eq!(check(text), (text.to_owned(), vec![]));
		}
	}

	#[test]
	fn a_quote_is_kept_when_found_once_and_dropped_with_its_reason_otherwise() {
		let root = scratch_dir("cites-quotes");
		let app = test_app(&root);
		make_space(&app);
		let kept = format!("[[{SLIDES}/p. 2/slides.pdf|force equals mass]]");
		assert_eq!(check_cites(&app, &format!("F. [[{SLIDES}:1 \" force  equals mass\"]]")), CheckedMarks { text: format!("F. {kept}"), ..CheckedMarks::default() });
		assert_eq!(check_cites(&app, &kept), CheckedMarks { text: kept.clone(), ..CheckedMarks::default() });

		let plain = format!("[[{DOC}/lines 1–2/heaps.docx]]");
		let text = format!(
			"A [[{DOC}:1 \"a heap\"]] B [[{DOC}:1 \"a stack\"]] C [[{DOC}:1 \"heap\"]] D [[{DOC}:1 \"a[0] heap\"]] E [[{DOC}:1 \"costs $5 each\"]] F [[{DOC}:1 \"a stack\"]] G [[{GONE}:1 \"a heap\"]]"
		);
		let drop = |quote: &str, miss| DroppedQuote { mark: format!("{DOC}:1"), quote: quote.to_owned(), miss };
		assert_eq!(
			check_cites(&app, &text),
			CheckedMarks {
				text: format!("A {plain} B {plain} C {plain} D {plain} E {plain} F {plain} G "),
				removed: vec![format!("{GONE}:1")],
				// A quote that keeps its mark from being read is cut first.
				dropped: vec![drop("a[0] heap", QuoteMiss::Unsafe), drop("costs $5 each", QuoteMiss::Unsafe), drop("a heap", QuoteMiss::Twice), drop("a stack", QuoteMiss::Absent), drop("heap", QuoteMiss::Shape)],
			}
		);
	}

	#[tokio::test]
	async fn a_click_shows_the_passage_and_the_pdf_page() {
		let root = scratch_dir("cites-passage");
		let app = test_app(&root);
		make_space(&app);
		let shown = |file_id: &'static str, range: &'static str| {
			let app = app.clone();
			async move { cited_passage(&app, file_id, range, None).await.map(|v| stringify(&v)) }
		};
		assert_eq!(shown(NOTES, "lines 1–2").await, Ok(r#"{"name":"notes.txt","range":"lines 1–2","page":null,"text":"line one line two","marks":null}"#.to_owned()));
		assert_eq!(shown(SLIDES, "p. 2").await, Ok(r#"{"name":"slides.pdf","range":"p. 2","page":2,"text":"Physics page: force equals mass times acceleration","marks":null}"#.to_owned()));
		assert_eq!(shown(SLIDES, "p. 3").await, Ok(r#"{"name":"slides.pdf","range":"p. 3","page":3,"text":"","marks":null}"#.to_owned()));
		assert_eq!(shown(NOTES, "lines 50–60").await, Err(ReadingError::Refused(404, "No passage at that place")));
		assert_eq!(shown(GONE, "p. 1").await, Err(ReadingError::Refused(404, "No space has that file")));
		assert_eq!(shown("not-an-id", "p. 1").await, Err(ReadingError::Refused(404, "No space has that file")));
	}

	#[tokio::test]
	async fn a_quote_on_code_shows_twelve_lines_of_the_file_centred_on_it() {
		let root = scratch_dir("cites-code");
		let app = test_app(&root);
		make_space(&app);
		let marks = |quote: &'static str| {
			let app = app.clone();
			async move { cited_passage(&app, CODE, "lines 1–22", Some(quote)).await.unwrap()["marks"].clone() }
		};
		let lines: Vec<&str> = ARRAYS_C.split('\n').collect();
		let got = marks("(void *)(p + 1)").await;
		assert_eq!(got["kind"], json!("lines"));
		assert_eq!(got["first"], json!(10));
		assert_eq!(got["lines"], Json::from(lines[9..21].iter().map(|l| Json::from(*l)).collect::<Vec<_>>()));
		assert_eq!(got["lines"][3], json!("\tint scores[4] = {90, 72, 85, 64};"), "indentation is kept");
		assert_eq!(got["spans"], json!([{ "line": 15, "start": 30, "end": 45 }]));
		assert_eq!(&lines[14][30..45], "(void *)(p + 1)");
		// Near the top or the bottom, the 12 lines stop at the file's edge.
		assert_eq!(marks("made-up example").await["first"], json!(1));
		let end = marks("return 0;").await;
		assert_eq!((end["first"].clone(), end["lines"].as_arr().unwrap().len()), (json!(11), 12));
		// A quote over a line end marks both lines, the second from its first visible character.
		assert_eq!(marks("int *p = scores; printf").await["spans"], json!([{ "line": 14, "start": 1, "end": 17 }, { "line": 15, "start": 1, "end": 7 }]));
		assert_eq!(marks("p + 1").await, Json::Null, "found twice");
		assert_eq!(marks("p + 2").await, Json::Null);
	}

	#[tokio::test]
	async fn a_quote_in_a_word_file_marks_its_place_in_the_passage_text() {
		let root = scratch_dir("cites-docx");
		let app = test_app(&root);
		make_space(&app);
		let got = cited_passage(&app, DOC, "lines 1–2", Some("smallest key")).await.unwrap();
		assert_eq!(got["marks"], json!({ "kind": "passage", "start": 17, "end": 29 }));
		assert_eq!(&got["text"].as_str().unwrap()[17..29], "smallest key");
		assert_eq!(cited_passage(&app, DOC, "lines 1–2", Some("a heap")).await.unwrap()["marks"], Json::Null);
	}

	#[tokio::test]
	async fn a_quote_on_a_pdf_page_gives_boxes_on_the_page() {
		let Some(pdfium) = gs_pdf::test_support::pdfium_dir() else { return };
		let root = scratch_dir("cites-boxes");
		for name in ["data", "home", "tmp"] {
			std::fs::create_dir_all(root.join(name)).unwrap();
		}
		let app = App::new(gs_base::config::Paths::new(root.join("data"), root.join("home"), root.join("tmp"), pdfium), None);
		make_space(&app);
		let boxes = cited_passage(&app, SLIDES, "p. 2", Some("force equals mass")).await.unwrap()["marks"].clone();
		assert_eq!(boxes["kind"], json!("page"));
		let b = &boxes["boxes"][0];
		let at = |k: &str| b[k].as_f64().unwrap();
		assert!(at("x") > 0.0 && at("y") > 0.0 && at("x") + at("w") < 1.0 && at("y") + at("h") < 1.0, "{b:?}");
		assert_eq!(boxes["boxes"].as_arr().unwrap().len(), 1);
		// Asked again, the cached boxes come back.
		assert_eq!(cited_passage(&app, SLIDES, "p. 2", Some("force equals mass")).await.unwrap()["marks"], boxes);
		assert_eq!(app.misc.quote_boxes.lock().len(), 1);
		assert_eq!(cited_passage(&app, SLIDES, "p. 2", Some("gravity")).await.unwrap()["marks"], Json::Null);
		assert_eq!(cited_passage(&app, SLIDES, "p. 3", Some("H2O is water")).await.unwrap()["marks"]["kind"], json!("page"), "boxes come from the page itself, indexed or not");
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
