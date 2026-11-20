//! What the agent's problem tools ask of a space's PDFs: the piece of a page where a printed
//! problem is, and its words. The piece is the shape `gs_core::spaces::page_piece` keeps.

use std::path::Path;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_agent::tools::ports::ProblemPages;
use gs_core::messages::quote_find::find_start;
use gs_core::spaces::page_piece::check_piece;
use gs_json::{Json, json};
use gs_pdf::{Found, Piece};

use super::homework::deadline_of;
use crate::App;
use crate::app::reading_pages::is_pdf;
use crate::spaces::space_card::space_file_path;

/// The lesson's own space (none outside a space) and, in homework, its deadline, whose assignment
/// file is the default source.
pub(super) fn problem_pages(app: &Arc<App>, space_id: Option<&str>, deadline_id: Option<&str>) -> Arc<dyn ProblemPages> {
	Arc::new(SpacePages { app: app.clone(), space_id: space_id.map(str::to_owned), deadline_id: deadline_id.map(str::to_owned) })
}

struct SpacePages {
	app: Arc<App>,
	space_id: Option<String>,
	deadline_id: Option<String>,
}

impl ProblemPages for SpacePages {
	fn find<'a>(&'a self, source: &'a Json, typed: Option<&'a str>) -> BoxFuture<'a, Result<Json, String>> {
		Box::pin(self.cut(source, typed))
	}
}

/// A piece in the shape the browser draws, checked the way a stored one is.
fn piece_json(file_id: &str, piece: &Piece) -> Result<Json, String> {
	let parts: Vec<Json> = piece.parts.iter().map(|p| json!({ "page": p.page, "crop": [p.crop.left, p.crop.top, p.crop.right, p.crop.bottom], "aspect": p.aspect })).collect();
	let labels: Vec<Json> = piece.labels.iter().map(|l| json!({ "label": l.label, "page": l.page, "y": l.y })).collect();
	let mark = piece.mark.map_or(Json::Null, |m| json!({ "page": piece.parts[0].page, "x": m.x, "y": m.y, "width": m.w, "height": m.h }));
	check_piece(&json!({ "fileId": file_id, "parts": parts, "labels": labels, "mark": mark }))
}

impl SpacePages {
	/// The file the problem is printed in and where it is on disk: the source's own, else the
	/// deadline's assignment file. Why not, in words for the teacher.
	async fn pdf_of(&self, source: &Json) -> Result<(String, String), String> {
		let space = self.space_id.as_deref().and_then(|id| self.app.stores.spaces.get_space(id)).ok_or("This lesson is not in a space, so there is no file to show a page of; type the problem instead.")?;
		let named = source["fileId"].as_str().filter(|id| !id.is_empty());
		let assignment = || {
			let deadline = self.deadline_id.as_deref().and_then(|id| deadline_of(&space, id));
			deadline.and_then(|d| d["assignmentFileId"].as_str()).filter(|id| !id.is_empty())
		};
		let file_id = named.or_else(assignment).ok_or("No file is named and this deadline has no assignment file; give the problem's fileId, or type the problem.")?;
		let file = space["files"].items().iter().find(|f| f["id"].as_str() == Some(file_id)).ok_or_else(|| format!("{file_id} is not a file of this lesson's space; use a fileId from the space card, or type the problem."))?;
		let name = file["name"].str_or_empty();
		if !is_pdf(Path::new(name)) {
			return Err(format!("{name} is not a PDF; type the problem instead."));
		}
		let path = space_file_path(&self.app, &space, file).filter(|path| Path::new(path).is_file()).ok_or_else(|| format!("{name} cannot be read from disk; type the problem instead."))?;
		Ok((file_id.to_owned(), path))
	}

	async fn cut(&self, source: &Json, typed: Option<&str>) -> Result<Json, String> {
		let (file_id, path) = self.pdf_of(source).await?;
		let page = source["page"].as_f64().filter(|n| n.fract() == 0.0 && (1.0..=f64::from(u32::MAX)).contains(n)).ok_or("page must be a whole number from 1")? as u32;
		let starts = source["starts"].as_str().map(str::trim).filter(|words| !words.is_empty()).ok_or("starts must hold the problem's first words")?;
		let ends = source["ends"].as_str().map(str::trim).filter(|words| !words.is_empty());
		let look = |number: u32| self.app.pdf.find_piece(Path::new(&path), number, starts.to_owned(), ends.map(str::to_owned), |text, words| find_start(text, words).ok());
		let found = look(page).await.map_err(|why| format!("Page {page} could not be read: {why}"))?;
		let found = match found {
			// A page off by one is a common slip: the page before and the page after get one look each.
			Found::Missing(lines) => {
				let mut next = None;
				for number in [page.checked_sub(1).filter(|n| *n >= 1), page.checked_add(1)].into_iter().flatten() {
					if let Ok(Found::Piece(piece)) = look(number).await {
						next = Some(Found::Piece(piece));
						break;
					}
				}
				next.ok_or_else(|| format!("\"{starts}\" is not on page {page}, or is on it more than once. Copy the problem's first words exactly as the page prints them. The page's lines:\n{}", lines.join("\n")))?
			}
			found => found,
		};
		let (piece, words) = match found {
			Found::Piece(piece) => (piece_json(&file_id, &piece)?, piece.text),
			Found::Scan { aspect } => (check_piece(&json!({ "fileId": file_id, "parts": [{ "page": page, "crop": [0, 0, 1, 1], "aspect": aspect }] }))?, typed.unwrap_or_default().to_owned()),
			Found::Missing(_) => unreachable!("a missing problem was refused above"),
		};
		Ok(json!({ "piece": piece, "text": words }))
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::turns::homework::deadline_problem_list;

	const WORKSHEET: &str = "f_aaaaaaaaaaaa";
	const SCAN: &str = "f_bbbbbbbbbbbb";
	const NOTES: &str = "f_cccccccccccc";
	const OTHER: &str = "f_dddddddddddd";

	/// A space with a worksheet, a scan and a text file, and a homework deadline on the worksheet.
	/// None when there is no pdfium to read the PDFs with.
	fn world(label: &str) -> Option<(crate::app::test_support::Scratch, Arc<App>, String, String)> {
		std::env::var_os("LH_PDFIUM_PATH")?;
		let root = scratch_dir(label);
		let app = test_app(&root);
		let space = app.stores.spaces.create_space(&json!({ "name": "Made-up Space" })).unwrap();
		let id = space["id"].str_or_empty().to_owned();
		let dir = app.stores.spaces.files_dir(&id).unwrap();
		std::fs::create_dir_all(&dir).unwrap();
		for (from, to) in [("worksheet.pdf", "worksheet.pdf"), ("image-only.pdf", "scan.pdf")] {
			std::fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("../pdf/tests/fixtures").join(from), dir.join(to)).unwrap();
		}
		crate::app::disk::write_file_atomic(&dir.join("notes.txt"), "line one\n").unwrap();
		let file = |id: &str, name: &str| json!({ "id": id, "origin": "copied", "name": name, "path": name, "kind": "study", "contentFp": "0", "status": "ready", "addedAt": "2026-01-01T00:00:00.000Z" });
		app.stores.spaces.save_files(&id, vec![file(WORKSHEET, "worksheet.pdf"), file(SCAN, "scan.pdf"), file(NOTES, "notes.txt")], &[]).unwrap();
		let deadline = crate::spaces::add_space_deadline(&app, &id, &json!({ "kind": "homework", "name": "Sheet 1", "date": "2026-11-20", "assignmentFileId": WORKSHEET })).unwrap();
		let deadline_id = deadline["id"].str_or_empty().to_owned();
		Some((root, app, id, deadline_id))
	}

	async fn cut(pages: &Arc<dyn ProblemPages>, source: Json, typed: Option<&str>) -> Result<Json, String> {
		pages.find(&source, typed).await
	}

	#[tokio::test]
	async fn a_problem_is_cut_from_a_file_of_the_space() {
		let Some((_root, app, space, _)) = world("pages-cut") else { return };
		let pages = problem_pages(&app, Some(&space), None);
		let source = json!({ "fileId": WORKSHEET, "page": 1, "starts": "1. First problem", "ends": "2. Second problem" });
		let shown = cut(&pages, source, None).await.unwrap();
		assert_eq!(shown["piece"]["fileId"].as_str(), Some(WORKSHEET));
		assert_eq!(shown["piece"]["parts"][0]["page"].as_f64(), Some(1.0));
		assert_eq!(shown["piece"]["labels"].items().len(), 2);
		assert_eq!(check_piece(&shown["piece"]).unwrap(), shown["piece"], "what is handed out already holds");
		assert!(shown["text"].str_or_empty().starts_with("1. First problem"));
		// Page 2 is off by one for a problem on page 1: the page before is tried.
		let off = cut(&pages, json!({ "fileId": WORKSHEET, "page": 2, "starts": "1. First problem", "ends": "2. Second problem" }), None).await.unwrap();
		assert_eq!(off["piece"]["parts"][0]["page"].as_f64(), Some(1.0));
	}

	#[tokio::test]
	async fn words_that_are_not_there_refuse_with_the_pages_lines() {
		let Some((_root, app, space, _)) = world("pages-missing") else { return };
		let why = cut(&problem_pages(&app, Some(&space), None), json!({ "fileId": WORKSHEET, "page": 1, "starts": "4. Fourth problem" }), None).await.unwrap_err();
		assert!(why.starts_with("\"4. Fourth problem\" is not on page 1"), "{why}");
		assert!(why.contains("1. First problem"), "the page's lines follow: {why}");
		let beyond = cut(&problem_pages(&app, Some(&space), None), json!({ "fileId": WORKSHEET, "page": 9, "starts": "1. First problem" }), None).await.unwrap_err();
		assert!(beyond.starts_with("Page 9 could not be read"), "{beyond}");
	}

	#[tokio::test]
	async fn a_scan_is_shown_whole_with_the_words_the_teacher_typed() {
		let Some((_root, app, space, _)) = world("pages-scan") else { return };
		let shown = cut(&problem_pages(&app, Some(&space), None), json!({ "fileId": SCAN, "page": 1, "starts": "anything" }), Some("Typed words")).await.unwrap();
		assert_eq!(shown["piece"]["parts"][0]["crop"], json!([0, 0, 1, 1]));
		assert_eq!(shown["text"].as_str(), Some("Typed words"));
		let bare = cut(&problem_pages(&app, Some(&space), None), json!({ "fileId": SCAN, "page": 1, "starts": "anything" }), None).await.unwrap();
		assert_eq!(bare["text"].as_str(), Some(""));
	}

	#[tokio::test]
	async fn a_file_that_is_not_a_pdf_of_the_lessons_space_is_refused_in_words() {
		let Some((_root, app, space, deadline)) = world("pages-refuse") else { return };
		let source = |file: Json| json!({ "fileId": file, "page": 1, "starts": "1. First problem" });
		let in_space = problem_pages(&app, Some(&space), None);
		assert!(cut(&in_space, source(json!(NOTES)), None).await.unwrap_err().contains("is not a PDF"));
		assert!(cut(&in_space, source(json!(OTHER)), None).await.unwrap_err().contains("is not a file of this lesson's space"));
		assert!(cut(&in_space, source(Json::Null), None).await.unwrap_err().contains("this deadline has no assignment file"));
		assert!(cut(&problem_pages(&app, None, None), source(json!(WORKSHEET)), None).await.unwrap_err().contains("not in a space"));
		// A homework session with no fileId reads the deadline's assignment file.
		let homework = problem_pages(&app, Some(&space), Some(&deadline));
		assert_eq!(cut(&homework, source(Json::Null), None).await.unwrap()["piece"]["fileId"].as_str(), Some(WORKSHEET));
	}

	#[tokio::test]
	async fn a_posted_piece_is_kept_with_its_deadline() {
		let Some((_root, app, space, deadline)) = world("pages-kept") else { return };
		let shown = cut(&problem_pages(&app, Some(&space), Some(&deadline)), json!({ "page": 1, "starts": "1. First problem", "ends": "2. Second problem" }), None).await.unwrap();
		let homework = deadline_problem_list(&app, &space, &deadline);
		assert_eq!(homework.post(&[json!({ "number": "1", "title": "First", "text": shown["text"], "piece": shown["piece"] })]), None);
		let kept = homework.problems();
		assert_eq!((kept[0]["piece"].clone(), kept[0].get("page")), (shown["piece"].clone(), None));
		let record = app.stores.spaces.get_space(&space).unwrap();
		let sheet = record["files"].items().iter().find(|f| f["id"].as_str() == Some(WORKSHEET)).unwrap();
		assert_eq!(sheet["problems"][0]["piece"], shown["piece"], "kept on the assignment file");
	}
}
