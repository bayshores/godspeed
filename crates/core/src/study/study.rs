//! One session that decides per topic whether to teach, drill or just check (study.ts).
//!
//! A study topic is `{ id, name, mode, factIds }`: the plan node id (the space topic's id, or
//! `FREE_TOPIC_ID`), its name, its mode from the learner's track record ("teach", "problems" or
//! "check") and the picked facts in it.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use gs_base::locale;
use gs_json::{Json, json};

use super::items;
use super::progress::topic_facts;
use super::deadline_plan::plan_days;
use crate::spaces::file_series::date_in_name;
use crate::session::plan_tree::create_tree;

/// The plan node of a typed topic that matches no fact.
pub const FREE_TOPIC_ID: &str = "topic";

/// A session holds at most this many facts.
pub const MAX_STUDY_FACTS: usize = 64;

/// Never tested is taught, strong is checked, weak or shaky is drilled.
pub fn study_mode(status: &str) -> &'static str {
	match status {
		"untested" => "teach",
		"strong" => "check",
		_ => "problems",
	}
}

/// Each fact's place in the space's order: the files sorted the way the deadline page lists
/// space days (dated files by date, then undated ones by name), and a fact sits where the file it
/// came from sits. Facts born in a lesson have no place.
pub fn fact_space_order(facts: &[Json], files: &[Json]) -> HashMap<String, usize> {
	let dated: Vec<(&Json, Option<String>)> = files.iter().map(|f| (f, date_in_name(f["name"].as_str().unwrap_or("")))).collect();
	let mut with_date: Vec<&(&Json, Option<String>)> = dated.iter().filter(|d| d.1.is_some()).collect();
	with_date.sort_by(|a, b| locale::compare(a.1.as_deref().unwrap_or(""), b.1.as_deref().unwrap_or("")));
	let mut without: Vec<&(&Json, Option<String>)> = dated.iter().filter(|d| d.1.is_none()).collect();
	without.sort_by(|a, b| locale::compare_numeric(a.0["name"].as_str().unwrap_or(""), b.0["name"].as_str().unwrap_or("")));
	let mut rank_of: HashMap<&str, usize> = HashMap::new();
	for (i, d) in with_date.into_iter().chain(without).enumerate() {
		if let Some(source) = d.0["sourceId"].as_str() {
			rank_of.insert(source, i);
		}
	}
	let mut out = HashMap::new();
	for fact in facts {
		if let (Some(id), Some(rank)) = (fact["id"].as_str(), fact["born"].as_str().and_then(|b| rank_of.get(b))) {
			out.insert(id.to_owned(), *rank);
		}
	}
	out
}

fn fact_ids(topic: &Json) -> Vec<&str> {
	items(&topic["factIds"]).iter().filter_map(Json::as_str).collect()
}

/// Topics sorted by their earliest fact's place in the space; facts from no space file go last
/// and ties keep their order.
fn in_space_order(topics: Vec<Json>, space_order: &HashMap<String, usize>) -> Vec<Json> {
	let rank = |t: &Json| fact_ids(t).iter().map(|id| space_order.get(*id).map_or(f64::INFINITY, |&r| r as f64)).fold(f64::INFINITY, f64::min);
	let mut ranked: Vec<(f64, Json)> = topics.into_iter().map(|t| (rank(&t), t)).collect();
	ranked.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(Ordering::Equal));
	ranked.into_iter().map(|(_, t)| t).collect()
}

fn study_topic(id: &Json, name: &Json, status: &str, fact_ids: Vec<Json>) -> Json {
	json!({ "id": id, "name": name, "mode": study_mode(status), "factIds": fact_ids })
}

/// The session's topics: the picked facts grouped by their space topic, in space order (a topic
/// sits at its earliest fact; facts from no space file go last; ties keep the order the facts were
/// picked in). When no picked fact is in a topic, the typed topic is the one "teach" topic.
///
/// `topics` are `{ id, name, members, status }`.
pub fn study_topics(picked: &[String], topics: &[Json], space_order: &HashMap<String, usize>, free_topic: &str) -> Vec<Json> {
	let mut topic_of: HashMap<&str, &Json> = HashMap::new();
	for t in topics {
		for id in items(&t["members"]).iter().filter_map(Json::as_str) {
			topic_of.insert(id, t);
		}
	}
	let mut groups: Vec<Json> = Vec::new();
	let mut group_at: HashMap<&str, usize> = HashMap::new();
	for id in picked {
		let Some(topic) = topic_of.get(id.as_str()) else { continue };
		let topic_id = topic["id"].as_str().unwrap_or("");
		match group_at.get(topic_id) {
			None => {
				group_at.insert(topic_id, groups.len());
				groups.push(study_topic(&topic["id"], &topic["name"], topic["status"].as_str().unwrap_or(""), vec![Json::from(id.as_str())]));
			}
			Some(&i) => {
				if !fact_ids(&groups[i]).contains(&id.as_str())
					&& let Some(list) = groups[i].get_mut("factIds").and_then(Json::as_arr_mut)
				{
					list.push(Json::from(id.as_str()));
				}
			}
		}
	}
	if groups.is_empty() {
		return vec![study_topic(&Json::from(FREE_TOPIC_ID), &Json::from(free_topic), "untested", vec![])];
	}
	in_space_order(groups, space_order)
}

/// A session on space topics (a Study start on topics or on a deadline): each topic with its
/// facts, the ones to fix first. Whole topics fill the session until the next one would pass
/// `MAX_STUDY_FACTS` facts (always at least one; one bigger than that keeps its first
/// `MAX_STUDY_FACTS` facts), and the kept ones are listed in space order.
///
/// A deadline start passes `studied_today` (the topics that are plan nodes of today's study
/// sessions), so each Study click moves on: first the topics that are not strong and were not
/// studied today, then not strong but studied today, then strong, each group in space order.
/// `topics` are `{ id, name, members, status }`; `facts` are the progress payload's facts.
pub fn topic_study(topic_ids: &[String], topics: &[Json], facts: &[Json], space_order: &HashMap<String, usize>, studied_today: Option<&HashSet<String>>) -> Vec<Json> {
	let mut by_id: HashMap<&str, &Json> = HashMap::new();
	for t in topics {
		by_id.insert(t["id"].as_str().unwrap_or(""), t);
	}
	let mut seen: HashSet<&str> = HashSet::new();
	let mut found = Vec::new();
	for id in topic_ids {
		if !seen.insert(id.as_str()) {
			continue;
		}
		if let Some(t) = by_id.get(id.as_str()) {
			let ids: Vec<Json> = topic_facts(facts, t).iter().map(|f| f["id"].clone()).collect();
			found.push(study_topic(&t["id"], &t["name"], t["status"].as_str().unwrap_or(""), ids));
		}
	}
	let candidates = in_space_order(found, space_order);
	// "check" is exactly the strong topics.
	let tier = |t: &Json| match studied_today {
		None => 0,
		Some(_) if t["mode"].as_str() == Some("check") => 2,
		Some(today) if t["id"].as_str().is_some_and(|id| today.contains(id)) => 1,
		Some(_) => 0,
	};
	let mut order: Vec<usize> = (0..candidates.len()).collect();
	order.sort_by_key(|&i| tier(&candidates[i]));
	let mut kept = vec![false; candidates.len()];
	let mut count = 0;
	let mut kept_any = false;
	for i in order {
		let size = fact_ids(&candidates[i]).len();
		if kept_any && count + size > MAX_STUDY_FACTS {
			break;
		}
		kept[i] = true;
		kept_any = true;
		count += size;
	}
	candidates
		.into_iter()
		.zip(kept)
		.filter(|(_, keep)| *keep)
		.map(|(mut t, _)| {
			if let Some(list) = t.get_mut("factIds").and_then(Json::as_arr_mut) {
				list.truncate(MAX_STUDY_FACTS);
			}
			t
		})
		.collect()
}

/// A Study start's title and first message on space topics.
pub fn study_title(topics: &[Json]) -> String {
	let names: Vec<&str> = topics.iter().map(|t| t["name"].as_str().unwrap_or("")).collect();
	format!("Study: {}", names.join(", "))
}

fn mode_note(mode: &str) -> &'static str {
	match mode {
		"teach" => "teach (never tested)",
		"problems" => "problems (weak or shaky)",
		_ => "check (strong)",
	}
}

/// The study context's model-facing text: names, modes and fact ids only (the graph context
/// above it carries the statements).
pub fn study_context_text(topics: &[Json]) -> String {
	let mut lines = vec!["[Study plan] \u{2014} this session's topics, in the order the space covered them, each with its plan node and its mode from the learner's track record:".to_owned()];
	for (i, t) in topics.iter().enumerate() {
		let ids = fact_ids(t);
		let facts = if ids.is_empty() { ", no facts in the space graph yet".to_owned() } else { format!(", facts {}", ids.join(", ")) };
		lines.push(format!("{}. {} \u{2014} node {}, {}{facts}", i + 1, t["name"].as_str().unwrap_or(""), t["id"].as_str().unwrap_or(""), mode_note(t["mode"].as_str().unwrap_or(""))));
	}
	lines.join("\n")
}

/// The plan the app writes for a study session: one node per topic, in space order (the step bar
/// keeps authored order when there are no edges).
pub fn study_plan_tree(topics: &[Json]) -> Result<Json, String> {
	let nodes: Vec<Json> = topics.iter().map(|t| json!({ "id": t["id"], "title": t["name"] })).collect();
	create_tree(&nodes, &[])
}

/// The topic ids a deadline's Study button studies: today's planned topics, or all its topics
/// once every one is strong (or the plan is over). `deadline_topics` are `{ id, name, rate }`.
pub fn deadline_study_topic_ids(today: &str, date: &str, deadline_topics: &[Json]) -> Vec<String> {
	let plan = plan_days(today, date, deadline_topics);
	let chosen = plan.first().map_or(deadline_topics, |day| items(&day["topics"]));
	chosen.iter().map(|t| t["id"].as_str().unwrap_or("").to_owned()).collect()
}

#[cfg(test)]
mod tests {
	use super::*;

	fn topic(id: &str, status: &str, members: &[&str]) -> Json {
		json!({ "id": id, "name": id.to_uppercase(), "members": members, "status": status })
	}

	fn ids(topics: &[Json]) -> Vec<String> {
		topics.iter().map(|t| t["id"].as_str().unwrap().to_owned()).collect()
	}

	#[test]
	fn modes_follow_the_status() {
		assert_eq!((study_mode("untested"), study_mode("strong"), study_mode("weak"), study_mode("shaky")), ("teach", "check", "problems", "problems"));
	}

	#[test]
	fn picked_facts_group_by_topic_in_space_order() {
		let topics = [topic("t1", "weak", &["a", "b"]), topic("t2", "strong", &["c"]), topic("t3", "untested", &["d"])];
		let order: HashMap<String, usize> = [("c", 0), ("a", 1)].map(|(k, v)| (k.to_owned(), v)).into();
		let picked = ["a", "b", "a", "c", "d", "zzz"].map(String::from);
		let got = study_topics(&picked, &topics, &order, "Free");
		assert_eq!(ids(&got), ["t2", "t1", "t3"]);
		assert_eq!(got[1]["factIds"], json!(["a", "b"]));
		assert_eq!(got[1]["mode"], Json::from("problems"));
		let free = study_topics(&["nope".to_owned()], &topics, &order, "Free");
		assert_eq!(free, vec![json!({ "id": "topic", "name": "Free", "mode": "teach", "factIds": [] })]);
	}

	#[test]
	fn the_text_lists_each_topic() {
		let got = [json!({ "id": "t1", "name": "Sums", "mode": "teach", "factIds": ["a", "b"] }), json!({ "id": "topic", "name": "Free", "mode": "check", "factIds": [] })];
		assert_eq!(study_title(&got), "Study: Sums, Free");
		let text = study_context_text(&got);
		assert!(text.ends_with("1. Sums \u{2014} node t1, teach (never tested), facts a, b\n2. Free \u{2014} node topic, check (strong), no facts in the space graph yet"));
	}

	#[test]
	fn sessions_stop_before_passing_the_fact_cap() {
		let many: Vec<String> = (0..40).map(|i| format!("f{i}")).collect();
		let more: Vec<String> = (0..40).map(|i| format!("g{i}")).collect();
		let topics = [json!({ "id": "t1", "name": "A", "members": many, "status": "weak" }), json!({ "id": "t2", "name": "B", "members": more, "status": "weak" })];
		let facts: Vec<Json> = many.iter().chain(&more).map(|id| json!({ "id": id, "name": id, "answers": [] })).collect();
		let picked = ["t1", "t2"].map(String::from);
		let got = topic_study(&picked, &topics, &facts, &HashMap::new(), None);
		assert_eq!(ids(&got), ["t1"]);
		let today: HashSet<String> = ["t1".to_owned()].into();
		let got = topic_study(&picked, &topics, &facts, &HashMap::new(), Some(&today));
		assert_eq!(ids(&got), ["t2"]);
	}

	#[test]
	fn a_deadline_studies_todays_topics_or_all_of_them() {
		let topics = [json!({ "id": "a", "name": "A", "rate": 0.1 }), json!({ "id": "b", "name": "B", "rate": 0.2 })];
		assert_eq!(deadline_study_topic_ids("2026-11-10", "2026-11-12", &topics), ["a"]);
		assert_eq!(deadline_study_topic_ids("2026-11-10", "2026-11-01", &topics), ["a", "b"]);
	}
}
