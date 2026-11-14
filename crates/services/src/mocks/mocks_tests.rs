//! Mocks end to end against a stand-in agent on the bridge: the questions land, the clock runs
//! with no agent (answers saved, examples run), ending asks for the grades, the grades count for
//! the sheet's topics, a mock past its time is ended on read, a failed write can be tried again,
//! and a deleted mock stops its grading's code runs.

use gs_base::clock;
use gs_core::mocks::mock::parse_mock_code;
use gs_engine::bridge::{AgentReply, ReplyCall, WaitOptions};

use super::*;
use crate::app::test_support::{scratch_dir, test_app};

const CODE: &str = "function countVowels(s) {\n\treturn [...s].filter((c) => 'aeiou'.includes(c)).length;\n}\n";

fn new_prep(app: &App) -> String {
	let prep = json!({
		"goal": "Online test for a junior web role",
		"about": "Two questions in 30 minutes.",
		"sources": [],
		"topics": [{ "id": "pt_strings", "name": "Strings" }, { "id": "pt_closures", "name": "Closures" }],
		"mock": { "questions": 2, "minutes": 30 },
	});
	let record = app.stores.spaces.create_space(&json!({ "name": "Junior web test", "prep": prep })).unwrap();
	record["id"].str_or_empty().to_owned()
}

fn questions() -> Json {
	json!({
		"questions": [
			{
				"title": "Count the vowels",
				"statement": "Return how many vowels `s` has.",
				"kind": "code",
				"topic_id": "pt_strings",
				"function_name": "countVowels",
				"params": ["s"],
				"examples": [{ "args": "[\"hello\"]", "expected": "2" }, { "args": "[\"xyz\"]", "expected": "0" }],
			},
			{ "title": "Explain closures", "statement": "What is a closure?", "kind": "text", "topic_id": "pt_closures" },
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
	let prep = prep_view(app, space_id).unwrap();
	items(&prep["mocks"]).iter().find(|m| m["id"].as_str() == Some(mock_id)).map_or(String::new(), |m| m["state"].str_or_empty().to_owned())
}

async fn ready_mock(app: &Arc<App>, space_id: &str) -> String {
	let mock_id = create_mock(app, space_id).unwrap();
	agent(app, Some(("write_mock_questions", questions()))).await;
	settled(app, space_id, &mock_id).await;
	mock_id
}

fn answer(text: &str, code: Json, seconds: f64) -> MockAction {
	let mut answer = json!({ "text": text, "language": "javascript", "seconds": seconds, "submitted": true });
	answer.as_obj_mut().unwrap().insert("code", parse_mock_code(&code));
	MockAction::Answer { question_id: "q1".to_owned(), answer }
}

/// Moves a running mock's start back past its time.
fn started_long_ago(app: &App, space_id: &str, mock_id: &str) {
	let mut mock = app.stores.mocks.read_mock(space_id, mock_id).unwrap().unwrap();
	mock.as_obj_mut().unwrap().insert("startedAt", time::iso(clock::now_ms() - 31 * 60_000));
	app.stores.mocks.write_mock(space_id, &mock).unwrap();
}

fn refusal<T: std::fmt::Debug>(outcome: Outcome<T>) -> (u16, String) {
	match outcome {
		Err(Stop::Refuse(status, error)) => (status, error),
		other => panic!("not a refusal: {other:?}"),
	}
}

#[tokio::test]
async fn a_mock_is_written_taken_with_no_agent_graded_and_counts_for_the_sheets_topics() {
	let root = scratch_dir("mocks-life");
	let app = test_app(&root);
	let space_id = new_prep(&app);
	let mock_id = create_mock(&app, &space_id).unwrap();
	assert_eq!(state(&app, &space_id, &mock_id), "writing");
	assert_eq!(refusal(create_mock(&app, &space_id)), (409, "Finish Mock 1 first.".to_owned()));
	let asked = agent(&app, Some(("write_mock_questions", questions()))).await;
	settled(&app, &space_id, &mock_id).await;
	assert!(asked.contains("They are preparing for: Online test for a junior web role"));
	assert!(asked.contains("Write a mock of exactly 2 questions for 30 minutes."));
	assert!(asked.contains("- pt_strings: Strings (not tested yet)"));

	let ready = view(&app, &space_id, &mock_id);
	assert_eq!(ready["prepName"], Json::from("Junior web test"));
	assert_eq!(ready["topics"], json!([{ "id": "pt_strings", "name": "Strings" }, { "id": "pt_closures", "name": "Closures" }]));
	let rows: Vec<Json> = items(&ready["mock"]["questions"]).iter().map(|q| json!([q["id"], q["kind"], q["topicId"]])).collect();
	assert_eq!(rows, [json!(["q1", "code", "pt_strings"]), json!(["q2", "text", "pt_closures"])]);
	assert_eq!(state(&app, &space_id, &mock_id), "ready");
	let python = "def countVowels(s):\n    return 0\n";
	let both = json!({ "javascript": CODE, "python": python });
	assert_eq!(refusal(change_mock(&app, &space_id, &mock_id, answer(CODE, both.clone(), 61.4))), (409, "This mock isn't running.".to_owned()), "no answers before the clock starts");
	assert_eq!(refusal(run_mock_examples(&app, &space_id, &mock_id, "q1", CODE, &Json::from("javascript")).await).0, 409);

	change_mock(&app, &space_id, &mock_id, MockAction::Start).unwrap();
	assert_eq!(refusal(change_mock(&app, &space_id, &mock_id, MockAction::Start)), (409, "This mock can't be started.".to_owned()));
	assert_eq!(state(&app, &space_id, &mock_id), "running");
	change_mock(&app, &space_id, &mock_id, answer(CODE, both.clone(), 61.4)).unwrap();
	assert_eq!(view(&app, &space_id, &mock_id)["mock"]["answers"]["q1"], json!({ "text": CODE, "language": "javascript", "code": both, "seconds": 61, "submitted": true }), "both languages are kept");

	let ran = run_mock_examples(&app, &space_id, &mock_id, "q1", CODE, &Json::from("javascript")).await.unwrap();
	assert_eq!(ran["examples"], json!([{ "returned": "2", "passed": true }, { "returned": "0", "passed": true }]));
	assert_eq!(refusal(run_mock_examples(&app, &space_id, &mock_id, "q2", CODE, &Json::from("javascript")).await), (404, "No such code question".to_owned()), "a written question has nothing to run");
	assert_eq!(refusal(run_mock_examples(&app, &space_id, &mock_id, "q1", CODE, &Json::from("ruby")).await), (400, "Pick JavaScript or Python.".to_owned()));

	change_mock(&app, &space_id, &mock_id, MockAction::End).unwrap();
	assert_eq!(state(&app, &space_id, &mock_id), "grading");
	until("the grading request is out", || is_running(&app, &mock_run_key(&space_id, &mock_id))).await;
	assert_eq!(refusal(change_mock(&app, &space_id, &mock_id, MockAction::Retry)), (409, "Your agent is still working on this mock.".to_owned()));
	let graded_prompt = agent(&app, Some(("grade_mock", json!({ "grades": [] })))).await;
	assert!(graded_prompt.contains("Mock 1: 2 questions in 30 minutes. They used 1 of them."));
	assert!(graded_prompt.contains("Their answer (JavaScript, 1 min):"));
	assert!(graded_prompt.contains("Run on the examples here: example 1 passed, example 2 passed."));
	assert!(graded_prompt.contains("## q2: Explain closures (written)\nWhat is a closure?\nThey left this blank. Don't grade it."));
	let sent_back = agent(&app, Some(("grade_mock", json!({ "grades": [{ "question": "q1", "verdict": "right", "feedback": "Correct and fast enough." }] })))).await;
	assert!(sent_back.contains("No grade for q1"), "grades that miss an answered question are sent back");
	settled(&app, &space_id, &mock_id).await;

	assert_eq!(view(&app, &space_id, &mock_id)["mock"]["grades"], json!({ "q1": { "verdict": "right", "feedback": "Correct and fast enough." } }));
	let sheet = prep_view(&app, &space_id).unwrap();
	let summaries: Vec<Json> = items(&sheet["mocks"]).iter().map(|m| json!([m["n"], m["state"], m["solved"]])).collect();
	assert_eq!(summaries, [json!([1, "graded", 1])]);
	let topics: Vec<Json> = items(&sheet["topics"]).iter().map(|t| json!([t["name"], t["answered"], t["right"]])).collect();
	assert_eq!(topics, [json!(["Strings", 1, 1]), json!(["Closures", 1, 0])], "a blank question counts as not known");

	let next = create_mock(&app, &space_id).unwrap();
	let asked = agent(&app, Some(("write_mock_questions", questions()))).await;
	settled(&app, &space_id, &next).await;
	assert_eq!(view(&app, &space_id, &next)["mock"]["n"], Json::from(2));
	assert!(asked.contains("Earlier mocks asked these. Don't ask them again:\n- Count the vowels\n- Explain closures"));
	delete_mock(&app, &space_id, &next).unwrap();
	assert_eq!(refusal(mock_view(&app, &space_id, &next)), (404, "No such mock".to_owned()));
	assert_eq!(items(&prep_view(&app, &space_id).unwrap()["mocks"]).len(), 1);
}

#[tokio::test]
async fn a_mock_past_its_time_is_ended_on_read_and_with_nothing_answered_nothing_is_asked() {
	let root = scratch_dir("mocks-over");
	let app = test_app(&root);
	let space_id = new_prep(&app);
	let mock_id = ready_mock(&app, &space_id).await;
	change_mock(&app, &space_id, &mock_id, MockAction::Start).unwrap();
	started_long_ago(&app, &space_id, &mock_id);
	let started = app.stores.mocks.read_mock(&space_id, &mock_id).unwrap().unwrap()["startedAt"].str_or_empty().to_owned();

	let over = view(&app, &space_id, &mock_id);
	assert_eq!(over["mock"]["endedAt"], Json::from(time::iso(time::parse_date(&started).unwrap() + 30 * 60_000)), "ended when its time ran out, not when it was read");
	assert_eq!(over["mock"]["grades"], json!({}));
	assert_eq!(over["working"], Json::Bool(false));
	assert_eq!(app.bridge.pending_work_count(), 0);
	assert_eq!(state(&app, &space_id, &mock_id), "graded");
	assert_eq!(refusal(change_mock(&app, &space_id, &mock_id, MockAction::Retry)), (409, "There is nothing to try again.".to_owned()));
}

#[tokio::test]
async fn a_mock_past_its_time_refuses_answers_and_runs_and_ends_then() {
	let root = scratch_dir("mocks-late");
	let app = test_app(&root);
	let space_id = new_prep(&app);
	let mock_id = ready_mock(&app, &space_id).await;
	change_mock(&app, &space_id, &mock_id, MockAction::Start).unwrap();
	started_long_ago(&app, &space_id, &mock_id);
	assert_eq!(refusal(run_mock_examples(&app, &space_id, &mock_id, "q1", CODE, &Json::from("javascript")).await), (409, "Time is up.".to_owned()));
	assert!(app.stores.mocks.read_mock(&space_id, &mock_id).unwrap().unwrap()["endedAt"].truthy(), "the run ended it");

	let later = ready_mock(&app, &space_id).await;
	change_mock(&app, &space_id, &later, MockAction::Start).unwrap();
	started_long_ago(&app, &space_id, &later);
	assert_eq!(refusal(change_mock(&app, &space_id, &later, answer(CODE, json!({ "javascript": CODE }), 5.0))), (409, "Time is up.".to_owned()));
	assert_eq!(app.stores.mocks.read_mock(&space_id, &later).unwrap().unwrap()["answers"], json!({}), "the late answer isn't kept");
	assert_eq!(state(&app, &space_id, &later), "graded");
}

#[tokio::test]
async fn a_failed_write_says_why_bad_questions_go_back_and_retry_asks_again() {
	let root = scratch_dir("mocks-retry");
	let app = test_app(&root);
	let space_id = new_prep(&app);
	let mock_id = create_mock(&app, &space_id).unwrap();
	agent(&app, None).await;
	settled(&app, &space_id, &mock_id).await;
	assert_eq!(view(&app, &space_id, &mock_id)["error"], Json::from("the agent never sent the questions"));
	assert_eq!(items(&prep_view(&app, &space_id).unwrap()["mocks"])[0]["error"], Json::from("the agent never sent the questions"));
	assert_eq!(state(&app, &space_id, &mock_id), "writing");

	change_mock(&app, &space_id, &mock_id, MockAction::Retry).unwrap();
	let one = json!({ "questions": [questions()["questions"][0].clone()] });
	agent(&app, Some(("write_mock_questions", one))).await;
	let sent_back = agent(&app, Some(("write_mock_questions", questions()))).await;
	assert!(sent_back.contains("Write exactly 2 questions (got 1)."));
	settled(&app, &space_id, &mock_id).await;
	assert!(view(&app, &space_id, &mock_id).get("error").is_none());
	assert_eq!(state(&app, &space_id, &mock_id), "ready");
	assert_eq!(refusal(change_mock(&app, &space_id, &mock_id, MockAction::Retry)), (409, "There is nothing to try again.".to_owned()));
}

#[tokio::test]
async fn deleting_a_mock_while_it_is_graded_stops_its_code_runs() {
	let root = scratch_dir("mocks-delete");
	let app = test_app(&root);
	let space_id = new_prep(&app);
	let mock_id = ready_mock(&app, &space_id).await;
	change_mock(&app, &space_id, &mock_id, MockAction::Start).unwrap();
	let endless = "function countVowels() { while (true) {} }";
	change_mock(&app, &space_id, &mock_id, answer(endless, json!({ "javascript": endless }), 5.0)).unwrap();
	change_mock(&app, &space_id, &mock_id, MockAction::End).unwrap();
	let key = mock_run_key(&space_id, &mock_id);
	until("the grading is out", || is_running(&app, &key)).await;
	let t0 = clock::now_ms();
	delete_mock(&app, &space_id, &mock_id).unwrap();
	assert!(!is_running(&app, &key));
	assert_eq!(app.stores.mocks.read_mock(&space_id, &mock_id).unwrap(), None);
	clock::sleep(300).await;
	assert_eq!(app.bridge.pending_work_count(), 0, "the teacher is never asked to grade it");
	assert!(clock::now_ms() - t0 < 4000);
	assert_eq!(run_error(&app, &key), None);
}

#[tokio::test]
async fn ids_and_spaces_that_are_not_mocks_or_preps_are_refused() {
	let root = scratch_dir("mocks-ids");
	let app = test_app(&root);
	let space_id = new_prep(&app);
	assert_eq!(refusal(mock_view(&app, &space_id, "mock_00000000")), (404, "No such mock".to_owned()));
	let plain = app.stores.spaces.create_space(&json!({ "name": "Plain space" })).unwrap();
	assert_eq!(refusal(create_mock(&app, plain["id"].str_or_empty())), (404, "No such prep".to_owned()));
	let unwritten = app.stores.spaces.create_space(&json!({ "name": "Unwritten", "prep": { "goal": "A test", "about": "", "sources": [], "topics": [] } })).unwrap();
	assert_eq!(refusal(create_mock(&app, unwritten["id"].str_or_empty())), (409, "The prep sheet doesn't say what a mock is yet. Write the sheet first.".to_owned()));
}
