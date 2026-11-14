//! One session over the picked topics (study.ts). At the start the picked facts become the
//! session's topics, in the order the space covered them, each with its material (from the topic
//! grouper) and where the learner stands on it; the study prompt's move table picks each topic's
//! move from that pair.
//!
//! A study topic (TS `StudyTopic`) is `{ id, name[, material], status[, latestWrong: true],
//! factIds }`: the plan node id (the space topic's id, or `FREE_TOPIC_ID`), its name, its
//! material, its status from the learner's track record, whether it is weak with a wrong newest
//! answer, and the picked facts in it.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use gs_base::{locale, time};
use gs_json::{Json, Obj, json};

use super::items;
use super::progress::{days_between, topic_facts};
use super::deadline_plan::plan_days;
use crate::spaces::file_series::date_in_name;
use crate::spaces::today_note::local_day;
use crate::session::plan_tree::create_tree;

/// The plan node of a typed topic that matches no fact.
pub const FREE_TOPIC_ID: &str = "topic";

/// A session holds at most this many facts.
pub const MAX_STUDY_FACTS: usize = 64;

/// A weak topic whose newest answer was not right or solved with hints: taught first again (the
/// status is a lifetime rate, so a topic can stay weak after the learner has caught up).
pub fn is_latest_wrong(status: &str, latest: Option<&str>) -> bool {
	status == "weak" && !matches!(latest, Some("right" | "hinted"))
}

/// A progress topic (`{ id, name[, material], status, answers }`) as a study topic over `fact_ids`.
fn study_topic(t: &Json, fact_ids: Vec<Json>) -> Json {
	let status = t["status"].as_str().unwrap_or("");
	let mut o = Obj::new();
	o.insert("id", t["id"].clone());
	o.insert("name", t["name"].clone());
	if let Some(material) = t["material"].as_str().filter(|m| !m.is_empty()) {
		o.insert("material", material);
	}
	o.insert("status", t["status"].clone());
	if is_latest_wrong(status, items(&t["answers"]).last().and_then(|a| a["outcome"].as_str())) {
		o.insert("latestWrong", true);
	}
	o.insert("factIds", fact_ids);
	Json::Obj(o)
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

/// The session's topics: the picked facts grouped by their space topic, in space order (a topic
/// sits at its earliest fact; facts from no space file go last; ties keep the order the facts were
/// picked in). When no picked fact is in a topic, the typed topic is the one untested topic.
///
/// `topics` are progress topics: `{ id, name, members[, material], status, answers }`.
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
				groups.push(study_topic(topic, vec![Json::from(id.as_str())]));
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
		return vec![json!({ "id": FREE_TOPIC_ID, "name": free_topic, "status": "untested", "factIds": [] })];
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
/// `topics` are progress topics (as in `study_topics`); `facts` are the progress payload's facts.
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
			found.push(study_topic(t, ids));
		}
	}
	let candidates = in_space_order(found, space_order);
	let tier = |t: &Json| match studied_today {
		None => 0,
		Some(_) if t["status"].as_str() == Some("strong") => 2,
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

/// "procedure, weak (latest wrong)": what the study prompt's move table reads.
fn material_and_standing(t: &Json) -> String {
	let material = t["material"].as_str().filter(|m| !m.is_empty()).map_or_else(String::new, |m| format!("{m}, "));
	let latest = if t["latestWrong"].truthy() { " (latest wrong)" } else { "" };
	format!("{material}{}{latest}", t["status"].as_str().unwrap_or(""))
}

/// The study context's model-facing text: names, standings and fact ids only (the graph context
/// above it carries the statements).
pub fn study_context_text(topics: &[Json]) -> String {
	let mut lines = vec!["[Study plan] \u{2014} this session's topics, in the order the space covered them, each with its plan node, its material and where he stands from his track record:".to_owned()];
	for (i, t) in topics.iter().enumerate() {
		let ids = fact_ids(t);
		let facts = if ids.is_empty() { ", no facts in the space graph yet".to_owned() } else { format!(", facts {}", ids.join(", ")) };
		lines.push(format!("{}. {} \u{2014} node {}, {}{facts}", i + 1, t["name"].as_str().unwrap_or(""), t["id"].as_str().unwrap_or(""), material_and_standing(t)));
	}
	lines.join("\n")
}

/// The plan the app writes for a study session: one node per topic, in space order (the step bar
/// keeps authored order when there are no edges).
pub fn study_plan_tree(topics: &[Json]) -> Result<Json, String> {
	let nodes: Vec<Json> = topics.iter().map(|t| json!({ "id": t["id"], "title": t["name"] })).collect();
	create_tree(&nodes, &[])
}

/// A strong topic with no question from earlier is checked again once its newest answer is this
/// many days old.
const RECHECK_DAYS: i64 = 7;

/// The topic ids a deadline's Study button studies: today's planned topics and the strong ones
/// not answered for `RECHECK_DAYS` days, or all its topics once every one is strong, the plan is
/// over, or today has nothing left. A topic in `reviewed` (it has a question from earlier it may still be asked) comes
/// back through review instead, so it is never rechecked here. `deadline` is a progress deadline (`date`, `topics` of
/// `{ id, name, rate }`); `topics` are the progress topics (`id`, `status`, `answers` oldest
/// first).
pub fn deadline_study_topic_ids(today: &str, deadline: &Json, topics: &[Json], reviewed: &HashSet<String>) -> Vec<String> {
	let deadline_topics = items(&deadline["topics"]);
	let id_of = |t: &Json| t["id"].as_str().unwrap_or("").to_owned();
	let plan = plan_days(today, deadline["date"].as_str().unwrap_or(""), deadline_topics);
	// Today is empty once every topic left was finished today: Study takes them all again.
	let Some(day) = plan.first().filter(|d| !items(&d["topics"]).is_empty()) else { return deadline_topics.iter().map(id_of).collect() };
	let in_deadline: HashSet<&str> = deadline_topics.iter().filter_map(|t| t["id"].as_str()).collect();
	let due_again = |t: &&Json| {
		let newest = items(&t["answers"]).last().and_then(|a| a["answeredAt"].as_str()).filter(|at| !at.is_empty());
		// An unreadable time is NaN days old in JS, which never reaches the limit.
		let old_enough = newest.and_then(time::parse_date).is_some_and(|ms| days_between(&local_day(ms), today) >= RECHECK_DAYS);
		t["id"].as_str().is_some_and(|id| in_deadline.contains(id) && !reviewed.contains(id)) && t["status"].as_str() == Some("strong") && old_enough
	};
	items(&day["topics"]).iter().chain(topics.iter().filter(due_again)).map(id_of).collect()
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;

	fn topic(id: &str, status: &str, members: &[&str]) -> Json {
		json!({ "id": id, "name": id.to_uppercase(), "members": members, "status": status, "answers": [] })
	}

	fn ids(topics: &[Json]) -> Vec<String> {
		topics.iter().map(|t| t["id"].as_str().unwrap().to_owned()).collect()
	}

	#[test]
	fn latest_wrong_is_weak_without_a_right_newest_answer() {
		assert!(is_latest_wrong("weak", Some("wrong")));
		assert!(is_latest_wrong("weak", Some("dontKnow")));
		assert!(is_latest_wrong("weak", None));
		assert!(!is_latest_wrong("weak", Some("right")));
		assert!(!is_latest_wrong("shaky", Some("wrong")));
	}

	#[test]
	fn picked_facts_group_by_topic_in_space_order() {
		let mut weak = topic("t1", "weak", &["a", "b"]);
		weak.as_obj_mut().unwrap().insert("material", "procedure");
		weak.as_obj_mut().unwrap().insert("answers", json!([{ "outcome": "right" }, { "outcome": "wrong" }]));
		let topics = [weak, topic("t2", "strong", &["c"]), topic("t3", "untested", &["d"])];
		let order: HashMap<String, usize> = [("c", 0), ("a", 1)].map(|(k, v)| (k.to_owned(), v)).into();
		let picked = ["a", "b", "a", "c", "d", "zzz"].map(String::from);
		let got = study_topics(&picked, &topics, &order, "Free");
		assert_eq!(ids(&got), ["t2", "t1", "t3"]);
		assert_eq!(stringify(&got[1]), r#"{"id":"t1","name":"T1","material":"procedure","status":"weak","latestWrong":true,"factIds":["a","b"]}"#);
		assert_eq!(stringify(&got[0]), r#"{"id":"t2","name":"T2","status":"strong","factIds":["c"]}"#);
		let free = study_topics(&["nope".to_owned()], &topics, &order, "Free");
		assert_eq!(free, vec![json!({ "id": "topic", "name": "Free", "status": "untested", "factIds": [] })]);
	}

	#[test]
	fn the_text_lists_each_topic_with_its_material_and_standing() {
		let got = [
			json!({ "id": "t1", "name": "Sums", "material": "procedure", "status": "weak", "latestWrong": true, "factIds": ["a", "b"] }),
			json!({ "id": "topic", "name": "Free", "status": "untested", "factIds": [] }),
		];
		assert_eq!(study_title(&got), "Study: Sums, Free");
		assert_eq!(
			study_context_text(&got),
			"[Study plan] \u{2014} this session's topics, in the order the space covered them, each with its plan node, its material and where he stands from his track record:\n1. Sums \u{2014} node t1, procedure, weak (latest wrong), facts a, b\n2. Free \u{2014} node topic, untested, no facts in the space graph yet"
		);
	}

	#[test]
	fn sessions_stop_before_passing_the_fact_cap() {
		let many: Vec<String> = (0..40).map(|i| format!("f{i}")).collect();
		let more: Vec<String> = (0..40).map(|i| format!("g{i}")).collect();
		let topics = [json!({ "id": "t1", "name": "A", "members": many, "status": "weak", "answers": [] }), json!({ "id": "t2", "name": "B", "members": more, "status": "weak", "answers": [] })];
		let facts: Vec<Json> = many.iter().chain(&more).map(|id| json!({ "id": id, "name": id, "answers": [] })).collect();
		let picked = ["t1", "t2"].map(String::from);
		let got = topic_study(&picked, &topics, &facts, &HashMap::new(), None);
		assert_eq!(ids(&got), ["t1"]);
		let today: HashSet<String> = ["t1".to_owned()].into();
		let got = topic_study(&picked, &topics, &facts, &HashMap::new(), Some(&today));
		assert_eq!(ids(&got), ["t2"]);
	}

	#[test]
	fn strong_topics_come_last_on_a_deadline_start() {
		let topics = [topic("t1", "strong", &["a"]), topic("t2", "shaky", &["b"])];
		let facts = [json!({ "id": "a", "topicId": "t1" }), json!({ "id": "b", "topicId": "t2" })];
		let picked = ["t1", "t2"].map(String::from);
		let caps: Vec<Json> = (0..64).map(|i| json!({ "id": format!("b{i}"), "topicId": "t2" })).collect();
		let big = [topic("t1", "strong", &["a"]), json!({ "id": "t2", "name": "T2", "members": caps.iter().map(|f| f["id"].clone()).collect::<Vec<_>>(), "status": "shaky", "answers": [] })];
		let all: Vec<Json> = facts.iter().cloned().chain(caps).collect();
		assert_eq!(ids(&topic_study(&picked, &topics, &facts, &HashMap::new(), Some(&HashSet::new()))), ["t1", "t2"]);
		assert_eq!(ids(&topic_study(&picked, &big, &all, &HashMap::new(), Some(&HashSet::new()))), ["t2"]);
	}

	#[test]
	fn a_deadline_studies_todays_topics_or_all_of_them() {
		let deadline = json!({ "date": "2026-11-12", "topics": [{ "id": "a", "name": "A", "rate": 0.1 }, { "id": "b", "name": "B", "rate": 0.2 }] });
		assert_eq!(deadline_study_topic_ids("2026-11-10", &deadline, &[], &HashSet::new()), ["a"]);
		let over = json!({ "date": "2026-11-01", "topics": deadline["topics"] });
		assert_eq!(deadline_study_topic_ids("2026-11-10", &over, &[], &HashSet::new()), ["a", "b"]);
	}

	#[test]
	fn a_deadline_rechecks_strong_topics_not_answered_for_a_week() {
		let deadline = json!({ "date": "2026-11-20", "topics": [{ "id": "a", "name": "A", "rate": 0.1 }, { "id": "s", "name": "S", "rate": 0.9 }, { "id": "r", "name": "R", "rate": 0.9 }] });
		let strong = |id: &str, at: &str| json!({ "id": id, "status": "strong", "answers": [{ "outcome": "right", "answeredAt": "2026-10-01T12:00:00.000Z" }, { "outcome": "right", "answeredAt": at }] });
		let topics = [
			strong("s", "2026-11-03T12:00:00.000Z"),
			strong("r", "2026-11-04T12:00:00.000Z"),
			strong("elsewhere", "2026-10-01T12:00:00.000Z"),
			json!({ "id": "n", "status": "strong", "answers": [] }),
			json!({ "id": "a", "status": "weak", "answers": [{ "outcome": "wrong", "answeredAt": "2026-10-01T12:00:00.000Z" }] }),
		];
		assert_eq!(deadline_study_topic_ids("2026-11-10", &deadline, &topics, &HashSet::new()), ["a", "s"]);
		assert_eq!(deadline_study_topic_ids("2026-11-11", &deadline, &topics, &HashSet::new()), ["a", "s", "r"]);
		let reviewed: HashSet<String> = ["s".to_owned()].into();
		assert_eq!(deadline_study_topic_ids("2026-11-11", &deadline, &topics, &reviewed), ["a", "r"], "a topic with a question from earlier comes back through review");
	}
}
