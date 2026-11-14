//! Every number the Overview and the topic Graph show, derived from what the app records
//! (progress.ts: deriveProgress). Nothing here is saved.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use gs_base::locale;
use gs_json::{Json, Obj};

use super::answers::{Tally, answer_ref, facts_by_message, facts_for_answer, is_overconfident};
use super::calibration::calibration;
use super::continue_study::{continue_study_for, ended_today_for};
use super::fact_progress::{file_coverage, from_lesson, next_up_file};
use super::homework::{latest_homework, problems_done};
use super::progress::{days_between, ramp_color, topic_status};
use super::topic_links::{topic_columns, topic_links};
use super::work_on_next::{TopicView, status_counts, work_on_next};
use super::items;
use crate::contracts::space::compare_deadlines;
use crate::graph::session_clusters::birth_session_of;
use crate::graph::topics::resolve_topics;

/// The progress payload for GET /api/progress.
///
/// `input` is `{ spaceId, today, facts, chains, topics, files, deadlines, lessons[,
/// deadlineSessions, homeworkSessions, mockAnswers, grouping] }`; each lesson carries its
/// collected `answers`, and `mockAnswers` are graded mock questions, which count for their facts
/// but belong to no lesson.
pub fn derive_progress(input: &Json) -> Json {
	let facts = items(&input["facts"]);
	let fact_ids: Vec<String> = facts.iter().map(|f| f["id"].as_str().unwrap_or("").to_owned()).collect();
	let snapshot = Some(&input["topics"]).filter(|t| !t.is_null());
	let resolved = resolve_topics(snapshot, &fact_ids);
	let mut topic_of_fact: HashMap<String, String> = HashMap::new();
	for t in &resolved {
		for id in items(&t["members"]).iter().filter_map(Json::as_str) {
			topic_of_fact.insert(id.to_owned(), t["id"].as_str().unwrap_or("").to_owned());
		}
	}

	// Answers, per lesson and for the whole space. A repeated lesson id keeps its first place and
	// its last answers, like a Map.
	let lessons = items(&input["lessons"]);
	let mut titles: HashMap<&str, &Json> = HashMap::new();
	let mut lesson_at: HashMap<&str, usize> = HashMap::new();
	let mut by_lesson: Vec<&[Json]> = Vec::new();
	for l in lessons {
		let id = l["id"].as_str().unwrap_or("");
		titles.insert(id, &l["title"]);
		match lesson_at.get(id) {
			Some(&i) => by_lesson[i] = items(&l["answers"]),
			None => {
				lesson_at.insert(id, by_lesson.len());
				by_lesson.push(items(&l["answers"]));
			}
		}
	}
	let mut all_answers: Vec<&Json> = by_lesson.iter().flat_map(|a| a.iter()).chain(items(&input["mockAnswers"])).collect();
	all_answers.sort_by(|a, b| locale::compare(a["answeredAt"].as_str().unwrap_or(""), b["answeredAt"].as_str().unwrap_or("")));

	// Answer to facts to topics.
	let index = facts_by_message(facts);
	let mut fact_answers: HashMap<String, Vec<&Json>> = HashMap::new();
	let mut topic_answers: HashMap<&str, Vec<&Json>> = HashMap::new();
	for answer in &all_answers {
		let mut topics_hit: Vec<&str> = Vec::new();
		for id in facts_for_answer(answer, &index) {
			if let Some(topic) = topic_of_fact.get(&id)
				&& !topics_hit.contains(&topic.as_str())
			{
				topics_hit.push(topic);
			}
			fact_answers.entry(id).or_default().push(answer);
		}
		for topic in topics_hit {
			topic_answers.entry(topic).or_default().push(answer);
		}
	}

	let links = topic_links(items(&input["chains"]), &topic_of_fact);
	let topic_ids: Vec<String> = resolved.iter().map(|t| t["id"].as_str().unwrap_or("").to_owned()).collect();
	let columns = topic_columns(&topic_ids, &links);
	let topics: Vec<Json> = resolved
		.iter()
		.zip(&topic_ids)
		.map(|(t, id)| {
			let answers = topic_answers.get(id.as_str()).map_or(&[][..], Vec::as_slice);
			let tally = Tally::of(answers.iter().copied());
			let mut o = Obj::new();
			o.insert("id", t["id"].clone());
			o.insert("name", t["name"].clone());
			o.insert("members", t["members"].clone());
			if t["ungrouped"].truthy() {
				o.insert("ungrouped", true);
			}
			if let Some(material) = t.get("material") {
				o.insert("material", material.clone());
			}
			tally.insert_into(&mut o);
			o.insert("status", topic_status(tally.rate).as_str());
			o.insert("color", ramp_color(tally.rate));
			o.insert("overconfident", is_overconfident(answers));
			o.insert("answers", answers.iter().map(|a| answer_ref(a)).collect::<Json>());
			o.insert("column", columns.get(id).copied().unwrap_or(0));
			Json::Obj(o)
		})
		.collect();

	let fact_rows: Vec<Json> = facts
		.iter()
		.map(|f| {
			let id = f["id"].as_str().unwrap_or("");
			let mut o = Obj::new();
			o.insert("id", f["id"].clone());
			o.insert("name", f["name"].clone());
			o.insert("statement", f["statement"].clone());
			if let Some(topic) = topic_of_fact.get(id) {
				o.insert("topicId", topic.as_str());
			}
			o.insert("born", birth_session_of(f));
			o.insert("inLessons", items(&f["provenance"]).iter().any(from_lesson));
			o.insert("answers", fact_answers.get(id).map_or(Json::Arr(vec![]), |a| a.iter().map(|x| answer_ref(x)).collect()));
			Json::Obj(o)
		})
		.collect();

	let files = file_coverage(items(&input["files"]), facts);

	let mut lesson_rows: Vec<Json> = lessons
		.iter()
		.map(|l| {
			let answers = by_lesson[lesson_at[l["id"].as_str().unwrap_or("")]];
			let tally = Tally::of(answers);
			let mut o = Obj::new();
			o.insert("chatId", l["id"].clone());
			o.insert("title", l["title"].clone());
			o.insert("kind", if l["kind"].is_null() { Json::from("teach") } else { l["kind"].clone() });
			o.insert("updatedAt", l["updatedAt"].clone());
			o.insert("answers", answers.iter().map(answer_ref).collect::<Json>());
			o.insert("right", tally.right);
			o.insert("answered", tally.answered);
			o.insert("score", tally.rate);
			Json::Obj(o)
		})
		.collect();
	lesson_rows.sort_by(|a, b| locale::compare(b["updatedAt"].as_str().unwrap_or(""), a["updatedAt"].as_str().unwrap_or("")));

	// Deadlines: the topics born in the deadline's files. The "Ungrouped" bucket is never a
	// recommendation.
	let grouped: Vec<(&Json, TopicView)> = topics.iter().filter(|t| !t["ungrouped"].truthy()).map(|t| (t, TopicView::of(t))).collect();
	let born_in: HashMap<&str, Option<&str>> = facts.iter().map(|f| (f["id"].as_str().unwrap_or(""), birth_session_of(f))).collect();
	let input_files = items(&input["files"]);
	let source_of_file: HashMap<&str, &str> = input_files.iter().filter_map(|f| Some((f["id"].as_str()?, f["sourceId"].as_str()?))).collect();
	let name_of_file: HashMap<&str, &Json> = input_files.iter().filter_map(|f| Some((f["id"].as_str()?, &f["name"]))).collect();
	let today = input["today"].as_str().unwrap_or("");
	let deadline_sessions = items(&input["deadlineSessions"]);
	let homework_sessions = items(&input["homeworkSessions"]);

	let mut sorted_deadlines: Vec<&Json> = items(&input["deadlines"]).iter().collect();
	sorted_deadlines.sort_by(|a, b| compare_deadlines(a, b));
	let deadlines: Vec<Json> = sorted_deadlines
		.into_iter()
		.map(|d| {
			let file_ids: Vec<&Json> = items(&d["fileIds"]).iter().collect();
			let sources: HashSet<&str> = file_ids.iter().filter_map(|id| id.as_str().and_then(|id| source_of_file.get(id).copied())).filter(|s| !s.is_empty()).collect();
			let covered: Vec<&(&Json, TopicView)> = grouped
				.iter()
				.filter(|(t, _)| items(&t["members"]).iter().any(|m| sources.contains(m.as_str().and_then(|id| born_in.get(id).copied().flatten()).unwrap_or(""))))
				.collect();
			let views: Vec<&TopicView> = covered.iter().map(|(_, v)| v).collect();
			let mut weakest = views.clone();
			weakest.sort_by(|a, b| a.rate.unwrap_or(0.0).partial_cmp(&b.rate.unwrap_or(0.0)).unwrap_or(Ordering::Equal).then_with(|| locale::compare(&a.name, &b.name)));
			let deadline_id = d["id"].as_str().unwrap_or("");
			let rates = views.iter().map(|t| t.rate.unwrap_or(0.0)).fold(0.0, |sum, r| sum + r);

			let mut o = Obj::new();
			o.insert("id", d["id"].clone());
			o.insert("kind", d["kind"].clone());
			o.insert("name", d["name"].clone());
			o.insert("date", d["date"].clone());
			if let Some(time) = d.get("time") {
				o.insert("time", time.clone());
			}
			o.insert("done", d["done"].clone());
			o.insert("daysUntil", days_between(today, d["date"].as_str().unwrap_or("")));
			o.insert(
				"files",
				file_ids
					.iter()
					.map(|id| {
						let name = id.as_str().and_then(|i| name_of_file.get(i)).filter(|n| !n.is_null()).map_or_else(|| (*id).clone(), |n| (*n).clone());
						let mut f = Obj::new();
						f.insert("id", (*id).clone());
						f.insert("name", name);
						Json::Obj(f)
					})
					.collect::<Json>(),
			);
			o.insert("topicIds", covered.iter().map(|(t, _)| t["id"].clone()).collect::<Json>());
			o.insert("counts", status_counts(views.iter().map(|v| &v.status)));
			o.insert("workOnNext", work_on_next(&views, &links));
			o.insert("ready", (!views.is_empty()).then(|| rates / views.len() as f64));
			o.insert("topics", weakest.iter().map(|t| gs_json::json!({ "id": t.id, "name": t.name, "rate": t.rate })).collect::<Json>());
			if let Some(next) = continue_study_for(deadline_id, deadline_sessions) {
				o.insert("continueStudy", next);
			}
			if ended_today_for(deadline_id, deadline_sessions, today) {
				o.insert("studyEndedToday", true);
			}
			if let Some(done) = problems_done(&d["problems"]) {
				o.insert("problems", done);
			}
			if let Some(chat) = latest_homework(deadline_id, homework_sessions) {
				o.insert("continueHomework", chat);
			}
			Json::Obj(o)
		})
		.collect();

	let grouped_views: Vec<&TopicView> = grouped.iter().map(|(_, v)| v).collect();
	let mut overall = Obj::new();
	overall.insert("topicIds", grouped.iter().map(|(t, _)| t["id"].clone()).collect::<Json>());
	overall.insert("counts", status_counts(grouped_views.iter().map(|v| &v.status)));
	overall.insert("workOnNext", work_on_next(&grouped_views, &links));

	let mut out = Obj::new();
	out.insert("spaceId", input["spaceId"].clone());
	out.insert("today", input["today"].clone());
	out.insert("topicsAt", input["topics"]["at"].clone());
	out.insert("grouping", input["grouping"].as_bool() == Some(true));
	out.insert("topics", topics);
	out.insert("topicLinks", links.iter().map(super::topic_links::TopicLink::to_json).collect::<Json>());
	out.insert("facts", fact_rows);
	let next_up = next_up_file(&files).cloned();
	out.insert("files", files);
	out.insert("nextUp", next_up);
	out.insert("lessons", lesson_rows);
	out.insert("calibration", calibration(&all_answers, |id| titles.get(id).and_then(|t| t.as_str()).unwrap_or(id).to_owned()));
	out.insert("deadlines", deadlines);
	out.insert("overall", Json::Obj(overall));
	out.insert("totals", Tally::of(all_answers.iter().copied()).to_json());
	Json::Obj(out)
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn a_graded_mock_question_counts_for_its_facts_topic_but_is_no_lesson() {
		let input = json!({
			"spaceId": "spc_a", "today": "2026-11-13",
			"facts": [{ "id": "f_a", "name": "Token bucket", "statement": "A token bucket refills at a fixed rate.", "provenance": [] }],
			"chains": [], "topics": { "topics": [{ "id": "t_limits", "name": "Rate limiting", "members": ["f_a"] }] },
			"files": [], "deadlines": [], "lessons": [],
			"mockAnswers": [{ "chatId": "mock_0a1b2c3d", "toolCallId": "q1", "tool": "mock", "factIds": ["f_a"], "outcome": "right", "answeredAt": "2026-11-12T10:00:00.000Z" }],
		});
		let progress = derive_progress(&input);
		assert_eq!((progress["topics"][0]["answered"].clone(), progress["topics"][0]["right"].clone()), (json!(1), json!(1)));
		assert_eq!(progress["facts"][0]["answers"].as_arr().unwrap().len(), 1);
		assert_eq!(progress["lessons"], json!([]));
	}
}
