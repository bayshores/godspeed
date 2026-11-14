//! A mock's life: the teacher's questions are checked and kept, the clock runs, answers are saved
//! only while it runs, the grades come once it has ended, and its questions count for the prep's
//! topics.

use std::collections::HashSet;

use gs_json::{Json, json, parse, stringify};

use super::*;

fn format() -> Json {
	json!({ "questions": 3, "minutes": 70 })
}

fn topics() -> HashSet<String> {
	["pt_a", "pt_b"].into_iter().map(str::to_owned).collect()
}

fn code() -> Json {
	json!({
		"title": "Longest run",
		"statement": "Return the length of the longest run of 1s.",
		"kind": "code",
		"topic_id": "pt_a",
		"function_name": "longestRun",
		"params": ["nums"],
		"examples": [{ "args": "[[1,1,0,1]]", "expected": "2" }, { "args": " [[0]] ", "expected": "0" }],
	})
}

fn text_q() -> Json {
	json!({ "title": "Event loop", "statement": "Explain the event loop.", "kind": "text", "topic_id": "pt_gone" })
}

fn written() -> Vec<Json> {
	let mut second = code();
	second.as_obj_mut().unwrap().insert("title", "Second run");
	second.as_obj_mut().unwrap().insert("topic_id", "pt_b");
	vec![code(), text_q(), second]
}

fn running() -> Json {
	let questions = take_questions(&written(), &format(), &topics()).unwrap();
	let fresh = with(&new_mock("mock_0a1b2c3d", 1.0, &format(), "2026-11-11T09:00:00.000Z"), "questions", Json::from(questions));
	start_mock(&fresh, "2026-11-11T10:00:00.000Z")
}

fn changed(base: Json, change: Json) -> Json {
	let mut out = base;
	for (k, v) in change.as_obj().unwrap() {
		out.as_obj_mut().unwrap().insert(k.as_str(), v.clone());
	}
	out
}

#[test]
fn questions_are_kept_in_order_with_only_topics_the_prep_has() {
	let questions = take_questions(&written(), &format(), &topics()).unwrap();
	let rows: Vec<Json> = questions.iter().map(|q| json!([q["id"], q["kind"], q["topicId"]])).collect();
	assert_eq!(rows, vec![json!(["q1", "code", "pt_a"]), json!(["q2", "text", null]), json!(["q3", "code", "pt_b"])]);
	assert_eq!(questions[0]["fn"], json!({ "name": "longestRun", "params": ["nums"] }));
	assert_eq!(questions[0]["examples"][1], json!({ "args": "[[0]]", "expected": "0" }), "trimmed");
	assert_eq!(stringify(&questions[1]), r#"{"id":"q2","title":"Event loop","statement":"Explain the event loop.","kind":"text"}"#);
}

#[test]
fn questions_are_refused_with_a_reason_the_teacher_can_act_on() {
	let bad = |change: Json| take_questions(&[changed(code(), change), text_q(), code()], &format(), &topics()).unwrap_err();
	assert_eq!(take_questions(&[code()], &format(), &topics()).unwrap_err(), "Write exactly 3 questions (got 1).");
	assert_eq!(bad(json!({ "title": " " })), "Question 1: title is empty.");
	assert!(bad(json!({ "statement": "" })).contains("statement"));
	assert!(bad(json!({ "function_name": "longest-run" })).contains("function_name"));
	for name in ["require", "module", "exports", "__import__", "delete", "class", "lambda", "None"] {
		assert!(bad(json!({ "function_name": name })).contains("function_name"), "{name}");
	}
	assert!(bad(json!({ "params": ["a", "a"] })).contains("params"));
	for name in ["from", "in", "new", "default"] {
		assert!(bad(json!({ "params": ["graph", name] })).starts_with("Question 1: params must be up to 6 different plain names"), "{name} is a keyword");
	}
	let first = code()["examples"][0].clone();
	assert_eq!(bad(json!({ "examples": [first] })), "Question 1: give 2 to 6 examples.");
	assert_eq!(bad(json!({ "examples": [{ "args": "[1, 2]", "expected": "2" }, first] })), "Question 1: example args [1, 2] must be a JSON array with one item per parameter (1).");
	assert_eq!(bad(json!({ "examples": [{ "args": "[[1]", "expected": "2" }, first] })), r#"Question 1: example args "[[1]" is not JSON."#);
	assert_eq!(bad(json!({ "examples": [{ "args": "[[1]]", "expected": "two" }, first] })), r#"Question 1: example expected "two" is not JSON."#);
	assert_eq!(bad(json!({ "examples": [{ "args": "[[1]]", "expected": "x".repeat(2001) }, first] })), "Question 1: an example is too long.");
}

#[test]
fn the_editor_starts_with_the_function_to_write() {
	let function = json!({ "name": "longestRun", "params": ["nums", "k"] });
	assert_eq!(starter_code(&function, MockLanguage::Javascript), "function longestRun(nums, k) {\n\t\n}\n");
	assert_eq!(starter_code(&function, MockLanguage::Python), "def longestRun(nums, k):\n    pass\n");
}

#[test]
fn a_mock_moves_from_writing_to_ready_running_grading_and_graded() {
	let fresh = new_mock("mock_0a1b2c3d", 1.0, &format(), "2026-11-11T09:00:00.000Z");
	assert_eq!(stringify(&fresh), r#"{"id":"mock_0a1b2c3d","n":1,"format":{"questions":3,"minutes":70},"createdAt":"2026-11-11T09:00:00.000Z","questions":[],"answers":{}}"#);
	assert_eq!(mock_state(&fresh), MockState::Writing);
	assert_eq!(start_mock(&fresh, "x"), fresh, "nothing to start before the questions");
	let ready = with(&fresh, "questions", Json::from(take_questions(&written(), &format(), &topics()).unwrap()));
	assert_eq!(mock_state(&ready), MockState::Ready);
	let live = start_mock(&ready, "2026-11-11T10:00:00.000Z");
	assert_eq!(mock_state(&live), MockState::Running);
	let over = end_mock(&live, "2026-11-11T10:30:00.000Z");
	assert_eq!(mock_state(&over), MockState::Grading);
	assert_eq!(end_mock(&over, "later")["endedAt"], Json::from("2026-11-11T10:30:00.000Z"), "ends once");
	assert_eq!(mock_state(&with_grades(&over, &[]).unwrap()), MockState::Graded, "nothing answered, nothing to grade");
}

#[test]
fn the_clock_counts_down_from_when_it_started() {
	let live = running();
	let t0 = time::parse_date("2026-11-11T10:00:00.000Z").unwrap() as f64;
	assert_eq!(seconds_left(&live, t0), 70.0 * 60.0);
	assert_eq!(seconds_left(&live, t0 + 21.0 * 60_000.0 + 48_000.0), 48.0 * 60.0 + 12.0);
	assert_eq!(seconds_left(&live, t0 + 71.0 * 60_000.0), 0.0);
	assert_eq!(seconds_left(&json!({ "format": format() }), t0), 70.0 * 60.0, "not started: the whole time");
	assert!(seconds_left(&json!({ "format": format(), "startedAt": "soon" }), t0).is_nan());
}

#[test]
fn answers_are_saved_only_while_it_runs_and_the_language_and_code_only_on_code() {
	let live = running();
	let code = json!({ "python": "py", "javascript": "js" });
	let first = with_answer(&live, "q1", &json!({ "text": "ignored", "language": "python", "code": code, "seconds": 61.4, "submitted": true }));
	let saved = with_answer(&first, "q2", &json!({ "text": "words", "language": "python", "code": code, "seconds": 5, "submitted": false }));
	assert_eq!(saved["answers"]["q1"], json!({ "text": "py", "language": "python", "code": code, "seconds": 61, "submitted": true }), "the text is the picked language's code");
	assert_eq!(
		with_answer(&live, "q1", &json!({ "text": "x", "language": "javascript", "code": { "python": "py" }, "seconds": 1, "submitted": false }))["answers"]["q1"],
		json!({ "text": "py", "language": "python", "code": { "python": "py" }, "seconds": 1, "submitted": false }),
		"nothing is written in the picked language: the written one is graded",
	);
	assert_eq!(with_answer(&live, "q1", &json!({ "text": "x", "language": "javascript", "code": {}, "seconds": 1, "submitted": false }))["answers"]["q1"]["text"], Json::from(""), "nothing written at all");
	assert_eq!(stringify(&saved["answers"]["q2"]), r#"{"text":"words","seconds":5,"submitted":false}"#);
	assert_eq!(with_answer(&live, "q9", &json!({ "text": "x", "seconds": 1, "submitted": true })), live, "no such question");
	let over = end_mock(&saved, "2026-11-11T10:30:00.000Z");
	assert_eq!(with_answer(&over, "q1", &json!({ "text": "late", "seconds": 1, "submitted": true })), over, "the mock is over");
}

#[test]
fn code_is_kept_only_in_known_languages_and_cut_to_the_longest_answer() {
	let raw = json!({ "ruby": "x", "python": "p".repeat(ANSWER_MAX + 5), "javascript": 3 });
	let code = parse_mock_code(&raw);
	assert_eq!(code.as_obj().unwrap().keys().collect::<Vec<_>>(), ["python"]);
	assert_eq!(code["python"].as_str().unwrap().len(), ANSWER_MAX);
	assert_eq!(parse_mock_code(&json!("text")), json!({}));
}

#[test]
fn every_answered_question_needs_a_grade_and_counts_for_the_preps_topics() {
	let live = running();
	let answer = |text: &str| json!({ "text": text, "language": "javascript", "code": { "javascript": text }, "seconds": 30, "submitted": true });
	let answered = with_answer(&with_answer(&with_answer(&live, "q1", &answer("a")), "q2", &answer("b")), "q3", &answer("  "));
	let over = end_mock(&answered, "2026-11-11T10:30:00.000Z");
	assert_eq!(with_grades(&over, &[json!({ "question": "q1", "verdict": "right", "feedback": "Good." })]).unwrap_err(), "No grade for q2: grade every answered question.");
	assert_eq!(
		with_grades(&over, &[json!({ "question": "q1", "verdict": "right", "feedback": " " }), json!({ "question": "q2", "verdict": "partly", "feedback": "Half." })]).unwrap_err(),
		"The feedback for q1 is empty."
	);
	assert_eq!(question_result(&over, "q1"), None, "not graded yet");
	let graded = with_grades(&over, &[json!({ "question": "q1", "verdict": "right", "feedback": "Good." }), json!({ "question": "q2", "verdict": "partly", "feedback": "Half." })]).unwrap();
	assert_eq!(["q1", "q2", "q3"].map(|id| question_result(&graded, id)), [Some("right"), Some("partly"), Some("blank")]);
	let at = "2026-11-11T10:30:00.000Z";
	assert_eq!(
		mock_answers(&graded),
		vec![json!({ "nodeId": "pt_a", "outcome": "right", "answeredAt": at }), json!({ "outcome": "wrong", "answeredAt": at }), json!({ "nodeId": "pt_b", "outcome": "dontKnow", "answeredAt": at })],
		"given when it ended"
	);
	assert_eq!(solved_count(&graded), 1);
	assert_eq!(minutes_used(&graded), Some(30.0));
	assert_eq!(minutes_used(&live), None);
	assert!(mock_answers(&over).is_empty(), "an ungraded mock counts for nothing");
}

#[test]
fn a_summary_carries_only_what_the_mock_has() {
	let live = running();
	assert_eq!(
		stringify(&mock_summary(&live, false, Some(""))),
		r#"{"id":"mock_0a1b2c3d","n":1,"state":"running","format":{"questions":3,"minutes":70},"createdAt":"2026-11-11T09:00:00.000Z","startedAt":"2026-11-11T10:00:00.000Z","working":false}"#
	);
	let graded = with_grades(&end_mock(&live, "2026-11-11T10:30:00.000Z"), &[]).unwrap();
	let summary = mock_summary(&graded, true, Some("the agent never sent the grades"));
	assert_eq!(summary["solved"], Json::from(0));
	assert_eq!(stringify(&summary).split(r#""endedAt""#).nth(1).unwrap(), r#":"2026-11-11T10:30:00.000Z","solved":0,"working":true,"error":"the agent never sent the grades"}"#);
}

#[test]
fn a_mock_reads_back_the_same_and_a_newer_builds_record_is_refused() {
	let live = running();
	let answered = with_answer(&live, "q1", &json!({ "text": "a", "language": "javascript", "code": { "javascript": "a", "python": "b" }, "seconds": 30, "submitted": true }));
	let graded = with_grades(&end_mock(&answered, "2026-11-11T10:30:00.000Z"), &[json!({ "question": "q1", "verdict": "wrong", "feedback": "Off by one." })]).unwrap();
	let stamped = changed(json!({ "version": 1 }), graded.clone());
	assert_eq!(parse_mock(&parse(&stringify(&stamped)).unwrap()), Some(ParsedMock::Mock(graded.clone())));
	assert_eq!(parse_mock(&changed(graded.clone(), json!({ "version": 99 }))), Some(ParsedMock::Newer));
	assert_eq!(parse_mock(&changed(graded, json!({ "id": "nope" }))), None);
	assert_eq!(parse_mock(&json!("text")), None);
}

#[test]
fn a_saved_code_question_whose_name_could_run_something_else_is_dropped() {
	let live = running();
	let code = live["questions"][0].clone();
	let edited = changed(live, json!({ "questions": [changed(code, json!({ "fn": { "name": "require('child_process')", "params": [] } }))] }));
	let Some(ParsedMock::Mock(read)) = parse_mock(&edited) else { panic!("a mock") };
	assert_eq!(read["questions"], json!([]));
}

#[test]
fn mock_ids_are_mock_and_eight_hex() {
	assert!(is_mock_id("mock_0a1b2c3d"));
	for id in ["mock_0A1B2C3D", "mock_0a1b2c3", "../space", "mock_0a1b2c3d4"] {
		assert!(!is_mock_id(id), "{id}");
	}
}
