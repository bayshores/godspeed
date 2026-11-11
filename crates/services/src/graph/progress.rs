//! Progress (server/progress.ts): reads one class scope's graph, topics, files, deadlines and
//! lessons and hands them to the pure derivation (gs_core study). A study session's topics, and
//! which ones a Study start picks, come from the same read. Nothing is written.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use gs_base::{clock, time};
use gs_core::classes::today_note::local_day;
use gs_core::graph::graph::get_graph;
use gs_core::session::plan_step_bar::plan_position_lh;
use gs_core::session::practice_outcomes::practice_outcomes;
use gs_core::study::progress::{collect_answers, derive_progress, facts_by_message, facts_for_answer};
use gs_core::study::study::{deadline_study_topic_ids, fact_class_order, study_topics, topic_study};
use gs_json::{Json, Obj, json};
use parking_lot::Mutex;

use super::graph::graph_store_for;
use super::topics::topic_grouping_running;
use crate::App;
use crate::classes::source_id_for;

/// A lesson's graded answers, practice outcomes and (a Study session started from a deadline)
/// its step bar's count. Progress is read again after every background update, and parsing every
/// lesson each time grows with the term, so each is kept while its record file is unchanged.
struct Readout {
	version: String,
	answers: Vec<Json>,
	outcomes: Vec<Json>,
	steps: Option<Json>,
}

#[derive(Default)]
pub struct Readouts(Mutex<HashMap<String, Arc<Readout>>>);

fn lesson_readout(app: &App, chat_id: &str) -> Option<Arc<Readout>> {
	let version = app.stores.chats.chat_version(chat_id)?;
	if let Some(hit) = app.graph.readouts.0.lock().get(chat_id).filter(|hit| hit.version == version) {
		return Some(hit.clone());
	}
	let record = app.stores.chats.get_chat(chat_id)?;
	let messages = items(&record["messages"]);
	let steps = (record["deadlineId"].truthy() && record["tree"].truthy()).then(|| plan_position_lh(&record["tree"], messages));
	let readout = Arc::new(Readout { version, answers: collect_answers(chat_id, messages), outcomes: practice_outcomes(messages), steps });
	app.graph.readouts.0.lock().insert(chat_id.to_owned(), readout.clone());
	Some(readout)
}

fn items(v: &Json) -> &[Json] {
	v.as_arr().map_or(&[], Vec::as_slice)
}

fn str_of(v: &Json) -> &str {
	v.as_str().unwrap_or("")
}

/// The lessons of one class (`classId` equal to `class_id`).
fn class_lessons(app: &App, class_id: &str) -> Vec<Json> {
	app.stores.chats.list_chats().into_iter().filter(|c| c["classId"].as_str() == Some(class_id)).collect()
}

/// The class's problems (practice and study) the learner solved only with hints.
pub fn hinted_problems(app: &App, class_id: &str) -> Vec<Json> {
	class_lessons(app, class_id)
		.iter()
		.filter_map(|c| lesson_readout(app, str_of(&c["id"])))
		.flat_map(|readout| readout.outcomes.clone())
		.filter(|o| o["outcome"].as_str() == Some("solvedWithHints"))
		.map(|o| json!({ "statement": o["statement"], "at": o["at"] }))
		.collect()
}

/// The class's mistakes: answers given wrong and problems solved only with hints, each with the
/// topics its facts are in (the cheat sheet's Watch out block).
pub fn class_mistakes(app: &App, class_id: &str, progress: &Json) -> Result<Vec<Json>, String> {
	let index = facts_by_message(&get_graph(graph_store_for(app, Some(class_id)).as_ref())?.nodes);
	let topic_of: HashMap<&str, &Json> = items(&progress["facts"]).iter().map(|f| (str_of(&f["id"]), &f["topicId"])).collect();
	let topics_of = |fact_ids: &[String]| -> Vec<Json> {
		let mut seen = HashSet::new();
		fact_ids.iter().filter_map(|id| topic_of.get(id.as_str()).and_then(|t| t.as_str())).filter(|t| !t.is_empty() && seen.insert(*t)).map(Json::from).collect()
	};
	let mut out = Vec::new();
	for c in class_lessons(app, class_id) {
		let Some(readout) = lesson_readout(app, str_of(&c["id"])) else { continue };
		for a in readout.answers.iter().filter(|a| a["outcome"].as_str() == Some("wrong")) {
			out.push(json!({ "text": a["question"], "kind": "wrong", "at": a["answeredAt"], "topicIds": topics_of(&facts_for_answer(a, &index)) }));
		}
		for o in readout.outcomes.iter().filter(|o| o["outcome"].as_str() == Some("solvedWithHints")) {
			let targets: Vec<String> = items(&o["targets"]).iter().map(|t| str_of(t).to_owned()).collect();
			out.push(json!({ "text": o["statement"], "kind": "hint", "at": o["at"], "topicIds": topics_of(&targets) }));
		}
	}
	Ok(out)
}

/// The class's files with the source id their facts are born under.
fn progress_files(record: Option<&Json>) -> Vec<Json> {
	let Some(record) = record else { return Vec::new() };
	let class_id = str_of(&record["id"]);
	items(&record["files"])
		.iter()
		.map(|f| {
			let source_id = f["sourceId"].as_str().map_or_else(|| source_id_for(class_id, str_of(&f["id"])), str::to_owned);
			json!({ "id": f["id"], "name": f["name"], "kind": f["kind"], "sourceId": source_id })
		})
		.collect()
}

/// Each fact's place in the class's order.
pub fn class_order_for(app: &App, class_id: &str, progress: &Json) -> HashMap<String, usize> {
	let record = app.stores.classes.get_class(class_id);
	fact_class_order(items(&progress["facts"]), &progress_files(record.as_ref()))
}

/// Copies the keys the summary has (an absent key stays absent, as `undefined` does in JSON).
fn picked(from: &Json, keys: &[&str]) -> Obj {
	let mut out = Obj::new();
	for key in keys {
		if let Some(v) = from.get(key) {
			out.insert(*key, v.clone());
		}
	}
	out
}

/// Everything the Overview and the Graph page show for one scope (`today`: the browser's day,
/// else this computer's). None when the class does not exist; Err when its graph cannot be read.
pub fn progress_for<'a>(app: &App, scope: impl Into<Option<&'a str>>, today: Option<&str>) -> Result<Option<Json>, String> {
	let scope = scope.into();
	let record = scope.and_then(|id| app.stores.classes.get_class(id));
	if scope.is_some() && record.is_none() {
		return Ok(None);
	}
	let graph = get_graph(graph_store_for(app, scope).as_ref())?;
	let chats = app.stores.chats.list_chats();
	let known: HashSet<&str> = chats.iter().map(|c| str_of(&c["id"])).collect();
	app.graph.readouts.0.lock().retain(|id, _| known.contains(id.as_str()));
	let (mut lessons, mut deadline_sessions, mut homework_sessions) = (Vec::new(), Vec::new(), Vec::new());
	for c in &chats {
		if c["classId"].as_str() != scope {
			continue;
		}
		if c["kind"].as_str() == Some("homework") && c["deadlineId"].truthy() {
			homework_sessions.push(json!({ "chatId": c["id"], "deadlineId": c["deadlineId"], "createdAt": c["createdAt"] }));
		}
		let Some(readout) = lesson_readout(app, str_of(&c["id"])) else { continue };
		let mut lesson = picked(c, &["id", "title", "kind", "updatedAt"]);
		lesson.insert("answers", readout.answers.clone());
		lessons.push(Json::Obj(lesson));
		if let (true, Some(steps)) = (c["deadlineId"].truthy(), &readout.steps) {
			let mut session = Obj::new();
			session.insert("chatId", c["id"].clone());
			session.insert("deadlineId", c["deadlineId"].clone());
			if let Some(created) = c.get("createdAt") {
				session.insert("createdAt", created.clone());
			}
			session.insert("done", steps["done"].clone());
			session.insert("total", steps["total"].clone());
			deadline_sessions.push(Json::Obj(session));
		}
	}
	let today = today.map_or_else(|| local_day(clock::now_ms()), str::to_owned);
	let topics = app.stores.graphs.read_topics(scope)?.unwrap_or(Json::Null);
	let input = json!({
		"classId": scope,
		"today": today,
		"facts": graph.nodes,
		"chains": graph.chains,
		"topics": topics,
		"files": progress_files(record.as_ref()),
		"deadlines": record.as_ref().map_or_else(|| json!([]), |r| r["deadlines"].as_arr().map_or_else(|| json!([]), |d| Json::Arr(d.clone()))),
		"lessons": lessons,
		"deadlineSessions": deadline_sessions,
		"homeworkSessions": homework_sessions,
		"grouping": scope.is_some_and(|id| topic_grouping_running(app, id)),
	});
	Ok(Some(derive_progress(&input)))
}

/// A study session's topics from its picked facts: grouped by class topic, in class order.
pub fn study_topics_for(app: &App, scope: Option<&str>, fact_ids: &[String], free_topic: &str) -> Result<Vec<Json>, String> {
	let progress = if fact_ids.is_empty() { None } else { progress_for(app, scope, None)? };
	let record = scope.and_then(|id| app.stores.classes.get_class(id));
	let class_order = progress.as_ref().map_or_else(HashMap::new, |p| fact_class_order(items(&p["facts"]), &progress_files(record.as_ref())));
	let topics = progress.as_ref().map_or(&[][..], |p| items(&p["topics"]));
	Ok(study_topics(fact_ids, topics, &class_order, free_topic))
}

/// A study session on class topics: its topics and their facts as the graph-context picks.
pub struct TopicStudy {
	pub topics: Vec<Json>,
	pub picks: Vec<Json>,
}

fn topic_study_in(app: &App, scope: Option<&str>, progress: &Json, topic_ids: &[String], studied_today: Option<&HashSet<String>>) -> TopicStudy {
	let record = scope.and_then(|id| app.stores.classes.get_class(id));
	let facts = items(&progress["facts"]);
	let class_order = fact_class_order(facts, &progress_files(record.as_ref()));
	let topics = topic_study(topic_ids, items(&progress["topics"]), facts, &class_order, studied_today);
	let fact_by_id: HashMap<&str, &Json> = facts.iter().map(|f| (str_of(&f["id"]), f)).collect();
	let picks = topics
		.iter()
		.flat_map(|t| items(&t["factIds"]).iter())
		.filter_map(|id| fact_by_id.get(str_of(id)).map(|f| json!({ "id": id, "name": f["name"], "statement": f["statement"] })))
		.collect();
	TopicStudy { topics, picks }
}

/// A Study start on some of the class's topics.
pub fn topic_study_for(app: &App, scope: Option<&str>, topic_ids: &[String]) -> Result<TopicStudy, String> {
	Ok(match progress_for(app, scope, None)? {
		Some(progress) => topic_study_in(app, scope, &progress, topic_ids, None),
		None => TopicStudy { topics: Vec::new(), picks: Vec::new() },
	})
}

/// A Study start on a deadline: today's topics of its plan, the ones that need work first.
pub struct DeadlineStudy {
	pub name: String,
	pub topics: Vec<Json>,
	pub picks: Vec<Json>,
}

/// None when the class has no such deadline.
pub fn deadline_study_for(app: &App, class_id: &str, deadline_id: &str) -> Result<Option<DeadlineStudy>, String> {
	let Some(progress) = progress_for(app, class_id, None)? else { return Ok(None) };
	let Some(deadline) = items(&progress["deadlines"]).iter().find(|d| d["id"].as_str() == Some(deadline_id)) else { return Ok(None) };
	let today = str_of(&progress["today"]);
	let studied = studied_on(app, class_id, today);
	let topic_ids = deadline_study_topic_ids(today, str_of(&deadline["date"]), items(&deadline["topics"]));
	let study = topic_study_in(app, Some(class_id), &progress, &topic_ids, Some(&studied));
	Ok(Some(DeadlineStudy { name: str_of(&deadline["name"]).to_owned(), topics: study.topics, picks: study.picks }))
}

/// The plan nodes of the class's study sessions created on `day` (the learner's local day).
fn studied_on(app: &App, class_id: &str, day: &str) -> HashSet<String> {
	let mut ids = HashSet::new();
	for c in app.stores.chats.list_chats() {
		let created_day = time::parse_date(str_of(&c["createdAt"])).map(local_day);
		if c["kind"].as_str() != Some("study") || c["classId"].as_str() != Some(class_id) || created_day.as_deref() != Some(day) {
			continue;
		}
		let record = app.stores.chats.get_chat(str_of(&c["id"]));
		for node in record.iter().flat_map(|r| items(&r["tree"]["nodes"])) {
			ids.insert(str_of(&node["id"]).to_owned());
		}
	}
	ids
}
