//! A mock's life: the teacher's questions are checked and kept, the clock runs and can be
//! paused, answers are saved only while it runs, the grades come once it has ended, and its
//! questions count for the facts they test. A format 1 mock reads as format 2.

use std::collections::HashSet;

use gs_json::{Json, json, parse, stringify};

use super::*;

fn format() -> Json {
	json!({ "questions": 3, "minutes": 70 })
}

fn facts() -> HashSet<String> {
	["f_a", "f_b"].into_iter().map(str::to_owned).collect()
}

fn at(text: &str) -> i64 {
	time::parse_date(text).unwrap()
}

fn code() -> Json {
	json!({
		"title": "Longest run",
		"statement": "Return the length of the longest run of 1s.",
		"kind": "code",
		"fact_ids": ["f_a", "f_gone", "f_a"],
		"function_name": "longestRun",
		"params": ["nums"],
		"examples": [{ "args": "[[1,1,0,1]]", "expected": "2" }, { "args": " [[0]] ", "expected": "0" }],
	})
}

fn text_q() -> Json {
	json!({ "title": "Event loop", "statement": "Explain the event loop.", "kind": "text", "fact_ids": ["f_gone"] })
}

fn written() -> Vec<Json> {
	let mut second = code();
	second.as_obj_mut().unwrap().insert("title", "Second run");
	second.as_obj_mut().unwrap().insert("fact_ids", json!(["f_b"]));
	vec![code(), text_q(), second]
}

fn running() -> Json {
	let questions = take_questions(&written(), &format(), &facts()).unwrap();
	let fresh = with(&new_mock("mock_0a1b2c3d", "ddl_a", 1.0, &format(), "2026-11-11T09:00:00.000Z"), "questions", Json::from(questions));
	start_mock(&fresh, at("2026-11-11T10:00:00.000Z"))
}

fn changed(base: Json, change: Json) -> Json {
	let mut out = base;
	for (k, v) in change.as_obj().unwrap() {
		out.as_obj_mut().unwrap().insert(k.as_str(), v.clone());
	}
	out
}

#[test]
fn questions_are_kept_in_order_with_only_facts_the_request_gave() {
	let questions = take_questions(&written(), &format(), &facts()).unwrap();
	let rows: Vec<Json> = questions.iter().map(|q| json!([q["id"], q["kind"], q["factIds"]])).collect();
	assert_eq!(rows, vec![json!(["q1", "code", ["f_a"]]), json!(["q2", "text", null]), json!(["q3", "code", ["f_b"]])]);
	assert_eq!(questions[0]["fn"], json!({ "name": "longestRun", "params": ["nums"] }));
	assert_eq!(questions[0]["examples"][1], json!({ "args": "[[0]]", "expected": "0" }), "trimmed");
	assert_eq!(stringify(&questions[1]), r#"{"id":"q2","title":"Event loop","statement":"Explain the event loop.","kind":"text"}"#);
}

#[test]
fn questions_are_refused_with_a_reason_the_teacher_can_act_on() {
	let bad = |change: Json| take_questions(&[changed(code(), change), text_q(), code()], &format(), &facts()).unwrap_err();
	assert_eq!(take_questions(&[code()], &format(), &facts()).unwrap_err(), "Write exactly 3 questions (got 1).");
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
	let fresh = new_mock("mock_0a1b2c3d", "ddl_a", 1.0, &format(), "2026-11-11T09:00:00.000Z");
	assert_eq!(stringify(&fresh), r#"{"id":"mock_0a1b2c3d","deadlineId":"ddl_a","n":1,"format":{"questions":3,"minutes":70},"createdAt":"2026-11-11T09:00:00.000Z","questions":[],"answers":{},"pauses":[]}"#);
	assert_eq!(mock_state(&fresh), MockState::Writing);
	assert_eq!(start_mock(&fresh, 0), fresh, "nothing to start before the questions");
	let ready = with(&fresh, "questions", Json::from(take_questions(&written(), &format(), &facts()).unwrap()));
	assert_eq!(mock_state(&ready), MockState::Ready);
	let live = start_mock(&ready, at("2026-11-11T10:00:00.000Z"));
	assert_eq!(mock_state(&live), MockState::Running);
	assert_eq!(live["endsAt"], Json::from("2026-11-11T11:10:00.000Z"));
	let over = end_mock(&live, at("2026-11-11T10:30:00.000Z"));
	assert_eq!(mock_state(&over), MockState::Grading);
	assert!(over.get("endsAt").is_none(), "only a running mock has an end time");
	assert_eq!(end_mock(&over, at("2026-11-11T10:40:00.000Z"))["endedAt"], Json::from("2026-11-11T10:30:00.000Z"), "ends once");
	assert_eq!(mock_state(&with_grades(&over, &[]).unwrap()), MockState::Graded, "nothing answered, nothing to grade");
}

#[test]
fn a_mock_with_no_time_limit_has_no_clock() {
	let untimed = with(&running(), "format", json!({ "questions": 3 }));
	assert_eq!(seconds_left(&untimed, 0.0), None);
	let fresh = with(&new_mock("mock_0a1b2c3d", "ddl_a", 1.0, &json!({ "questions": 3 }), "t"), "questions", running()["questions"].clone());
	let live = start_mock(&fresh, at("2026-11-11T10:00:00.000Z"));
	assert!(live.get("endsAt").is_none());
	assert_eq!(pause_mock(&live, at("2026-11-11T10:05:00.000Z")), live, "nothing to pause");
	assert_eq!(minutes_used(&end_mock(&live, at("2026-11-12T10:00:00.000Z"))), Some(1440.0), "no limit caps it");
}

#[test]
fn the_clock_counts_down_to_its_end_time() {
	let live = running();
	let t0 = at("2026-11-11T10:00:00.000Z") as f64;
	assert_eq!(seconds_left(&live, t0), Some(70.0 * 60.0));
	assert_eq!(seconds_left(&live, t0 + 21.0 * 60_000.0 + 48_000.0), Some(48.0 * 60.0 + 12.0));
	assert_eq!(seconds_left(&live, t0 + 71.0 * 60_000.0), Some(0.0));
	assert_eq!(seconds_left(&json!({ "format": format() }), t0), Some(70.0 * 60.0), "not started: the whole time");
}

#[test]
fn a_paused_mock_keeps_its_time_left_however_late_it_is_read_and_resumes_with_it() {
	let live = running();
	let paused = pause_mock(&live, at("2026-11-11T10:20:00.000Z"));
	assert_eq!(mock_state(&paused), MockState::Paused);
	assert_eq!(paused["paused"], json!({ "at": "2026-11-11T10:20:00.000Z", "left": 3000 }));
	assert!(paused.get("endsAt").is_none());
	let a_day_later = at("2026-11-12T10:20:00.000Z");
	assert_eq!(seconds_left(&paused, a_day_later as f64), Some(3000.0), "past its old end time it still has 50 minutes");
	assert_eq!(with_answer(&paused, "q2", &json!({ "text": "x", "seconds": 1, "submitted": true })), paused, "no answers while paused");
	assert_eq!(pause_mock(&paused, a_day_later), paused, "paused once");
	let resumed = resume_mock(&paused, a_day_later);
	assert_eq!(mock_state(&resumed), MockState::Running);
	assert_eq!(resumed["endsAt"], Json::from("2026-11-12T11:10:00.000Z"));
	assert_eq!(resumed["pauses"], json!([{ "from": "2026-11-11T10:20:00.000Z", "to": "2026-11-12T10:20:00.000Z" }]));
	assert_eq!(pause_total(&resumed, 0), (1, 86_400_000.0));
	let ended = end_mock(&pause_mock(&resumed, at("2026-11-12T10:30:00.000Z")), at("2026-11-12T10:31:00.000Z"));
	assert_eq!(ended["pauses"].as_arr().unwrap().len(), 2, "ending a paused mock closes its pause");
	assert!(ended.get("paused").is_none());
	assert_eq!(minutes_used(&ended), Some(30.0), "time paused is not time used");
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
	let over = end_mock(&saved, at("2026-11-11T10:30:00.000Z"));
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
fn every_answered_question_needs_a_grade_and_counts_for_the_facts_it_tests() {
	let live = running();
	let answer = |text: &str| json!({ "text": text, "language": "javascript", "code": { "javascript": text }, "seconds": 30, "submitted": true });
	let answered = with_answer(&with_answer(&with_answer(&live, "q1", &answer("a")), "q2", &answer("b")), "q3", &answer("  "));
	let over = end_mock(&answered, at("2026-11-11T10:30:00.000Z"));
	assert_eq!(with_grades(&over, &[json!({ "question": "q1", "verdict": "right", "feedback": "Good." })]).unwrap_err(), "No grade for q2: grade every answered question.");
	assert_eq!(
		with_grades(&over, &[json!({ "question": "q1", "verdict": "right", "feedback": " " }), json!({ "question": "q2", "verdict": "partly", "feedback": "Half." })]).unwrap_err(),
		"The feedback for q1 is empty."
	);
	assert_eq!(question_result(&over, "q1"), None, "not graded yet");
	let graded = with_grades(&over, &[json!({ "question": "q1", "verdict": "right", "feedback": "Good." }), json!({ "question": "q2", "verdict": "partly", "feedback": "Half." })]).unwrap();
	assert_eq!(["q1", "q2", "q3"].map(|id| question_result(&graded, id)), [Some("right"), Some("partly"), Some("blank")]);
	let at = "2026-11-11T10:30:00.000Z";
	let answer = |q: &str, facts: Json, outcome: &str| json!({ "chatId": "mock_0a1b2c3d", "toolCallId": q, "tool": "mock", "factIds": facts, "outcome": outcome, "answeredAt": at });
	assert_eq!(mock_answers(&graded), vec![answer("q1", json!(["f_a"]), "right"), answer("q3", json!(["f_b"]), "dontKnow")], "given when it ended, only for questions with facts");
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
		r#"{"id":"mock_0a1b2c3d","deadlineId":"ddl_a","n":1,"state":"running","format":{"questions":3,"minutes":70},"createdAt":"2026-11-11T09:00:00.000Z","startedAt":"2026-11-11T10:00:00.000Z","endsAt":"2026-11-11T11:10:00.000Z","working":false}"#
	);
	let paused = mock_summary(&pause_mock(&live, at("2026-11-11T10:10:00.000Z")), false, None);
	assert_eq!((paused["state"].clone(), paused["paused"]["left"].clone()), (json!("paused"), json!(3600)));
	let graded = with_grades(&end_mock(&live, at("2026-11-11T10:30:00.000Z")), &[]).unwrap();
	let summary = mock_summary(&graded, true, Some("the agent never sent the grades"));
	assert_eq!(summary["solved"], Json::from(0));
	assert_eq!(stringify(&summary).split(r#""endedAt""#).nth(1).unwrap(), r#":"2026-11-11T10:30:00.000Z","solved":0,"working":true,"error":"the agent never sent the grades"}"#);
}

#[test]
fn a_mock_reads_back_the_same_and_a_newer_builds_record_is_refused() {
	let live = running();
	let answered = with_answer(&live, "q1", &json!({ "text": "a", "language": "javascript", "code": { "javascript": "a", "python": "b" }, "seconds": 30, "submitted": true }));
	let paused = pause_mock(&answered, at("2026-11-11T10:10:00.000Z"));
	let stamped = |m: &Json| parse(&stringify(&changed(json!({ "version": 2 }), m.clone()))).unwrap();
	assert_eq!(parse_mock(&stamped(&paused)), Some(ParsedMock::Mock(paused.clone())));
	let graded = with_grades(&end_mock(&resume_mock(&paused, at("2026-11-11T10:15:00.000Z")), at("2026-11-11T10:30:00.000Z")), &[json!({ "question": "q1", "verdict": "wrong", "feedback": "Off by one." })]).unwrap();
	assert_eq!(parse_mock(&stamped(&graded)), Some(ParsedMock::Mock(graded.clone())));
	let untimed = with(&graded, "format", json!({ "questions": 3 }));
	assert_eq!(parse_mock(&stamped(&untimed)), Some(ParsedMock::Mock(untimed)));
	assert_eq!(parse_mock(&changed(graded.clone(), json!({ "version": 99 }))), Some(ParsedMock::Newer));
	assert_eq!(parse_mock(&changed(graded, json!({ "id": "nope" }))), None);
	assert_eq!(parse_mock(&json!("text")), None);
}

/// A format 1 mock as 0.6.5 saved it: always timed, its questions tagged with prep topics.
fn v1(started: Option<&str>, ended: Option<&str>) -> Json {
	let mut mock = json!({
		"version": 1, "id": "mock_0a1b2c3d", "n": 2, "format": { "questions": 1, "minutes": 30 }, "createdAt": "2026-11-11T09:00:00.000Z",
		"questions": [{ "id": "q1", "topicId": "pt_a", "title": "Event loop", "statement": "Explain it.", "kind": "text" }],
		"answers": { "q1": { "text": "A queue.", "seconds": 60, "submitted": true } },
	});
	let obj = mock.as_obj_mut().unwrap();
	if let Some(started) = started {
		obj.insert("startedAt", started);
	}
	if let Some(ended) = ended {
		obj.insert("endedAt", ended);
		obj.insert("grades", json!({ "q1": { "verdict": "right", "feedback": "Yes." } }));
	}
	mock
}

#[test]
fn a_format_1_mock_reads_with_the_same_state_clock_and_score() {
	let Some(ParsedMock::Mock(live)) = parse_mock(&v1(Some("2026-11-11T10:00:00.000Z"), None)) else { panic!("a mock") };
	assert_eq!(mock_state(&live), MockState::Running);
	assert_eq!(live["endsAt"], Json::from("2026-11-11T10:30:00.000Z"), "it still ends at its start plus its minutes");
	assert_eq!(seconds_left(&live, at("2026-11-11T10:20:00.000Z") as f64), Some(600.0));
	assert_eq!(live["pauses"], json!([]));
	assert!(live["questions"][0].get("topicId").is_none(), "prep topics are dropped");
	assert!(live.get("deadlineId").is_none(), "the upgrade ties it to its deadline");
	let Some(ParsedMock::Mock(graded)) = parse_mock(&v1(Some("2026-11-11T10:00:00.000Z"), Some("2026-11-11T10:25:00.000Z"))) else { panic!("a mock") };
	assert_eq!((mock_state(&graded), solved_count(&graded), minutes_used(&graded)), (MockState::Graded, 1, Some(25.0)), "its score stays");
	assert!(graded.get("endsAt").is_none());
	assert!(mock_answers(&graded).is_empty(), "old answers color no topic");
	let mut untimed = v1(None, None);
	untimed.get_mut("format").unwrap().as_obj_mut().unwrap().remove("minutes");
	assert_eq!(parse_mock(&untimed), None, "format 1 always had minutes");
}

#[test]
fn a_format_is_one_to_ten_questions_with_no_time_limit_or_5_to_240_minutes() {
	assert_eq!(mock_format(&json!(5), None), Ok(json!({ "questions": 5 })));
	assert_eq!(mock_format(&json!(10), Some(&json!(240))), Ok(json!({ "questions": 10, "minutes": 240 })));
	for (questions, minutes) in [(json!(0), None), (json!(11), None), (json!(2.5), None), (json!(3), Some(json!(4))), (json!(3), Some(json!(241))), (json!("3"), None)] {
		assert_eq!(mock_format(&questions, minutes.as_ref()), Err("A mock is 1 to 10 questions, with no time limit or 5 to 240 minutes.".to_owned()), "{questions:?} {minutes:?}");
	}
	assert!(takes_mocks(&json!("interview")) && takes_mocks(&json!("exam")) && takes_mocks(&json!("quiz")));
	assert!(!takes_mocks(&json!("homework")) && !takes_mocks(&json!("project")));
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
