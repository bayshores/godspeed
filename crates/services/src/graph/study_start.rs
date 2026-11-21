//! What a Study start picks: the topics, facts and note for a session on space topics, a deadline
//! or a path topic, built from the Progress read.

use std::collections::{HashMap, HashSet};

use gs_core::graph::graph::get_graph;
use gs_core::spaces::space_path::path_lesson_note;
use gs_core::study::review::reviewable_topics;
use gs_core::study::study::{MAX_STUDY_FACTS, NEAREST_FACTS, deadline_study_topic_ids, fact_space_order, nearest_topics, study_topics, topic_study};
use gs_json::{Json, Obj, json};

use super::graph::graph_store_for;
use super::progress::{progress_for, progress_files, space_lessons, space_reviews, studied_on};
use crate::App;

/// A study session's topics from its picked facts: grouped by space topic, in space order.
pub fn study_topics_for(app: &App, scope: Option<&str>, fact_ids: &[String]) -> Result<Vec<Json>, String> {
	let progress = if fact_ids.is_empty() { None } else { progress_for(app, scope, None)? };
	let record = scope.and_then(|id| app.stores.spaces.get_space(id));
	let space_order = progress.as_ref().map_or_else(HashMap::new, |p| fact_space_order(p["facts"].items(), &progress_files(record.as_ref())));
	let topics = progress.as_ref().map_or(&[][..], |p| p["topics"].items());
	Ok(study_topics(fact_ids, topics, &space_order))
}

/// The space topics nearest a typed goal, with where the learner stands on each: the topics of
/// the facts the graph search finds for it. Empty when the space has no facts for it.
pub async fn nearest_topics_for(app: &App, space_id: &str, goal: &str) -> Result<Vec<Json>, String> {
	let graph = get_graph(graph_store_for(app, Some(space_id)).as_ref())?;
	let hits = match app.search.search_facts(Some(space_id), &graph.nodes, goal, NEAREST_FACTS).await {
		Ok(hits) => hits,
		// A lesson still starts when the search cannot run (its model is missing); the teacher's
		// own search_graph then shows it the same error.
		Err(err) => {
			eprintln!("[lesson start] finding the topics nearest \"{goal}\" failed: {err}");
			return Ok(Vec::new());
		}
	};
	if hits.is_empty() {
		return Ok(Vec::new());
	}
	Ok(progress_for(app, space_id, None)?.map_or_else(Vec::new, |progress| nearest_topics(&hits, progress["topics"].items())))
}

/// A study session on space topics: its topics and their facts as the graph-context picks.
pub struct TopicStudy {
	pub topics: Vec<Json>,
	pub picks: Vec<Json>,
}

fn topic_study_in(app: &App, scope: Option<&str>, progress: &Json, topic_ids: &[String], studied_today: Option<&HashSet<String>>) -> TopicStudy {
	let record = scope.and_then(|id| app.stores.spaces.get_space(id));
	let facts = progress["facts"].items();
	let space_order = fact_space_order(facts, &progress_files(record.as_ref()));
	let topics = topic_study(topic_ids, progress["topics"].items(), facts, &space_order, studied_today);
	let fact_by_id: HashMap<&str, &Json> = facts.iter().map(|f| (f["id"].str_or_empty(), f)).collect();
	let picks = topics
		.iter()
		.flat_map(|t| t["factIds"].items().iter())
		.filter_map(|id| fact_by_id.get(id.str_or_empty()).map(|f| json!({ "id": id, "name": f["name"], "statement": f["statement"] })))
		.collect();
	TopicStudy { topics, picks }
}

/// A Study start on some of the space's topics.
pub fn topic_study_for(app: &App, scope: Option<&str>, topic_ids: &[String]) -> Result<TopicStudy, String> {
	Ok(match progress_for(app, scope, None)? {
		Some(progress) => topic_study_in(app, scope, &progress, topic_ids, None),
		None => TopicStudy { topics: Vec::new(), picks: Vec::new() },
	})
}

/// A Study start on a deadline: today's topics of its plan, the ones that need work first, strong
/// ones due a check last.
pub struct DeadlineStudy {
	pub name: String,
	pub topics: Vec<Json>,
	pub picks: Vec<Json>,
}

/// A deadline's progress row.
fn deadline_row<'a>(progress: &'a Json, deadline_id: &str) -> Option<&'a Json> {
	progress["deadlines"].items().iter().find(|d| d["id"].as_str() == Some(deadline_id))
}

/// None when the space has no such deadline.
pub fn deadline_study_for(app: &App, space_id: &str, deadline_id: &str) -> Result<Option<DeadlineStudy>, String> {
	let Some(progress) = progress_for(app, space_id, None)? else { return Ok(None) };
	let Some(deadline) = deadline_row(&progress, deadline_id) else { return Ok(None) };
	let today = progress["today"].str_or_empty();
	let studied = studied_on(app, space_id, today);
	let reviews = space_reviews(app, space_id);
	let reviewed = reviewable_topics(&reviews.answers, &reviews.items);
	let topic_ids = deadline_study_topic_ids(today, deadline, progress["topics"].items(), &reviewed);
	let study = topic_study_in(app, Some(space_id), &progress, &topic_ids, Some(&studied));
	Ok(Some(DeadlineStudy { name: deadline["name"].str_or_empty().to_owned(), topics: study.topics, picks: study.picks }))
}

/// The progress topics a deadline covers (empty when the space or deadline is gone).
pub fn deadline_topics_for(app: &App, space_id: &str, deadline_id: &str) -> Result<Vec<Json>, String> {
	let Some(progress) = progress_for(app, space_id, None)? else { return Ok(Vec::new()) };
	let Some(deadline) = deadline_row(&progress, deadline_id) else { return Ok(Vec::new()) };
	let covered: HashSet<&str> = deadline["topicIds"].items().iter().filter_map(Json::as_str).collect();
	Ok(progress["topics"].items().iter().filter(|t| covered.contains(t["id"].str_or_empty())).cloned().collect())
}

/// A space's path with where the learner stands on each topic and the topic Study takes next
/// (the Progress payload's `path`); None when the space has no path.
pub fn path_for(app: &App, space_id: &str) -> Result<Option<Json>, String> {
	if app.stores.spaces.get_space(space_id).is_none_or(|r| r.get("path").is_none()) {
		return Ok(None);
	}
	Ok(progress_for(app, space_id, None)?.and_then(|p| p.get("path").cloned()))
}

/// A Study start on one path topic: the topic as a study topic (its standing from the answers
/// given on it), the facts born in earlier lessons on it as picks, and the note on its place.
pub struct PathStudy {
	pub topic: Json,
	pub picks: Vec<Json>,
	pub note: String,
}

/// None when the space's path has no such topic.
pub fn path_study_for(app: &App, space_id: &str, topic_id: &str) -> Result<Option<PathStudy>, String> {
	let Some(path) = path_for(app, space_id)? else { return Ok(None) };
	let topics = path["topics"].items();
	let Some(at) = topics.iter().position(|t| t["id"].as_str() == Some(topic_id)) else { return Ok(None) };
	let t = &topics[at];
	let lessons: HashSet<String> = space_lessons(app, space_id)
		.iter()
		.filter_map(|c| app.stores.chats.get_chat(c["id"].str_or_empty()))
		.filter(|c| c["tree"]["nodes"].items().iter().any(|n| n["id"].as_str() == Some(topic_id)))
		.filter_map(|c| c["id"].as_str().map(str::to_owned))
		.collect();
	let graph = get_graph(graph_store_for(app, Some(space_id)).as_ref())?;
	let picks: Vec<Json> = graph
		.nodes
		.iter()
		.filter(|f| f["provenance"].items().iter().any(|p| p["chatId"].as_str().is_some_and(|c| lessons.contains(c))))
		.take(MAX_STUDY_FACTS)
		.map(|f| json!({ "id": f["id"], "name": f["name"], "statement": f["statement"] }))
		.collect();
	let mut topic = Obj::new();
	for key in ["id", "name", "status"] {
		topic.insert(key, t[key].clone());
	}
	topic.insert("factIds", picks.iter().map(|p| p["id"].clone()).collect::<Json>());
	let note = path_lesson_note(path["goal"].str_or_empty(), at + 1, topics.len(), t["covers"].str_or_empty());
	Ok(Some(PathStudy { topic: Json::Obj(topic), picks, note }))
}

#[cfg(test)]
mod tests {
	use gs_base::clock;
	use gs_core::spaces::today_note::local_day;

	use super::super::progress::tests::{hinted, hinted_at};
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	/// A made-up space with five topics, one fact each, and an exam due in `days`; its id and the
	/// deadline's.
	fn ml_space(app: &App, days: i64) -> (String, String) {
		use gs_store::graph::Ledger;
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Machine Learning Foundations" })).unwrap()["id"].str_or_empty().to_owned();
		let file = json!({ "id": "f_lec", "origin": "copied", "name": "Lectures.pdf", "path": "f_lec/Lectures.pdf", "kind": "study", "contentFp": "", "status": "ready", "addedAt": "t" });
		app.stores.spaces.rewrite_space(&space_id, |r| {
			let mut next = r.clone();
			next.as_obj_mut().unwrap().insert("files", json!([file]));
			next
		}).unwrap();
		let source = crate::spaces::source_id_for(&space_id, "f_lec");
		let names = [("cv", "Cross-validation"), ("gd", "Gradient descent"), ("ms", "Model selection"), ("of", "Overfitting"), ("rg", "Regularization")];
		let scope = Some(space_id.as_str());
		for (id, name) in names {
			let fact = json!({ "id": format!("n_{id}"), "name": name, "statement": format!("{name} matters."), "aliases": [], "createdAt": "t", "provenance": [{ "chatId": source, "messageId": "" }] });
			app.stores.graphs.append(scope, Ledger::Nodes, &fact).unwrap();
		}
		let topics: Vec<Json> = names.iter().map(|(id, name)| json!({ "id": format!("tpc_{id}"), "name": name, "members": [format!("n_{id}")] })).collect();
		app.stores.graphs.append(scope, Ledger::Topics, &json!({ "at": "t", "topics": topics })).unwrap();
		let due = local_day(clock::now_ms() + days * 86_400_000);
		let deadline_id = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "Midterm", "kind": "exam", "date": due, "fileIds": ["f_lec"] })).unwrap()["id"].str_or_empty().to_owned();
		(space_id, deadline_id)
	}

	/// A Study session on the deadline whose messages are `messages`.
	fn study_session(app: &App, space_id: &str, deadline_id: &str, nodes: &[&str], messages: &[Json]) {
		let chat_id = app.stores.chats.create_chat("Study", Some("study"), Some(space_id), Some(deadline_id), &[]).unwrap()["id"].str_or_empty().to_owned();
		let tree_nodes: Vec<Json> = nodes.iter().map(|id| json!({ "id": id, "title": id })).collect();
		app.stores.chats.save_tree(&chat_id, &json!({ "nodes": tree_nodes, "edges": [] })).unwrap();
		app.stores.chats.save_messages(&chat_id, messages).unwrap();
	}

	fn planned(app: &App, space_id: &str, deadline_id: &str) -> Vec<String> {
		deadline_study_for(app, space_id, deadline_id).unwrap().unwrap().topics.iter().map(|t| t["id"].str_or_empty().to_owned()).collect()
	}

	#[test]
	fn topics_finished_in_todays_study_session_are_not_planned_again_today_or_untested() {
		let root = scratch_dir("progress-finished-today");
		let app = test_app(&root);
		let (space_id, deadline_id) = ml_space(&app, 3);
		assert_eq!(planned(&app, &space_id, &deadline_id), ["tpc_cv", "tpc_gd"], "today's two topics");

		study_session(&app, &space_id, &deadline_id, &["tpc_cv", "tpc_gd"], &[hinted("1", "tpc_cv", "n_cv"), hinted("2", "tpc_gd", "n_gd")].concat());

		let progress = progress_for(&app, space_id.as_str(), None).unwrap().unwrap();
		let status = |id: &str| progress["topics"].items().iter().find(|t| t["id"].as_str() == Some(id)).unwrap()["status"].clone();
		assert_eq!((status("tpc_cv"), status("tpc_gd")), (json!("shaky"), json!("shaky")), "solved with hints: shaky, not untested");
		assert_eq!(planned(&app, &space_id, &deadline_id), ["tpc_ms", "tpc_of"], "Study again moves on to the next untested topics");
	}

	#[test]
	fn with_every_topic_left_finished_today_today_plans_nothing_and_study_still_starts() {
		let root = scratch_dir("progress-all-finished-today");
		let app = test_app(&root);
		let (space_id, deadline_id) = ml_space(&app, 1);
		let all = ["tpc_cv", "tpc_gd", "tpc_ms", "tpc_of", "tpc_rg"];
		let finish = |ids: &[&str]| -> Vec<Json> { ids.iter().flat_map(|id| hinted(id, id, &id.replace("tpc_", "n_"))).collect() };
		study_session(&app, &space_id, &deadline_id, &all[..4], &finish(&all[..4]));
		// A stop from yesterday finishes nothing today.
		study_session(&app, &space_id, &deadline_id, &all[4..], &hinted_at("y", "tpc_rg", "n_rg", clock::now_ms() - 86_400_000));
		let today_plan = |app: &App| {
			let progress = progress_for(app, space_id.as_str(), None).unwrap().unwrap();
			let deadline = progress["deadlines"].items()[0].clone();
			let plan = gs_core::study::deadline_plan::plan_days(progress["today"].str_or_empty(), deadline["date"].str_or_empty(), deadline["topics"].items());
			let flagged: Vec<String> = deadline["topics"].items().iter().filter(|t| t.get("finishedToday").is_some()).map(|t| t["id"].str_or_empty().to_owned()).collect();
			(plan, flagged, deadline)
		};
		let (plan, flagged, _) = today_plan(&app);
		assert_eq!(flagged.len(), 4, "absent on the topic finished yesterday: {flagged:?}");
		assert_eq!(plan.len(), 1, "due tomorrow: today is the only day");
		assert_eq!(plan[0]["topics"].items().iter().map(|t| t["id"].str_or_empty()).collect::<Vec<_>>(), ["tpc_rg"]);

		study_session(&app, &space_id, &deadline_id, &all[4..], &finish(&all[4..]));
		let (plan, flagged, deadline) = today_plan(&app);
		assert_eq!(flagged.len(), 5);
		assert_eq!(deadline["counts"]["shaky"], json!(5), "the topics still count");
		assert!(deadline["ready"].as_f64().is_some_and(|r| (r - 0.6).abs() < 1e-9), "readiness keeps them: {:?}", deadline["ready"]);
		assert_eq!(plan.len(), 1);
		assert!(plan[0]["topics"].items().is_empty(), "nothing left for today");
		let mut again = planned(&app, &space_id, &deadline_id);
		again.sort();
		assert_eq!(again, all, "Study from the deadline page still takes its topics");
	}
}
