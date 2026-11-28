//! A round of the teacher's work on a space (space-work.ts): it opens when a study file starts
//! waiting to be read and ends when none waits. Pure, so the store can apply it on every file
//! write. A round is `{ startedAt, endedAt?, fileIds, deadlineIds }`.

use gs_json::{Json, json};

use super::file_state::{FileKind, FileStatus};

/// A study file the teacher still has to read.
pub(crate) fn is_waiting_file(file: &Json) -> bool {
	FileKind::of(file) == Some(FileKind::Study) && FileStatus::of(file).is_some_and(FileStatus::is_waiting)
}

fn open(work: Option<&Json>) -> Option<&Json> {
	work.filter(|w| !w["endedAt"].truthy())
}

/// The round with these fields set (its other fields keep their place).
fn with(work: &Json, fields: &[(&str, Json)]) -> Json {
	let mut out = work.as_obj().cloned().unwrap_or_default();
	for (key, value) in fields {
		out.insert(*key, value.clone());
	}
	Json::Obj(out)
}

/// The round after a file write: `before` is the list as stored, `after` the list being saved.
/// A file that stops waiting joins the round; a round that made nothing leaves no trace.
pub fn work_after_files(work: Option<&Json>, before: &[Json], after: &[Json], now: &str) -> Option<Json> {
	let waiting = after.iter().any(is_waiting_file);
	let Some(round) = open(work) else {
		return if waiting { Some(json!({ "startedAt": now, "fileIds": [], "deadlineIds": [] })) } else { work.cloned() };
	};
	let waited: Vec<&str> = before.iter().filter(|f| is_waiting_file(f)).filter_map(|f| f["id"].as_str()).collect();
	let mut file_ids: Vec<Json> = round["fileIds"].as_arr().cloned().unwrap_or_default();
	let read_before = round["fileIds"].strs();
	for f in after {
		let Some(id) = f["id"].as_str() else { continue };
		if waited.contains(&id) && !is_waiting_file(f) && !read_before.contains(&id) {
			file_ids.push(Json::from(id));
		}
	}
	if waiting {
		return Some(with(round, &[("fileIds", Json::Arr(file_ids))]));
	}
	let made_something = !file_ids.is_empty() || !round["deadlineIds"].strs().is_empty();
	made_something.then(|| with(round, &[("fileIds", Json::Arr(file_ids)), ("endedAt", Json::from(now))]))
}

/// A deadline added while a round is open belongs to it.
pub fn work_after_deadline(work: Option<&Json>, deadline_id: &str) -> Option<Json> {
	let Some(round) = open(work) else { return work.cloned() };
	let mut deadline_ids = round["deadlineIds"].as_arr().cloned().unwrap_or_default();
	deadline_ids.push(Json::from(deadline_id));
	Some(with(round, &[("deadlineIds", Json::Arr(deadline_ids))]))
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;

	fn file(id: &str, kind: &str, status: &str) -> Json {
		json!({ "id": id, "kind": kind, "status": status })
	}

	#[test]
	fn only_study_files_still_to_read_wait() {
		assert!(is_waiting_file(&file("a", "study", "pending")) && is_waiting_file(&file("a", "study", "extracting")));
		assert!(!is_waiting_file(&file("a", "info", "pending")) && !is_waiting_file(&file("a", "study", "failed")));
	}

	#[test]
	fn a_round_opens_collects_what_finished_and_ends_when_nothing_waits() {
		let opened = work_after_files(None, &[], &[file("a", "study", "pending"), file("b", "study", "pending")], "t1").unwrap();
		assert_eq!(stringify(&opened), r#"{"startedAt":"t1","fileIds":[],"deadlineIds":[]}"#);
		let before = [file("a", "study", "pending"), file("b", "study", "pending")];
		let after = [file("a", "study", "ready"), file("b", "study", "extracting")];
		let going = work_after_files(Some(&opened), &before, &after, "t2").unwrap();
		assert_eq!(stringify(&going), r#"{"startedAt":"t1","fileIds":["a"],"deadlineIds":[]}"#);
		let ended = work_after_files(Some(&going), &after, &[file("a", "study", "ready"), file("b", "study", "failed")], "t3").unwrap();
		assert_eq!(stringify(&ended), r#"{"startedAt":"t1","fileIds":["a","b"],"deadlineIds":[],"endedAt":"t3"}"#);
		// An ended round stays until a file waits again.
		assert_eq!(work_after_files(Some(&ended), &[], &[file("a", "study", "ready")], "t4"), Some(ended.clone()));
		assert_eq!(stringify(&work_after_files(Some(&ended), &[], &[file("c", "study", "pending")], "t5").unwrap()), r#"{"startedAt":"t5","fileIds":[],"deadlineIds":[]}"#);
	}

	#[test]
	fn a_round_that_made_nothing_leaves_no_trace() {
		let opened = work_after_files(None, &[], &[file("a", "study", "pending")], "t1");
		assert_eq!(work_after_files(opened.as_ref(), &[file("a", "study", "pending")], &[], "t2"), None);
		let with_deadline = work_after_deadline(opened.as_ref(), "ddl_1");
		assert_eq!(stringify(&with_deadline.clone().unwrap()), r#"{"startedAt":"t1","fileIds":[],"deadlineIds":["ddl_1"]}"#);
		let ended = work_after_files(with_deadline.as_ref(), &[], &[], "t3").unwrap();
		assert_eq!(stringify(&ended), r#"{"startedAt":"t1","fileIds":[],"deadlineIds":["ddl_1"],"endedAt":"t3"}"#);
		assert_eq!(work_after_deadline(Some(&ended), "ddl_2"), Some(ended));
		assert_eq!(work_after_deadline(None, "ddl_2"), None);
	}
}
