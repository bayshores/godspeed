//! topic_done, Study's call after a finished topic: it stores the topic's review question and the
//! next topic's opener (its lead and first prediction), shown when the learner goes on, and ends
//! the turn. Every field is checked before validation, so a refused call lists all its problems at
//! once and never gets its arguments echoed back.

use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_base::{clock, text};
use gs_core::contracts::chat::{TOPIC_DONE_STORED_TEXT, TOPIC_DONE_TOOL};
use gs_core::session::argument_heal::heal_encoded_arguments;
use gs_core::session::question_core::{quiz_input_object, quiz_input_problems};
use gs_core::session::schema::{described, object, string};
use gs_core::study::topic_end::{finished_topic, topic_done_stored, topic_stop};
use gs_engine::turn::messages::text_block;
use gs_engine::turn::tool::{ExecutionMode, Tool, ToolContext};
use gs_engine::turn::validate::argument_problems;
use gs_json::{Json, Obj, json, stringify_pretty};

use super::fn_tool::FnTool;
use super::practice::{LessonRecord, TurnGate, record_messages};

/// Checks the source marks in a text: the text with its marks in stored form, and each mark that
/// points at no passage (taken out of the text).
pub type CheckMarks = Arc<dyn Fn(&str) -> (String, Vec<String>) + Send + Sync>;

const LEAD_MAX: usize = 700;

/// The free-recall description is these two sentences alone.
const DESCRIPTION_START: &str = "Study only. Call after the conclude that finishes a topic, once you have read what the next topic needs.";

fn description(multiple_choice: bool) -> String {
	if !multiple_choice {
		return DESCRIPTION_START.to_owned();
	}
	let example = stringify_pretty(&example(), "  ");
	format!("{DESCRIPTION_START} Ends your turn. review and opener.quiz take the same fields as quiz; godspeed checks them now.\nExample arguments:\n```json\n{example}\n```")
}

/// Written in the quiz example's form, so its escaping is the one models already copy.
fn example() -> Json {
	let options = |labels: [&str; 4]| -> Json { Json::Arr(labels.iter().zip(["A", "B", "C", "D"]).map(|(label, value)| json!({ "label": *label, "value": value })).collect()) };
	json!({
		"nodeId": "n3",
		"review": {
			"type": "check",
			"nodeId": "n3",
			"question": "For which $\\lambda$ is $X^\\top X + \\lambda I$ always invertible?",
			"options": options(["Every $\\lambda > 0$.", "Only $\\lambda \\ge 1$.", "Only when $X^\\top X$ is invertible.", "No $\\lambda$."]),
			"explanation": "$v^\\top(X^\\top X+\\lambda I)v = \\|Xv\\|^2 + \\lambda\\|v\\|^2 > 0$ for $v \\ne 0$.",
			"correctAnswer": "A",
		},
		"opener": {
			"lead": "Here $\\lambda$ is picked on one split of the 60 points, then on another.[[f_1a2b3c4d5e6f:3]]",
			"quiz": {
				"type": "predict",
				"nodeId": "n4",
				"question": "Pick the $\\lambda$ with the lowest validation error on Split 1, then again on Split 2. What happens to the best $\\lambda$?",
				"options": options(["It can move a lot.", "It stays the same, since the data are the same.", "It always gets larger.", "It always gets smaller."]),
				"explanation": "Each split picks its own $\\lambda$.",
				"correctAnswer": "A",
			},
		},
	})
}

fn quiz_schema(description: &str) -> Json {
	described(quiz_input_object(), description)
}

fn lead_schema() -> Json {
	json!({ "type": "string", "maxLength": LEAD_MAX, "description": "Its first words; source marks go here." })
}

/// The schema the agent sees. Free recall has no quiz, so only the topic.
fn parameters(multiple_choice: bool) -> Json {
	let mut fields = vec![("nodeId", string("the topic just finished (concluded, or ended by a right quiz)"))];
	if multiple_choice {
		fields.push(("review", quiz_schema("One standalone check on this topic, stored and asked weeks later, never shown now.")));
		let opener = object(&["lead", "quiz"], vec![("lead", lead_schema()), ("quiz", quiz_schema("Its first prediction."))]);
		fields.push(("opener", described(opener, "The next topic's start, shown when he goes on, before you reply.")));
	}
	object(&["nodeId"], fields)
}

/// The shown schema without what the tool's own lines say better: both quiz types and the lead's
/// cap.
fn check_schema(parameters: &Json) -> Json {
	let mut schema = parameters.clone();
	let plain_type = |quiz: &mut Json| {
		if let Some(fields) = quiz.as_obj_mut().and_then(|q| q.get_mut("properties")).and_then(Json::as_obj_mut) {
			fields.insert("type", json!({ "type": "string" }));
		}
	};
	if let Some(fields) = schema.as_obj_mut().and_then(|s| s.get_mut("properties")).and_then(Json::as_obj_mut) {
		if let Some(review) = fields.get_mut("review") {
			plain_type(review);
		}
		if let Some(opener) = fields.get_mut("opener").and_then(|o| o.as_obj_mut()).and_then(|o| o.get_mut("properties")).and_then(Json::as_obj_mut) {
			if let Some(quiz) = opener.get_mut("quiz") {
				plain_type(quiz);
			}
			opener.insert("lead", json!({ "type": "string" }));
		}
	}
	schema
}

/// The shipped quiz lines under a path: `review.correctAnswer ...`, or `review: Two options ...`
/// for a line that does not start with a field.
fn at_path(path: &str, lines: Vec<String>) -> impl Iterator<Item = String> {
	lines.into_iter().map(move |line| if line.starts_with(|c: char| c.is_ascii_lowercase()) { format!("{path}.{line}") } else { format!("{path}: {line}") })
}

/// Heals a nested object against its own schema, in place.
fn heal_at(parent: &mut Json, key: &str, schema: &Json) {
	if let Some(obj) = parent.as_obj_mut()
		&& let Some(value) = obj.get(key).filter(|v| v.as_obj().is_some())
	{
		let healed = heal_encoded_arguments(value, schema);
		obj.insert(key, healed);
	}
}

struct TopicDone {
	description: String,
	parameters: Json,
	check_schema: Json,
	multiple_choice: bool,
	record: LessonRecord,
	gate: Arc<TurnGate>,
	check_marks: CheckMarks,
}

impl TopicDone {
	/// The nested quizzes' heal (the registry heals the top level), then every field check; all
	/// problems in one refusal.
	fn prepare(&self, mut args: Json) -> Result<Json, String> {
		if self.multiple_choice {
			let quiz = quiz_input_object();
			heal_at(&mut args, "review", &quiz);
			if let Some(opener) = args.as_obj_mut().and_then(|a| a.get_mut("opener")) {
				heal_at(opener, "quiz", &quiz);
			}
		}
		let mut problems = argument_problems(&self.check_schema, &args);
		let review = &args["review"];
		if review.as_obj().is_some() {
			if review["type"].as_str() != Some("check") {
				problems.push("review: must be type \"check\".".to_owned());
			}
			problems.extend(at_path("review", quiz_input_problems(review)));
		}
		let opener = &args["opener"];
		if let Some(lead) = opener["lead"].as_str() {
			let length = text::len16(lead);
			if length > LEAD_MAX {
				problems.push(format!("opener.lead: {length} characters, at most {LEAD_MAX}."));
			}
		}
		let quiz = &opener["quiz"];
		if quiz.as_obj().is_some() {
			if quiz["type"].as_str() != Some("predict") {
				problems.push("opener.quiz: must be type \"predict\".".to_owned());
			}
			if let Some(node_id) = quiz["nodeId"].as_str().filter(|n| Some(*n) == args["nodeId"].as_str()) {
				problems.push(format!("opener.quiz.nodeId: \"{node_id}\" is the topic you just finished; use the next topic's node."));
			}
			problems.extend(at_path("opener.quiz", quiz_input_problems(quiz)));
		}
		if problems.is_empty() { Ok(args) } else { Err(problems.join("\n")) }
	}

	/// The turn gate and the lead's marks, then the stored result that ends the turn.
	fn run(&self, args: &Json) -> Result<Json, String> {
		let messages = record_messages(&self.record.chat_store, &self.record.chat_id);
		let node_id = args["nodeId"].as_str().unwrap_or_default();
		// The topic this turn's conclude finished, else the one the record's newest graded event did.
		let this_turn = self.gate.topic_ended();
		let finished = this_turn.as_ref().map(|t| (t.node_id.clone(), false)).or_else(|| finished_topic(&messages));
		let mut problems = Vec::new();
		match &finished {
			None => problems.push("Finish this topic first: conclude its problem, or wait for a right answer to a quiz on it.".to_owned()),
			Some((done, _)) if done != node_id => problems.push(format!("nodeId: \"{node_id}\" is not the topic you just finished (\"{done}\").")),
			Some((done, _)) if this_turn.as_ref().is_some_and(|t| t.stored) || topic_done_stored(&messages, done) => problems.push(format!("topic_done for \"{done}\" is already stored.")),
			Some(_) => {}
		}
		let lead = args["opener"]["lead"].as_str().map(|lead| {
			let (checked, removed) = (self.check_marks)(lead);
			problems.extend(removed.iter().map(|mark| format!("opener.lead: removed source mark {mark}; it does not point at a passage.")));
			checked
		});
		let Some((done, by_quiz)) = finished.filter(|_| problems.is_empty()) else { return Err(problems.join("\n")) };
		self.gate.set_topic_ended(&done, true);
		let mut details = Obj::new();
		details.insert("part", TOPIC_DONE_TOOL);
		details.insert("v", 1);
		if let Some(lead) = lead {
			details.insert("lead", lead);
		}
		// A topic a conclude finished has its stop on that conclude.
		if by_quiz {
			details.insert("stop", topic_stop(&messages, &done, clock::now_ms()));
		}
		Ok(json!({ "content": [text_block(TOPIC_DONE_STORED_TEXT)], "details": Json::Obj(details), "terminate": true }))
	}
}

impl Tool for TopicDone {
	fn name(&self) -> &str {
		TOPIC_DONE_TOOL
	}

	fn description(&self) -> &str {
		&self.description
	}

	fn parameters(&self) -> &Json {
		&self.parameters
	}

	fn execution_mode(&self) -> ExecutionMode {
		ExecutionMode::Sequential
	}

	fn prepare_arguments(&self, args: Json) -> Result<Json, String> {
		self.prepare(args)
	}

	fn execute(&self, args: Json, _ctx: ToolContext) -> BoxFuture<'_, Result<Json, String>> {
		Box::pin(async move { self.run(&args) })
	}
}

/// The tool for one Study turn, under the gate the study problem and conclude share.
pub fn topic_done_tool(record: LessonRecord, gate: &Arc<TurnGate>, check_marks: CheckMarks, multiple_choice: bool) -> FnTool {
	let parameters = parameters(multiple_choice);
	let check_schema = check_schema(&parameters);
	FnTool::from_tool(Arc::new(TopicDone { description: description(multiple_choice), parameters, check_schema, multiple_choice, record, gate: gate.clone(), check_marks }))
}

#[cfg(test)]
mod tests {
	use gs_engine::turn::abort::Abort;
	use gs_engine::turn::agent::{Agent, AgentOptions};
	use gs_engine::turn::faux::{Engine, Scripted, faux_model};
	use gs_engine::turn::messages::faux_assistant_message;
	use gs_json::stringify;

	use super::*;
	use crate::tools::test_record::record;

	/// Keeps every mark but `[[f_bad:9]]`, which points at nothing.
	fn check_marks() -> CheckMarks {
		Arc::new(|text: &str| if text.contains("[[f_bad:9]]") { (text.replace("[[f_bad:9]]", ""), vec!["f_bad:9".to_owned()]) } else { (text.replace("[[f_1:3]]", "[[f_1/p. 3/Notes.pdf]]"), Vec::new()) })
	}

	fn tool_on(messages: Vec<Json>, multiple_choice: bool) -> (FnTool, Arc<TurnGate>) {
		let gate = TurnGate::new(false);
		(topic_done_tool(record(messages), &gate, check_marks(), multiple_choice), gate)
	}

	async fn call(tool: &FnTool, args: Json) -> Result<Json, String> {
		let prepared = tool.prepare_arguments(args)?;
		tool.execute(prepared, ToolContext { tool_call_id: "t1".to_owned(), abort: Abort::new() }).await
	}

	fn quiz(kind: &str, node_id: &str) -> Json {
		json!({ "type": kind, "nodeId": node_id, "question": "Q?", "options": [{ "label": "A" }, { "label": "B" }, { "label": "C" }, { "label": "D" }], "explanation": "Because.", "correctAnswer": "A" })
	}

	fn sent() -> Json {
		json!({ "nodeId": "n3", "review": quiz("check", "n3"), "opener": { "lead": "Now split the data [[f_1:3]].", "quiz": quiz("predict", "n4") } })
	}

	fn with(mut args: Json, path: &[&str], value: Json) -> Json {
		let (last, parents) = path.split_last().unwrap();
		let mut at = &mut args;
		for key in parents {
			at = at.as_obj_mut().unwrap().get_mut(key).unwrap();
		}
		at.as_obj_mut().unwrap().insert(*last, value);
		args
	}

	/// n3's problem, then a right check quiz on n3.
	fn quiz_ended() -> Vec<Json> {
		vec![
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "q1", "name": "quiz", "arguments": quiz("check", "n3") }], "timestamp": 1_000 }),
			json!({ "role": "toolResult", "toolCallId": "q1", "toolName": "quiz", "details": { "kind": "quiz", "correct": true }, "isError": false, "timestamp": 2_000 }),
		]
	}

	fn concluded_now(gate: &TurnGate) {
		gate.set_topic_ended("n3", false);
	}

	#[tokio::test]
	async fn the_described_example_passes_every_check() {
		let (tool, gate) = tool_on(Vec::new(), true);
		concluded_now(&gate);
		assert!(tool.description().ends_with(&format!("```json\n{}\n```", stringify_pretty(&example(), "  "))));
		let stored = call(&tool, example()).await.unwrap();
		assert_eq!(stored["terminate"], json!(true));
	}

	#[tokio::test]
	async fn every_field_problem_comes_back_at_once_without_the_call() {
		let (tool, gate) = tool_on(Vec::new(), true);
		concluded_now(&gate);
		let args = with(with(with(with(sent(), &["review", "type"], json!("predict")), &["review", "correctAnswer"], json!("b")), &["opener", "lead"], Json::from("x".repeat(812))), &["opener", "quiz"], quiz("check", "n3"));
		let refused = call(&tool, args).await.unwrap_err();
		assert_eq!(
			refused.lines().collect::<Vec<_>>(),
			[
				"review: must be type \"check\".",
				"review.correctAnswer \"b\" does not match any option value. Valid values: \"A\", \"B\", \"C\", \"D\". Copy the exact value (or label) of the intended option \u{2014} never a paraphrase or slug.",
				"opener.lead: 812 characters, at most 700.",
				"opener.quiz: must be type \"predict\".",
				"opener.quiz.nodeId: \"n3\" is the topic you just finished; use the next topic's node.",
			]
		);
		assert!(!refused.contains("Received arguments"));
	}

	#[tokio::test]
	async fn nested_quiz_problems_name_their_path() {
		let (tool, gate) = tool_on(Vec::new(), true);
		concluded_now(&gate);
		let mut opener_quiz = quiz("predict", "n4");
		opener_quiz.as_obj_mut().unwrap().remove("question");
		let args = with(with(sent(), &["opener", "quiz"], opener_quiz), &["review", "options"], json!([{ "label": "A" }, { "label": "A" }]));
		assert_eq!(
			call(&tool, args).await.unwrap_err().lines().collect::<Vec<_>>(),
			["opener.quiz.question: must have required properties question", "review: Two options resolve to the same value \"A\" \u{2014} options must be distinct."]
		);
		let encoded = with(sent(), &["opener", "quiz", "options"], Json::from(stringify(&quiz("predict", "n4")["options"])));
		assert!(call(&tool, encoded).await.is_ok(), "a nested JSON-encoded list is healed");
	}

	#[tokio::test]
	async fn the_gate_wants_the_topic_just_finished_once() {
		let (tool, _) = tool_on(Vec::new(), true);
		assert_eq!(call(&tool, sent()).await.unwrap_err(), "Finish this topic first: conclude its problem, or wait for a right answer to a quiz on it.");

		let (tool, gate) = tool_on(Vec::new(), true);
		concluded_now(&gate);
		let bad_mark = with(with(sent(), &["nodeId"], json!("n4")), &["opener", "quiz", "nodeId"], json!("n5"));
		let bad_mark = with(bad_mark, &["opener", "lead"], json!("See [[f_bad:9]]."));
		assert_eq!(
			call(&tool, bad_mark).await.unwrap_err().lines().collect::<Vec<_>>(),
			["nodeId: \"n4\" is not the topic you just finished (\"n3\").", "opener.lead: removed source mark f_bad:9; it does not point at a passage."]
		);
		assert!(call(&tool, sent()).await.is_ok(), "this turn's conclude finished n3");
		assert_eq!(call(&tool, sent()).await.unwrap_err(), "topic_done for \"n3\" is already stored.");

		let stored = [quiz_ended(), vec![
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "t0", "name": "topic_done", "arguments": { "nodeId": "n3" } }], "timestamp": 3_000 }),
			json!({ "role": "toolResult", "toolCallId": "t0", "toolName": "topic_done", "details": { "part": "topic_done", "v": 1 }, "isError": false, "timestamp": 3_000 }),
		]].concat();
		let (tool, _) = tool_on(stored, true);
		assert_eq!(call(&tool, sent()).await.unwrap_err(), "topic_done for \"n3\" is already stored.");
	}

	#[tokio::test]
	async fn a_stored_topic_ends_the_turn_and_a_quiz_ended_one_carries_its_stop() {
		let (tool, gate) = tool_on(Vec::new(), true);
		concluded_now(&gate);
		let done = call(&tool, sent()).await.unwrap();
		assert_eq!(done, json!({ "content": [{ "type": "text", "text": TOPIC_DONE_STORED_TEXT }], "details": { "part": "topic_done", "v": 1, "lead": "Now split the data [[f_1/p. 3/Notes.pdf]]." }, "terminate": true }));

		let (tool, _) = tool_on(quiz_ended(), true);
		let done = call(&tool, sent()).await.unwrap();
		let stop = &done["details"]["stop"];
		assert_eq!((stop["kind"].as_str(), stop["nodeId"].as_str(), stop["activeMinutes"].as_f64()), (Some("topic"), Some("n3"), Some(0.0)));
		assert_eq!(done["terminate"], Json::Bool(true));
	}

	#[tokio::test]
	async fn free_recall_takes_the_topic_alone() {
		let (tool, gate) = tool_on(Vec::new(), false);
		assert_eq!(tool.description(), "Study only. Call after the conclude that finishes a topic, once you have read what the next topic needs.");
		assert_eq!(stringify(tool.parameters()), stringify(&json!({ "type": "object", "required": ["nodeId"], "properties": { "nodeId": { "type": "string", "description": "the topic just finished (concluded, or ended by a right quiz)" } } })));
		assert_eq!(call(&tool, json!({})).await.unwrap_err(), "nodeId: must have required properties nodeId");
		concluded_now(&gate);
		assert_eq!(call(&tool, json!({ "nodeId": "n3" })).await.unwrap()["details"], json!({ "part": "topic_done", "v": 1 }));
	}

	#[tokio::test]
	async fn the_stored_call_is_what_was_sent() {
		let (tool, gate) = tool_on(Vec::new(), true);
		concluded_now(&gate);
		let sent_args = with(sent(), &["review", "options"], Json::from(stringify(&quiz("check", "n3")["options"])));
		let scripted = Scripted::new();
		scripted.reply(faux_assistant_message(vec![json!({ "type": "toolCall", "id": "t1", "name": "topic_done", "arguments": sent_args.clone() })], "toolUse"));
		let mut options = AgentOptions::new(Engine { model: faux_model("m", "p", "faux", "Faux", 1000.0, 100.0), respond: scripted });
		options.tools = vec![tool.into_arc()];
		let agent = Agent::new(options);
		agent.prompt(vec![json!({ "role": "user", "content": "go", "timestamp": 1 })], Abort::new()).await.unwrap();
		let messages = agent.messages();
		let assistant = messages.iter().find(|m| m["role"].as_str() == Some("assistant")).unwrap();
		assert_eq!(stringify(&assistant["content"][0]["arguments"]), stringify(&sent_args));
		let result = messages.iter().find(|m| m["role"].as_str() == Some("toolResult")).unwrap();
		assert_eq!((result["isError"].as_bool(), result["content"][0]["text"].as_str()), (Some(false), Some(TOPIC_DONE_STORED_TEXT)));
		assert_eq!(messages.last().unwrap()["role"].as_str(), Some("toolResult"), "its result ends the run");
	}
}
