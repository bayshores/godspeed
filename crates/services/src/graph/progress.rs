//! Progress (server/progress.ts): reads one space scope's graph, topics, files, deadlines and
//! lessons and hands them to the pure derivation (gs_core study). Nothing is written.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use gs_base::hash::sha256_text;
use gs_base::{clock, time};
use gs_core::contracts::chat::ChatKind;
use gs_core::spaces::problem_list::with_problem_lists;
use gs_core::spaces::today_note::local_day;
use gs_core::graph::graph::get_graph;
use gs_core::session::plan_step_bar::step_bar;
use gs_core::session::practice_outcomes::practice_outcomes;
use gs_core::study::kept::{KeptSentence, kept_comebacks, kept_sentences};
use gs_core::study::progress::{collect_answers, derive_progress, facts_by_message, facts_for_answer};
use gs_core::study::review::review_items;
use gs_core::study::study::fact_space_order;
use gs_core::study::topic_end::{lesson_stop, topic_stop_times};
use gs_json::{Json, Obj, json};
use parking_lot::Mutex;

use super::graph::graph_store_for;
use super::topics::topic_grouping_running;
use crate::App;
use crate::mocks::mocks::space_mock_answers;
use crate::spaces::source_id_for;

/// A lesson's graded answers, practice outcomes, questions from earlier, kept sentences and when
/// they came back, and where its plan stands. Progress is read again after every background
/// update, and parsing every lesson each time grows with the term, so each is kept while its
/// record file is unchanged.
struct Readout {
	version: String,
	answers: Vec<Json>,
	outcomes: Vec<Json>,
	reviews: Vec<Json>,
	kept: Vec<KeptSentence>,
	comebacks: Vec<(String, i64)>,
	/// Set for a lesson with a plan.
	plan: Option<Obj>,
	/// Each topic stop's node and time.
	topic_stops: Vec<(String, String)>,
}

#[derive(Default)]
pub struct Readouts(Mutex<HashMap<String, Arc<Readout>>>);

fn lesson_readout(app: &App, chat_id: &str) -> Option<Arc<Readout>> {
	let version = app.stores.chats.chat_version(chat_id)?;
	if let Some(hit) = app.graph.readouts.0.lock().get(chat_id).filter(|hit| hit.version == version) {
		return Some(hit.clone());
	}
	let record = app.stores.chats.get_chat(chat_id)?;
	let messages = record["messages"].items();
	let has_plan = !record["tree"]["nodes"].items().is_empty() && ChatKind::of(&record) != ChatKind::Practice;
	let readout = Arc::new(Readout {
		version,
		answers: collect_answers(chat_id, messages),
		outcomes: practice_outcomes(messages),
		reviews: review_items(chat_id, messages),
		kept: kept_sentences(chat_id, messages),
		comebacks: kept_comebacks(messages),
		plan: has_plan.then(|| plan_state(&record["tree"], messages)),
		topic_stops: topic_stop_times(messages),
	});
	app.graph.readouts.0.lock().insert(chat_id.to_owned(), readout.clone());
	Some(readout)
}

/// Whether the lesson's plan reached its end ("Done for today").
pub fn lesson_ended(app: &App, chat_id: &str) -> bool {
	lesson_readout(app, chat_id).and_then(|r| r.plan.as_ref().map(|plan| plan.contains_key("endedAt"))).unwrap_or(false)
}

/// Where a lesson's plan stands: the steps its step bar ticks (`done`, of `total`), the current
/// step's number (`step`, the steps visited while none is current), the stop it waits at until he
/// keeps going (`stop`: `{at, next}`), when it reached its end (`endedAt`), and otherwise the topic
/// it is in the middle of (`inTopic`, the current step's title).
fn plan_state(tree: &Json, messages: &[Json]) -> Obj {
	let stop = lesson_stop(messages, Some(tree), None);
	// The step bar ticks the current step at its topic's stop, as stepsRow does.
	let finished = stop.as_ref().filter(|s| s["kind"].as_str() != Some("problem") && !s["keptGoing"].truthy()).and_then(|s| s["nodeId"].as_str());
	let bar = step_bar(tree, messages, finished);
	let mut out = Obj::new();
	out.insert("done", bar.done as f64);
	out.insert("total", bar.total as f64);
	out.insert("step", bar.step as f64);
	let (key, value) = match stop {
		Some(stop) if stop["kind"].as_str() == Some("end") => ("endedAt", Some(stop["at"].clone())),
		Some(stop) if !stop["keptGoing"].truthy() => ("stop", Some(json!({ "at": stop["at"], "next": stop["next"] }))),
		_ => ("inTopic", bar.current_title),
	};
	if let Some(value) = value {
		out.insert(key, value);
	}
	out
}

/// What the review schedule reads from a space's lessons: every graded answer, every problem
/// outcome, every question from earlier, every kept sentence and each time one came back.
#[derive(Default)]
pub struct SpaceReviews {
	pub answers: Vec<Json>,
	pub outcomes: Vec<Json>,
	pub items: Vec<Json>,
	pub kept: Vec<KeptSentence>,
	pub comebacks: Vec<(String, i64)>,
}

pub fn space_reviews(app: &App, space_id: &str) -> SpaceReviews {
	let mut out = SpaceReviews::default();
	for readout in app.stores.chats.list_space_chats(space_id).iter().filter_map(|c| lesson_readout(app, c["id"].str_or_empty())) {
		out.answers.extend(readout.answers.iter().cloned());
		out.outcomes.extend(readout.outcomes.iter().cloned());
		out.items.extend(readout.reviews.iter().cloned());
		out.kept.extend(readout.kept.iter().cloned());
		out.comebacks.extend(readout.comebacks.iter().cloned());
	}
	out
}

/// The space's problems (practice and study) the learner solved only with hints.
pub fn hinted_problems(app: &App, space_id: &str) -> Vec<Json> {
	app.stores.chats.list_space_chats(space_id)
		.iter()
		.filter_map(|c| lesson_readout(app, c["id"].str_or_empty()))
		.flat_map(|readout| readout.outcomes.clone())
		.filter(|o| o["outcome"].as_str() == Some("solvedWithHints"))
		.map(|o| json!({ "statement": o["statement"], "at": o["at"] }))
		.collect()
}

/// Which topic each fact is in, and the facts each answer counts for.
pub struct TopicLookup {
	index: HashMap<String, Vec<String>>,
	topic_of: HashMap<String, String>,
	/// The grouped topics' ids.
	known: HashSet<String>,
}

impl TopicLookup {
	/// The topics the facts are in, each once.
	fn of_facts(&self, fact_ids: &[String]) -> Vec<String> {
		let mut seen = HashSet::new();
		fact_ids.iter().filter_map(|id| self.topic_of.get(id)).filter(|t| !t.is_empty() && seen.insert(t.as_str())).cloned().collect()
	}

	/// The grouped topics an answer counts for: its facts' topics, else its plan node when that
	/// is a topic (as the progress derivation counts it).
	pub fn of_answer(&self, answer: &Json) -> Vec<String> {
		let hit: Vec<String> = self.of_facts(&facts_for_answer(answer, &self.index)).into_iter().filter(|t| self.known.contains(t)).collect();
		self.or_node(hit, answer)
	}

	/// `topics`, or the plan node of `of` when that is a topic and `topics` is empty.
	fn or_node(&self, topics: Vec<String>, of: &Json) -> Vec<String> {
		match of["nodeId"].as_str().filter(|n| self.known.contains(*n)) {
			Some(node) if topics.is_empty() => vec![node.to_owned()],
			_ => topics,
		}
	}
}

/// `progress` is `progress_for` of the space.
pub fn topic_lookup(app: &App, space_id: &str, progress: &Json) -> Result<TopicLookup, String> {
	Ok(TopicLookup {
		index: facts_by_message(&get_graph(graph_store_for(app, Some(space_id)).as_ref())?.nodes),
		topic_of: progress["facts"].items().iter().filter_map(|f| Some((f["id"].as_str()?.to_owned(), f["topicId"].as_str()?.to_owned()))).collect(),
		known: progress["topics"].items().iter().filter(|t| !t["ungrouped"].truthy()).filter_map(|t| t["id"].as_str().map(str::to_owned)).collect(),
	})
}

/// A mistake's id: the same each time it is read, short enough to send to the teacher.
fn mistake_id(chat_id: &str, call_id: &str) -> String {
	format!("m{}", &sha256_text(&format!("{chat_id}:{call_id}"))[..6])
}

/// The space's mistakes: answers given wrong and problems solved only with hints, each with an
/// id and the topics its facts are in (the cheat sheet's Watch out block, and the vault notes).
pub fn space_mistakes(app: &App, space_id: &str, progress: &Json) -> Result<Vec<Json>, String> {
	let lookup = topic_lookup(app, space_id, progress)?;
	let mut out = Vec::new();
	for c in app.stores.chats.list_space_chats(space_id) {
		let chat_id = c["id"].str_or_empty();
		let Some(readout) = lesson_readout(app, chat_id) else { continue };
		for a in readout.answers.iter().filter(|a| a["outcome"].as_str() == Some("wrong")) {
			let topics = lookup.of_answer(a);
			out.push(json!({ "id": mistake_id(chat_id, a["toolCallId"].str_or_empty()), "text": a["question"], "kind": "wrong", "at": a["answeredAt"], "topicIds": topics }));
		}
		for o in readout.outcomes.iter().filter(|o| o["outcome"].as_str() == Some("solvedWithHints")) {
			let targets: Vec<String> = o["targets"].items().iter().map(|t| t.str_or_empty().to_owned()).collect();
			out.push(json!({ "id": mistake_id(chat_id, o["problemCallId"].str_or_empty()), "text": o["statement"], "kind": "hint", "at": o["at"], "topicIds": lookup.or_node(lookup.of_facts(&targets), o) }));
		}
	}
	Ok(out)
}

/// The grouped topics a lesson's answers since `since` (an ISO time) count for, each with how
/// many answers, the most answered first.
pub fn lesson_answered_topics(app: &App, chat_id: &str, since: Option<&str>) -> Result<Vec<(String, usize)>, String> {
	let Some(space_id) = app.stores.chats.get_chat(chat_id).and_then(|c| c["spaceId"].as_str().map(str::to_owned)) else { return Ok(Vec::new()) };
	let Some(readout) = lesson_readout(app, chat_id) else { return Ok(Vec::new()) };
	let Some(progress) = progress_for(app, space_id.as_str(), None)? else { return Ok(Vec::new()) };
	let lookup = topic_lookup(app, &space_id, &progress)?;
	let since = since.and_then(time::parse_date);
	let mut counts: Vec<(String, usize)> = Vec::new();
	for answer in readout.answers.iter().filter(|a| since.is_none_or(|s| a["answeredAt"].as_str().and_then(time::parse_date).is_some_and(|at| at > s))) {
		for topic in lookup.of_answer(answer) {
			match counts.iter_mut().find(|(id, _)| *id == topic) {
				Some((_, n)) => *n += 1,
				None => counts.push((topic, 1)),
			}
		}
	}
	counts.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
	Ok(counts)
}

/// The space's files with the source id their facts are born under, and the problems listed for
/// each.
pub(super) fn progress_files(record: Option<&Json>) -> Vec<Json> {
	let Some(record) = record else { return Vec::new() };
	let space_id = record["id"].str_or_empty();
	record["files"].items()
		.iter()
		.map(|f| {
			let source_id = f["sourceId"].as_str().map_or_else(|| source_id_for(space_id, f["id"].str_or_empty()), str::to_owned);
			let mut file = Obj::new();
			for key in ["id", "name", "kind"] {
				file.insert(key, f[key].clone());
			}
			file.insert("sourceId", source_id);
			file.insert_present("problems", f.get("problems"));
			Json::Obj(file)
		})
		.collect()
}

/// Each fact's place in the space's order.
pub fn space_order_for(app: &App, space_id: &str, progress: &Json) -> HashMap<String, usize> {
	let record = app.stores.spaces.get_space(space_id);
	fact_space_order(progress["facts"].items(), &progress_files(record.as_ref()))
}

/// Copies the keys the summary has (an absent key stays absent, as `undefined` does in JSON).
fn picked(from: &Json, keys: &[&str]) -> Obj {
	let mut out = Obj::new();
	for key in keys {
		out.insert_present(key, from.get(key));
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
	let today = today.map_or_else(|| local_day(clock::now_ms()), str::to_owned);
	let (mut lessons, mut deadline_sessions, mut homework_sessions) = (Vec::new(), Vec::new(), Vec::new());
	let mut finished_today: Vec<String> = Vec::new();
	for c in &chats {
		if c["spaceId"].as_str() != scope {
			continue;
		}
		if ChatKind::of(c) == ChatKind::Homework && c["deadlineId"].truthy() {
			homework_sessions.push(json!({ "chatId": c["id"], "deadlineId": c["deadlineId"], "createdAt": c["createdAt"] }));
		}
		let Some(readout) = lesson_readout(app, c["id"].str_or_empty()) else { continue };
		let mut lesson = picked(c, &["id", "title", "kind", "updatedAt", "deadlineId", "fileIds", "pendingQuestion", "pendingProblem"]);
		lesson.insert("answers", readout.answers.clone());
		if let Some(plan) = &readout.plan {
			lesson.insert("plan", plan.clone());
		}
		lessons.push(Json::Obj(lesson));
		if ChatKind::of(c) == ChatKind::Study {
			let today_stops = readout.topic_stops.iter().filter(|(_, at)| time::parse_date(at).map(local_day).as_deref() == Some(today.as_str()));
			finished_today.extend(today_stops.map(|(node, _)| node.clone()));
		}
		// A lesson whose agent has not written its plan yet is the deadline's session too,
		// uncounted. A homework lesson is never one: Study for the deadline would reopen it.
		if c["deadlineId"].truthy() && ChatKind::of(c) != ChatKind::Homework {
			let mut session = Obj::new();
			session.insert("chatId", c["id"].clone());
			session.insert("deadlineId", c["deadlineId"].clone());
			session.insert_present("updatedAt", c.get("updatedAt"));
			session.extend(readout.plan.clone().unwrap_or_default());
			deadline_sessions.push(Json::Obj(session));
		}
	}
	let topics = app.stores.graphs.read_topics(scope)?.unwrap_or(Json::Null);
	let path = record.as_ref().map_or(Json::Null, |r| r["path"].clone());
	let studied_today = match scope {
		Some(id) if !path.is_null() => studied_on(app, id, &today).into_iter().map(Json::from).collect(),
		_ => Vec::new(),
	};
	let input = json!({
		"spaceId": scope,
		"today": today,
		"facts": graph.nodes,
		"chains": graph.chains,
		"topics": topics,
		"files": progress_files(record.as_ref()),
		"deadlines": record.as_ref().map_or_else(|| json!([]), |r| with_problem_lists(r)["deadlines"].as_arr().map_or_else(|| json!([]), |d| Json::Arr(d.clone()))),
		"lessons": lessons,
		"deadlineSessions": deadline_sessions,
		"homeworkSessions": homework_sessions,
		"finishedToday": finished_today,
		"mockAnswers": scope.map_or_else(Vec::new, |id| space_mock_answers(app, id)),
		"grouping": scope.is_some_and(|id| topic_grouping_running(app, id)),
		"path": path,
		"studiedToday": studied_today,
	});
	Ok(Some(derive_progress(&input)))
}

/// The plan nodes of the space's study sessions created on `day` (the learner's local day).
pub(super) fn studied_on(app: &App, space_id: &str, day: &str) -> HashSet<String> {
	let mut ids = HashSet::new();
	for c in app.stores.chats.list_chats() {
		let created_day = time::parse_date(c["createdAt"].str_or_empty()).map(local_day);
		if ChatKind::of(&c) != ChatKind::Study || c["spaceId"].as_str() != Some(space_id) || created_day.as_deref() != Some(day) {
			continue;
		}
		let record = app.stores.chats.get_chat(c["id"].str_or_empty());
		for node in record.iter().flat_map(|r| r["tree"]["nodes"].items()) {
			ids.insert(node["id"].str_or_empty().to_owned());
		}
	}
	ids
}

#[cfg(test)]
pub(super) mod tests {
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
		progress["deadlines"].items().iter().find(|d| d["id"].as_str() == Some(deadline_id)).unwrap().clone()
	}

	#[test]
	fn progress_read_under_a_lessons_lock_does_not_wait_for_its_space() {
		use gs_base::locks::LockKey;
		use std::sync::mpsc::channel;
		use std::time::Duration;
		let root = scratch_dir("progress-locks");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Larkspur onsite" })).unwrap()["id"].str_or_empty().to_owned();
		let deadline = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "Onsite", "kind": "interview", "date": "2099-01-15" })).unwrap();
		let mock = gs_core::mocks::mock::new_mock("mock_0000abcd", deadline["id"].str_or_empty(), 1.0, &json!({ "questions": 2 }), "2026-11-11T10:00:00.000Z");
		app.stores.mocks.write_mock(&space_id, &mock).unwrap();
		let chat_id = app.stores.chats.create_chat("Strings", Some("study"), Some(&space_id), None, &[]).unwrap()["id"].str_or_empty().to_owned();
		// A review answer holds the lesson and reads progress while a space delete holds the space
		// and waits for the lesson.
		let (done_tx, done_rx) = channel();
		let (lesson_held_tx, lesson_held_rx) = channel();
		let (answering, space, chat) = (app.clone(), space_id.clone(), chat_id.clone());
		std::thread::spawn(move || {
			let _lesson = answering.locks.lock(LockKey::Chat(&chat));
			lesson_held_tx.send(()).unwrap();
			std::thread::sleep(Duration::from_millis(100));
			let _ = done_tx.send(progress_for(&answering, space.as_str(), None).unwrap().is_some());
		});
		lesson_held_rx.recv().unwrap();
		let (deleting, space, chat) = (app.clone(), space_id.clone(), chat_id.clone());
		std::thread::spawn(move || {
			let _space = deleting.locks.lock(LockKey::Space(&space));
			let _lesson = deleting.locks.lock(LockKey::Chat(&chat));
		});
		assert_eq!(done_rx.recv_timeout(Duration::from_secs(10)), Ok(true), "the two would wait for each other for good");
	}

	#[test]
	fn a_deadline_session_is_mid_topic_or_at_its_stop_until_he_keeps_going_and_closes_at_its_end() {
		let root = scratch_dir("progress-stop");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Machine Learning Foundations" })).unwrap()["id"].str_or_empty().to_owned();
		let deadline = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "Midterm", "kind": "exam", "date": "2099-01-15" })).unwrap();
		let deadline_id = deadline["id"].str_or_empty().to_owned();
		let chat_id = app.stores.chats.create_chat("Study for Midterm", Some("study"), Some(&space_id), Some(&deadline_id), &[]).unwrap()["id"].str_or_empty().to_owned();
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

		let typed = |words: &str| json!({ "role": "user", "content": words, "timestamp": clock::now_ms() });
		let question = [stopped.clone(), vec![typed("Why does lambda shrink the weights?"), json!({ "role": "assistant", "content": [{ "type": "text", "text": "The penalty grows with them." }], "timestamp": clock::now_ms() })]].concat();
		app.stores.chats.save_messages(&chat_id, &question).unwrap();
		assert_eq!(midterm(&app, &space_id, &deadline_id)["continueStudy"]["stop"]["next"], json!("Cross-validation"), "a question about the finished topic leaves the stop");
		let typed_on = [stopped.clone(), vec![typed("ok, go on"), asked("cv")]].concat();
		app.stores.chats.save_messages(&chat_id, &typed_on).unwrap();
		let d = midterm(&app, &space_id, &deadline_id);
		assert_eq!(d["continueStudy"].get("stop"), None, "the teacher went on with no Keep going");
		assert_eq!(d["continueStudy"]["inTopic"], json!("Cross-validation"));

		let end = [going, ended("c2", "cv"), ended("c3", "gd")].concat();
		app.stores.chats.save_messages(&chat_id, &end).unwrap();
		let d = midterm(&app, &space_id, &deadline_id);
		assert_eq!(d.get("continueStudy"), None, "a session that reached its end is not continued");
		assert_eq!(d["studyEndedToday"], json!(true));
	}
	#[test]
	fn a_deadline_session_with_no_plan_yet_is_continued_uncounted_until_the_agent_writes_one() {
		let root = scratch_dir("progress-agent-plan");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Machine Learning Foundations" })).unwrap()["id"].str_or_empty().to_owned();
		let deadline_id = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "Midterm", "kind": "exam", "date": "2099-01-15" })).unwrap()["id"].str_or_empty().to_owned();
		let chat_id = app.stores.chats.create_chat("Study for Midterm", Some("study"), Some(&space_id), Some(&deadline_id), &[]).unwrap()["id"].str_or_empty().to_owned();
		assert_eq!(midterm(&app, &space_id, &deadline_id)["continueStudy"], json!({ "chatId": chat_id }), "no plan yet: reopened, nothing to count");
		app.stores.chats.save_tree(&chat_id, &tree()).unwrap();
		assert_eq!(midterm(&app, &space_id, &deadline_id)["continueStudy"], json!({ "chatId": chat_id, "done": 0, "total": 3 }));
	}

	#[test]
	fn a_lesson_with_a_plan_and_no_deadline_gets_its_step_and_is_unfinished_until_its_end() {
		let root = scratch_dir("progress-lesson-plan");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Machine Learning Foundations" })).unwrap()["id"].str_or_empty().to_owned();
		let chat_id = app.stores.chats.create_chat("Regularization", Some("study"), Some(&space_id), None, &[]).unwrap()["id"].str_or_empty().to_owned();
		app.stores.chats.save_tree(&chat_id, &tree()).unwrap();
		let row = |app: &App| progress_for(app, space_id.as_str(), None).unwrap().unwrap()["lessons"].items().iter().find(|l| l["chatId"].as_str() == Some(chat_id.as_str())).unwrap().clone();

		let r = row(&app);
		assert_eq!((r["step"].clone(), r["unfinished"].clone(), r.get("deadlineId")), (json!({ "done": 0, "total": 3 }), json!(true), None), "nothing shown yet");
		let stopped = [vec![asked("reg")], ended("c1", "reg"), opener_after("reg", "cv")].concat();
		let going = [stopped, vec![kept_going("c1")]].concat();
		app.stores.chats.save_messages(&chat_id, &going).unwrap();
		let r = row(&app);
		assert_eq!((r["step"].clone(), r["unfinished"].clone()), (json!({ "done": 1, "total": 3 }), json!(true)), "on the second topic, the first one ticked");
		app.stores.chats.save_messages(&chat_id, &[going, ended("c2", "cv"), vec![asked("gd")], ended("c3", "gd")].concat()).unwrap();
		let r = row(&app);
		assert_eq!((r["step"].clone(), r.get("unfinished")), (json!({ "done": 3, "total": 3 }), None), "reached its end, every step ticked");
	}

	#[test]
	fn a_homework_lesson_is_never_the_deadlines_study_session() {
		let root = scratch_dir("progress-homework");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Algorithms" })).unwrap()["id"].str_or_empty().to_owned();
		let deadline_id = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "HW6", "kind": "homework", "date": "2099-01-15" })).unwrap()["id"].str_or_empty().to_owned();
		let homework = app.stores.chats.create_chat("HW6", Some("homework"), Some(&space_id), Some(&deadline_id), &[]).unwrap()["id"].str_or_empty().to_owned();
		let d = midterm(&app, &space_id, &deadline_id);
		assert_eq!(d.get("continueStudy"), None, "Study would reopen the homework");
		assert_eq!(d["continueHomework"], json!(homework));
		app.stores.chats.save_messages(&homework, &ended("c1", "reg")).unwrap();
		assert_eq!(midterm(&app, &space_id, &deadline_id).get("studyEndedToday"), None, "homework is not studying");

		let study = app.stores.chats.create_chat("Study for HW6", Some("study"), Some(&space_id), Some(&deadline_id), &[]).unwrap()["id"].str_or_empty().to_owned();
		let d = midterm(&app, &space_id, &deadline_id);
		assert_eq!(d["continueStudy"]["chatId"], json!(study));
		assert_eq!(d["continueHomework"], json!(homework));
	}

	#[test]
	fn study_continues_the_deadlines_lesson_worked_in_last() {
		let root = scratch_dir("progress-last-worked");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Algorithms" })).unwrap()["id"].str_or_empty().to_owned();
		let deadline_id = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "Midterm", "kind": "exam", "date": "2099-01-15" })).unwrap()["id"].str_or_empty().to_owned();
		let lesson = |title: &str| {
			// Each lesson's time is its own clock tick.
			clock::advance(5);
			app.stores.chats.create_chat(title, Some("study"), Some(&space_id), Some(&deadline_id), &[]).unwrap()["id"].str_or_empty().to_owned()
		};
		let (study, practice) = (lesson("Study for Midterm"), lesson("Practice test"));
		assert_eq!(midterm(&app, &space_id, &deadline_id)["continueStudy"]["chatId"], json!(practice), "the practice test, made and worked in last");
		clock::advance(5);
		app.stores.chats.save_messages(&study, &[]).unwrap();
		assert_eq!(midterm(&app, &space_id, &deadline_id)["continueStudy"]["chatId"], json!(study), "back in the older one");
		let unfinished = |app: &App| progress_for(app, space_id.as_str(), None).unwrap().unwrap()["lessons"].items().iter().filter(|l| l["unfinished"].truthy()).count();
		assert_eq!(unfinished(&app), 2, "both stay to go back to");
	}

	#[test]
	fn a_practice_lesson_with_a_solved_problem_and_no_quiz_is_not_unfinished() {
		let root = scratch_dir("progress-practice-solved");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Algorithms" })).unwrap()["id"].str_or_empty().to_owned();
		let chat_id = app.stores.chats.create_chat("Recurrences", Some("practice"), Some(&space_id), None, &[]).unwrap()["id"].str_or_empty().to_owned();
		let row = |app: &App| progress_for(app, space_id.as_str(), None).unwrap().unwrap()["lessons"].items()[0].clone();
		assert_eq!(row(&app)["unfinished"], json!(true), "nothing done yet");
		app.stores.chats.save_messages(&chat_id, &hinted("1", "rec", "n_rec")).unwrap();
		let r = row(&app);
		assert_eq!((r["answered"].clone(), r.get("unfinished")), (json!(1), None), "a problem solved with hints counts as answered");
	}

	/// A problem on `node` the learner solved with hints, ending the topic now.
	pub(in crate::graph) fn hinted(n: &str, node: &str, fact: &str) -> Vec<Json> {
		hinted_at(n, node, fact, clock::now_ms())
	}

	pub(in crate::graph) fn hinted_at(n: &str, node: &str, fact: &str, at_ms: i64) -> Vec<Json> {
		let stop = json!({ "kind": "topic", "nodeId": node, "activeMinutes": 2, "at": time::iso(at_ms) });
		vec![
			json!({ "role": "assistant", "id": format!("m-{n}"), "content": [{ "type": "toolCall", "id": format!("p-{n}"), "name": "problem", "arguments": { "nodeId": node, "mode": "composition", "target": [fact], "statement": "Work it out." } }], "timestamp": clock::now_ms() }),
			json!({ "role": "toolResult", "toolCallId": format!("p-{n}"), "toolName": "problem", "isError": false, "timestamp": clock::now_ms() }),
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": format!("c-{n}"), "name": "conclude", "arguments": { "outcome": "solvedWithHints", "verdict": "Solid now." } }], "timestamp": clock::now_ms() }),
			json!({ "role": "toolResult", "toolCallId": format!("c-{n}"), "toolName": "conclude", "details": { "stop": stop }, "isError": false, "timestamp": clock::now_ms() }),
		]
	}
}
