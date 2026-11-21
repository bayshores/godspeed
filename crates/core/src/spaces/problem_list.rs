//! Where a problem list lives. A document's numbered problems and their done marks belong to the
//! file they are printed in, so a deadline with an assignment file reads and writes that file's
//! list; a deadline without one keeps its own (problems the learner pasted). A lesson works on one
//! list (`lesson_list_owner`).

use gs_json::Json;

/// Where the deadline's assignment file sits in `files`, when the space has it.
fn assignment_at(files: &[Json], deadline: &Json) -> Option<usize> {
	let file_id = deadline["assignmentFileId"].as_str()?;
	files.iter().position(|f| f["id"].as_str() == Some(file_id))
}

/// Sets `problems` on a file or deadline, or removes it for an empty list.
fn put(holder: &mut Json, list: Vec<Json>) {
	if let Some(obj) = holder.as_obj_mut() {
		obj.set_or_remove("problems", (!list.is_empty()).then_some(Json::Arr(list)));
	}
}

/// The deadline's problem list: its assignment file's when it has one, else its own.
pub fn problem_list<'a>(record: &'a Json, deadline: &'a Json) -> &'a [Json] {
	let files = record["files"].items();
	match assignment_at(files, deadline) {
		Some(at) => files[at]["problems"].items(),
		None => deadline["problems"].items(),
	}
}

/// Whose problem list: a deadline's (its assignment file's, else its own) or a file's, as a
/// lesson on files keeps its first file's.
#[derive(Clone, Copy, Debug)]
pub enum ListOwner<'a> {
	Deadline(&'a str),
	File(&'a str),
}

/// Whose list a lesson works on: a homework lesson its deadline's, a lesson on files its first
/// file's. None for any other lesson.
pub fn lesson_list_owner(lesson: &Json) -> Option<ListOwner<'_>> {
	match lesson["kind"].as_str() {
		Some("homework") => lesson["deadlineId"].as_str().filter(|id| !id.is_empty()).map(ListOwner::Deadline),
		Some("study") => lesson["fileIds"][0].as_str().map(ListOwner::File),
		_ => None,
	}
}

fn position(list: &[Json], id: &str) -> Option<usize> {
	list.iter().position(|item| item["id"].as_str() == Some(id))
}

/// The owner's problem list; empty when the record has no such deadline or file.
pub fn problems_of<'a>(record: &'a Json, owner: ListOwner) -> &'a [Json] {
	match owner {
		ListOwner::Deadline(id) => position(record["deadlines"].items(), id).map_or(&[], |at| problem_list(record, &record["deadlines"][at])),
		ListOwner::File(id) => position(record["files"].items(), id).map_or(&[], |at| record["files"][at]["problems"].items()),
	}
}

/// The record with `list` as the owner's problem list, written where `problems_of` reads it.
/// None when the record has no such deadline or file.
pub fn with_problem_list(record: &Json, owner: ListOwner, list: Vec<Json>) -> Option<Json> {
	let (key, index) = match owner {
		ListOwner::Deadline(id) => {
			let at = position(record["deadlines"].items(), id)?;
			match assignment_at(record["files"].items(), &record["deadlines"][at]) {
				Some(f) => ("files", f),
				None => ("deadlines", at),
			}
		}
		ListOwner::File(id) => ("files", position(record["files"].items(), id)?),
	};
	let mut next = record.clone();
	put(next.get_mut(key)?.as_arr_mut()?.get_mut(index)?, list);
	Some(next)
}

/// The record as it leaves the store for readers: each deadline carries its list as `problems`
/// (left out when empty) and the files carry none, so the list is sent once and no reader picks
/// the place.
pub fn with_problem_lists(record: &Json) -> Json {
	let lists: Vec<Vec<Json>> = record["deadlines"].items().iter().map(|d| problem_list(record, d).to_vec()).collect();
	let mut next = record.clone();
	if let Some(deadlines) = next.get_mut("deadlines").and_then(Json::as_arr_mut) {
		for (deadline, list) in deadlines.iter_mut().zip(lists) {
			put(deadline, list);
		}
	}
	for file in next.get_mut("files").and_then(Json::as_arr_mut).into_iter().flatten() {
		put(file, Vec::new());
	}
	next
}

/// How much of a list is worked: its done marks, then its length.
fn worked(list: &Json) -> (usize, usize) {
	(list.items().iter().filter(|p| p["done"].as_bool() == Some(true)).count(), list.items().len())
}

/// The v13 upgrade: each deadline's own list moves onto its assignment file. A deadline whose
/// file is not in the space keeps its own. When two deadlines name one file, the list with more
/// done marks stays on it (then the longer one, then the first), since the other is the less
/// worked copy of the same sheet.
pub fn move_lists_to_files(files: &mut [Json], deadlines: &mut [Json]) {
	for deadline in deadlines.iter_mut() {
		let Some(f) = assignment_at(files, deadline) else { continue };
		let Some(list) = deadline.as_obj_mut().and_then(|d| d.remove("problems")) else { continue };
		if worked(&list) > worked(&files[f]["problems"]) {
			put(&mut files[f], list.items().to_vec());
		}
	}
}

/// After a change to a deadline: one that kept its own list and now has an assignment file with
/// no list hands its list to that file. When the file has a list of its own, the deadline keeps
/// its list unused, so the learner's done marks come back if the file is unpicked or leaves.
pub fn hand_list_to_file(files: &mut [Json], deadline: &mut Json) {
	let Some(f) = assignment_at(files, deadline) else { return };
	if !files[f]["problems"].items().is_empty() {
		return;
	}
	if let Some(list) = deadline.as_obj_mut().and_then(|d| d.remove("problems")) {
		put(&mut files[f], list.items().to_vec());
	}
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;

	fn problem(number: &str, done: bool) -> Json {
		json!({ "number": number, "title": number, "text": "x", "done": done })
	}

	fn record(files: Json, deadlines: Json) -> Json {
		json!({ "id": "spc_a", "files": files, "deadlines": deadlines })
	}

	#[test]
	fn a_deadline_reads_its_assignment_files_list_else_its_own() {
		let r = record(
			json!([{ "id": "f1", "problems": [problem("1", true)] }, { "id": "f2" }]),
			json!([
				{ "id": "d1", "assignmentFileId": "f1", "problems": [problem("9", false)] },
				{ "id": "d2", "problems": [problem("2", false)] },
				{ "id": "d3", "assignmentFileId": "f2" },
				{ "id": "d4", "assignmentFileId": "gone", "problems": [problem("4", false)] },
			]),
		);
		let numbers = |at: usize| problem_list(&r, &r["deadlines"][at]).iter().map(|p| p["number"].str_or_empty().to_owned()).collect::<Vec<_>>();
		assert_eq!(numbers(0), ["1"], "the file's list, never the deadline's");
		assert_eq!(numbers(1), ["2"]);
		assert!(numbers(2).is_empty(), "a file with no list yet");
		assert_eq!(numbers(3), ["4"], "a file not in the space leaves the deadline's own");
	}

	#[test]
	fn a_list_is_written_where_it_is_read() {
		let r = record(json!([{ "id": "f1" }]), json!([{ "id": "d1", "assignmentFileId": "f1" }, { "id": "d2" }]));
		let on_file = with_problem_list(&r, ListOwner::Deadline("d1"), vec![problem("1", false)]).unwrap();
		assert_eq!(stringify(&on_file["files"][0]["problems"]), r#"[{"number":"1","title":"1","text":"x","done":false}]"#);
		assert!(on_file["deadlines"][0].get("problems").is_none());
		let own = with_problem_list(&r, ListOwner::Deadline("d2"), vec![problem("2", true)]).unwrap();
		assert_eq!(own["deadlines"][1]["problems"][0]["number"], json!("2"));
		assert!(own["files"][0].get("problems").is_none());
		assert!(with_problem_list(&on_file, ListOwner::Deadline("d1"), Vec::new()).unwrap()["files"][0].get("problems").is_none(), "an empty list removes the field");
		assert!(with_problem_list(&r, ListOwner::Deadline("nope"), Vec::new()).is_none());
		let by_file = with_problem_list(&r, ListOwner::File("f1"), vec![problem("3", true)]).unwrap();
		assert_eq!(problems_of(&by_file, ListOwner::File("f1")), problems_of(&by_file, ListOwner::Deadline("d1")), "a file's list is its deadline's");
		assert!(problems_of(&by_file, ListOwner::File("gone")).is_empty() && with_problem_list(&r, ListOwner::File("gone"), Vec::new()).is_none());
	}

	#[test]
	fn readers_get_each_deadlines_list_once() {
		let r = record(
			json!([{ "id": "f1", "problems": [problem("1", true)] }]),
			json!([{ "id": "d1", "assignmentFileId": "f1" }, { "id": "d2", "problems": [problem("2", false)] }, { "id": "d3" }]),
		);
		let shown = with_problem_lists(&r);
		assert_eq!(shown["deadlines"][0]["problems"], json!([problem("1", true)]));
		assert_eq!(shown["deadlines"][1]["problems"], json!([problem("2", false)]));
		assert!(shown["deadlines"][2].get("problems").is_none());
		assert!(shown["files"][0].get("problems").is_none());
		assert!(with_problem_lists(&json!({ "id": "spc_a", "files": [] })).get("deadlines").is_none(), "a space with no deadlines stays without");
	}

	#[test]
	fn the_upgrade_moves_each_list_onto_its_file_and_keeps_the_more_worked_copy() {
		let mut files = vec![json!({ "id": "f1" }), json!({ "id": "f2" })];
		let mut deadlines = vec![
			json!({ "id": "d1", "assignmentFileId": "f1", "problems": [problem("1", false), problem("2", false), problem("3", false)] }),
			json!({ "id": "d2", "assignmentFileId": "f1", "problems": [problem("1", true)] }),
			json!({ "id": "d3", "assignmentFileId": "f2", "problems": [problem("1", false)] }),
			json!({ "id": "d4", "assignmentFileId": "f2", "problems": [problem("1", false), problem("2", false)] }),
			json!({ "id": "d5", "problems": [problem("5", true)] }),
		];
		move_lists_to_files(&mut files, &mut deadlines);
		assert_eq!(files[0]["problems"], json!([problem("1", true)]), "more done marks win");
		assert_eq!(files[1]["problems"].items().len(), 2, "same done marks: the longer one");
		assert!(deadlines[..4].iter().all(|d| d.get("problems").is_none()));
		assert_eq!(deadlines[4]["problems"], json!([problem("5", true)]), "no assignment file: kept on the deadline");
	}

	#[test]
	fn a_first_assignment_file_takes_the_deadlines_list_unless_it_has_one() {
		let mut files = vec![json!({ "id": "f1" }), json!({ "id": "f2", "problems": [problem("7", true)] })];
		let mut to_empty = json!({ "id": "d1", "assignmentFileId": "f1", "problems": [problem("1", true)] });
		hand_list_to_file(&mut files, &mut to_empty);
		assert_eq!(files[0]["problems"], json!([problem("1", true)]));
		assert!(to_empty.get("problems").is_none());
		let mut to_full = json!({ "id": "d2", "assignmentFileId": "f2", "problems": [problem("1", false)] });
		hand_list_to_file(&mut files, &mut to_full);
		assert_eq!(files[1]["problems"], json!([problem("7", true)]), "the file's own list wins");
		assert_eq!(to_full["problems"], json!([problem("1", false)]), "and the deadline keeps its own, unused");
		let mut no_file = json!({ "id": "d3", "problems": [problem("3", false)] });
		hand_list_to_file(&mut files, &mut no_file);
		assert_eq!(no_file["problems"], json!([problem("3", false)]));
	}
}
