//! Mocks end to end against a stand-in agent on the bridge: a mock belongs to its deadline and is
//! written from what it is like, taken with no agent (answers saved, examples run), paused and
//! resumed, ended by End mock or by its time, graded, and removed; a paused mock is never ended
//! by its old end time.

use gs_base::{clock, fsx};
use gs_core::mocks::mock::parse_mock_code;
use gs_engine::bridge::{AgentReply, ReplyCall, WaitOptions};

use super::*;
use crate::app::test_support::{scratch_dir, test_app};

const CODE: &str = "function countVowels(s) {\n\treturn [...s].filter((c) => 'aeiou'.includes(c)).length;\n}\n";

/// A space with an info file on what the interview is like, the interview pointing at it, and a
/// homework deadline. Its id and the two deadlines' ids.
fn interview_space(app: &App) -> (String, String, String) {
	let space_id = app.stores.spaces.create_space(&json!({ "name": "Larkspur onsite" })).unwrap()["id"].str_or_empty().to_owned();
	let file = json!({ "id": "f_about", "origin": "copied", "name": "What it's like.md", "path": "f_about/What it's like.md", "kind": "info", "contentFp": "", "status": "ready", "addedAt": "t" });
	fsx::write_text_atomic(&app.stores.spaces.files_dir(&space_id).unwrap().join("f_about/What it's like.md"), "Two coding rounds.").unwrap();
	app.stores.spaces.rewrite_space(&space_id, |r| {
		let mut next = r.clone();
		next.as_obj_mut().unwrap().insert("files", json!([file]));
		next
	}).unwrap();
	let add = |init: Json| app.stores.spaces.add_deadline(&space_id, &init).unwrap()["id"].str_or_empty().to_owned();
	let onsite = add(json!({ "kind": "interview", "name": "Onsite", "date": "2026-11-24", "time": "14:00", "aboutFileId": "f_about" }));
	let homework = add(json!({ "kind": "homework", "name": "Take-home", "date": "2026-11-20" }));
	(space_id, onsite, homework)
}

fn questions() -> Json {
	json!({
		"questions": [
			{
				"title": "Count the vowels",
				"statement": "Return how many vowels `s` has.",
				"kind": "code",
				"function_name": "countVowels",
				"params": ["s"],
				"examples": [{ "args": "[\"hello\"]", "expected": "2" }, { "args": "[\"xyz\"]", "expected": "0" }],
			},
			{ "title": "Explain closures", "statement": "What is a closure?", "kind": "text" },
		],
	})
}

/// Answers the next work item with one tool call (or words); what it was asked, as text.
async fn agent(app: &App, call: Option<(&str, Json)>) -> String {
	let view = app.bridge.wait_for_work(10_000, WaitOptions::default()).await.expect("a work item");
	let reply = match call {
		Some((name, arguments)) => AgentReply { text: None, tool_calls: vec![ReplyCall { name: name.to_owned(), arguments }] },
		None => AgentReply { text: Some("I can't.".to_owned()), tool_calls: Vec::new() },
	};
	app.bridge.respond_to_work(&view.work_id, reply, 0).unwrap();
	view.messages.iter().map(|m| m["text"].str_or_empty().to_owned()).collect::<Vec<_>>().join("\n")
}

async fn until(what: &str, done: impl Fn() -> bool) {
	for _ in 0..2000 {
		if done() {
			return;
		}
		clock::sleep(5).await;
	}
	panic!("{what}");
}

fn view(app: &Arc<App>, space_id: &str, mock_id: &str) -> Json {
	mock_view(app, space_id, mock_id).unwrap()
}

async fn settled(app: &Arc<App>, space_id: &str, mock_id: &str) {
	until("the mock's request ended", || !view(app, space_id, mock_id)["working"].truthy()).await;
}

fn state(app: &Arc<App>, space_id: &str, mock_id: &str) -> String {
	view(app, space_id, mock_id)["mock"].get("questions").map_or(String::new(), |_| mock_state(&view(app, space_id, mock_id)["mock"]).as_str().to_owned())
}

fn two(minutes: Option<i64>) -> (Json, Option<Json>) {
	(json!(2), minutes.map(Json::from))
}

async fn ready_mock(app: &Arc<App>, space_id: &str, deadline_id: &str, minutes: Option<i64>) -> String {
	let (questions, minutes) = two(minutes);
	let mock_id = create_mock(app, space_id, deadline_id, &questions, minutes.as_ref()).unwrap();
	agent(app, Some(("write_mock_questions", self::questions()))).await;
	settled(app, space_id, &mock_id).await;
	mock_id
}

fn answer(text: &str, code: Json, seconds: f64) -> MockAction {
	let mut answer = json!({ "text": text, "language": "javascript", "seconds": seconds, "submitted": true });
	answer.as_obj_mut().unwrap().insert("code", parse_mock_code(&code));
	MockAction::Answer { question_id: "q1".to_owned(), answer }
}

/// Sets fields of a saved mock, as if time had passed.
fn edited(app: &App, space_id: &str, mock_id: &str, fields: Json) {
	let mut mock = app.stores.mocks.read_mock(space_id, mock_id).unwrap().unwrap();
	for (key, value) in fields.as_obj().unwrap() {
		mock.as_obj_mut().unwrap().insert(key.as_str(), value.clone());
	}
	app.stores.mocks.write_mock(space_id, &mock).unwrap();
}

fn ago(ms: i64) -> Json {
	Json::from(time::iso(clock::now_ms() - ms))
}

fn refusal<T: std::fmt::Debug>(outcome: Outcome<T>) -> (u16, String) {
	match outcome {
		Err(Stop::Refuse(status, error)) => (status, error),
		other => panic!("not a refusal: {other:?}"),
	}
}

#[tokio::test]
async fn a_mock_is_written_from_its_deadline_taken_with_no_agent_and_graded() {
	let root = scratch_dir("mocks-life");
	let app = test_app(&root);
	let (space_id, onsite, homework) = interview_space(&app);
	let (questions, minutes) = two(Some(30));
	assert_eq!(refusal(create_mock(&app, &space_id, &homework, &questions, None)), (400, "Mocks are for exams, quizzes and interviews.".to_owned()));
	assert_eq!(refusal(create_mock(&app, &space_id, &onsite, &json!(11), None)).0, 400);
	assert_eq!(refusal(create_mock(&app, &space_id, "ddl_gone", &questions, None)), (404, "No such deadline".to_owned()));
	app.stores.spaces.update_deadline(&space_id, &onsite, &json!({ "done": true })).unwrap();
	assert_eq!(refusal(create_mock(&app, &space_id, &onsite, &questions, None)), (409, "This deadline is done.".to_owned()));
	app.stores.spaces.update_deadline(&space_id, &onsite, &json!({ "done": false })).unwrap();
	let mock_id = create_mock(&app, &space_id, &onsite, &questions, minutes.as_ref()).unwrap();
	assert_eq!(refusal(create_mock(&app, &space_id, &onsite, &questions, None)), (409, "Finish Mock 1 first.".to_owned()));
	let asked = agent(&app, Some(("write_mock_questions", self::questions()))).await;
	settled(&app, &space_id, &mock_id).await;
	assert!(asked.starts_with("They are preparing for: Onsite (interview).\n\nWhat it is like:\nTwo coding rounds.\n\nWrite a mock of exactly 2 questions for 30 minutes."), "{asked}");
	assert!(asked.contains("It has no study facts yet"));

	let ready = view(&app, &space_id, &mock_id);
	assert_eq!((ready["deadlineId"].clone(), ready["deadlineName"].clone()), (json!(onsite), json!("Onsite")));
	assert_eq!(ready["mock"]["fromAbout"], json!(true), "written from what it is like alone");
	assert_eq!(state(&app, &space_id, &mock_id), "ready");
	let both = json!({ "javascript": CODE, "python": "def countVowels(s):\n    return 0\n" });
	assert_eq!(refusal(change_mock(&app, &space_id, &mock_id, answer(CODE, both.clone(), 61.4))), (409, "This mock isn't running.".to_owned()));

	change_mock(&app, &space_id, &mock_id, MockAction::Start).unwrap();
	assert_eq!(refusal(change_mock(&app, &space_id, &mock_id, MockAction::Start)), (409, "This mock can't be started.".to_owned()));
	change_mock(&app, &space_id, &mock_id, answer(CODE, both.clone(), 61.4)).unwrap();
	assert_eq!(view(&app, &space_id, &mock_id)["mock"]["answers"]["q1"], json!({ "text": CODE, "language": "javascript", "code": both, "seconds": 61, "submitted": true }));
	let ran = run_mock_examples(&app, &space_id, &mock_id, "q1", CODE, &Json::from("javascript")).await.unwrap();
	assert_eq!(ran["examples"], json!([{ "returned": "2", "passed": true }, { "returned": "0", "passed": true }]));
	assert_eq!(refusal(run_mock_examples(&app, &space_id, &mock_id, "q2", CODE, &Json::from("javascript")).await), (404, "No such code question".to_owned()));

	change_mock(&app, &space_id, &mock_id, MockAction::End).unwrap();
	assert_eq!(state(&app, &space_id, &mock_id), "grading");
	until("the grading request is out", || is_running(&app, &mock_run_key(&space_id, &mock_id))).await;
	let graded_prompt = agent(&app, Some(("grade_mock", json!({ "grades": [{ "question": "q1", "verdict": "right", "feedback": "Correct." }] })))).await;
	assert!(graded_prompt.starts_with("They are preparing for: Onsite (interview).\nMock 1: 2 questions for 30 minutes. They used 1 of them."), "{graded_prompt}");
	settled(&app, &space_id, &mock_id).await;
	assert_eq!(state(&app, &space_id, &mock_id), "graded");

	let next = create_mock(&app, &space_id, &onsite, &json!(1), None).unwrap();
	let asked = agent(&app, Some(("write_mock_questions", json!({ "questions": [questions_one()] })))).await;
	assert!(asked.contains("exactly 1 question, with no time limit.") && asked.contains("Earlier mocks asked these. Don't ask them again:\n- Count the vowels\n- Explain closures"));
	settled(&app, &space_id, &next).await;
	let rows: Vec<Json> = list_mocks(&app, &space_id, Some(&onsite)).unwrap().iter().map(|m| json!([m["n"], m["state"], m["solved"]])).collect();
	assert_eq!(rows, [json!([2, "ready", null]), json!([1, "graded", 1])], "newest first, numbered per deadline");
	assert!(list_mocks(&app, &space_id, Some(&homework)).unwrap().is_empty());
	delete_mock(&app, &space_id, &next).unwrap();
	assert_eq!(refusal(mock_view(&app, &space_id, &next)), (404, "No such mock".to_owned()));
}

fn questions_one() -> Json {
	questions()["questions"][1].clone()
}

#[tokio::test]
async fn a_paused_mock_refuses_saves_and_runs_stays_paused_past_its_old_end_and_resumes_with_its_time() {
	let root = scratch_dir("mocks-paused");
	let app = test_app(&root);
	let (space_id, onsite, _) = interview_space(&app);
	let mock_id = ready_mock(&app, &space_id, &onsite, Some(5)).await;
	change_mock(&app, &space_id, &mock_id, MockAction::Start).unwrap();
	change_mock(&app, &space_id, &mock_id, MockAction::Pause).unwrap();
	assert_eq!(state(&app, &space_id, &mock_id), "paused");
	// Paused two hours ago with 4 minutes left: long past when it would have ended.
	edited(&app, &space_id, &mock_id, json!({ "startedAt": ago(7_260_000), "paused": { "at": ago(7_200_000), "left": 240 } }));
	let still = view(&app, &space_id, &mock_id);
	assert_eq!((mock_state(&still["mock"]).as_str(), still["mock"]["paused"]["left"].clone()), ("paused", json!(240)), "never ended by the clock");
	assert_eq!(refusal(change_mock(&app, &space_id, &mock_id, answer(CODE, json!({ "javascript": CODE }), 5.0))), (409, "This mock is paused.".to_owned()));
	assert_eq!(refusal(run_mock_examples(&app, &space_id, &mock_id, "q1", CODE, &Json::from("javascript")).await), (409, "This mock is paused.".to_owned()));
	assert_eq!(refusal(change_mock(&app, &space_id, &mock_id, MockAction::Pause)), (409, "This mock is paused.".to_owned()));

	let before = clock::now_ms();
	change_mock(&app, &space_id, &mock_id, MockAction::Resume).unwrap();
	let resumed = view(&app, &space_id, &mock_id)["mock"].clone();
	let ends = time::parse_date(resumed["endsAt"].str_or_empty()).unwrap();
	assert!(ends >= before + 240_000 && ends <= clock::now_ms() + 240_000, "it runs for the time it had left");
	assert_eq!(resumed["pauses"].as_arr().unwrap().len(), 1);
	change_mock(&app, &space_id, &mock_id, answer(CODE, json!({ "javascript": CODE }), 5.0)).unwrap();

	// Its time runs out: the next read ends it at its end time and asks for the grades.
	let end = ago(11_000);
	edited(&app, &space_id, &mock_id, json!({ "endsAt": end }));
	assert_eq!(view(&app, &space_id, &mock_id)["mock"]["endedAt"], end, "ended by itself, at its time");
	let graded_prompt = agent(&app, Some(("grade_mock", json!({ "grades": [{ "question": "q1", "verdict": "right", "feedback": "Yes." }] })))).await;
	assert!(graded_prompt.contains(" Paused 1 time, 120 minutes in total."), "{graded_prompt}");
}

#[tokio::test]
async fn a_mock_with_no_time_limit_runs_until_it_is_ended_and_cannot_be_paused() {
	let root = scratch_dir("mocks-untimed");
	let app = test_app(&root);
	let (space_id, onsite, _) = interview_space(&app);
	let mock_id = ready_mock(&app, &space_id, &onsite, None).await;
	change_mock(&app, &space_id, &mock_id, MockAction::Start).unwrap();
	edited(&app, &space_id, &mock_id, json!({ "startedAt": ago(86_400_000) }));
	assert_eq!(state(&app, &space_id, &mock_id), "running", "still running a day later");
	assert_eq!(refusal(change_mock(&app, &space_id, &mock_id, MockAction::Pause)), (409, "This mock has no time limit.".to_owned()));
	change_mock(&app, &space_id, &mock_id, answer(CODE, json!({ "javascript": CODE }), 5.0)).unwrap();
}

#[tokio::test]
async fn a_mock_past_its_time_refuses_answers_and_runs_and_ends_then() {
	let root = scratch_dir("mocks-late");
	let app = test_app(&root);
	let (space_id, onsite, _) = interview_space(&app);
	let mock_id = ready_mock(&app, &space_id, &onsite, Some(30)).await;
	change_mock(&app, &space_id, &mock_id, MockAction::Start).unwrap();
	edited(&app, &space_id, &mock_id, json!({ "endsAt": ago(60_000) }));
	assert_eq!(refusal(change_mock(&app, &space_id, &mock_id, answer(CODE, json!({ "javascript": CODE }), 5.0))), (409, "Time is up.".to_owned()));
	let ended = app.stores.mocks.read_mock(&space_id, &mock_id).unwrap().unwrap();
	assert_eq!(ended["answers"], json!({}), "the late answer isn't kept");
	assert_eq!(mock_state(&ended).as_str(), "graded", "nothing answered, nothing to grade");
	assert_eq!(app.bridge.pending_work_count(), 0);
}

#[tokio::test]
async fn a_failed_write_says_why_and_retry_asks_again() {
	let root = scratch_dir("mocks-retry");
	let app = test_app(&root);
	let (space_id, onsite, _) = interview_space(&app);
	let mock_id = create_mock(&app, &space_id, &onsite, &json!(2), None).unwrap();
	agent(&app, None).await;
	settled(&app, &space_id, &mock_id).await;
	assert_eq!(view(&app, &space_id, &mock_id)["error"], Json::from("the agent never sent the questions"));
	assert_eq!(list_mocks(&app, &space_id, None).unwrap()[0]["error"], Json::from("the agent never sent the questions"));
	change_mock(&app, &space_id, &mock_id, MockAction::Retry).unwrap();
	agent(&app, Some(("write_mock_questions", questions()))).await;
	settled(&app, &space_id, &mock_id).await;
	assert_eq!(state(&app, &space_id, &mock_id), "ready");
	assert_eq!(refusal(change_mock(&app, &space_id, &mock_id, MockAction::Retry)), (409, "There is nothing to try again.".to_owned()));
}

#[tokio::test]
async fn a_deadline_with_nothing_to_write_from_takes_no_mock_and_a_removed_one_takes_its_mocks() {
	let root = scratch_dir("mocks-deadline");
	let app = test_app(&root);
	let (space_id, onsite, _) = interview_space(&app);
	let bare = app.stores.spaces.add_deadline(&space_id, &json!({ "kind": "exam", "name": "Final", "date": "2026-12-10" })).unwrap()["id"].str_or_empty().to_owned();
	assert_eq!(refusal(create_mock(&app, &space_id, &bare, &json!(3), None)), (409, "This deadline has no study facts and no \"What it's like\" yet.".to_owned()));
	let mock_id = create_mock(&app, &space_id, &onsite, &json!(2), None).unwrap();
	let key = mock_run_key(&space_id, &mock_id);
	until("the questions request is out", || is_running(&app, &key)).await;
	assert_eq!(crate::spaces::remove_space_deadline(&app, &space_id, &onsite).unwrap(), 1);
	assert!(!is_running(&app, &key), "its request stops");
	assert!(app.stores.mocks.list_mocks(&space_id).unwrap().is_empty());
}

#[tokio::test]
async fn a_copy_read_before_its_mock_was_removed_or_ended_is_never_written_back() {
	let root = scratch_dir("mocks-stale");
	let app = test_app(&root);
	let (space_id, onsite, _) = interview_space(&app);
	let removed = ready_mock(&app, &space_id, &onsite, Some(30)).await;
	change_mock(&app, &space_id, &removed, MockAction::Start).unwrap();
	edited(&app, &space_id, &removed, json!({ "endsAt": ago(60_000) }));
	let stale = app.stores.mocks.read_mock(&space_id, &removed).unwrap().unwrap();
	delete_mock(&app, &space_id, &removed).unwrap();
	assert_eq!(finish(&app, &space_id, &stale).unwrap(), None);
	assert_eq!(app.stores.mocks.read_mock(&space_id, &removed).unwrap(), None, "a removed mock stays removed");

	let graded = ready_mock(&app, &space_id, &onsite, Some(30)).await;
	change_mock(&app, &space_id, &graded, MockAction::Start).unwrap();
	edited(&app, &space_id, &graded, json!({ "endsAt": ago(60_000) }));
	let stale = app.stores.mocks.read_mock(&space_id, &graded).unwrap().unwrap();
	change_mock(&app, &space_id, &graded, MockAction::End).unwrap();
	let grades = json!({ "q1": { "verdict": "right", "feedback": "Yes." } });
	edited(&app, &space_id, &graded, json!({ "grades": grades }));
	assert_eq!(finish(&app, &space_id, &stale).unwrap().unwrap()["grades"], grades);
	assert_eq!(app.stores.mocks.read_mock(&space_id, &graded).unwrap().unwrap()["grades"], grades, "its grades are kept");
	assert_eq!(app.bridge.pending_work_count(), 0, "no second grading");
}

#[test]
fn a_what_its_like_that_is_empty_or_not_text_is_nothing_to_write_from() {
	let root = scratch_dir("mocks-about");
	let app = test_app(&root);
	let (space_id, onsite, _) = interview_space(&app);
	let file = app.stores.spaces.files_dir(&space_id).unwrap().join("f_about/What it's like.md");
	let nothing = (409, "This deadline has no study facts and no \"What it's like\" yet.".to_owned());
	for bytes in [&b" \n"[..], &b"%PDF-1.7\n\xff\xfe\x00"[..]] {
		std::fs::write(&file, bytes).unwrap();
		assert_eq!(crate::spaces::deadline_about(&app, &space_id, &onsite), None, "the window shows no What it's like");
		assert_eq!(refusal(create_mock(&app, &space_id, &onsite, &json!(2), None)), nothing);
	}
}
