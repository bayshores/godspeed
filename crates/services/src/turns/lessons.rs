//! Lesson creation (lessons.ts): the one place a new lesson record is born (POST /api/chats and
//! MCP start_lesson), so a lesson in a space always opens with its space card. Every new lesson
//! is a study session: on a typed topic, picked facts, some of the space's topics, one question
//! of a graded mock, a deadline, one topic of the space's path, or some of its files. With no
//! space topics for it, the agent writes the plan.
//!
//! Message order at birth: space card, graph-context picks, study plan; the caller then sends the
//! learner's first message. A start from a deadline is recorded on the chat so that deadline's
//! Study button can reopen it.

use std::collections::HashMap;
use std::sync::Arc;

use gs_base::locks::LockKey;
use gs_core::contracts::graph::title_from_prompt;
use gs_core::contracts::space::display_name;
use gs_core::graph::chains::{chains_for_selection, format_chain_line};
use gs_core::graph::graph::get_graph;
use gs_core::messages::native_messages::{new_space_context_message, new_graph_context_message, new_study_context_message};
use gs_core::mocks::mock::question_result;
use gs_core::mocks::mock_requests::go_over_text;
use gs_core::spaces::problem_list::{ListOwner, problems_of};
use gs_core::study::homework::files_context_text;
use gs_core::study::study::{FREE_TOPIC_ID, MAX_STUDY_FACTS, no_topics_text, study_context_text, study_plan_tree, study_title};
use gs_core::study::topic_parts::NO_PLOT_YET;
use gs_json::{Json, Obj, json};

use crate::App;
use crate::spaces::space_card::{space_card_for, space_file_path};
use crate::graph::graph::graph_store_for;
use crate::graph::study_start::{deadline_study_for, nearest_topics_for, path_study_for, study_topics_for, topic_study_for};

/// What a lesson starts from.
pub enum LessonStart {
	/// A typed topic (its title), with any facts picked for it (`{id, name, statement}`) and the
	/// space topics nearest it (see `LessonStart::typed`).
	Typed { title: String, picks: Vec<Json>, nearest: Vec<Json> },
	/// Some of the space's topics.
	Topics(Vec<String>),
	/// One question of a graded mock, to go over.
	MockQuestion { mock_id: String, question_id: String },
	/// A deadline: its topics for today.
	Deadline(String),
	/// One topic of the space's path, by id.
	PathTopic(String),
	/// Files of the space, the first one first (`files_lesson` decides when one starts).
	Files(Vec<String>),
}

impl LessonStart {
	/// A typed start. With nothing picked in a space, the fact search finds the topics nearest the
	/// title, so the plan note says where the learner really stands on them. Run before
	/// `create_lesson`, which holds the space's lock and so cannot wait on a search.
	pub async fn typed(app: &App, scope: Option<&str>, title: &str, picks: Vec<Json>) -> Result<LessonStart, String> {
		let title = gs_base::text::trim(title);
		let nearest = match scope {
			Some(space_id) if picks.is_empty() && !title.is_empty() => nearest_topics_for(app, space_id, title).await?,
			_ => Vec::new(),
		};
		Ok(LessonStart::Typed { title: title.to_owned(), picks, nearest })
	}
}

pub struct CreateLessonInput {
	/// None is "No space".
	pub space_id: Option<String>,
	pub start: LessonStart,
	/// A deadline of the space the lesson is for, though it does not start from the deadline's
	/// topics (a practice test for it).
	pub for_deadline: Option<String>,
}

/// A new lesson: `title` is the whole title (the record's may be shortened), the first message.
pub struct Created {
	pub chat: Json,
	pub title: String,
}

/// The 404 refusals: `space_not_found`, `topics_not_found` (a path topic too),
/// `deadline_not_found`, `file_not_found`.
#[derive(Debug, PartialEq)]
pub struct NotFound {
	pub code: &'static str,
	pub error: &'static str,
}

const NO_DEADLINE: NotFound = NotFound { code: "deadline_not_found", error: "No such deadline" };

struct Start {
	title: String,
	picks: Vec<Json>,
	topics: Vec<Json>,
	/// With no topics: the space topics nearest the title.
	nearest: Vec<Json>,
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
	if let Some(id) = &input.for_deadline
		&& !cls.as_ref().is_some_and(|c| c["deadlines"].items().iter().any(|d| d["id"].as_str() == Some(id)))
	{
		return Ok(Err(NO_DEADLINE));
	}
	let start = match start_of(app, scope, &input.start)? {
		Ok(start) => start,
		Err(not_found) => return Ok(Err(not_found)),
	};
	let deadline_id = match &input.start {
		LessonStart::Deadline(id) => Some(id.as_str()),
		_ => input.for_deadline.as_deref(),
	};
	let space_id = cls.as_ref().and_then(|c| c["id"].as_str());
	let file_ids = match &input.start {
		LessonStart::Files(ids) => ids.as_slice(),
		_ => &[],
	};
	let chat = app.stores.chats.create_chat(&title_from_prompt(&start.title), Some("study"), space_id, deadline_id, file_ids)?;
	let chat_id = chat["id"].str_or_empty().to_owned();
	let mut messages = Vec::new();
	if let Some(cls) = &cls {
		messages.push(new_space_context_message(&space_card_for(app, cls)?));
	}
	if !start.picks.is_empty() {
		// The picks carry what the learner saw; the chains come from the lesson's own space graph.
		let graph = get_graph(graph_store_for(app, scope).as_ref())?;
		let by_id: HashMap<&str, &Json> = graph.nodes.iter().filter_map(|n| Some((n["id"].as_str()?, n))).collect();
		let names: HashMap<String, String> = by_id.iter().map(|(id, n)| ((*id).to_owned(), n["name"].str_or_empty().to_owned())).collect();
		let picked: Vec<Json> = start.picks.iter().filter_map(|p| by_id.get(p["id"].as_str()?).map(|n| (*n).clone())).collect();
		let lines: Vec<String> = chains_for_selection(&picked, &graph.chains)
			.iter()
			.map(|c| {
				let premises: Vec<&str> = c["premises"].items().iter().filter_map(Json::as_str).collect();
				format_chain_line(&premises, c["conclusion"].str_or_empty(), &names)
			})
			.collect();
		messages.push(new_graph_context_message(&start.picks, &lines));
	}
	// The first topic starts here, with no plot yet. With no topics the agent's plan_init writes
	// the tree.
	let topics = if start.topics.is_empty() { no_topics_text(&start.title, &start.nearest) } else { study_context_text(&start.topics) };
	let plan = format!("{topics}\n\n{NO_PLOT_YET}");
	let context = match &start.note {
		Some(note) => format!("{plan}\n\n{note}"),
		None => plan,
	};
	messages.push(new_study_context_message(&context, "study-context"));
	app.stores.chats.save_messages(&chat_id, &messages)?;
	if !start.topics.is_empty() {
		app.stores.chats.save_tree(&chat_id, &study_plan_tree(&start.topics)?)?;
	}
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
			Ok(Start { title: study_title(&study.topics), picks: study.picks, topics: study.topics, nearest: Vec::new(), note: None })
		}
		LessonStart::MockQuestion { mock_id, question_id } => {
			let mock = match scope {
				Some(space_id) => app.stores.mocks.read_mock(space_id, mock_id)?,
				None => None,
			};
			let question = mock.as_ref().and_then(|m| m["questions"].items().iter().find(|q| q["id"].as_str() == Some(question_id.as_str())));
			let note = mock.as_ref().and_then(|m| go_over_text(m, question_id));
			let (Some(mock), Some(question), Some(note)) = (&mock, question, note) else {
				return Ok(Err(NotFound { code: "topics_not_found", error: "No such question" }));
			};
			// The topics of the facts it tested are the plan; a question with none in a topic is its
			// own topic, weak, since it is being gone over, and latest wrong unless it was right.
			let title = question["title"].str_or_empty();
			let fact_ids: Vec<String> = question["factIds"].items().iter().filter_map(|f| f.as_str().map(str::to_owned)).collect();
			let tested = if fact_ids.is_empty() { Vec::new() } else { study_topics_for(app, scope, &fact_ids)? };
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
			Ok(Start { title: format!("Go over: {title}"), picks: Vec::new(), topics, nearest: Vec::new(), note: Some(note) })
		}
		LessonStart::Deadline(deadline_id) => {
			let deadline = match scope {
				Some(space_id) => deadline_study_for(app, space_id, deadline_id)?,
				None => None,
			};
			let Some(deadline) = deadline else {
				return Ok(Err(NO_DEADLINE));
			};
			// A deadline with no topics yet is studied by name.
			if deadline.topics.is_empty() {
				return Ok(Ok(typed(app, scope, &format!("Study for {}", deadline.name), Vec::new(), Vec::new())?));
			}
			Ok(Start { title: study_title(&deadline.topics), picks: deadline.picks, topics: deadline.topics, nearest: Vec::new(), note: None })
		}
		LessonStart::PathTopic(topic_id) => {
			let study = match scope {
				Some(space_id) => path_study_for(app, space_id, topic_id)?,
				None => None,
			};
			let Some(study) = study else {
				return Ok(Err(NotFound { code: "topics_not_found", error: "No such path topic" }));
			};
			let topics = vec![study.topic];
			Ok(Start { title: study_title(&topics), picks: study.picks, topics, nearest: Vec::new(), note: Some(study.note) })
		}
		LessonStart::Typed { title, picks, nearest } => Ok(typed(app, scope, gs_base::text::trim(title), picks.iter().take(MAX_STUDY_FACTS).cloned().collect(), nearest.clone())?),
		LessonStart::Files(file_ids) => {
			let space = scope.and_then(|id| app.stores.spaces.get_space(id));
			let file = |id: &String| space.as_ref().and_then(|s| s["files"].items().iter().find(|f| f["id"].as_str() == Some(id.as_str())));
			let files = file_ids.iter().map(file).collect::<Option<Vec<&Json>>>().unwrap_or_default();
			let (Some(space), Some(first)) = (&space, files.first()) else {
				return Ok(Err(NotFound { code: "file_not_found", error: "No such file" }));
			};
			let all = space["files"].items();
			let named: Vec<Json> = files
				.iter()
				.map(|f| {
					let mut entry = json!({ "id": f["id"], "name": f["name"], "path": space_file_path(app, space, f) });
					if let Some(tex) = all.iter().find(|t| t["pdfId"] == f["id"]) {
						entry.set("source", json!({ "name": tex["name"], "path": space_file_path(app, space, tex) }));
					}
					entry
				})
				.collect();
			let note = files_context_text(&named, problems_of(space, ListOwner::File(first["id"].str_or_empty())));
			Ok(Start { title: display_name(first["name"].str_or_empty()), picks: Vec::new(), topics: Vec::new(), nearest: Vec::new(), note: Some(note) })
		}
	})
}

/// A typed topic: its picked facts grouped into topics, or none when no picked fact is in one.
/// Picked facts with nothing typed are titled after their topics.
fn typed(app: &Arc<App>, scope: Option<&str>, title: &str, picks: Vec<Json>, nearest: Vec<Json>) -> Result<Start, String> {
	let fact_ids: Vec<String> = picks.iter().filter_map(|p| p["id"].as_str().map(str::to_owned)).collect();
	let topics = study_topics_for(app, scope, &fact_ids)?;
	let title = if !title.is_empty() {
		title.to_owned()
	} else if !topics.is_empty() {
		study_title(&topics)
	} else {
		"Untitled lesson".to_owned()
	};
	Ok(Start { title, picks, topics, nearest, note: None })
}

#[cfg(test)]
mod tests {
	use super::*;
	use gs_core::messages::role::is_custom;
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
		create_lesson(app, CreateLessonInput { space_id: Some(space_id.to_owned()), start, for_deadline: None }).unwrap().map(|created| (app.stores.chats.get_chat(created.chat["id"].as_str().unwrap()).unwrap(), created.title))
	}

	fn study_plan(chat: &Json) -> &str {
		chat["messages"].as_arr().unwrap().iter().find(|m| is_custom(m, "study-context")).unwrap()["content"].as_str().unwrap()
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
		assert!(plan.contains(&format!("\n\n{NO_PLOT_YET}\n\n[Mock question] The learner wants to go over this question from Mock 1.")), "the plot reminder, then the note: {plan}");
		assert!(plan.contains("Your grade then: right. Your feedback then:\nCorrect."));
		assert_eq!(start(&app, &space_id, go_over("q9")).unwrap_err(), NotFound { code: "topics_not_found", error: "No such question" });
		let (free, _) = start(&app, &space_id, go_over("q3")).unwrap();
		assert!(study_plan(&free).contains("1. Big O of a loop — node topic, weak (latest wrong)"), "a question with no topic is its own, gone over because it went wrong");
	}

	#[test]
	fn with_no_space_topics_the_agent_writes_the_plan() {
		let root = scratch_dir("lesson-no-topics");
		let app = test_app(&root);
		let space_id = graded_mock(&app);
		let (typed, title) = start(&app, &space_id, LessonStart::Typed { title: "Bayes' rule".to_owned(), picks: Vec::new(), nearest: Vec::new() }).unwrap();
		assert_eq!(title, "Bayes' rule");
		assert!(typed["tree"].is_null(), "no tree until the agent's plan_init: {:?}", typed["tree"]);
		assert_eq!(study_plan(&typed), format!("{}\n\n{NO_PLOT_YET}", no_topics_text("Bayes' rule", &[])));

		let deadline_id = app.stores.spaces.get_space(&space_id).unwrap()["deadlines"][0]["id"].as_str().unwrap().to_owned();
		let (by_deadline, title) = start(&app, &space_id, LessonStart::Deadline(deadline_id.clone())).unwrap();
		assert_eq!(title, "Study for Onsite");
		assert_eq!(by_deadline["deadlineId"].as_str(), Some(deadline_id.as_str()));
		assert!(by_deadline["tree"].is_null());
		assert!(study_plan(&by_deadline).starts_with("[Study plan] \u{2014} no space topics for this: Study for Onsite."));

		let practice = |deadline: &str| CreateLessonInput { space_id: Some(space_id.clone()), start: LessonStart::Typed { title: "Practice test".to_owned(), picks: Vec::new(), nearest: Vec::new() }, for_deadline: Some(deadline.to_owned()) };
		let for_it = create_lesson(&app, practice(&deadline_id)).unwrap().unwrap();
		assert_eq!((for_it.title.as_str(), for_it.chat["deadlineId"].as_str()), ("Practice test", Some(deadline_id.as_str())), "a typed lesson for the deadline");
		assert_eq!(create_lesson(&app, practice("ddl_nope")).unwrap().map(|c| c.title), Err(NO_DEADLINE), "not a deadline of this space");
	}

	#[tokio::test]
	async fn a_typed_start_names_the_nearest_topics_and_starts_without_them_when_the_search_fails() {
		let root = scratch_dir("lesson-nearest");
		let app = test_app(&root);
		let space_id = graded_mock(&app);
		let near = gs_json::json!({ "id": "tpc_1", "name": "Processes", "material": "concept", "status": "untested", "factIds": [] });
		let (typed, _) = start(&app, &space_id, LessonStart::Typed { title: "Fork a child".to_owned(), picks: Vec::new(), nearest: vec![near.clone()] }).unwrap();
		assert_eq!(study_plan(&typed), format!("{}\n\n{NO_PLOT_YET}", no_topics_text("Fork a child", &[near])));
		assert!(study_plan(&typed).contains("\n- Processes: concept, untested\n\n"), "{}", study_plan(&typed));

		// The test app has no search model: the search fails, and the lesson starts all the same.
		let fact = gs_json::json!({ "id": "n_fork", "name": "fork", "statement": "fork returns twice.", "aliases": [], "createdAt": "t", "provenance": [] });
		app.stores.graphs.append(Some(space_id.as_str()), gs_store::graph::Ledger::Nodes, &fact).unwrap();
		let LessonStart::Typed { title, nearest, .. } = LessonStart::typed(&app, Some(&space_id), "  Fork a child ", Vec::new()).await.unwrap() else { panic!("a typed start") };
		assert_eq!((title.as_str(), nearest.len()), ("Fork a child", 0));
	}

	/// A problem on `node` the learner solved, as a lesson stores it.
	fn solved(node: &str) -> Vec<Json> {
		let now = gs_base::clock::now_ms();
		vec![
			gs_json::json!({ "role": "assistant", "id": "m1", "content": [{ "type": "toolCall", "id": "p1", "name": "problem", "arguments": { "nodeId": node, "mode": "composition", "target": [], "statement": "Undo the last commit." } }], "timestamp": now }),
			gs_json::json!({ "role": "toolResult", "toolCallId": "p1", "toolName": "problem", "isError": false, "timestamp": now }),
			gs_json::json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "c1", "name": "conclude", "arguments": { "outcome": "solved" } }], "timestamp": now }),
			gs_json::json!({ "role": "toolResult", "toolCallId": "c1", "toolName": "conclude", "details": { "stop": { "kind": "topic", "nodeId": node, "activeMinutes": 2, "at": gs_base::time::iso(now) } }, "isError": false, "timestamp": now }),
		]
	}

	fn path_ids(app: &Arc<App>, space_id: &str) -> Vec<String> {
		app.stores.spaces.get_space(space_id).unwrap()["path"]["topics"].items().iter().map(|t| t["id"].as_str().unwrap().to_owned()).collect()
	}

	#[tokio::test]
	async fn a_goal_space_studies_its_path_one_topic_at_a_time() {
		use crate::spaces::space_actions::{Mark, SendFirstMessage, space_actions};
		use gs_core::spaces::space_tools::ToolOutcome;
		let root = scratch_dir("lesson-path");
		let app = test_app(&root);
		let send: SendFirstMessage = Arc::new(|_, _| Box::pin(async { Ok(()) }));
		let actions = space_actions(&app, Some("Teacher"), send, Mark::Started);
		let value = |outcome: ToolOutcome| match outcome {
			ToolOutcome::Ok { value, .. } => value,
			ToolOutcome::Err(error) => panic!("{error}"),
		};
		let topics = gs_json::json!([{ "name": "Git", "covers": "Commits and branches." }, { "name": "HTTP", "covers": "Methods and status codes." }, { "name": "SQL", "covers": "Joins." }]);
		let made = value(actions.create_space(&gs_json::json!({ "name": "Backend", "icon": "code", "path": { "goal": "backend developer", "topics": topics } })));
		assert_eq!(made["path"], gs_json::json!({ "topics": 3 }), "the answer counts, it does not repeat the list");
		let space_id = made["space"]["id"].as_str().unwrap().to_owned();
		let ids = path_ids(&app, &space_id);

		// Study takes the topic it is on, with its place and what it covers under the plan.
		let (lesson, title) = start(&app, &space_id, LessonStart::PathTopic(ids[0].clone())).unwrap();
		assert_eq!(title, "Study: Git");
		assert_eq!(study_plan(&lesson), format!("{}\n\n{NO_PLOT_YET}\n\n[Path] Topic 1 of 3 on his path to backend developer. It covers: Commits and branches.", study_context_text(&[gs_json::json!({ "id": ids[0], "name": "Git", "status": "untested", "factIds": [] })])));
		assert_eq!(start(&app, &space_id, LessonStart::PathTopic("pth_nope".to_owned())).unwrap_err(), NotFound { code: "topics_not_found", error: "No such path topic" });

		// Studied today and not strong yet: the path moves on. One right answer makes it strong.
		let path = |app: &Arc<App>| crate::graph::study_start::path_for(app, &space_id).unwrap().unwrap();
		assert_eq!(path(&app)["nextId"], gs_json::json!(ids[1]));
		app.stores.chats.save_messages(lesson["id"].as_str().unwrap(), &solved(&ids[0])).unwrap();
		assert_eq!(path(&app)["topics"][0]["status"], gs_json::json!("strong"), "the answer counts at once, with no facts read");

		// read_space shows names and standings, and what the next one covers.
		let read = value(actions.read_space(&gs_json::json!({ "space_id": space_id })));
		assert_eq!(read["path"], gs_json::json!({ "goal": "backend developer", "topics": [{ "name": "Git", "status": "strong" }, { "name": "HTTP", "status": "untested" }, { "name": "SQL", "status": "untested" }], "next": { "name": "HTTP", "covers": "Methods and status codes." } }));

		// "I know Git, put SQL first": the kept names keep their ids.
		let changed = value(actions.update_space(&gs_json::json!({ "space_id": space_id, "path": { "goal": "backend developer", "topics": [topics[2], topics[1]] } })));
		assert_eq!(changed["changed"]["path"], gs_json::json!({ "topics": 2, "removed": ["Git"] }));
		assert_eq!(path_ids(&app, &space_id), [ids[2].clone(), ids[1].clone()]);
		let refused = actions.update_space(&gs_json::json!({ "space_id": space_id, "path": { "goal": "backend developer", "topics": [topics[0], topics[0]] } }));
		assert!(matches!(refused, ToolOutcome::Err(e) if e == "\"Git\" is on the path twice."));

		// The agent starting a lesson on a path topic's name studies that topic.
		let started = value(actions.start_lesson(&gs_json::json!({ "space_id": space_id, "topic": "sql" })).await);
		let chat = app.stores.chats.get_chat(started["lessonId"].as_str().unwrap()).unwrap();
		assert_eq!(chat["tree"]["nodes"][0]["id"], gs_json::json!(ids[2]));
		assert!(study_plan(&chat).ends_with("[Path] Topic 1 of 2 on his path to backend developer. It covers: Joins."));
	}

	#[test]
	fn a_later_path_session_picks_the_facts_born_in_the_earlier_ones() {
		use gs_store::graph::Ledger;
		let root = scratch_dir("lesson-path-facts");
		let app = test_app(&root);
		let path = gs_json::json!({ "goal": "backend developer", "topics": [{ "id": "pth_git", "name": "Git", "covers": "Commits." }] });
		let space_id = app.stores.spaces.create_space(&gs_json::json!({ "name": "Backend", "path": path })).unwrap()["id"].as_str().unwrap().to_owned();
		let (first, _) = start(&app, &space_id, LessonStart::PathTopic("pth_git".to_owned())).unwrap();
		let other = app.stores.chats.create_chat("Other", Some("study"), Some(&space_id), None, &[]).unwrap();
		let scope = Some(space_id.as_str());
		for (id, chat) in [("n_revert", &first["id"]), ("n_other", &other["id"])] {
			let fact = gs_json::json!({ "id": id, "name": id, "statement": "s", "aliases": [], "createdAt": "t", "provenance": [{ "chatId": chat, "messageId": "m1" }] });
			app.stores.graphs.append(scope, Ledger::Nodes, &fact).unwrap();
		}
		let (later, _) = start(&app, &space_id, LessonStart::PathTopic("pth_git".to_owned())).unwrap();
		assert!(study_plan(&later).starts_with(&study_context_text(&[gs_json::json!({ "id": "pth_git", "name": "Git", "status": "untested", "factIds": ["n_revert"] })])));
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
			let input = CreateLessonInput { space_id: Some(space), start: LessonStart::Typed { title: "Sets".to_owned(), picks: Vec::new(), nearest: Vec::new() }, for_deadline: None };
			create_lesson(&starting, input).unwrap().map(drop)
		});
		std::thread::sleep(std::time::Duration::from_millis(100));
		app.stores.spaces.delete_space(&space_id).unwrap();
		drop(deleting);
		assert_eq!(started.join().unwrap(), Err(NotFound { code: "space_not_found", error: "No such space" }));
		assert!(app.stores.chats.list_chats().is_empty());
	}
}
