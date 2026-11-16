//! What a space check changed, in plain lines for the learner's notice: "Added HW 5, due Fri Nov
//! 20 11:59 PM", "Linked Week 7.pdf to Final".

use std::collections::HashMap;

use gs_json::Json;

use super::today_note::when_label;

/// One deadline a check changed: its copy before the first change (None when the check added it)
/// and after the last.
#[derive(Debug, Clone, PartialEq)]
pub struct DeadlineChange {
	pub before: Option<Json>,
	pub after: Json,
}

/// The ids in `after`'s `key` list that `before`'s lacks.
fn new_ids<'a>(before: &Json, after: &'a Json, key: &str) -> Vec<&'a str> {
	let had = before[key].strs();
	after[key].strs().into_iter().filter(|id| !had.contains(id)).collect()
}

/// The lines for one deadline, in the order the learner reads them.
fn deadline_lines(change: &DeadlineChange, file_names: &HashMap<String, String>) -> Vec<String> {
	let after = &change.after;
	let name = after["name"].str_or_empty();
	let Some(before) = &change.before else { return vec![format!("Added {name}, due {}", when_label(after))] };
	let file = |id: &str| file_names.get(id).cloned().unwrap_or_else(|| "a file".to_owned());
	let mut lines = Vec::new();
	let old_name = before["name"].str_or_empty();
	if old_name != name {
		lines.push(format!("Renamed {old_name} to {name}"));
	}
	if before["date"] != after["date"] || before["time"] != after["time"] {
		lines.push(format!("Moved {name} to {}", when_label(after)));
	}
	lines.extend(new_ids(before, after, "fileIds").into_iter().map(|id| format!("Linked {} to {name}", file(id))));
	lines.extend(new_ids(before, after, "leftOutIds").into_iter().map(|id| format!("Left {} out of {name}", file(id))));
	let dropped = new_ids(after, before, "fileIds").into_iter().filter(|id| !after["leftOutIds"].strs().contains(id));
	lines.extend(dropped.map(|id| format!("Unlinked {} from {name}", file(id))));
	if lines.is_empty() {
		lines.push(format!("Changed {name}"));
	}
	lines
}

/// Every line, deadline by deadline in the order the check first changed them.
pub fn change_lines(changes: &[DeadlineChange], file_names: &HashMap<String, String>) -> Vec<String> {
	changes.iter().flat_map(|c| deadline_lines(c, file_names)).collect()
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn names() -> HashMap<String, String> {
		[("f_w7", "Week 7.pdf"), ("f_w1", "Week 1.pdf")].into_iter().map(|(id, name)| (id.to_owned(), name.to_owned())).collect()
	}

	fn changed(before: Json, after: Json) -> DeadlineChange {
		DeadlineChange { before: Some(before), after }
	}

	#[test]
	fn each_change_reads_as_one_plain_line() {
		let final_exam = json!({ "id": "d1", "kind": "exam", "name": "Final", "date": "2026-12-10", "fileIds": ["f_w1"] });
		let added = DeadlineChange { before: None, after: json!({ "id": "d2", "kind": "homework", "name": "HW 5", "date": "2026-11-20", "time": "23:59", "fileIds": [] }) };
		let linked = changed(final_exam.clone(), json!({ "id": "d1", "kind": "exam", "name": "Final", "date": "2026-12-10", "fileIds": ["f_w1", "f_w7"] }));
		let left_out = changed(final_exam.clone(), json!({ "id": "d1", "kind": "exam", "name": "Final", "date": "2026-12-10", "fileIds": [], "leftOutIds": ["f_w1", "f_w7"] }));
		let moved = changed(json!({ "id": "d3", "kind": "exam", "name": "Midterm", "date": "2026-11-30", "fileIds": [] }), json!({ "id": "d3", "kind": "exam", "name": "Midterm 1", "date": "2026-12-03", "fileIds": [] }));
		let lines = change_lines(&[added, linked, left_out, moved], &names());
		assert_eq!(lines, [
			"Added HW 5, due Fri Nov 20 11:59 PM",
			"Linked Week 7.pdf to Final",
			"Left Week 1.pdf out of Final",
			"Left Week 7.pdf out of Final",
			"Renamed Midterm to Midterm 1",
			"Moved Midterm 1 to Thu Dec 3",
		]);
	}

	#[test]
	fn a_file_dropped_from_a_deadline_or_a_change_with_no_line_of_its_own_is_still_named() {
		let before = json!({ "id": "d1", "kind": "exam", "name": "Final", "date": "2026-12-10", "fileIds": ["f_w1", "f_gone"] });
		let dropped = changed(before.clone(), json!({ "id": "d1", "kind": "exam", "name": "Final", "date": "2026-12-10", "fileIds": [] }));
		assert_eq!(change_lines(&[dropped], &names()), ["Unlinked Week 1.pdf from Final", "Unlinked a file from Final"]);
		let sourced = changed(before.clone(), json!({ "id": "d1", "kind": "exam", "name": "Final", "date": "2026-12-10", "fileIds": ["f_w1", "f_gone"], "source": "Syllabus.pdf" }));
		assert_eq!(change_lines(&[sourced], &names()), ["Changed Final"]);
	}
}
