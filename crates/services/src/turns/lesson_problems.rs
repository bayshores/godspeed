//! A lesson's problem list: a homework lesson's is its deadline's (`problem_list`), a lesson on
//! files has its first file's. The tools read and write it through the space store, and the lesson
//! page reads it with the file it is printed in.

use std::sync::Arc;

use gs_agent::tools::homework::ProblemList;
use gs_core::spaces::problem_list::{ListOwner, problems_of};
use gs_core::study::homework::merge_problems;
use gs_json::{Json, json};

use super::homework::{deadline_of, file_of};
use crate::App;
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

/// What the lesson page shows of the list: its problems and the file to open, `{ name, path }`
/// or null. None for a lesson without a list, or once its space or deadline is gone.
pub fn problems_view(app: &App, record: &Json) -> Option<Json> {
	let (space_id, of) = list_of(record)?;
	let space = app.stores.spaces.get_space(&space_id)?;
	if let ListOf::Deadline(id) = &of {
		deadline_of(&space, id)?;
	}
	let file = of.file(&space).map_or(Json::Null, |file| json!({ "name": file["name"], "path": space_file_path(app, &space, file) }));
	Some(json!({ "problems": problems_of(&space, of.owner()), "file": file }))
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
		let view = problems_view(&app, &lesson).unwrap();
		assert_eq!((view["problems"].clone(), view["file"]["name"].clone()), (record["files"][0]["problems"].clone(), json!("HW6.pdf")));
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
		assert_eq!(problems_view(&app, &lesson).unwrap()["file"]["name"], json!("Practice midterm.pdf"));
		assert!(lesson_problem_list(&app, &json!({ "kind": "study", "spaceId": space_id })).is_none(), "a study lesson with no files has no list");
		assert!(problems_view(&app, &json!({ "kind": "practice", "spaceId": space_id, "fileIds": ["f_test"] })).is_none());
	}
}
