//! The mock's two requests (mock-writer.ts), each one work item on the single-submit seam: the
//! questions before it starts ("Mock 1: questions") and the grades after it ends ("Mock 1:
//! grading"). Nothing is asked while the clock runs.
//!
//! Only the model talks here; what the app sends and keeps is the mocks service.

use std::collections::HashSet;
use std::sync::Arc;

use futures_util::FutureExt;
use gs_core::mocks::mock::{take_questions, with_grades};
use gs_engine::bridge::Bridge;
use gs_engine::turn::abort::Abort;
use gs_engine::turn::faux::Engine;
use gs_json::{Json, json};
use parking_lot::Mutex;

use super::pi_run::RunError;
use crate::extraction::submit_agent::{SubmitAgentOptions, run_submit_agent};

const MOCK_QUESTIONS_INSTRUCTIONS: &str = r#"You write one practice run (a mock) for someone getting ready for the exam, quiz or interview the request names. Reply with one write_mock_questions call.

- Write exactly the number of questions asked for, like the real thing in kind and difficulty, and doable in the time given. If the real thing gets harder as it goes, so does this.
- Cover what the real thing covers, leaning on the topics that most need work. Give each question the fact_ids of the facts it tests, from the request.
- Never repeat a question from an earlier mock.
- kind "code": the answer is one function, checked by calling it. Give function_name (one plain name used in both JavaScript and Python), params, and 2 to 4 examples. It takes and returns only JSON values (numbers, strings, true/false, null, arrays, objects) and behaves the same in both languages. An example's args is a JSON array with one item per parameter, expected is the JSON value it returns. Work each example out by hand: a wrong one costs the learner the question.
- kind "text": anything answered in words (explain, design, a behavioral question, a choice with its reason).
- statement, in markdown: what to do, what the function takes and returns, the limits on the input. The app shows the examples under it, so don't repeat them. No hints and no solution.
- No em-dashes."#;

fn questions_schema() -> Json {
	json!({
		"type": "object",
		"required": ["questions"],
		"properties": {
			"questions": {
				"type": "array",
				"items": {
					"type": "object",
					"required": ["title", "statement", "kind"],
					"properties": {
						"title": { "type": "string", "minLength": 1, "description": "A few words." },
						"statement": { "type": "string", "minLength": 1, "description": "The whole question, in markdown." },
						"kind": { "anyOf": [{ "type": "string", "const": "code" }, { "type": "string", "const": "text" }] },
						"fact_ids": { "type": "array", "items": { "type": "string" }, "description": "The ids of the facts it tests." },
						"function_name": { "type": "string", "description": "Code questions: the one function to write." },
						"params": { "type": "array", "items": { "type": "string" }, "description": "Code questions: its parameter names, in order." },
						"examples": {
							"type": "array",
							"items": {
								"type": "object",
								"required": ["args", "expected"],
								"properties": {
									"args": { "type": "string", "description": "A JSON array with one item per parameter: \"[[2,7,11,15], 9]\"." },
									"expected": { "type": "string", "description": "The JSON value it returns: \"[0,1]\"." },
								},
							},
							"description": "Code questions: 2 to 4 calls and what each returns.",
						},
					},
				},
				"minItems": 1,
			},
		},
	})
}

const GRADE_MOCK_INSTRUCTIONS: &str = r#"You grade one finished practice run (a mock). The request has every question with the facts it tests, what the learner wrote, and how long each took. Reply with one grade_mock call.

- Grade every answered question. Skip the ones marked blank.
- A code answer: decide whether it is correct for every input the question allows, not only its examples. If you can run code, run it on the edge cases (empty input, one item, repeats, the largest sizes). right: correct, and fast enough for the limits. partly: the idea is right but some inputs fail or it is too slow. wrong: anything else.
- A written answer: right when it would pass in the real thing, partly when the core is there with real gaps, wrong otherwise.
- feedback, to the learner as "you", under 120 words, in markdown: what was right, the first thing that breaks it (name an input that fails), and what to fix. Don't write out the full solution: they can go over it with you after.
- No em-dashes."#;

fn grades_schema() -> Json {
	json!({
		"type": "object",
		"required": ["grades"],
		"properties": {
			"grades": {
				"type": "array",
				"items": {
					"type": "object",
					"required": ["question", "verdict", "feedback"],
					"properties": {
						"question": { "type": "string", "description": "The question's id: \"q1\"." },
						"verdict": { "anyOf": [{ "type": "string", "const": "right" }, { "type": "string", "const": "partly" }, { "type": "string", "const": "wrong" }] },
						"feedback": { "type": "string", "minLength": 1, "description": "Under 120 words, markdown." },
					},
				},
			},
		},
	})
}

/// One of a mock's two requests.
pub struct MockRequest {
	/// "Mock 1": the work item's label.
	pub label: String,
	/// The request (core `mock_requests`).
	pub prompt: String,
	pub engine: Engine,
	pub signal: Abort,
}

fn items(list: &Json) -> &[Json] {
	list.as_arr().map_or(&[], Vec::as_slice)
}

/// Writes a mock's questions for its `format`, keeping only `fact_ids` the request gave. Fails
/// when the agent never sends usable ones.
pub async fn write_mock_questions(bridge: &Bridge, input: MockRequest, format: &Json, fact_ids: HashSet<String>) -> Result<Vec<Json>, RunError> {
	let taken: Arc<Mutex<Vec<Json>>> = Arc::default();
	let mut opts = SubmitAgentOptions::new(
		"write_mock_questions",
		"Send every question of the mock, in order.",
		questions_schema(),
		MOCK_QUESTIONS_INSTRUCTIONS.to_owned(),
		Json::from(input.prompt),
		"the agent never sent the questions",
	);
	opts.fill = Some(Box::new(|raw: Json| raw["questions"].clone()));
	opts.validate = Some(Box::new({
		let (taken, format) = (taken.clone(), format.clone());
		move |written: &Json| {
			let problem = match take_questions(items(written), &format, &fact_ids) {
				Ok(questions) => {
					*taken.lock() = questions;
					None
				}
				Err(problem) => Some(problem),
			};
			std::future::ready(problem).boxed()
		}
	}));
	opts.task_label = Some(format!("{}: questions", input.label));
	opts.engine = Some(input.engine);
	opts.abort = Some(input.signal);
	run_submit_agent(bridge, opts).await?;
	Ok(std::mem::take(&mut *taken.lock()))
}

/// Grades an ended mock: the mock with its grades. Fails when the agent never sends usable ones.
pub async fn grade_mock(bridge: &Bridge, input: MockRequest, mock: &Json) -> Result<Json, RunError> {
	let graded = Arc::new(Mutex::new(mock.clone()));
	let mut opts = SubmitAgentOptions::new(
		"grade_mock",
		"Send the grade of every answered question.",
		grades_schema(),
		GRADE_MOCK_INSTRUCTIONS.to_owned(),
		Json::from(input.prompt),
		"the agent never sent the grades",
	);
	opts.fill = Some(Box::new(|raw: Json| raw["grades"].clone()));
	opts.validate = Some(Box::new({
		let (graded, mock) = (graded.clone(), mock.clone());
		move |written: &Json| {
			let problem = match with_grades(&mock, items(written)) {
				Ok(taken) => {
					*graded.lock() = taken;
					None
				}
				Err(problem) => Some(problem),
			};
			std::future::ready(problem).boxed()
		}
	}));
	opts.task_label = Some(format!("{}: grading", input.label));
	opts.engine = Some(input.engine);
	opts.abort = Some(input.signal);
	run_submit_agent(bridge, opts).await?;
	let graded = graded.lock().clone();
	Ok(graded)
}

#[cfg(test)]
mod tests {
	use gs_core::mocks::mock::{end_mock, new_mock, start_mock, with_answer};
	use gs_engine::turn::faux::Scripted;

	use super::*;
	use crate::subagents::test_support::{bridge, calls, faux_engine, reply_seeing, result_texts, says};

	fn request(script: &Arc<Scripted>) -> MockRequest {
		MockRequest { label: "Mock 1".to_owned(), prompt: "They are preparing for: Larkspur phone screen (interview).".to_owned(), engine: faux_engine(script), signal: Abort::new() }
	}

	fn format() -> Json {
		json!({ "questions": 1, "minutes": 30 })
	}

	fn question() -> Json {
		json!({ "title": "Count", "statement": "Count them.", "kind": "code", "fact_ids": ["f_a"], "function_name": "count", "params": ["s"], "examples": [{ "args": "[\"ab\"]", "expected": "2" }, { "args": "[\"\"]", "expected": "0" }] })
	}

	#[tokio::test]
	async fn questions_that_cant_be_kept_go_back_and_the_kept_ones_are_returned() {
		let script = Scripted::new();
		let seen = Arc::new(Mutex::new(Vec::new()));
		script.reply(calls(&[("write_mock_questions", json!({ "questions": [question(), question()] }))]));
		reply_seeing(&script, calls(&[("write_mock_questions", json!({ "questions": [question()] }))]), &seen);
		let questions = write_mock_questions(&bridge(), request(&script), &format(), HashSet::new()).await.unwrap();
		assert_eq!(questions.len(), 1);
		assert_eq!(questions[0]["id"], Json::from("q1"));
		assert!(questions[0].get("factIds").is_none(), "a fact the request didn't give is dropped");
		assert!(result_texts(&seen.lock()[0])[0].contains("Write exactly 1 questions (got 2)."));
	}

	#[tokio::test]
	async fn no_questions_at_all_fails() {
		let script = Scripted::new();
		for _ in 0..4 {
			script.reply(says("I can't."));
		}
		assert_eq!(write_mock_questions(&bridge(), request(&script), &format(), HashSet::new()).await, Err(RunError::Failed("the agent never sent the questions".to_owned())));
	}

	#[tokio::test]
	async fn grades_must_cover_every_answered_question() {
		let mut mock = new_mock("mock_0a1b2c3d", "ddl_a", 1.0, &format(), "2026-11-11T09:00:00.000Z");
		mock.as_obj_mut().unwrap().insert("questions", take_questions(&[question()], &format(), &HashSet::new()).unwrap());
		let live = start_mock(&mock, 1_000);
		let ended = end_mock(&with_answer(&live, "q1", &json!({ "text": "", "language": "javascript", "code": { "javascript": "x" }, "seconds": 5, "submitted": true })), 2_000);
		let script = Scripted::new();
		let seen = Arc::new(Mutex::new(Vec::new()));
		script.reply(calls(&[("grade_mock", json!({ "grades": [] }))]));
		reply_seeing(&script, calls(&[("grade_mock", json!({ "grades": [{ "question": "q1", "verdict": "wrong", "feedback": " Off by one. " }] }))]), &seen);
		let graded = grade_mock(&bridge(), request(&script), &ended).await.unwrap();
		assert_eq!(graded["grades"], json!({ "q1": { "verdict": "wrong", "feedback": "Off by one." } }));
		assert!(result_texts(&seen.lock()[0])[0].contains("No grade for q1: grade every answered question."));
	}

	#[test]
	fn the_schemas_are_typebox_shaped() {
		assert_eq!(
			gs_json::stringify(&questions_schema()),
			r#"{"type":"object","required":["questions"],"properties":{"questions":{"type":"array","items":{"type":"object","required":["title","statement","kind"],"properties":{"title":{"type":"string","minLength":1,"description":"A few words."},"statement":{"type":"string","minLength":1,"description":"The whole question, in markdown."},"kind":{"anyOf":[{"type":"string","const":"code"},{"type":"string","const":"text"}]},"fact_ids":{"type":"array","items":{"type":"string"},"description":"The ids of the facts it tests."},"function_name":{"type":"string","description":"Code questions: the one function to write."},"params":{"type":"array","items":{"type":"string"},"description":"Code questions: its parameter names, in order."},"examples":{"type":"array","items":{"type":"object","required":["args","expected"],"properties":{"args":{"type":"string","description":"A JSON array with one item per parameter: \"[[2,7,11,15], 9]\"."},"expected":{"type":"string","description":"The JSON value it returns: \"[0,1]\"."}}},"description":"Code questions: 2 to 4 calls and what each returns."}}},"minItems":1}}}"#
		);
		assert_eq!(
			gs_json::stringify(&grades_schema()),
			r#"{"type":"object","required":["grades"],"properties":{"grades":{"type":"array","items":{"type":"object","required":["question","verdict","feedback"],"properties":{"question":{"type":"string","description":"The question's id: \"q1\"."},"verdict":{"anyOf":[{"type":"string","const":"right"},{"type":"string","const":"partly"},{"type":"string","const":"wrong"}]},"feedback":{"type":"string","minLength":1,"description":"Under 120 words, markdown."}}}}}}"#
		);
	}
}
