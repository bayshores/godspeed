//! Where the learner stands on a space's path. A path topic's id is the plan node of its Study
//! sessions, so each answer given there counts for it at once, before any fact is read. Study
//! moves on by the deadline rule: the first topic that is not strong and was not studied today.

use std::collections::{HashMap, HashSet};

use gs_json::{Json, Obj};

use super::answers::Tally;
use super::progress::{ramp_color, topic_status};
use super::study::study_tier;

/// `{goal, topics: [{id, name, covers, answered, right[, hinted], wrong, dontKnow, rate, status,
/// color}], nextId}` for a saved path, over every graded answer of the space and the plan nodes
/// of today's Study sessions.
pub(crate) fn path_progress(path: &Json, answers: &[&Json], studied_today: &HashSet<String>) -> Json {
	let mut by_node: HashMap<&str, Vec<&Json>> = HashMap::new();
	for a in answers {
		if let Some(node) = a["nodeId"].as_str() {
			by_node.entry(node).or_default().push(a);
		}
	}
	let topics: Vec<Json> = path["topics"]
		.items()
		.iter()
		.map(|t| {
			let tally = Tally::of(by_node.get(t["id"].str_or_empty()).into_iter().flatten().copied());
			let mut o = Obj::new();
			for key in ["id", "name", "covers"] {
				o.insert(key, t[key].clone());
			}
			tally.insert_into(&mut o);
			o.insert("status", topic_status(tally.rate).as_str());
			o.insert("color", ramp_color(tally.rate));
			Json::Obj(o)
		})
		.collect();
	let next = topics.iter().min_by_key(|t| study_tier(t["status"].str_or_empty(), t["id"].str_or_empty(), studied_today)).map(|t| t["id"].clone());
	let mut out = Obj::new();
	out.insert("goal", path["goal"].clone());
	out.insert("topics", topics);
	out.insert("nextId", next.unwrap_or(Json::Null));
	Json::Obj(out)
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;

	fn path() -> Json {
		json!({ "goal": "backend developer", "topics": [
			{ "id": "pth_git", "name": "Git", "covers": "Commits." },
			{ "id": "pth_http", "name": "HTTP", "covers": "Methods." },
			{ "id": "pth_sql", "name": "SQL", "covers": "Joins." },
		] })
	}

	fn answer(node: &str, outcome: &str) -> Json {
		json!({ "nodeId": node, "outcome": outcome })
	}

	fn next(answers: &[Json], today: &[&str]) -> Json {
		let today: HashSet<String> = today.iter().map(|s| (*s).to_owned()).collect();
		path_progress(&path(), &answers.iter().collect::<Vec<_>>(), &today)["nextId"].clone()
	}

	#[test]
	fn each_topic_counts_the_answers_on_its_node() {
		let answers = [answer("pth_git", "right"), answer("pth_http", "wrong"), answer("pth_http", "right"), answer("tpc_other", "wrong")];
		let got = path_progress(&path(), &answers.iter().collect::<Vec<_>>(), &HashSet::new());
		assert_eq!(
			stringify(&got["topics"][0]),
			r#"{"id":"pth_git","name":"Git","covers":"Commits.","answered":1,"right":1,"wrong":0,"dontKnow":0,"rate":1,"status":"strong","color":"var(--lh-ramp-5)"}"#,
			"one right answer makes it strong"
		);
		assert_eq!((got["topics"][1]["status"].clone(), got["topics"][2]["status"].clone()), (json!("weak"), json!("untested")));
		assert_eq!(got["goal"], json!("backend developer"));
	}

	#[test]
	fn study_moves_on_to_the_first_topic_not_strong_and_not_studied_today() {
		assert_eq!(next(&[], &[]), json!("pth_git"));
		assert_eq!(next(&[answer("pth_git", "right")], &[]), json!("pth_http"));
		assert_eq!(next(&[answer("pth_git", "right")], &["pth_http"]), json!("pth_sql"));
		assert_eq!(next(&[answer("pth_git", "right")], &["pth_http", "pth_sql"]), json!("pth_http"), "then the first studied today that is not strong");
		let all = [answer("pth_git", "right"), answer("pth_http", "right"), answer("pth_sql", "right")];
		assert_eq!(next(&all, &[]), json!("pth_git"), "with every topic strong, the first");
	}
}
