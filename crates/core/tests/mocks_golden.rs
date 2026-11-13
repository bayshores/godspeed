//! Parity with Node for mocks (tests/golden/mocks.json, recorded from the Node server): questions taken or refused, answers and grades, saved mocks read back, the
//! clock, the program that runs the examples, how its output is read, and the teacher's texts.

use std::collections::HashSet;

use gs_base::time;
use gs_core::preps::mock::{
	MockLanguage, ParsedMock, end_mock, minutes_used, mock_answers, mock_state, mock_summary, parse_mock, question_result, seconds_left, solved_count, start_mock, starter_code, take_questions, with_answer, with_grades,
};
use gs_core::preps::mock_requests::{go_over_text, grade_request_text, mock_request_text};
use gs_core::preps::mock_run::{read_run, runner_source};
use gs_json::{Json, json, parse, stringify};

fn golden(case: &str) -> Json {
	let all = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/mocks.json")).unwrap()).unwrap();
	let found = all.as_arr().unwrap().iter().find(|c| c["name"] == Json::from(case)).unwrap_or_else(|| panic!("no golden case {case}"));
	assert!(found.get("error").is_none(), "{case}: {:?}", found["error"]);
	found["output"].clone()
}

fn items(v: &Json) -> &[Json] {
	v.as_arr().map_or(&[], Vec::as_slice)
}

fn same(got: &Json, want: &Json, what: &str) {
	assert_eq!(stringify(got), stringify(want), "{what}");
}

fn topics() -> HashSet<String> {
	["pt_lists", "pt_maps"].into_iter().map(str::to_owned).collect()
}

/// A JS number or null (`number | null`).
fn number(n: Option<f64>) -> Json {
	n.map_or(Json::Null, Json::Num)
}

#[test]
fn take_questions_matches() {
	for case in items(&golden("take questions")) {
		let got = match take_questions(items(&case["written"]), &case["format"], &topics()) {
			Ok(questions) => Json::from(questions),
			Err(problem) => Json::from(problem),
		};
		same(&got, &case["output"], &stringify(&case["written"]));
	}
}

#[test]
fn starter_code_matches() {
	let got: Vec<Json> = MockLanguage::ALL.iter().map(|&l| json!([starter_code(&json!({ "name": "pairSum", "params": [] }), l), starter_code(&json!({ "name": "f", "params": ["a", "b_2"] }), l)])).collect();
	same(&Json::from(got), &golden("starter code"), "starter code");
}

#[test]
fn states_and_clock_match() {
	let want = golden("states and clock");
	let mocks = items(&want["mocks"]);
	let states: Vec<&str> = mocks.iter().map(|m| mock_state(m).as_str()).collect();
	same(&json!(states), &want["states"], "states");
	let (live, over, ready) = (&mocks[2], &mocks[3], &mocks[1]);
	same(&start_mock(live, "later"), &want["started"], "start twice");
	same(&end_mock(over, "later"), &want["ended"], "end twice");
	let t0 = time::parse_date("2026-11-12T09:00:00.000Z").unwrap() as f64;
	let left: Vec<Json> = items(&want["offsets"]).iter().map(|ms| Json::Num(seconds_left(live, t0 + ms.as_f64().unwrap()))).collect();
	same(&Json::from(left), &want["left"], "seconds left");
	same(&Json::Num(seconds_left(ready, t0)), &want["notStarted"], "not started");
	let mut used = vec![number(minutes_used(live))];
	used.extend(items(&want["ends"]).iter().map(|end| number(minutes_used(&end_mock(live, end.as_str().unwrap())))));
	same(&Json::from(used), &want["used"], "minutes used");
}

#[test]
fn answers_match() {
	for case in items(&golden("answers kept")) {
		same(&with_answer(&case["mock"], case["id"].as_str().unwrap(), &case["answer"]), &case["output"], &stringify(&case["answer"]));
	}
	for case in items(&golden("answers refused")) {
		same(&with_answer(&case["mock"], "q1", &json!({ "text": "a", "seconds": 1, "submitted": true })), &case["output"], "refused");
	}
}

#[test]
fn grades_match() {
	let want = golden("grades");
	for case in items(&want["tries"]) {
		let got = match with_grades(&case["mock"], items(&case["written"])) {
			Ok(mock) => mock,
			Err(problem) => Json::from(problem),
		};
		same(&got, &case["output"], &stringify(&case["written"]));
	}
	let mock = &want["mock"];
	let results: Vec<Json> = ["q1", "q2", "q3"].iter().map(|id| Json::from(question_result(mock, id))).collect();
	same(&Json::from(results), &want["results"], "results");
	same(&Json::from(question_result(&want["over"], "q1")), &want["ungraded"], "ungraded");
	same(&Json::from(mock_answers(mock)), &want["answers"], "answers");
	same(&Json::from(solved_count(mock)), &want["solved"], "solved");
	let summaries = [mock_summary(mock, false, None), mock_summary(&want["running"], true, Some("the agent never sent the questions")), mock_summary(&want["ready"], false, Some(""))];
	same(&Json::from(summaries.to_vec()), &want["summaries"], "summaries");
}

#[test]
fn saved_mocks_read_back_like_node() {
	for case in items(&golden("parse")) {
		let got = match parse_mock(&case["raw"]) {
			Some(ParsedMock::Mock(mock)) => mock,
			Some(ParsedMock::Newer) => Json::from("newer"),
			None => Json::Null,
		};
		same(&got, &case["output"], &stringify(&case["raw"]));
	}
}

#[test]
fn runner_source_matches() {
	let examples = items(&golden("read run")["examples"]).to_vec();
	let mut got = Vec::new();
	for language in MockLanguage::ALL {
		got.push(Json::from(runner_source("def x():\n  pass", &json!({ "name": "pairSum", "params": ["nums", "target"] }), &examples, language, "__godspeed_mark__")));
		got.push(Json::from(runner_source("", &json!({ "name": "f", "params": [] }), &[], language, "M")));
	}
	same(&Json::from(got), &golden("runner source"), "runner source");
}

#[test]
fn read_run_matches() {
	let want = golden("read run");
	let examples = items(&want["examples"]);
	for case in items(&want["cases"]) {
		same(&read_run(case["stdout"].as_str().unwrap(), case["stderr"].as_str().unwrap(), "@@", examples), &case["output"], &stringify(case));
	}
}

#[test]
fn requests_match() {
	let want = golden("requests");
	let topics = items(&want["topics"]);
	let asked = ["Pair sums".to_owned(), "Hash maps".to_owned()];
	let questions = [
		mock_request_text("Backend intern online test", "Two coding questions.\nNo libraries.", &json!({ "questions": 1, "minutes": 45 }), topics, &asked),
		mock_request_text("g", "", &json!({ "questions": 10, "minutes": 240 }), &[], &[]),
	];
	same(&json!(questions), &want["questions"], "questions");
	let grades = [
		grade_request_text("Backend intern online test", &want["mock"], &want["runs"]),
		grade_request_text("g", &want["short"], &json!({})),
		grade_request_text("g", &want["running"], &want["timedOut"]),
	];
	same(&json!(grades), &want["grades"], "grades");
	let go_over = [go_over_text(&want["mock"], "q1"), go_over_text(&want["mock"], "q2"), go_over_text(&want["blankGraded"], "q2"), go_over_text(&want["mock"], "q3")];
	same(&json!(go_over), &want["goOver"], "go over");
}
