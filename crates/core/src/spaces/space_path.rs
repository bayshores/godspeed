//! A space's path: the goal a learner with no syllabus works toward and the topics toward it, in
//! order, as the agent writes them with `create_space` and `update_space`. Sending a path
//! replaces the list. A topic keeps its id while its name stays, so the answers given on it keep
//! counting.

use std::collections::HashSet;

use gs_base::text;
use gs_json::{Json, json};

use crate::contracts::space::{MAX_PATH_TOPICS, PATH_GOAL_MAX};
use crate::graph::topics::{clean_topic_name, topic_name_problem};

/// Longest "covers" line, in characters.
pub const PATH_COVERS_MAX: usize = 200;

/// A saved path, field by field: `{goal, topics: [{id, name, covers}]}`, or None with no goal or
/// no topic.
pub fn read_path(v: &Json) -> Option<Json> {
	let goal = v["goal"].as_str().filter(|g| !g.is_empty())?;
	let topics: Vec<Json> = v["topics"]
		.items()
		.iter()
		.filter_map(|t| Some(json!({ "id": t["id"].as_str()?, "name": t["name"].as_str()?, "covers": t["covers"].as_str()? })))
		.collect();
	(!topics.is_empty()).then(|| json!({ "goal": goal, "topics": topics }))
}

/// A path as sent, ready to save, and the names of the old topics it left off.
#[derive(Debug, PartialEq)]
pub struct CleanPath {
	pub path: Json,
	pub removed: Vec<String>,
}

/// The `path` argument checked against the space's `old` path: each topic takes the id of the
/// old topic with its name (case does not matter), else `new_id()`. Err says what to fix.
pub fn clean_path(raw: &Json, old: Option<&Json>, mut new_id: impl FnMut() -> String) -> Result<CleanPath, String> {
	let goal = clean_topic_name(raw["goal"].str_or_empty());
	if goal.is_empty() || text::len16(&goal) > PATH_GOAL_MAX {
		return Err(format!("Give the path a goal of 1 to {PATH_GOAL_MAX} characters that reads after \"Path to\", e.g. \"backend developer\"."));
	}
	let sent = raw["topics"].items();
	if sent.is_empty() || sent.len() > MAX_PATH_TOPICS {
		return Err(format!("A path has 1 to {MAX_PATH_TOPICS} topics."));
	}
	let old_topics = old.map_or(&[][..], |p| p["topics"].items());
	let old_id = |key: &str| old_topics.iter().find(|t| t["name"].str_or_empty().to_lowercase() == key).and_then(|t| t["id"].as_str());
	let mut used: HashSet<String> = old_topics.iter().filter_map(|t| t["id"].as_str().map(str::to_owned)).collect();
	let mut names = HashSet::new();
	let mut topics = Vec::new();
	for t in sent {
		let name = clean_topic_name(t["name"].str_or_empty());
		if let Some(problem) = topic_name_problem(&name) {
			return Err(problem);
		}
		let key = name.to_lowercase();
		if !names.insert(key.clone()) {
			return Err(format!("\"{name}\" is on the path twice."));
		}
		let covers = clean_topic_name(t["covers"].str_or_empty());
		if covers.is_empty() {
			return Err(format!("Say in one line what \"{name}\" covers."));
		}
		let id = match old_id(&key) {
			Some(id) => id.to_owned(),
			None => loop {
				let id = new_id();
				if used.insert(id.clone()) {
					break id;
				}
			},
		};
		topics.push(json!({ "id": id, "name": name, "covers": text::slice16(&covers, 0, Some(PATH_COVERS_MAX as i64)) }));
	}
	let removed = old_topics.iter().map(|t| t["name"].str_or_empty()).filter(|n| !names.contains(&n.to_lowercase())).map(str::to_owned).collect();
	Ok(CleanPath { path: json!({ "goal": goal, "topics": topics }), removed })
}

/// What a path Study session's teacher reads under its plan: where the topic sits on the path
/// and what it covers.
pub fn path_lesson_note(goal: &str, position: usize, total: usize, covers: &str) -> String {
	format!("[Path] Topic {position} of {total} on his path to {goal}. It covers: {covers}")
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;

	fn ids() -> impl FnMut() -> String {
		let mut n = 0;
		move || {
			n += 1;
			format!("pth_{n}")
		}
	}

	#[test]
	fn a_saved_path_reads_field_by_field() {
		let saved = json!({ "goal": "backend developer", "topics": [{ "id": "pth_1", "name": "Git", "covers": "Commits.", "extra": 1 }, { "id": 2, "name": "SQL", "covers": "" }], "x": 1 });
		assert_eq!(stringify(&read_path(&saved).unwrap()), r#"{"goal":"backend developer","topics":[{"id":"pth_1","name":"Git","covers":"Commits."}]}"#);
		assert!(read_path(&json!({ "goal": "", "topics": saved["topics"] })).is_none());
		assert!(read_path(&json!({ "goal": "x", "topics": [] })).is_none());
		assert!(read_path(&Json::Null).is_none());
	}

	#[test]
	fn a_sent_path_keeps_the_ids_of_names_it_keeps_and_names_what_it_left_off() {
		let first = clean_path(&json!({ "goal": " backend \n developer ", "topics": [{ "name": "Git", "covers": "Commits,\n branches." }, { "name": "HTTP", "covers": "Methods." }] }), None, ids()).unwrap();
		assert_eq!(stringify(&first.path), r#"{"goal":"backend developer","topics":[{"id":"pth_1","name":"Git","covers":"Commits, branches."},{"id":"pth_2","name":"HTTP","covers":"Methods."}]}"#);
		assert!(first.removed.is_empty());
		let again = clean_path(&json!({ "goal": "backend developer", "topics": [{ "name": "SQL", "covers": "Joins." }, { "name": "http", "covers": "Verbs." }] }), Some(&first.path), ids()).unwrap();
		assert_eq!(stringify(&again.path["topics"]), r#"[{"id":"pth_3","name":"SQL","covers":"Joins."},{"id":"pth_2","name":"http","covers":"Verbs."}]"#, "a new id never takes an old one");
		assert_eq!(again.removed, ["Git"]);
	}

	#[test]
	fn a_path_with_a_bad_goal_topic_or_count_is_refused() {
		let topic = json!({ "name": "Git", "covers": "Commits." });
		let refused = |raw: Json| clean_path(&raw, None, ids()).unwrap_err();
		assert!(refused(json!({ "goal": "", "topics": [topic] })).starts_with("Give the path a goal"));
		assert!(refused(json!({ "goal": "x".repeat(41), "topics": [topic] })).starts_with("Give the path a goal"));
		assert_eq!(refused(json!({ "goal": "x", "topics": [] })), "A path has 1 to 40 topics.");
		assert_eq!(refused(json!({ "goal": "x", "topics": vec![topic.clone(); 41] })), "A path has 1 to 40 topics.");
		assert_eq!(refused(json!({ "goal": "x", "topics": [topic, { "name": " GIT ", "covers": "Again." }] })), "\"GIT\" is on the path twice.");
		assert!(refused(json!({ "goal": "x", "topics": [{ "name": "one two three four five", "covers": "c" }] })).contains("has 5 words"));
		assert_eq!(refused(json!({ "goal": "x", "topics": [{ "name": "Git", "covers": " \n" }] })), "Say in one line what \"Git\" covers.");
	}

	#[test]
	fn the_lesson_note_names_the_place_and_what_it_covers() {
		assert_eq!(path_lesson_note("backend developer", 4, 28, "Methods, status codes, headers."), "[Path] Topic 4 of 28 on his path to backend developer. It covers: Methods, status codes, headers.");
	}
}
