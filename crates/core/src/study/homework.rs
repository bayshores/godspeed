//! Homework: an assignment's problems, worked one at a time (homework.ts).

use gs_json::{Json, Obj, json};

use super::{items, latest_session};

/// The kinds of deadline that have problems to work on.
pub fn has_problems(kind: &str) -> bool {
	kind == "homework" || kind == "project"
}

/// The posted list, each problem keeping its done mark by number.
pub fn merge_problems(previous: &[Json], posted: &[Json]) -> Vec<Json> {
	posted
		.iter()
		.map(|p| {
			// A later problem with the same number wins, like a Map built from the list.
			let done = previous.iter().rev().find(|q| q["number"] == p["number"]).map(|q| q["done"].clone()).filter(|d| !d.is_null());
			let mut merged = p.as_obj().cloned().unwrap_or_else(Obj::new);
			merged.insert("done", done.unwrap_or(Json::Bool(false)));
			Json::Obj(merged)
		})
		.collect()
}

/// How many problems are done, `{ done, total }`; None with none posted.
pub fn problems_done(problems: &Json) -> Option<Json> {
	let list = items(problems);
	if list.is_empty() {
		return None;
	}
	Some(json!({ "done": list.iter().filter(|p| p["done"].truthy()).count(), "total": list.len() }))
}

/// The chat id of the latest homework session on a deadline, which Work on reopens.
pub fn latest_homework(deadline_id: &str, sessions: &[Json]) -> Option<String> {
	latest_session(deadline_id, sessions).and_then(|s| s["chatId"].as_str().map(str::to_owned))
}

/// Whether a conclude outcome marks the problem done.
pub fn conclude_marks_done(outcome: &Json) -> bool {
	matches!(outcome.as_str(), Some("solved" | "solvedWithHints"))
}

/// What the teacher knows when a homework session starts (a hidden message at its top).
/// `assignment` is `{ id, name, path }` or null.
pub fn homework_context_text(deadline: &Json, assignment: &Json, problems: &[Json]) -> String {
	let text = |v: &Json| v.as_str().map_or_else(|| gs_json::stringify(v), str::to_owned);
	let time = deadline["time"].as_str().filter(|t| !t.is_empty()).map(|t| format!(" {t}")).unwrap_or_default();
	let mut lines = vec![format!("[Homework] The learner is working on {} ({}), due {}{time}.", text(&deadline["name"]), text(&deadline["kind"]), text(&deadline["date"]))];
	if assignment.is_null() {
		lines.push("No assignment file is attached yet. Ask the learner which class file it is and attach it with update_class_deadline (assignment_file_id), or work from the problems they paste.".to_owned());
	} else {
		let at = assignment["path"].as_str().filter(|p| !p.is_empty()).map(|p| format!(", at {p}")).unwrap_or_default();
		lines.push(format!("Its assignment is the class file {} (file id {}){at}.", text(&assignment["name"]), text(&assignment["id"])));
	}
	if problems.is_empty() {
		lines.push("No problems are posted yet. Read the assignment and post them all with post_problems first.".to_owned());
	} else {
		lines.push("Its problems, posted before:".to_owned());
		for p in problems {
			lines.push(format!("- {}: {}{}", text(&p["number"]), text(&p["title"]), if p["done"].truthy() { " (done)" } else { "" }));
		}
		lines.push("Open the first one not done unless the learner picks another.".to_owned());
	}
	lines.join("\n")
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;

	#[test]
	fn posted_problems_keep_their_done_marks() {
		let previous = [json!({ "number": "1", "title": "A", "done": true }), json!({ "number": "2", "title": "B", "done": false })];
		let posted = [json!({ "number": "1", "title": "A2" }), json!({ "number": "3", "title": "C" })];
		assert_eq!(stringify(&Json::from(merge_problems(&previous, &posted))), r#"[{"number":"1","title":"A2","done":true},{"number":"3","title":"C","done":false}]"#);
	}

	#[test]
	fn done_counts_and_conclude_outcomes() {
		assert_eq!(problems_done(&json!([])), None);
		assert_eq!(problems_done(&json!([{ "done": true }, { "done": false }])), Some(json!({ "done": 1, "total": 2 })));
		assert!(conclude_marks_done(&json!("solvedWithHints")));
		assert!(!conclude_marks_done(&json!("movedOn")));
		assert!(!conclude_marks_done(&json!(3)));
	}

	#[test]
	fn the_latest_homework_session_and_the_opening_text() {
		let sessions = [json!({ "chatId": "a", "deadlineId": "d", "createdAt": "1" }), json!({ "chatId": "b", "deadlineId": "d", "createdAt": "2" })];
		assert_eq!(latest_homework("d", &sessions).as_deref(), Some("b"));
		let deadline = json!({ "name": "HW 4", "kind": "homework", "date": "2026-11-20", "time": "17:00" });
		let text = homework_context_text(&deadline, &json!({ "id": "f1", "name": "hw4.pdf", "path": null }), &[json!({ "number": "1", "title": "Sums", "done": true })]);
		assert_eq!(
			text,
			"[Homework] The learner is working on HW 4 (homework), due 2026-11-20 17:00.\nIts assignment is the class file hw4.pdf (file id f1).\nIts problems, posted before:\n- 1: Sums (done)\nOpen the first one not done unless the learner picks another."
		);
	}
}
