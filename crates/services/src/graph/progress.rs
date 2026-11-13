//! Progress (server/progress.ts): reads one space scope's graph, topics, files, deadlines and
//! lessons and hands them to the pure derivation (gs_core study). A study session's topics, and
//! which ones a Study start picks, come from the same read. Nothing is written.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use gs_base::{clock, time};
use gs_core::spaces::today_note::local_day;
use gs_core::graph::graph::get_graph;
use gs_core::session::plan_step_bar::{current_step_title, plan_position_lh};
use gs_core::session::practice_outcomes::practice_outcomes;
use gs_core::study::progress::{collect_answers, derive_progress, facts_by_message, facts_for_answer};
use gs_core::study::study::{deadline_study_topic_ids, fact_space_order, study_topics, topic_study};
use gs_core::study::topic_end::lesson_stop;
use gs_json::{Json, Obj, json};
use parking_lot::Mutex;

use super::graph::graph_store_for;
use super::topics::topic_grouping_running;
use crate::App;
use crate::spaces::source_id_for;

/// A lesson's graded answers, practice outcomes and (a Study session started from a deadline)
/// where the session stands. Progress is read again after every background update, and parsing
/// every lesson each time grows with the term, so each is kept while its record file is unchanged.
struct Readout {
	version: String,
	answers: Vec<Json>,
	outcomes: Vec<Json>,
	session: Option<Obj>,
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
	let session = (record["deadlineId"].truthy() && record["tree"].truthy()).then(|| deadline_session(&record["tree"], messages));
	let readout = Arc::new(Readout { version, answers: collect_answers(chat_id, messages), outcomes: practice_outcomes(messages), session });
	app.graph.readouts.0.lock().insert(chat_id.to_owned(), readout.clone());
	Some(readout)
}

/// Where a Study session started from a deadline stands: its step bar's count (`done`, `total`),
/// the stop it waits at until he keeps going (`stop`: `{at, next}`), when it reached its end
/// (`endedAt`), and otherwise the topic it is in the middle of (`inTopic`, the current step's
/// title).
fn deadline_session(tree: &Json, messages: &[Json]) -> Obj {
	let mut out = picked(&plan_position_lh(tree, messages), &["done", "total"]);
	let (key, value) = match lesson_stop(messages, Some(tree), None) {
		Some(stop) if stop["kind"].as_str() == Some("end") => ("endedAt", Some(stop["at"].clone())),
		Some(stop) if !stop["keptGoing"].truthy() => ("stop", Some(json!({ "at": stop["at"], "next": stop["next"] }))),
		_ => ("inTopic", current_step_title(tree, messages)),
	};
	if let Some(value) = value {
		out.insert(key, value);
	}
	out
}

fn items(v: &Json) -> &[Json] {
	v.as_arr().map_or(&[], Vec::as_slice)
}

/// The lessons of one space (`spaceId` equal to `space_id`).
fn space_lessons(app: &App, space_id: &str) -> Vec<Json> {
	app.stores.chats.list_chats().into_iter().filter(|c| c["spaceId"].as_str() == Some(space_id)).collect()
}

/// Every graded answer in the space's lessons.
pub fn space_answers(app: &App, space_id: &str) -> Vec<Json> {
	space_lessons(app, space_id).iter().filter_map(|c| lesson_readout(app, c["id"].str_or_empty())).flat_map(|readout| readout.answers.clone()).collect()
}

/// The space's problems (practice and study) the learner solved only with hints.
pub fn hinted_problems(app: &App, space_id: &str) -> Vec<Json> {
	space_lessons(app, space_id)
		.iter()
		.filter_map(|c| lesson_readout(app, c["id"].str_or_empty()))
		.flat_map(|readout| readout.outcomes.clone())
		.filter(|o| o["outcome"].as_str() == Some("solvedWithHints"))
		.map(|o| json!({ "statement": o["statement"], "at": o["at"] }))
		.collect()
}

/// The space's mistakes: answers given wrong and problems solved only with hints, each with the
/// topics its facts are in (the cheat sheet's Watch out block).
pub fn space_mistakes(app: &App, space_id: &str, progress: &Json) -> Result<Vec<Json>, String> {
	let index = facts_by_message(&get_graph(graph_store_for(app, Some(space_id)).as_ref())?.nodes);
	let topic_of: HashMap<&str, &Json> = items(&progress["facts"]).iter().map(|f| (f["id"].str_or_empty(), &f["topicId"])).collect();
	let topics_of = |fact_ids: &[String]| -> Vec<Json> {
		let mut seen = HashSet::new();
		fact_ids.iter().filter_map(|id| topic_of.get(id.as_str()).and_then(|t| t.as_str())).filter(|t| !t.is_empty() && seen.insert(*t)).map(Json::from).collect()
	};
	let mut out = Vec::new();
	for c in space_lessons(app, space_id) {
		let Some(readout) = lesson_readout(app, c["id"].str_or_empty()) else { continue };
		for a in readout.answers.iter().filter(|a| a["outcome"].as_str() == Some("wrong")) {
			out.push(json!({ "text": a["question"], "kind": "wrong", "at": a["answeredAt"], "topicIds": topics_of(&facts_for_answer(a, &index)) }));
		}
		for o in readout.outcomes.iter().filter(|o| o["outcome"].as_str() == Some("solvedWithHints")) {
			let targets: Vec<String> = items(&o["targets"]).iter().map(|t| t.str_or_empty().to_owned()).collect();
			out.push(json!({ "text": o["statement"], "kind": "hint", "at": o["at"], "topicIds": topics_of(&targets) }));
		}
	}
	Ok(out)
}

/// The space's files with the source id their facts are born under.
fn progress_files(record: Option<&Json>) -> Vec<Json> {
	let Some(record) = record else { return Vec::new() };
	let space_id = record["id"].str_or_empty();
	items(&record["files"])
		.iter()
		.map(|f| {
			let source_id = f["sourceId"].as_str().map_or_else(|| source_id_for(space_id, f["id"].str_or_empty()), str::to_owned);
			json!({ "id": f["id"], "name": f["name"], "kind": f["kind"], "sourceId": source_id })
		})
		.collect()
}

/// Each fact's place in the space's order.
pub fn space_order_for(app: &App, space_id: &str, progress: &Json) -> HashMap<String, usize> {
	let record = app.stores.spaces.get_space(space_id);
	fact_space_order(items(&progress["facts"]), &progress_files(record.as_ref()))
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
/// else this computer's). None when the space does not exist; Err when its graph cannot be read.
pub fn progress_for<'a>(app: &App, scope: impl Into<Option<&'a str>>, today: Option<&str>) -> Result<Option<Json>, String> {
	let scope = scope.into();
	let record = scope.and_then(|id| app.stores.spaces.get_space(id));
	if scope.is_some() && record.is_none() {
		return Ok(None);
	}
	let graph = get_graph(graph_store_for(app, scope).as_ref())?;
	let chats = app.stores.chats.list_chats();
	let known: HashSet<&str> = chats.iter().map(|c| c["id"].str_or_empty()).collect();
	app.graph.readouts.0.lock().retain(|id, _| known.contains(id.as_str()));
	let (mut lessons, mut deadline_sessions, mut homework_sessions) = (Vec::new(), Vec::new(), Vec::new());
	for c in &chats {
		if c["spaceId"].as_str() != scope {
			continue;
		}
		if c["kind"].as_str() == Some("homework") && c["deadlineId"].truthy() {
			homework_sessions.push(json!({ "chatId": c["id"], "deadlineId": c["deadlineId"], "createdAt": c["createdAt"] }));
		}
		let Some(readout) = lesson_readout(app, c["id"].str_or_empty()) else { continue };
		let mut lesson = picked(c, &["id", "title", "kind", "updatedAt"]);
		lesson.insert("answers", readout.answers.clone());
		lessons.push(Json::Obj(lesson));
		if let (true, Some(stands)) = (c["deadlineId"].truthy(), &readout.session) {
			let mut session = Obj::new();
			session.insert("chatId", c["id"].clone());
			session.insert("deadlineId", c["deadlineId"].clone());
			if let Some(created) = c.get("createdAt") {
				session.insert("createdAt", created.clone());
			}
			session.extend(stands.clone());
			deadline_sessions.push(Json::Obj(session));
		}
	}
	let today = today.map_or_else(|| local_day(clock::now_ms()), str::to_owned);
	let topics = app.stores.graphs.read_topics(scope)?.unwrap_or(Json::Null);
	let input = json!({
		"spaceId": scope,
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

/// A study session's topics from its picked facts: grouped by space topic, in space order.
pub fn study_topics_for(app: &App, scope: Option<&str>, fact_ids: &[String], free_topic: &str) -> Result<Vec<Json>, String> {
	let progress = if fact_ids.is_empty() { None } else { progress_for(app, scope, None)? };
	let record = scope.and_then(|id| app.stores.spaces.get_space(id));
	let space_order = progress.as_ref().map_or_else(HashMap::new, |p| fact_space_order(items(&p["facts"]), &progress_files(record.as_ref())));
	let topics = progress.as_ref().map_or(&[][..], |p| items(&p["topics"]));
	Ok(study_topics(fact_ids, topics, &space_order, free_topic))
}

/// A study session on space topics: its topics and their facts as the graph-context picks.
pub struct TopicStudy {
	pub topics: Vec<Json>,
	pub picks: Vec<Json>,
}

fn topic_study_in(app: &App, scope: Option<&str>, progress: &Json, topic_ids: &[String], studied_today: Option<&HashSet<String>>) -> TopicStudy {
	let record = scope.and_then(|id| app.stores.spaces.get_space(id));
	let facts = items(&progress["facts"]);
	let space_order = fact_space_order(facts, &progress_files(record.as_ref()));
	let topics = topic_study(topic_ids, items(&progress["topics"]), facts, &space_order, studied_today);
	let fact_by_id: HashMap<&str, &Json> = facts.iter().map(|f| (f["id"].str_or_empty(), f)).collect();
	let picks = topics
		.iter()
		.flat_map(|t| items(&t["factIds"]).iter())
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

/// None when the space has no such deadline.
pub fn deadline_study_for(app: &App, space_id: &str, deadline_id: &str) -> Result<Option<DeadlineStudy>, String> {
	let Some(progress) = progress_for(app, space_id, None)? else { return Ok(None) };
	let Some(deadline) = items(&progress["deadlines"]).iter().find(|d| d["id"].as_str() == Some(deadline_id)) else { return Ok(None) };
	let today = progress["today"].str_or_empty();
	let studied = studied_on(app, space_id, today);
	let topic_ids = deadline_study_topic_ids(today, deadline, items(&progress["topics"]));
	let study = topic_study_in(app, Some(space_id), &progress, &topic_ids, Some(&studied));
	Ok(Some(DeadlineStudy { name: deadline["name"].str_or_empty().to_owned(), topics: study.topics, picks: study.picks }))
}

/// The plan nodes of the space's study sessions created on `day` (the learner's local day).
fn studied_on(app: &App, space_id: &str, day: &str) -> HashSet<String> {
	let mut ids = HashSet::new();
	for c in app.stores.chats.list_chats() {
		let created_day = time::parse_date(c["createdAt"].str_or_empty()).map(local_day);
		if c["kind"].as_str() != Some("study") || c["spaceId"].as_str() != Some(space_id) || created_day.as_deref() != Some(day) {
			continue;
		}
		let record = app.stores.chats.get_chat(c["id"].str_or_empty());
		for node in record.iter().flat_map(|r| items(&r["tree"]["nodes"])) {
			ids.insert(node["id"].str_or_empty().to_owned());
		}
	}
	ids
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	fn tree() -> Json {
		json!({ "nodes": [{ "id": "reg", "title": "Regularization" }, { "id": "cv", "title": "Cross-validation" }, { "id": "gd", "title": "Gradient descent" }], "edges": [{ "from": "reg", "to": "cv" }] })
	}

	/// The concluding pair that ends `node` on a topic stop now.
	fn ended(call: &str, node: &str) -> Vec<Json> {
		let stop = json!({ "kind": "topic", "nodeId": node, "activeMinutes": 30, "at": time::iso(clock::now_ms()) });
		vec![
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": call, "name": "conclude", "arguments": { "outcome": "solved" } }], "timestamp": clock::now_ms() }),
			json!({ "role": "toolResult", "toolCallId": call, "toolName": "conclude", "details": { "stop": stop }, "isError": false, "timestamp": clock::now_ms() }),
		]
	}

	fn asked(node: &str) -> Json {
		json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": format!("q-{node}"), "name": "quiz", "arguments": { "nodeId": node } }], "timestamp": clock::now_ms() })
	}

	/// The topic_done after `node` ended, storing the opener of the topic after it.
	fn opener_after(node: &str, next: &str) -> Vec<Json> {
		vec![
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "t1", "name": "topic_done", "arguments": { "nodeId": node, "opener": { "lead": "Now split the data.", "quiz": { "question": "?", "type": "predict", "nodeId": next } } } }], "timestamp": clock::now_ms() }),
			json!({ "role": "toolResult", "toolCallId": "t1", "toolName": "topic_done", "details": { "part": "topic_done", "v": 1, "lead": "Now split the data." }, "isError": false, "timestamp": clock::now_ms() }),
		]
	}

	fn kept_going(call: &str) -> Json {
		json!({ "role": "custom", "customType": "keep-going", "content": "", "details": { "stopOf": call, "at": time::iso(clock::now_ms()) }, "timestamp": clock::now_ms() })
	}

	fn midterm(app: &App, space_id: &str, deadline_id: &str) -> Json {
		let progress = progress_for(app, space_id, None).unwrap().unwrap();
		items(&progress["deadlines"]).iter().find(|d| d["id"].as_str() == Some(deadline_id)).unwrap().clone()
	}

	#[test]
	fn a_deadline_session_is_mid_topic_or_at_its_stop_until_he_keeps_going_and_closes_at_its_end() {
		let root = scratch_dir("progress-stop");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Machine Learning Foundations" })).unwrap()["id"].str_or_empty().to_owned();
		let deadline = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "Midterm", "kind": "exam", "date": "2099-01-15" })).unwrap();
		let deadline_id = deadline["id"].str_or_empty().to_owned();
		let chat_id = app.stores.chats.create_chat("Study for Midterm", Some("study"), Some(&space_id), Some(&deadline_id)).unwrap()["id"].str_or_empty().to_owned();
		app.stores.chats.save_tree(&chat_id, &tree()).unwrap();

		assert_eq!(midterm(&app, &space_id, &deadline_id)["continueStudy"].get("inTopic"), None, "nothing asked yet");
		let fresh = vec![asked("reg")];
		app.stores.chats.save_messages(&chat_id, &fresh).unwrap();
		let d = midterm(&app, &space_id, &deadline_id);
		assert_eq!(d["continueStudy"]["inTopic"], json!("Regularization"), "asked, nothing answered");
		assert_eq!(d["continueStudy"].get("stop"), None);

		let stopped = [fresh, ended("c1", "reg"), opener_after("reg", "cv")].concat();
		app.stores.chats.save_messages(&chat_id, &stopped).unwrap();
		let at = stopped[2]["details"]["stop"]["at"].clone();
		let d = midterm(&app, &space_id, &deadline_id);
		assert_eq!(d["continueStudy"]["stop"], json!({ "at": at, "next": "Cross-validation" }));
		assert_eq!(d["continueStudy"].get("inTopic"), None, "a stop is not mid-topic");
		assert_eq!(d.get("studyEndedToday"), None);

		let going = [stopped.clone(), vec![kept_going("c1")]].concat();
		app.stores.chats.save_messages(&chat_id, &going).unwrap();
		let d = midterm(&app, &space_id, &deadline_id);
		assert_eq!(d["continueStudy"].get("stop"), None, "he kept going");
		assert_eq!(d["continueStudy"]["inTopic"], json!("Cross-validation"), "the opener moved him to the next topic");

		let end = [going, ended("c2", "cv"), ended("c3", "gd")].concat();
		app.stores.chats.save_messages(&chat_id, &end).unwrap();
		let d = midterm(&app, &space_id, &deadline_id);
		assert_eq!(d.get("continueStudy"), None, "a session that reached its end is not continued");
		assert_eq!(d["studyEndedToday"], json!(true));
	}
}
