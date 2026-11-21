//! A lesson's problem list: a homework lesson's is its deadline's (`problem_list`), a lesson on
//! files has its first file's. The tools read and write it through the space store, and the lesson
//! page reads it and the files its Document panel shows.

use std::path::Path;
use std::sync::Arc;

use gs_agent::tools::homework::ProblemList;
use gs_core::spaces::problem_list::{ListOwner, problems_of};
use gs_core::contracts::space::display_name;
use gs_core::study::homework::merge_problems;
use gs_json::{Json, json};

use super::homework::{deadline_of, file_of};
use crate::App;
use crate::app::reading_pages::is_pdf;
use crate::spaces::save_problems;
use crate::spaces::space_card::space_file_path;

/// Whose list a lesson works on.
#[derive(Clone)]
enum ListOf {
	Deadline(String),
	File(String),
}

impl ListOf {
	fn owner(&self) -> ListOwner<'_> {
		match self {
			ListOf::Deadline(id) => ListOwner::Deadline(id),
			ListOf::File(id) => ListOwner::File(id),
		}
	}

	/// The file the list is printed in: a deadline's assignment file, or the lesson's first file.
	fn file<'a>(&self, space: &'a Json) -> Option<&'a Json> {
		match self {
			ListOf::Deadline(id) => file_of(space, deadline_of(space, id)?),
			ListOf::File(id) => space["files"].items().iter().find(|f| f["id"].as_str() == Some(id.as_str())),
		}
	}
}

/// The lesson's space and whose list it works on: a homework lesson its deadline's, a study
/// lesson on files its first file's. None for any other lesson.
fn list_of(record: &Json) -> Option<(String, ListOf)> {
	let space_id = record["spaceId"].as_str().filter(|id| !id.is_empty())?.to_owned();
	let of = match record["kind"].as_str() {
		Some("homework") => ListOf::Deadline(record["deadlineId"].as_str().filter(|id| !id.is_empty())?.to_owned()),
		Some("study") => ListOf::File(record["fileIds"][0].as_str()?.to_owned()),
		_ => return None,
	};
	Some((space_id, of))
}

/// The tools' view of a lesson's problem list; None for a lesson without one.
pub(super) fn lesson_problem_list(app: &Arc<App>, record: &Json) -> Option<Arc<dyn ProblemList>> {
	let (space_id, of) = list_of(record)?;
	Some(Arc::new(SpaceProblems { app: app.clone(), space_id, of }))
}

/// What the lesson page shows of the list, `{ problems }`. None for a lesson without a list, or
/// once its space or deadline is gone.
pub fn problems_view(app: &App, record: &Json) -> Option<Json> {
	let (space_id, of) = list_of(record)?;
	let space = app.stores.spaces.get_space(&space_id)?;
	if let ListOf::Deadline(id) = &of {
		deadline_of(&space, id)?;
	}
	Some(json!({ "problems": problems_of(&space, of.owner()) }))
}

/// What a lesson's Document panel shows, `{ documents, listFileId }`. `documents` are a homework
/// lesson's assignment file, or every file of a lesson on files still in its space. Each is `{ id,
/// name, path, pdf }`, `name` as lessons show it and `path` null when its folder is gone; a PDF
/// that opens also has `pages` and `aspect`, its first page's width over its height. `listFileId`
/// is the file the problem list is printed in, null once it has left the space. Empty for any
/// other lesson.
pub async fn documents_view(app: &App, record: &Json) -> Json {
	let empty = json!({ "documents": [], "listFileId": null });
	let Some((space_id, of)) = list_of(record) else { return empty };
	let Some(space) = app.stores.spaces.get_space(&space_id) else { return empty };
	let files: Vec<&Json> = match &of {
		ListOf::Deadline(_) => of.file(&space).into_iter().collect(),
		ListOf::File(_) => record["fileIds"].items().iter().filter_map(|id| space["files"].items().iter().find(|f| f["id"].as_str().is_some_and(|f| Some(f) == id.as_str()))).collect(),
	};
	let mut documents = Vec::new();
	for file in files {
		let name = file["name"].str_or_empty();
		let pdf = is_pdf(Path::new(name));
		let path = space_file_path(app, &space, file);
		let mut document = json!({ "id": file["id"], "name": display_name(name), "path": path.clone().map_or(Json::Null, Json::from), "pdf": pdf });
		if let (Some(path), true) = (&path, pdf) {
			match app.pdf.pdf_shape(Path::new(path)).await {
				Ok(shape) => {
					if let Some(o) = document.as_obj_mut() {
						o.insert("pages", shape.page_count);
						o.insert("aspect", shape.aspect);
					}
				}
				// The panel says it could not load this file; the reason is kept here.
				Err(err) => eprintln!("[lesson documents] couldn't open {path}: {err}"),
			}
		}
		documents.push(document);
	}
	json!({ "documents": documents, "listFileId": of.file(&space).map_or(Json::Null, |f| f["id"].clone()) })
}

struct SpaceProblems {
	app: Arc<App>,
	space_id: String,
	of: ListOf,
}

impl SpaceProblems {
	/// Saves the problems; the error text when they could not be saved.
	fn save(&self, next: Vec<Json>) -> Option<String> {
		save_problems(&self.app, &self.space_id, self.of.owner(), &Json::Arr(next)).err().map(|failure| failure.error)
	}
}

impl ProblemList for SpaceProblems {
	fn problems(&self) -> Vec<Json> {
		self.app.stores.spaces.get_space(&self.space_id).map(|space| problems_of(&space, self.of.owner()).to_vec()).unwrap_or_default()
	}

	fn post(&self, posted: &[Json]) -> Option<String> {
		self.save(merge_problems(&self.problems(), posted))
	}

	fn mark_done(&self, number: &str) {
		let next = self
			.problems()
			.into_iter()
			.map(|mut p| {
				if p["number"].as_str() == Some(number)
					&& let Some(o) = p.as_obj_mut()
				{
					o.insert("done", true);
				}
				p
			})
			.collect();
		self.save(next);
	}

	fn file_id(&self) -> Option<String> {
		match &self.of {
			ListOf::File(id) => Some(id.clone()),
			ListOf::Deadline(_) => None,
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::spaces::list_open_deadlines;

	fn sheet(id: &str, name: &str) -> Json {
		json!({ "id": id, "origin": "copied", "name": name, "path": "p", "kind": "info", "contentFp": "x", "status": "ready", "addedAt": "t" })
	}

	#[test]
	fn a_homework_lesson_works_on_its_assignment_files_list_and_readers_see_it_on_the_deadline() {
		let root = scratch_dir("lesson-problems-homework");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Algorithms" })).unwrap()["id"].str_or_empty().to_owned();
		app.stores.spaces.save_files(&space_id, vec![sheet("f_sheet", "HW6.pdf")], &[]).unwrap();
		let deadline_id = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "HW6", "kind": "homework", "date": "2099-01-15", "assignmentFileId": "f_sheet" })).unwrap()["id"].str_or_empty().to_owned();
		let lesson = json!({ "kind": "homework", "spaceId": space_id, "deadlineId": deadline_id });
		let problems = lesson_problem_list(&app, &lesson).unwrap();
		assert_eq!(problems.post(&[json!({ "number": "1", "title": "Sums", "text": "Sum 1 to n." }), json!({ "number": "2", "title": "Bound", "text": "Bound it." })]), None);
		problems.mark_done("1");
		assert_eq!(problems.file_id(), None, "a homework's problems may come from any file");

		let record = app.stores.spaces.get_space(&space_id).unwrap();
		assert!(record["deadlines"][0].get("problems").is_none());
		assert_eq!(record["files"][0]["problems"][0]["done"], json!(true), "kept on the assignment file");
		assert_eq!(problems.problems().len(), 2);
		assert_eq!(problems_view(&app, &lesson).unwrap()["problems"], record["files"][0]["problems"]);
		assert_eq!(list_open_deadlines(&app)[0]["problems"], record["files"][0]["problems"]);
	}

	#[test]
	fn a_lesson_on_files_works_on_its_first_files_list() {
		let root = scratch_dir("lesson-problems-files");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Algorithms" })).unwrap()["id"].str_or_empty().to_owned();
		app.stores.spaces.save_files(&space_id, vec![sheet("f_test", "Practice midterm.pdf"), sheet("f_key", "Key.pdf")], &[]).unwrap();
		let lesson = json!({ "kind": "study", "spaceId": space_id, "fileIds": ["f_test", "f_key"] });
		let problems = lesson_problem_list(&app, &lesson).unwrap();
		assert_eq!(problems.file_id().as_deref(), Some("f_test"));
		assert_eq!(problems.post(&[json!({ "number": "1", "title": "Limits", "text": "Find it." })]), None);
		problems.mark_done("1");
		let record = app.stores.spaces.get_space(&space_id).unwrap();
		assert_eq!(record["files"][0]["problems"][0]["done"], json!(true));
		assert!(lesson_problem_list(&app, &json!({ "kind": "study", "spaceId": space_id })).is_none(), "a study lesson with no files has no list");
		assert!(problems_view(&app, &json!({ "kind": "practice", "spaceId": space_id, "fileIds": ["f_test"] })).is_none());
	}

	#[tokio::test]
	async fn the_document_panel_lists_the_lessons_files_with_a_pdfs_pages_and_names_the_lists_file() {
		let root = scratch_dir("lesson-documents");
		// The pages come from pdfium; a run without the library checks the rest.
		let pdfium = gs_pdf::test_support::pdfium_dir();
		let app = match pdfium.clone() {
			Some(res) => {
				for name in ["data", "home", "tmp"] {
					std::fs::create_dir_all(root.join(name)).unwrap();
				}
				App::new(gs_base::config::Paths::new(root.join("data"), root.join("home"), root.join("tmp"), res), None)
			}
			None => test_app(&root),
		};
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Algorithms" })).unwrap()["id"].str_or_empty().to_owned();
		let dir = app.stores.spaces.files_dir(&space_id).unwrap();
		std::fs::create_dir_all(&dir).unwrap();
		std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/fixtures/sample-3page.pdf"), dir.join("Midterm 2022.pdf")).unwrap();
		crate::app::disk::write_file_atomic(&dir.join("Notes.docx"), "made-up").unwrap();
		let file = |id: &str, name: &str| json!({ "id": id, "origin": "copied", "name": name, "path": name, "kind": "info", "contentFp": "x", "status": "ready", "addedAt": "t" });
		let files = vec![file("f_notes", "Notes.docx"), file("f_test", "Midterm 2022.pdf"), file("f_key", "Midterm 2022 key.pdf")];
		app.stores.spaces.save_files(&space_id, files, &[]).unwrap();

		let lesson = json!({ "kind": "study", "spaceId": space_id, "fileIds": ["f_test", "f_gone", "f_key", "f_notes"] });
		let view = documents_view(&app, &lesson).await;
		assert_eq!(view["listFileId"], json!("f_test"));
		let documents = view["documents"].items();
		let shown: Vec<_> = documents.iter().map(|d| (d["id"].str_or_empty(), d["name"].str_or_empty(), d["pdf"].as_bool(), d["pages"].as_f64())).collect();
		assert_eq!(
			shown,
			[("f_test", "Midterm 2022", Some(true), pdfium.as_ref().map(|_| 3.0)), ("f_key", "Midterm 2022 key", Some(true), None), ("f_notes", "Notes", Some(false), None)],
			"a file gone from the space is left out, and a PDF that does not open has no pages"
		);
		assert_eq!(documents[0]["aspect"].as_f64().is_some_and(|a| a > 0.0), pdfium.is_some());
		assert!(documents[0]["path"].str_or_empty().ends_with("Midterm 2022.pdf"));

		let deadline_id = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "HW6", "kind": "homework", "date": "2099-01-15", "assignmentFileId": "f_test" })).unwrap()["id"].str_or_empty().to_owned();
		let homework = documents_view(&app, &json!({ "kind": "homework", "spaceId": space_id, "deadlineId": deadline_id })).await;
		assert_eq!(homework["documents"].items().iter().map(|d| d["id"].str_or_empty()).collect::<Vec<_>>(), ["f_test"], "a homework shows its assignment file");
		assert_eq!(homework["listFileId"], json!("f_test"));
		assert_eq!(documents_view(&app, &json!({ "kind": "teach", "spaceId": space_id })).await, json!({ "documents": [], "listFileId": null }));

		let moved = documents_view(&app, &json!({ "kind": "study", "spaceId": space_id, "fileIds": ["f_gone", "f_key"] })).await;
		assert_eq!(moved["documents"].items().iter().map(|d| d["id"].str_or_empty()).collect::<Vec<_>>(), ["f_key"]);
		assert_eq!(moved["listFileId"], Json::Null, "the list's file left the space: the next file is not taken for it");
	}
}
