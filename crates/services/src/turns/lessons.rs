//! Lesson creation (lessons.ts): the one place a new lesson record is born (POST /api/chats and
//! MCP start_lesson), so a lesson in a space always opens with its space card. Every new lesson
//! is a study session: on a typed topic, picked facts, some of the space's topics, one question
//! of a graded mock, or a deadline.
//!
//! Message order at birth: space card, graph-context picks, study plan; the caller then sends the
//! learner's first message. A start from a deadline is recorded on the chat so that deadline's
//! Study button can reopen it.

use std::collections::HashMap;
use std::sync::Arc;

use gs_base::locks::LockKey;
use gs_core::contracts::graph::title_from_prompt;
use gs_core::graph::chains::{chains_for_selection, format_chain_line};
use gs_core::graph::graph::get_graph;
use gs_core::messages::native_messages::{new_space_context_message, new_graph_context_message, new_study_context_message};
use gs_core::mocks::mock::question_result;
use gs_core::mocks::mock_requests::go_over_text;
use gs_core::study::study::{FREE_TOPIC_ID, MAX_STUDY_FACTS, study_context_text, study_plan_tree, study_title};
use gs_json::{Json, Obj};

use crate::App;
use crate::spaces::space_card::space_card_for;
use crate::graph::graph::graph_store_for;
use crate::graph::progress::{deadline_study_for, study_topics_for, topic_study_for};

fn items(v: &Json) -> &[Json] {
	v.as_arr().map_or(&[], Vec::as_slice)
}

/// What a lesson starts from.
pub enum LessonStart {
	/// A typed topic (its title), with any facts picked for it (`{id, name, statement}`).
	Typed { title: String, picks: Vec<Json> },
	/// Some of the space's topics.
	Topics(Vec<String>),
	/// One question of a graded mock, to go over.
	MockQuestion { mock_id: String, question_id: String },
	/// A deadline: its topics for today.
	Deadline(String),
}

pub struct CreateLessonInput {
	/// None is "No space".
	pub space_id: Option<String>,
	pub start: LessonStart,
}

/// A new lesson: `title` is the whole title (the record's may be shortened), the first message.
pub struct Created {
	pub chat: Json,
	pub title: String,
}

/// The 404 refusals: `space_not_found`, `topics_not_found`, `deadline_not_found`.
#[derive(Debug, PartialEq)]
pub struct NotFound {
	pub code: &'static str,
	pub error: &'static str,
}

struct Start {
	title: String,
	picks: Vec<Json>,
	topics: Vec<Json>,
	/// More for the teacher under the study plan.
	note: Option<String>,
}

pub fn create_lesson(app: &Arc<App>, input: CreateLessonInput) -> Result<Result<Created, NotFound>, String> {
	let scope = input.space_id.as_deref();
	// Held from the space check to the finished lesson: a space delete takes this lock too, so it
	// sees the new lesson, never a lesson born into a space it already removed.
	let _space = scope.map(|id| app.locks.lock(LockKey::Space(id)));
	let cls = match scope {
		None => None,
		Some(id) => match app.stores.spaces.get_space(id) {
			Some(cls) => Some(cls),
			None => return Ok(Err(NotFound { code: "space_not_found", error: "No such space" })),
		},
	};
	let start = match start_of(app, scope, &input.start)? {
		Ok(start) => start,
		Err(not_found) => return Ok(Err(not_found)),
	};
	let deadline_id = match &input.start {
		LessonStart::Deadline(id) => Some(id.as_str()),
		_ => None,
	};
	let space_id = cls.as_ref().and_then(|c| c["id"].as_str());
	let chat = app.stores.chats.create_chat(&title_from_prompt(&start.title), Some("study"), space_id, deadline_id)?;
	let chat_id = chat["id"].as_str().unwrap_or_default().to_owned();
	let mut messages = Vec::new();
	if let Some(cls) = &cls {
		messages.push(new_space_context_message(&space_card_for(app, cls)?));
	}
	if !start.picks.is_empty() {
		// The picks carry what the learner saw; the chains come from the lesson's own space graph.
		let graph = get_graph(graph_store_for(app, scope).as_ref())?;
		let by_id: HashMap<&str, &Json> = graph.nodes.iter().filter_map(|n| Some((n["id"].as_str()?, n))).collect();
		let names: HashMap<String, String> = by_id.iter().map(|(id, n)| ((*id).to_owned(), n["name"].as_str().unwrap_or_default().to_owned())).collect();
		let picked: Vec<Json> = start.picks.iter().filter_map(|p| by_id.get(p["id"].as_str()?).map(|n| (*n).clone())).collect();
		let lines: Vec<String> = chains_for_selection(&picked, &graph.chains)
			.iter()
			.map(|c| {
				let premises: Vec<&str> = c["premises"].as_arr().into_iter().flatten().filter_map(Json::as_str).collect();
				format_chain_line(&premises, c["conclusion"].as_str().unwrap_or_default(), &names)
			})
			.collect();
		messages.push(new_graph_context_message(&start.picks, &lines));
	}
	let plan = study_context_text(&start.topics);
	let context = match &start.note {
		Some(note) => format!("{plan}\n\n{note}"),
		None => plan,
	};
	messages.push(new_study_context_message(&context, "study-context"));
	app.stores.chats.save_messages(&chat_id, &messages)?;
	app.stores.chats.save_tree(&chat_id, &study_plan_tree(&start.topics)?)?;
	let chat = app.stores.chats.get_chat(&chat_id).unwrap_or(chat);
	Ok(Ok(Created { chat, title: start.title }))
}

/// The session's title, picks and topics for each kind of start.
fn start_of(app: &Arc<App>, scope: Option<&str>, start: &LessonStart) -> Result<Result<Start, NotFound>, String> {
	Ok(match start {
		LessonStart::Topics(topic_ids) => {
			let study = topic_study_for(app, scope, topic_ids)?;
			if study.topics.is_empty() {
				return Ok(Err(NotFound { code: "topics_not_found", error: "No such topics" }));
			}
			Ok(Start { title: study_title(&study.topics), picks: study.picks, topics: study.topics, note: None })
		}
		LessonStart::MockQuestion { mock_id, question_id } => {
			let mock = match scope {
				Some(space_id) => app.stores.mocks.read_mock(space_id, mock_id)?,
				None => None,
			};
			let question = mock.as_ref().and_then(|m| items(&m["questions"]).iter().find(|q| q["id"].as_str() == Some(question_id.as_str())));
			let note = mock.as_ref().and_then(|m| go_over_text(m, question_id));
			let (Some(mock), Some(question), Some(note)) = (&mock, question, note) else {
				return Ok(Err(NotFound { code: "topics_not_found", error: "No such question" }));
			};
			// The topics of the facts it tested are the plan; a question with none is its own topic,
			// weak, since it is being gone over, and latest wrong unless it was right.
			let title = question["title"].as_str().unwrap_or("");
			let fact_ids: Vec<String> = items(&question["factIds"]).iter().filter_map(|f| f.as_str().map(str::to_owned)).collect();
			let tested = if fact_ids.is_empty() { Vec::new() } else { study_topics_for(app, scope, &fact_ids, title)? };
			let topics = if tested.is_empty() {
				let mut own = Obj::new();
				own.insert("id", FREE_TOPIC_ID);
				own.insert("name", title);
				own.insert("status", "weak");
				if question_result(mock, question_id) != Some("right") {
					own.insert("latestWrong", true);
				}
				own.insert("factIds", Json::Arr(Vec::new()));
				vec![Json::Obj(own)]
			} else {
				tested
			};
			Ok(Start { title: format!("Go over: {title}"), picks: Vec::new(), topics, note: Some(note) })
		}
		LessonStart::Deadline(deadline_id) => {
			let deadline = match scope {
				Some(space_id) => deadline_study_for(app, space_id, deadline_id)?,
				None => None,
			};
			let Some(deadline) = deadline else {
				return Ok(Err(NotFound { code: "deadline_not_found", error: "No such deadline" }));
			};
			// A deadline with no topics yet is studied by name.
			if deadline.topics.is_empty() {
				return Ok(Ok(typed(app, scope, &format!("Study for {}", deadline.name), Vec::new())?));
			}
			Ok(Start { title: study_title(&deadline.topics), picks: deadline.picks, topics: deadline.topics, note: None })
		}
		LessonStart::Typed { title, picks } => Ok(typed(app, scope, gs_base::text::trim(title), picks.iter().take(MAX_STUDY_FACTS).cloned().collect())?),
	})
}

/// A typed topic: its picked facts grouped into topics, or the one topic it names. Picked facts
/// with nothing typed are titled after their topics.
fn typed(app: &Arc<App>, scope: Option<&str>, title: &str, picks: Vec<Json>) -> Result<Start, String> {
	let fact_ids: Vec<String> = picks.iter().filter_map(|p| p["id"].as_str().map(str::to_owned)).collect();
	let topics = study_topics_for(app, scope, &fact_ids, &title_from_prompt(if title.is_empty() { "Untitled session" } else { title }))?;
	let title = if !title.is_empty() {
		title.to_owned()
	} else if !picks.is_empty() {
		study_title(&topics)
	} else {
		"Untitled session".to_owned()
	};
	Ok(Start { title, picks, topics, note: None })
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	/// A space with an interview and one graded mock: q1 right on a fact, q2 left blank on a fact,
	/// q3 wrong with no facts.
	fn graded_mock(app: &Arc<App>) -> String {
		let space_id = app.stores.spaces.create_space(&gs_json::json!({ "name": "Larkspur onsite" })).unwrap()["id"].as_str().unwrap().to_owned();
		let deadline = app.stores.spaces.add_deadline(&space_id, &gs_json::json!({ "kind": "interview", "name": "Onsite", "date": "2099-01-15" })).unwrap();
		let mock = gs_json::json!({
			"id": "mock_0000abcd", "deadlineId": deadline["id"], "n": 1, "format": { "questions": 3, "minutes": 30 }, "createdAt": "2026-11-11T10:00:00.000Z",
			"questions": [
				{ "id": "q1", "factIds": ["f_strings"], "title": "Count the vowels", "statement": "Count them.", "kind": "text" },
				{ "id": "q2", "factIds": ["f_closures"], "title": "Explain closures", "statement": "What is one?", "kind": "text" },
				{ "id": "q3", "title": "Big O of a loop", "statement": "How fast?", "kind": "text" },
			],
			"answers": { "q1": { "text": "Five", "seconds": 60, "submitted": true }, "q3": { "text": "n squared", "seconds": 60, "submitted": true } },
			"startedAt": "2026-11-11T10:00:00.000Z", "endedAt": "2026-11-11T10:20:00.000Z", "pauses": [],
			"grades": { "q1": { "verdict": "right", "feedback": "Correct." }, "q3": { "verdict": "wrong", "feedback": "It is linear." } },
		});
		app.stores.mocks.write_mock(&space_id, &mock).unwrap();
		space_id
	}

	fn start(app: &Arc<App>, space_id: &str, start: LessonStart) -> Result<(Json, String), NotFound> {
		create_lesson(app, CreateLessonInput { space_id: Some(space_id.to_owned()), start }).unwrap().map(|created| (app.stores.chats.get_chat(created.chat["id"].as_str().unwrap()).unwrap(), created.title))
	}

	fn study_plan(chat: &Json) -> &str {
		chat["messages"].as_arr().unwrap().iter().find(|m| m["customType"].as_str() == Some("study-context")).unwrap()["content"].as_str().unwrap()
	}

	#[tokio::test]
	async fn a_graded_mock_question_is_gone_over_with_the_grade_under_the_plan() {
		let root = scratch_dir("lesson-go-over");
		let app = test_app(&root);
		let space_id = graded_mock(&app);
		let go_over = |question: &str| LessonStart::MockQuestion { mock_id: "mock_0000abcd".to_owned(), question_id: question.to_owned() };
		let (lesson, title) = start(&app, &space_id, go_over("q1")).unwrap();
		assert_eq!(title, "Go over: Count the vowels");
		let plan = study_plan(&lesson);
		assert!(plan.contains("\n\n[Mock question] The learner wants to go over this question from Mock 1."), "{plan}");
		assert!(plan.contains("Your grade then: right. Your feedback then:\nCorrect."));
		assert_eq!(start(&app, &space_id, go_over("q9")).unwrap_err(), NotFound { code: "topics_not_found", error: "No such question" });
		let (free, _) = start(&app, &space_id, go_over("q3")).unwrap();
		assert!(study_plan(&free).contains("1. Big O of a loop — node topic, weak (latest wrong)"), "a question with no topic is its own, gone over because it went wrong");
	}

	#[test]
	fn a_lesson_started_as_its_space_goes_is_not_created() {
		let root = scratch_dir("lesson-space-gone");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&gs_json::json!({ "name": "Algebra" })).unwrap()["id"].as_str().unwrap().to_owned();
		// The delete holds the space while the lesson is started.
		let deleting = app.locks.lock(LockKey::Space(&space_id));
		let (starting, space) = (app.clone(), space_id.clone());
		let started = std::thread::spawn(move || {
			let input = CreateLessonInput { space_id: Some(space), start: LessonStart::Typed { title: "Sets".to_owned(), picks: Vec::new() } };
			create_lesson(&starting, input).unwrap().map(drop)
		});
		std::thread::sleep(std::time::Duration::from_millis(100));
		app.stores.spaces.delete_space(&space_id).unwrap();
		drop(deleting);
		assert_eq!(started.join().unwrap(), Err(NotFound { code: "space_not_found", error: "No such space" }));
		assert!(app.stores.chats.list_chats().is_empty());
	}
}
