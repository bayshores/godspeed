//! What the teacher is asked about a mock (mock-requests.ts): the request for its questions and
//! the request for its grades, and what a session that goes over one question starts from.

use std::collections::HashMap;

use gs_base::num;
use gs_json::{Json, js_number};

use super::mock::{MockLanguage, is_answered, minutes_used, pause_total};

fn status_note(status: &str) -> &str {
	match status {
		"untested" | "" => "not tested yet",
		other => other,
	}
}

fn questions_word(n: &Json) -> &'static str {
	if n.as_f64() == Some(1.0) { "question" } else { "questions" }
}

fn number(n: &Json) -> String {
	js_number(n.as_f64().unwrap_or(f64::NAN))
}

fn items(list: &Json) -> &[Json] {
	list.as_arr().map_or(&[], Vec::as_slice)
}

/// What the mock is for: the deadline's name and kind.
fn for_line(deadline: &Json) -> String {
	format!("They are preparing for: {} ({}).", deadline["name"].str_or_empty(), deadline["kind"].str_or_empty())
}

/// The mock's size and time limit.
fn size_text(format: &Json) -> String {
	let size = format!("{} {}", number(&format["questions"]), questions_word(&format["questions"]));
	match format.get("minutes") {
		Some(minutes) => format!("{size} for {} minutes", number(minutes)),
		None => format!("{size}, with no time limit"),
	}
}

/// The request for a mock's questions: the deadline it is for (`{name, kind}`), what it is like,
/// its size, the deadline's topics the ones that most need work first (each `{name, status,
/// facts: [{id, statement}]}`), and the titles of what earlier mocks asked.
pub fn mock_request_text(deadline: &Json, about: Option<&str>, format: &Json, topics: &[Json], asked: &[String]) -> String {
	let mut lines = vec![for_line(deadline)];
	if let Some(about) = about.filter(|a| !a.trim().is_empty()) {
		lines.extend([String::new(), "What it is like:".to_owned(), about.trim().to_owned()]);
	}
	lines.extend([String::new(), format!("Write a mock of exactly {}.", size_text(format))]);
	if topics.is_empty() {
		lines.extend([String::new(), "It has no study facts yet: write from what it is like, and leave fact_ids out.".to_owned()]);
	} else {
		lines.extend([String::new(), "Its topics, the ones that most need work first, with their facts (fact_id: statement). Give each question the fact_ids it tests:".to_owned()]);
		for t in topics {
			lines.push(format!("## {} ({})", t["name"].str_or_empty(), status_note(t["status"].str_or_empty())));
			lines.extend(items(&t["facts"]).iter().map(|f| format!("- {}: {}", f["id"].str_or_empty(), f["statement"].str_or_empty())));
		}
	}
	if !asked.is_empty() {
		lines.extend([String::new(), "Earlier mocks asked these. Don't ask them again:".to_owned()]);
		lines.extend(asked.iter().map(|title| format!("- {title}")));
	}
	lines.join("\n")
}

fn minutes(seconds: f64) -> String {
	let rounded = num::math_round(seconds / 60.0);
	format!("{} min", js_number(if rounded.is_nan() { rounded } else { rounded.max(1.0) }))
}

/// How the answer did on the question's own examples (a run outcome), in one line.
fn run_line(run: &Json) -> String {
	if let Some(error) = run["error"].as_str().filter(|e| !e.is_empty()) {
		return format!("It did not run on the examples here: {error}");
	}
	let lines: Vec<String> = items(&run["examples"])
		.iter()
		.enumerate()
		.map(|(i, e)| {
			let how = if e["passed"].truthy() {
				"passed".to_owned()
			} else if e["error"].truthy() {
				format!("threw {}", e["error"].str_or_empty())
			} else {
				format!("returned {}", gs_json::js_text::js_string(e.get("returned")))
			};
			format!("example {} {how}", i + 1)
		})
		.collect();
	format!("Run on the examples here: {}.", lines.join(", "))
}

const BLANK_NOTE: &str = "They left this blank. Don't grade it.";

/// One question for the teacher; `facts` (id to statement) names what a question tests.
fn question_block(mock: &Json, q: &Json, run: Option<&Json>, facts: &HashMap<String, String>) -> Vec<String> {
	let id = q["id"].str_or_empty();
	let answer = &mock["answers"][id];
	let code = q["kind"].as_str() == Some("code");
	let mut block = vec![format!("## {id}: {} ({})", q["title"].str_or_empty(), if code { "code" } else { "written" }), q["statement"].str_or_empty().to_owned()];
	let tests: Vec<&String> = items(&q["factIds"]).iter().filter_map(|f| facts.get(f.str_or_empty())).collect();
	if !tests.is_empty() {
		block.push("It tests:".to_owned());
		block.extend(tests.iter().map(|statement| format!("- {statement}")));
	}
	if code {
		let params: Vec<&str> = items(&q["fn"]["params"]).iter().map(Json::str_or_empty).collect();
		block.push(format!("Function: {}({}). Examples (arguments, then what it returns):", q["fn"]["name"].str_or_empty(), params.join(", ")));
		block.extend(items(&q["examples"]).iter().map(|e| format!("- {} returns {}", e["args"].str_or_empty(), e["expected"].str_or_empty())));
	}
	if !is_answered(answer) {
		block.push(BLANK_NOTE.to_owned());
		return block;
	}
	let language = if code { MockLanguage::parse(&answer["language"]) } else { None };
	let spent = minutes(answer["seconds"].as_f64().unwrap_or(f64::NAN));
	block.push(format!("Their answer ({}{spent}{}):", language.map_or(String::new(), |l| format!("{}, ", l.label())), if answer["submitted"].truthy() { "" } else { ", never submitted" }));
	block.push(format!("```{}", language.map_or("", MockLanguage::as_str)));
	block.push(answer["text"].str_or_empty().to_owned());
	block.push("```".to_owned());
	if let Some(run) = run {
		block.push(run_line(run));
	}
	block
}

/// What a session that goes over one graded question starts from: the question, the learner's
/// answer and the grade. None when the mock has no such question.
pub fn go_over_text(mock: &Json, question_id: &str) -> Option<String> {
	let question = items(&mock["questions"]).iter().find(|q| q["id"].as_str() == Some(question_id))?;
	let grade = &mock["grades"][question_id];
	let mut lines = vec![
		format!(
			"[Mock question] The learner wants to go over this question from Mock {}. Start from what they wrote: say what was right, find the gap, and have them fix it themselves before anything new.",
			number(&mock["n"])
		),
		String::new(),
	];
	lines.extend(question_block(mock, question, None, &HashMap::new()).into_iter().filter(|line| line != BLANK_NOTE));
	if grade.is_null() {
		lines.extend([String::new(), "They left it blank in the mock.".to_owned()]);
	} else {
		lines.extend([String::new(), format!("Your grade then: {}. Your feedback then:", grade["verdict"].str_or_empty()), grade["feedback"].str_or_empty().to_owned()]);
	}
	Some(lines.join("\n"))
}

fn times(n: usize, one: &str, many: &str) -> String {
	format!("{n} {}", if n == 1 { one } else { many })
}

/// The request for an ended mock's grades: the deadline it is for (`{name, kind}`), how it went
/// (time used and pauses), every question with the facts it tests (`facts`, id to statement) and
/// what the learner wrote, and how each code answer did on its examples (`runs` by question id).
pub fn grade_request_text(deadline: &Json, mock: &Json, runs: &Json, facts: &HashMap<String, String>) -> String {
	let format = &mock["format"];
	let mut head = format!("Mock {}: {}.", number(&mock["n"]), size_text(format));
	if let (Some(used), true) = (minutes_used(mock), format.get("minutes").is_some()) {
		head.push_str(&format!(" They used {} of them.", js_number(used)));
		let ended = mock["endedAt"].as_str().and_then(gs_base::time::parse_date).unwrap_or(0);
		let (count, ms) = pause_total(mock, ended);
		if count > 0 {
			let minutes = num::math_round(ms / 60_000.0).max(1.0) as usize;
			head.push_str(&format!(" Paused {}, {} in total.", times(count, "time", "times"), times(minutes, "minute", "minutes")));
		}
	}
	let mut lines = vec![for_line(deadline), head];
	for q in items(&mock["questions"]) {
		lines.push(String::new());
		lines.extend(question_block(mock, q, runs.get(q["id"].str_or_empty()), facts));
	}
	lines.join("\n")
}

#[cfg(test)]
mod tests {
	use std::collections::HashSet;

	use gs_base::time::parse_date;
	use gs_json::json;

	use super::super::mock::{end_mock, new_mock, pause_mock, resume_mock, start_mock, take_questions, with_answer, with_grades};
	use super::*;

	fn format() -> Json {
		json!({ "questions": 2, "minutes": 70 })
	}

	fn at(text: &str) -> i64 {
		parse_date(text).unwrap()
	}

	fn deadline() -> Json {
		json!({ "name": "Larkspur onsite", "kind": "interview" })
	}

	fn facts() -> HashMap<String, String> {
		HashMap::from([("f_runs".to_owned(), "A run is a stretch of equal items.".to_owned())])
	}

	fn ended() -> Json {
		let written = [
			json!({ "title": "Longest run", "statement": "Return the longest run of 1s.", "kind": "code", "fact_ids": ["f_runs"], "function_name": "longestRun", "params": ["nums"], "examples": [{ "args": "[[1,1,0]]", "expected": "2" }, { "args": "[[0]]", "expected": "0" }] }),
			json!({ "title": "Event loop", "statement": "Explain the event loop.", "kind": "text" }),
		];
		let questions = take_questions(&written, &format(), &HashSet::from(["f_runs".to_owned()])).unwrap();
		let mut fresh = new_mock("mock_0a1b2c3d", "ddl_a", 2.0, &format(), "2026-11-11T09:00:00.000Z");
		fresh.as_obj_mut().unwrap().insert("questions", questions);
		let mut mock = start_mock(&fresh, at("2026-11-11T10:00:00.000Z"));
		let code = "function longestRun(nums) { return 2; }";
		mock = with_answer(&mock, "q1", &json!({ "text": code, "language": "javascript", "code": { "javascript": code }, "seconds": 600, "submitted": true }));
		end_mock(&mock, at("2026-11-11T10:30:00.000Z"))
	}

	fn topic(name: &str, status: &str, facts: Json) -> Json {
		json!({ "id": "t", "name": name, "status": status, "facts": facts })
	}

	#[test]
	fn the_questions_request_names_the_deadline_what_it_is_like_the_size_the_topics_and_what_was_asked() {
		let topics = [topic("Grids", "weak", json!([{ "id": "f_bfs", "statement": "BFS finds shortest paths." }])), topic("Heaps", "untested", json!([]))];
		let text = mock_request_text(&deadline(), Some(" Two coding rounds. "), &json!({ "questions": 1, "minutes": 45 }), &topics, &["Longest run".to_owned()]);
		assert_eq!(
			text,
			"They are preparing for: Larkspur onsite (interview).\n\nWhat it is like:\nTwo coding rounds.\n\nWrite a mock of exactly 1 question for 45 minutes.\n\nIts topics, the ones that most need work first, with their facts (fact_id: statement). Give each question the fact_ids it tests:\n## Grids (weak)\n- f_bfs: BFS finds shortest paths.\n## Heaps (not tested yet)\n\nEarlier mocks asked these. Don't ask them again:\n- Longest run"
		);
	}

	#[test]
	fn with_no_facts_or_time_limit_the_questions_request_says_so() {
		let text = mock_request_text(&deadline(), None, &json!({ "questions": 3 }), &[], &[]);
		assert_eq!(text, "They are preparing for: Larkspur onsite (interview).\n\nWrite a mock of exactly 3 questions, with no time limit.\n\nIt has no study facts yet: write from what it is like, and leave fact_ids out.");
	}

	#[test]
	fn the_grades_request_has_every_question_its_facts_the_answer_and_how_it_ran() {
		let runs = json!({ "q1": { "examples": [{ "returned": "2", "passed": true }, { "returned": "2", "passed": false }] } });
		assert_eq!(
			grade_request_text(&deadline(), &ended(), &runs, &facts()),
			"They are preparing for: Larkspur onsite (interview).\nMock 2: 2 questions for 70 minutes. They used 30 of them.\n\n## q1: Longest run (code)\nReturn the longest run of 1s.\nIt tests:\n- A run is a stretch of equal items.\nFunction: longestRun(nums). Examples (arguments, then what it returns):\n- [[1,1,0]] returns 2\n- [[0]] returns 0\nTheir answer (JavaScript, 10 min):\n```javascript\nfunction longestRun(nums) { return 2; }\n```\nRun on the examples here: example 1 passed, example 2 returned 2.\n\n## q2: Event loop (written)\nExplain the event loop.\nThey left this blank. Don't grade it."
		);
	}

	#[test]
	fn the_grades_request_names_the_pauses_and_leaves_time_out_without_a_limit() {
		let mut fresh = new_mock("mock_0a1b2c3d", "ddl_a", 1.0, &format(), "2026-11-11T09:00:00.000Z");
		fresh.as_obj_mut().unwrap().insert("questions", json!([{ "id": "q1", "title": "Event loop", "statement": "Explain it.", "kind": "text" }]));
		let mut mock = start_mock(&fresh, at("2026-11-11T10:00:00.000Z"));
		mock = pause_mock(&mock, at("2026-11-11T10:05:00.000Z"));
		mock = resume_mock(&mock, at("2026-11-11T10:15:00.000Z"));
		mock = pause_mock(&mock, at("2026-11-11T10:20:00.000Z"));
		let ended = end_mock(&mock, at("2026-11-11T10:24:00.000Z"));
		let text = grade_request_text(&deadline(), &ended, &json!({}), &HashMap::new());
		assert!(text.contains("Mock 1: 2 questions for 70 minutes. They used 10 of them. Paused 2 times, 14 minutes in total."), "{text}");
		let mut untimed = ended.clone();
		untimed.as_obj_mut().unwrap().insert("format", json!({ "questions": 2 }));
		assert!(grade_request_text(&deadline(), &untimed, &json!({}), &HashMap::new()).contains("\nMock 1: 2 questions, with no time limit.\n"));
	}

	#[test]
	fn the_grades_request_says_when_the_code_never_ran_threw_or_was_never_submitted() {
		let mut mock = ended();
		mock.get_mut("answers").and_then(|a| a.get_mut("q1")).unwrap().as_obj_mut().unwrap().insert("submitted", false);
		let text = grade_request_text(&deadline(), &mock, &json!({ "q1": { "examples": [], "error": "SyntaxError: bad" } }), &facts());
		assert!(text.contains("10 min, never submitted)"));
		assert!(text.contains("It did not run on the examples here: SyntaxError: bad"));
		let threw = grade_request_text(&deadline(), &mock, &json!({ "q1": { "examples": [{ "error": "TypeError: x", "passed": false }, { "returned": "1", "passed": false }] } }), &facts());
		assert!(threw.contains("example 1 threw TypeError: x, example 2 returned 1."));
	}

	#[test]
	fn going_over_starts_from_the_question_the_answer_and_the_grade() {
		let graded = with_grades(&ended(), &[json!({ "question": "q1", "verdict": "partly", "feedback": "Hard-coded." })]).unwrap();
		let text = go_over_text(&graded, "q1").unwrap();
		assert!(text.starts_with("[Mock question] The learner wants to go over this question from Mock 2."));
		assert!(text.contains("## q1: Longest run (code)"));
		assert!(text.ends_with("Your grade then: partly. Your feedback then:\nHard-coded."));
	}

	#[test]
	fn going_over_a_blank_one_says_so_and_no_other_question_is_known() {
		let graded = with_grades(&ended(), &[json!({ "question": "q1", "verdict": "right", "feedback": "Good." })]).unwrap();
		let text = go_over_text(&graded, "q2").unwrap();
		assert!(text.ends_with("Explain the event loop.\n\nThey left it blank in the mock."));
		assert!(!text.contains("Don't grade it"));
		assert_eq!(go_over_text(&graded, "q9"), None);
	}
}
