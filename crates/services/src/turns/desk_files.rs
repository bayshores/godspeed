//! The paper on a lesson's desk: the files the teacher has to work from (the stack), and the file
//! and place one step reads. A file is `{name, path, kind}`, its path the one the window's paper
//! reads through /api/reading; a place adds `{from, to, page}`.

use std::collections::HashSet;

use gs_agent::fs_tools::fs_shared::resolve_source_path;
use gs_core::contracts::space::base_name;
use gs_core::session::lesson_steps::{StepFile, desk_kind, step_file};
use gs_json::{Json, json};
use gs_search::index::PassageRef;

use crate::App;
use crate::spaces::space_card::readable_path;

/// The stack holds at most this many files.
const DESK_FILES_MAX: usize = 5;

/// The stack, front first: the lesson's own files; else its deadline's assignment, then the files
/// the deadline covers; else its space's study files, then its info files. Newest first within
/// each group; a source with no file the desk can show gives way to the next.
pub(super) fn desk_files(app: &App, lesson: &Json) -> Vec<Json> {
	let Some(space) = lesson["spaceId"].as_str().and_then(|id| app.stores.spaces.get_space(id)) else { return Vec::new() };
	let files = space["files"].items();
	let by_id = |id: &Json| files.iter().find(|f| f["id"] == *id);
	let by_ids = |ids: &Json| -> Vec<&Json> { ids.items().iter().filter_map(by_id).collect() };
	let deadline = lesson["deadlineId"].as_str().and_then(|id| space["deadlines"].items().iter().find(|d| d["id"].as_str() == Some(id)));
	let sources: [Vec<Vec<&Json>>; 3] = [
		vec![by_ids(&lesson["fileIds"])],
		deadline.map(|d| vec![by_id(&d["assignmentFileId"]).into_iter().collect(), by_ids(&d["fileIds"])]).unwrap_or_default(),
		["study", "info"].map(|kind| files.iter().filter(|f| f["kind"].as_str() == Some(kind)).collect()).into(),
	];
	sources
		.into_iter()
		.map(|groups| {
			let mut seen = HashSet::new();
			groups
				.into_iter()
				.flat_map(newest_first)
				.filter(|file| seen.insert(file["id"].str_or_empty()))
				.filter_map(|file| {
					let path = readable_path(app, &space, file)?;
					let kind = desk_kind(&path)?;
					Some(json!({ "name": file["name"], "path": path, "kind": kind }))
				})
				.take(DESK_FILES_MAX)
				.collect::<Vec<_>>()
		})
		.find(|stack| !stack.is_empty())
		.unwrap_or_default()
}

fn newest_first(mut group: Vec<&Json>) -> Vec<&Json> {
	group.sort_by(|a, b| b["addedAt"].str_or_empty().cmp(a["addedAt"].str_or_empty()));
	group
}

/// The file and place a call of `tool` reads, when the desk can show it. `space_id` is the space
/// a read_passage call reads in.
pub(super) fn step_reading(app: &App, tool: &str, args: &Json, space_id: Option<&str>) -> Option<Json> {
	match step_file(tool, args)? {
		StepFile::Path { path, from, to } => path_reading(&path, from, to, None),
		StepFile::Passage => passage_reading(app, space_id?, args),
	}
}

/// A file the teacher named by path, at these lines or this PDF page.
pub(super) fn path_reading(path: &str, from: Option<u64>, to: Option<u64>, page: Option<u64>) -> Option<Json> {
	let kind = desk_kind(path)?;
	let at = resolve_source_path(Some(path)).to_string_lossy().into_owned();
	let (from, to, page) = match kind {
		"text" => (from, to, None),
		"pdf" => (None, None, page),
		_ => (None, None, None),
	};
	Some(json!({ "name": base_name(path), "path": at, "kind": kind, "from": from, "to": to, "page": page }))
}

/// The space file a read_passage call opens, at the passage's lines or PDF page, read from the
/// space's passage table.
fn passage_reading(app: &App, space_id: &str, args: &Json) -> Option<Json> {
	let space = app.stores.spaces.get_space(space_id)?;
	let rows = app.search.passages_at(space_id, &PassageRef::of_args(args)?);
	let (first, last) = (rows.first()?, rows.last()?);
	let file = space["files"].items().iter().find(|f| f["id"] == first["fileId"])?;
	let path = readable_path(app, &space, file)?;
	let kind = desk_kind(&path)?;
	let lines = kind == "text" && first["range"].str_or_empty().starts_with("lines ");
	let place = |row: &Json, key: &str| row[key].as_f64().filter(|_| lines);
	let page = first["from"].as_f64().filter(|_| kind == "pdf");
	Some(json!({ "name": file["name"], "path": path, "kind": kind, "from": place(first, "from"), "to": place(last, "to"), "page": page }))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	fn file(id: &str, name: &str, kind: &str, added: &str) -> Json {
		json!({ "id": id, "origin": "copied", "name": name, "path": name, "kind": kind, "contentFp": "x", "status": "ready", "addedAt": added })
	}

	fn names(stack: &[Json]) -> Vec<&str> {
		stack.iter().map(|f| f["name"].str_or_empty()).collect()
	}

	#[test]
	fn the_stack_is_the_lesson_s_files_else_its_deadline_s_else_its_space_s() {
		let root = scratch_dir("desk-files");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "CSE 29" })).unwrap()["id"].str_or_empty().to_owned();
		let files = vec![
			file("f_old", "Week 1.md", "study", "2026-09-01T00:00:00.000Z"),
			file("f_new", "Week 7.md", "study", "2026-11-01T00:00:00.000Z"),
			file("f_info", "Syllabus.pdf", "info", "2026-12-01T00:00:00.000Z"),
			file("f_pa4", "PA4.pdf", "info", "2026-10-01T00:00:00.000Z"),
			file("f_pic", "Board.png", "study", "2026-11-02T00:00:00.000Z"),
			file("f_deck", "Slides.pptx", "study", "2026-08-01T00:00:00.000Z"),
		];
		app.stores.spaces.save_files(&space_id, files, &[]).unwrap();
		let deadline = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "PA4", "kind": "homework", "date": "2099-01-15", "assignmentFileId": "f_pa4", "fileIds": ["f_old", "f_pa4", "f_new"] })).unwrap()["id"].str_or_empty().to_owned();
		let stack = |lesson: Json| desk_files(&app, &lesson);

		let space = stack(json!({ "spaceId": space_id }));
		assert_eq!(names(&space), ["Week 7.md", "Week 1.md", "Slides.pptx", "Syllabus.pdf", "PA4.pdf"], "study then info, newest first, no picture");
		assert_eq!(space[0]["kind"], json!("text"));
		assert_eq!(space[2]["kind"], json!("other"));
		assert_eq!(space[3]["kind"], json!("pdf"));
		assert!(space[0]["path"].str_or_empty().ends_with("Week 7.md") && space[0]["path"].str_or_empty().starts_with('/'), "{:?}", space[0]);
		assert_eq!(names(&stack(json!({ "spaceId": space_id, "deadlineId": deadline }))), ["PA4.pdf", "Week 7.md", "Week 1.md"], "the assignment once, then what it covers");
		assert_eq!(names(&stack(json!({ "spaceId": space_id, "deadlineId": deadline, "fileIds": ["f_old", "f_info"] }))), ["Syllabus.pdf", "Week 1.md"]);
		assert_eq!(names(&stack(json!({ "spaceId": space_id, "fileIds": ["f_pic"] }))).len(), 5, "picked files the desk cannot show give way");
		assert_eq!(stack(json!({ "title": "No space" })), Vec::<Json>::new());
	}

	#[test]
	fn a_read_is_its_file_at_its_lines_and_a_pdf_at_its_page() {
		let home = resolve_source_path(None).to_string_lossy().into_owned();
		let read = step_reading_of("read", json!({ "path": "notes/Week 7.md", "offset": 3, "limit": 10 }));
		assert_eq!(read, Some(json!({ "name": "Week 7.md", "path": format!("{home}/notes/Week 7.md"), "kind": "text", "from": 3, "to": 12, "page": null })));
		assert_eq!(step_reading_of("pdf", json!({ "path": "/a/HW7.pdf", "question": "q" })), Some(json!({ "name": "HW7.pdf", "path": "/a/HW7.pdf", "kind": "pdf", "from": null, "to": null, "page": null })));
		assert_eq!(path_reading("/a/HW7.pdf", None, None, Some(4)).map(|r| r["page"].clone()), Some(json!(4)));
		assert_eq!(step_reading_of("read", json!({ "path": "/a/board.png" })), None, "the desk shows no picture");
		assert_eq!(step_reading_of("grep", json!({ "pattern": "x" })), None);
	}

	fn step_reading_of(tool: &str, args: Json) -> Option<Json> {
		let root = scratch_dir("desk-reading");
		let app = test_app(&root);
		step_reading(&app, tool, &args, None)
	}
}
