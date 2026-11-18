//! Homework: an assignment's problems, worked one at a time (homework.ts).

use gs_json::{Json, Obj, json};

use crate::messages::role::{Role, is_custom};
use super::latest_session;
use super::study::is_topic_latest_wrong;

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
	let list = problems.items();
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

/// The problem the learner's newest input picked from the problem list, if it was a pick: a
/// problem closed for it moves on without a long-problem stop, since he chose where to go next.
pub fn picked_problem(messages: &[Json]) -> Option<&str> {
	let newest = messages.iter().rev().find(|m| Role::User.is(m) || is_custom(m, "practice-next"))?;
	newest["details"]["number"].as_str()
}

/// The track record line: the deadline's topics Study would teach first (untested, or weak with
/// the latest answer wrong), and the rest. `topics` are progress topics.
fn track_record_line(topics: &[Json]) -> String {
	if topics.is_empty() {
		return "Track record on its topics: none yet.".to_owned();
	}
	let (teach, open): (Vec<&Json>, Vec<&Json>) = topics.iter().partition(|t| t["status"].as_str() == Some("untested") || is_topic_latest_wrong(t));
	let group = |label: &str, list: &[&Json]| (!list.is_empty()).then(|| format!(" {label}: {}.", list.iter().map(|t| t["name"].str_or_empty()).collect::<Vec<_>>().join(", ")));
	format!("Track record on its topics.{}{}", group("Teach first", &teach).unwrap_or_default(), group("Open right away", &open).unwrap_or_default())
}

/// What the teacher knows when a homework session starts (a hidden message at its top).
/// `assignment` is `{ id, name, path }` or null; `topics` are the progress topics the deadline covers.
pub fn homework_context_text(space_id: &str, deadline: &Json, assignment: &Json, problems: &[Json], topics: &[Json]) -> String {
	let text = |v: &Json| v.as_str().map_or_else(|| gs_json::stringify(v), str::to_owned);
	let time = deadline["time"].as_str().filter(|t| !t.is_empty()).map(|t| format!(" {t}")).unwrap_or_default();
	let mut lines = vec![format!("[Homework] The learner is working on {} ({}), due {}{time}.", text(&deadline["name"]), text(&deadline["kind"]), text(&deadline["date"]))];
	if assignment.is_null() {
		lines.push(format!(
			"No assignment file is attached yet. Find it in the space files (search_space_files) and attach it with update_space_deadline (space_id {space_id}, deadline_id {}, assignment_file_id) before you post its problems. Ask the learner only when you can't find it, or work from the problems they paste.",
			text(&deadline["id"])
		));
	} else {
		let at = assignment["path"].as_str().filter(|p| !p.is_empty()).map(|p| format!(", at {p}")).unwrap_or_default();
		lines.push(format!("Its assignment is the space file {} (file id {}){at}.", text(&assignment["name"]), text(&assignment["id"])));
	}
	lines.push(track_record_line(topics));
	if problems.is_empty() {
		lines.push("No problems are posted yet. Read the assignment and post them all with post_problems first.".to_owned());
	} else {
		lines.push("Its problems, posted before:".to_owned());
		for p in problems {
			lines.push(format!("- {}: {}{}", text(&p["number"]), text(&p["title"]), if p["done"].truthy() { " (done)" } else { "" }));
		}
		lines.push("Next is the first one not done unless the learner picks another.".to_owned());
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
		let deadline = json!({ "id": "ddl_4", "name": "HW 4", "kind": "homework", "date": "2026-11-20", "time": "17:00" });
		let text = homework_context_text("spc_1", &deadline, &json!({ "id": "f1", "name": "hw4.pdf", "path": null }), &[json!({ "number": "1", "title": "Sums", "done": true })], &[]);
		assert_eq!(
			text,
			"[Homework] The learner is working on HW 4 (homework), due 2026-11-20 17:00.\nIts assignment is the space file hw4.pdf (file id f1).\nTrack record on its topics: none yet.\nIts problems, posted before:\n- 1: Sums (done)\nNext is the first one not done unless the learner picks another."
		);
		let bare = homework_context_text("spc_1", &deadline, &Json::Null, &[], &[]);
		assert!(bare.contains("update_space_deadline (space_id spc_1, deadline_id ddl_4, assignment_file_id)"));
	}

	fn topic(name: &str, status: &str, outcomes: &[&str]) -> Json {
		json!({ "name": name, "status": status, "answers": outcomes.iter().map(|o| json!({ "outcome": o })).collect::<Vec<_>>() })
	}

	fn track_record(topics: &[Json]) -> String {
		let text = homework_context_text("spc_1", &json!({ "id": "d", "name": "HW", "kind": "homework", "date": "2026-11-20" }), &Json::Null, &[], topics);
		text.lines().find(|l| l.starts_with("Track record")).unwrap().to_owned()
	}

	#[test]
	fn the_track_record_sorts_topics_by_the_study_rule() {
		let both = [topic("Sets", "untested", &[]), topic("Logic", "strong", &["right"]), topic("Counting", "weak", &["right", "wrong"])];
		assert_eq!(track_record(&both), "Track record on its topics. Teach first: Sets, Counting. Open right away: Logic.");
		assert_eq!(track_record(&both[..1]), "Track record on its topics. Teach first: Sets.");
		assert_eq!(track_record(&both[1..2]), "Track record on its topics. Open right away: Logic.");
		assert_eq!(track_record(&[]), "Track record on its topics: none yet.");
	}

	#[test]
	fn a_weak_topic_answered_right_last_opens_right_away() {
		assert_eq!(track_record(&[topic("Counting", "weak", &["wrong", "right"])]), "Track record on its topics. Open right away: Counting.");
	}

	#[test]
	fn only_the_newest_input_being_a_pick_counts() {
		let pick = json!({ "role": "custom", "customType": "practice-next", "details": { "number": "2b" } });
		let next = json!({ "role": "custom", "customType": "practice-next", "details": {} });
		let typed = json!({ "role": "user", "content": "hm" });
		let reply = json!({ "role": "assistant", "content": [] });
		assert_eq!(picked_problem(&[pick.clone(), reply.clone()]), Some("2b"));
		assert_eq!(picked_problem(&[pick.clone(), typed]), None, "he typed after picking");
		assert_eq!(picked_problem(&[pick, next]), None);
		assert_eq!(picked_problem(&[reply]), None);
	}
}
