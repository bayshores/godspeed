//! The prep sheet writer: one request on the single-submit seam, so the connected agent gets it as
//! one labeled work item ("Prep sheet: Backend phone screen"). The agent looks the thing up with
//! its own web search, reads any files the learner attached, and answers with one
//! write_prep_sheet call.
//!
//! Only the model talks here; what the app sends and keeps is the preps service.

use futures_util::FutureExt;
use gs_core::mocks::prep::{MAX_PREP_TOPICS, MOCK_MINUTES, MOCK_QUESTIONS, TOPIC_NAME_MAX, sheet_problem};
use gs_engine::bridge::Bridge;
use gs_engine::turn::abort::Abort;
use gs_engine::turn::faux::Engine;
use gs_json::{Json, json};

use super::pi_run::RunError;
use crate::extraction::submit_agent::{SubmitAgentOptions, run_submit_agent};

const PREP_SHEET_INSTRUCTIONS: &str = r#"You help someone get ready for one thing they named: an interview round, an online assessment, a test. They often don't know what it is like or what to study. Find out, then reply with one write_prep_sheet call.

- Look it up online with your own web search before you write: the exact format (how many questions, how long, what kinds), what it tests, how it is scored, what is allowed. Read any files they attached first (a job posting, an email, a resume): they say which role, level and stack this is.
- about: what it is like, for someone who has never seen it. Plain words, short paragraphs or a short list, under 200 words. Only what you found; where sources disagree or you could not find something, say so in one line. No pep talk.
- sources: the pages you actually read, each with its title and full URL. Never make one up.
- topics: what to study, in the order to study it: the most likely to come up and the most basic first. Each is one skill a study session can cover ("Arrays and strings", "Promises and async"), not a whole field. why: one line on where it shows up.
- mock: how many questions in how many minutes one practice run should be, matching the real thing as closely as a single sitting allows.
- name: a short name for this prep, a few words ("Backend phone screen").
- When the request lists topics the sheet already has, keep a topic's exact name where it still fits, so their progress on it stays.
- No em-dashes."#;

/// write_prep_sheet's parameters, as TypeBox emits them.
fn sheet_schema() -> Json {
	json!({
		"type": "object",
		"required": ["name", "about", "sources", "topics", "mock"],
		"properties": {
			"name": { "type": "string", "minLength": 1, "description": "A short name for this prep, a few words (\"Backend phone screen\")." },
			"about": { "type": "string", "minLength": 1, "description": "What it is like: format, timing, what it tests, how it is scored. Markdown, under 200 words." },
			"sources": {
				"type": "array",
				"items": { "type": "object", "required": ["title", "url"], "properties": { "title": { "type": "string" }, "url": { "type": "string", "description": "The full URL, starting with https://" } } },
				"description": "The pages you read.",
			},
			"topics": {
				"type": "array",
				"items": {
					"type": "object",
					"required": ["name"],
					"properties": {
						"name": { "type": "string", "minLength": 1, "maxLength": TOPIC_NAME_MAX, "description": "One skill to study." },
						"why": { "type": "string", "description": "One line: where it shows up." },
					},
				},
				"minItems": 1,
				"maxItems": MAX_PREP_TOPICS,
				"description": "What to study, in order.",
			},
			"mock": {
				"type": "object",
				"required": ["questions", "minutes"],
				"properties": {
					"questions": { "type": "integer", "minimum": *MOCK_QUESTIONS.start(), "maximum": *MOCK_QUESTIONS.end() },
					"minutes": { "type": "integer", "minimum": *MOCK_MINUTES.start(), "maximum": *MOCK_MINUTES.end() },
				},
				"description": "One practice run: how many questions in how many minutes.",
			},
		},
	})
}

/// One prep's sheet request.
pub struct SheetRequest {
	/// The learner's words: the work item's label.
	pub goal: String,
	/// The request (core `prep_request_text`).
	pub prompt: String,
	pub engine: Engine,
	pub signal: Abort,
}

/// Writes one prep's sheet (`{name, about, sources, topics, mock}` as sent). Fails when the agent
/// never sends a usable one.
pub async fn write_prep_sheet(bridge: &Bridge, input: SheetRequest) -> Result<Json, RunError> {
	let mut opts = SubmitAgentOptions::new(
		"write_prep_sheet",
		"Send the prep sheet: what it is like, your sources, the topics in order and the mock's format.",
		sheet_schema(),
		PREP_SHEET_INSTRUCTIONS.to_owned(),
		Json::from(input.prompt),
		"the agent never sent the sheet",
	);
	opts.validate = Some(Box::new(|sheet: &Json| std::future::ready(sheet_problem(sheet)).boxed()));
	opts.task_label = Some(format!("Prep sheet: {}", input.goal));
	opts.engine = Some(input.engine);
	opts.abort = Some(input.signal);
	run_submit_agent(bridge, opts).await
}

#[cfg(test)]
mod tests {
	use std::sync::Arc;

	use gs_engine::turn::faux::Scripted;
	use gs_json::stringify;
	use parking_lot::Mutex;

	use super::*;
	use crate::subagents::test_support::{bridge, calls, faux_engine, reply_seeing, result_texts, says};

	fn sheet(about: &str) -> Json {
		json!({ "name": "Backend phone screen", "about": about, "sources": [], "topics": [{ "name": "Arrays" }], "mock": { "questions": 2, "minutes": 45 } })
	}

	fn request(script: &Arc<Scripted>) -> SheetRequest {
		SheetRequest { goal: "Phone screen".to_owned(), prompt: "They are preparing for: Phone screen".to_owned(), engine: faux_engine(script), signal: Abort::new() }
	}

	#[tokio::test]
	async fn a_sheet_that_cant_be_kept_goes_back_and_the_next_one_is_kept() {
		let script = Scripted::new();
		let seen = Arc::new(Mutex::new(Vec::new()));
		script.reply(calls(&[("write_prep_sheet", sheet("  "))]));
		reply_seeing(&script, calls(&[("write_prep_sheet", sheet("One call, 45 minutes."))]), &seen);
		let written = write_prep_sheet(&bridge(), request(&script)).await.unwrap();
		assert_eq!(written["about"], Json::from("One call, 45 minutes."));
		assert!(result_texts(&seen.lock()[0])[0].contains("about is empty: say what it is like."));
	}

	#[tokio::test]
	async fn no_sheet_at_all_fails() {
		let script = Scripted::new();
		script.reply(says("I could not find it."));
		assert_eq!(write_prep_sheet(&bridge(), request(&script)).await, Err(RunError::Failed("the agent never sent the sheet".to_owned())));
	}

	#[test]
	fn the_schema_is_typebox_shaped() {
		assert_eq!(
			stringify(&sheet_schema()),
			r#"{"type":"object","required":["name","about","sources","topics","mock"],"properties":{"name":{"type":"string","minLength":1,"description":"A short name for this prep, a few words (\"Backend phone screen\")."},"about":{"type":"string","minLength":1,"description":"What it is like: format, timing, what it tests, how it is scored. Markdown, under 200 words."},"sources":{"type":"array","items":{"type":"object","required":["title","url"],"properties":{"title":{"type":"string"},"url":{"type":"string","description":"The full URL, starting with https://"}}},"description":"The pages you read."},"topics":{"type":"array","items":{"type":"object","required":["name"],"properties":{"name":{"type":"string","minLength":1,"maxLength":80,"description":"One skill to study."},"why":{"type":"string","description":"One line: where it shows up."}}},"minItems":1,"maxItems":12,"description":"What to study, in order."},"mock":{"type":"object","required":["questions","minutes"],"properties":{"questions":{"type":"integer","minimum":1,"maximum":10},"minutes":{"type":"integer","minimum":5,"maximum":240}},"description":"One practice run: how many questions in how many minutes."}}}"#
		);
	}
}
