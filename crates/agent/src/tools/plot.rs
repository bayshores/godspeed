//! plot, Study's slider plot: one or two lines over x with one slider, sent with a guess on it in
//! the same reply. Every rule is checked before validation, so a refused call lists all its
//! problems at once with no echo; its guess is checked with it by the lesson-parts hook. A drawn
//! plot is named p1, p2 in lesson order, tells the agent its values at the slider's start, and ends
//! the turn. The window recomputes the lines from the stored call; the result's details hold only
//! its id, its guess and the y range.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use futures_util::future::BoxFuture;
use gs_core::session::plot::{PLOT_TOOL, check_plot, plot_details};
use gs_core::session::schema::{described, object};
use gs_engine::turn::messages::text_block;
use gs_engine::turn::tool::{ExecutionMode, Tool, ToolContext};
use gs_json::{Json, json};

use super::fn_tool::FnTool;
use super::lesson_parts::LessonParts;
use super::practice::{LessonRecord, record_messages};

const DESCRIPTION: &str = "Draws one or two lines over x with one slider, instead of demo, when the idea is a curve and one knob. Send it with a prediction on it (quiz.onPlot) in the same reply; it stays locked until he answers. Leave one plain reply after his marked page or a keep.";

fn parameters() -> Json {
	let name = |description: &str| json!({ "type": "string", "pattern": "^[a-z][a-z0-9_]{0,11}$", "description": description });
	let label = |description: &str| json!({ "type": "string", "maxLength": 40, "description": description });
	let number = || json!({ "type": "number" });
	let line = object(
		&["label", "expr"],
		vec![
			("label", label("One word, shown beside the line.")),
			("expr", json!({ "type": "string", "maxLength": 200, "description": "Plain math, not LaTeX, in the x and slider names: + - * / ^, brackets, sin cos tan exp ln log10 sqrt abs, min max, pi, e. Example: min(a, 4/(1+lambda))" })),
			("hidden", json!({ "type": "boolean", "description": "Held back until he answers; use it for the true line when the plot tests an analogy." })),
		],
	);
	object(
		&["title", "x", "y", "slider", "lines"],
		vec![
			("title", json!({ "type": "string", "maxLength": 60, "description": "What the plot shows." })),
			("x", object(&["name", "label", "min", "max"], vec![("name", name("Its name in expr, like a.")), ("label", label("The axis title.")), ("min", number()), ("max", number())])),
			("y", described(object(&["label"], vec![("label", label("The axis title.")), ("min", number()), ("max", number())]), "Give min and max both, or leave both out and godspeed picks them.")),
			(
				"slider",
				object(
					&["name", "min", "max", "start"],
					vec![("name", name("Its name in expr; a Greek letter's name shows as its symbol.")), ("min", number()), ("max", number()), ("start", json!({ "type": "number", "description": "where the thumb starts; inside min to max" }))],
				),
			),
			("lines", json!({ "type": "array", "items": line, "minItems": 1, "maxItems": 2, "description": "First solid, second dashed." })),
		],
	)
}

struct Plot {
	parameters: Json,
	record: LessonRecord,
	parts: Arc<LessonParts>,
	/// Plots drawn in this turn, for the next one's id.
	drawn: AtomicUsize,
}

impl Plot {
	fn run(&self, args: &Json, call_id: &str) -> Result<Json, String> {
		let plot = check_plot(args).map_err(|problems| problems.join("\n"))?;
		let guess = self.parts.guess_of(call_id).ok_or("plot: needs a quiz with onPlot in the same reply.")?;
		let stored = record_messages(&self.record.chat_store, &self.record.chat_id)
			.iter()
			.filter(|m| m["role"].as_str() == Some("toolResult") && m["toolName"].as_str() == Some(PLOT_TOOL) && !m["isError"].truthy())
			.count();
		let id = format!("p{}", stored + self.drawn.fetch_add(1, Ordering::SeqCst) + 1);
		let details = plot_details(&id, guess, plot.y);
		Ok(json!({ "content": [text_block(&plot.result_line(&id))], "details": details, "terminate": true }))
	}
}

impl Tool for Plot {
	fn name(&self) -> &str {
		PLOT_TOOL
	}

	fn description(&self) -> &str {
		DESCRIPTION
	}

	fn parameters(&self) -> &Json {
		&self.parameters
	}

	fn execution_mode(&self) -> ExecutionMode {
		ExecutionMode::Sequential
	}

	/// Every rule of the call as sent, all problems in one refusal. Nothing is healed: the window
	/// draws the stored call.
	fn prepare_arguments(&self, args: Json) -> Result<Json, String> {
		check_plot(&args).map(|_| args).map_err(|problems| problems.join("\n"))
	}

	fn execute(&self, args: Json, ctx: ToolContext) -> BoxFuture<'_, Result<Json, String>> {
		Box::pin(async move { self.run(&args, &ctx.tool_call_id) })
	}
}

/// The tool for one Study turn, sharing the hook's passed guesses.
pub fn plot_tool(record: LessonRecord, parts: &Arc<LessonParts>) -> FnTool {
	FnTool::from_tool(Arc::new(Plot { parameters: parameters(), record, parts: parts.clone(), drawn: AtomicUsize::new(0) }))
}

#[cfg(test)]
mod tests {
	use gs_engine::turn::abort::Abort;
	use gs_engine::turn::agent::{Agent, AgentOptions};
	use gs_engine::turn::faux::{Engine, Scripted, faux_model};
	use gs_engine::turn::messages::faux_assistant_message;
	use gs_json::stringify;

	use super::*;
	use crate::tools::heal::heal_tool_record;
	use crate::tools::plan::PlanContext;
	use crate::tools::test_record::record;

	fn leash() -> Json {
		json!({
			"title": "One feature, where the weight ends up",
			"x": { "name": "a", "label": "where the data alone put it", "min": 0, "max": 10 },
			"y": { "label": "w" },
			"slider": { "name": "lambda", "min": 0.5, "max": 4, "start": 1 },
			"lines": [{ "label": "penalty", "expr": "a/(1+lambda)", "hidden": true }, { "label": "leash", "expr": "min(a, 4/(1+lambda))" }],
		})
	}

	fn guess(right: &str) -> Json {
		let options = json!([{ "label": "At 2, the leash's length.", "value": "A" }, { "label": "At 4.", "value": "B" }, { "label": "At 3.", "value": "C" }, { "label": "At 8.", "value": "D" }]);
		json!({ "type": "predict", "nodeId": "reg", "question": "Where does the penalty put it?", "options": options, "explanation": "a/(1+lambda).", "correctAnswer": right, "onPlot": { "line": "penalty", "x": 8 } })
	}

	/// A lesson whose plan holds `reg`, already holding one stored plot.
	fn lesson() -> LessonRecord {
		let stored = vec![
			json!({ "role": "toolResult", "toolCallId": "p0", "toolName": "plot", "isError": false, "details": { "part": "plot", "v": 1, "id": "p1" } }),
			json!({ "role": "toolResult", "toolCallId": "px", "toolName": "plot", "isError": true, "details": null }),
		];
		record(stored)
	}

	/// The quiz and plot of the Study registry under the hook, healed as the registry heals them,
	/// running one scripted reply.
	async fn run_reply(calls: Vec<Json>) -> Vec<Json> {
		run_with(calls, true).await
	}

	async fn run_with(calls: Vec<Json>, hooked: bool) -> Vec<Json> {
		let record = lesson();
		let plan = PlanContext { chat_id: record.chat_id.clone(), chat_store: Arc::new(Planned(record.chat_store.clone())) };
		let parts = LessonParts::new(&plan);
		let scripted = Scripted::new();
		scripted.reply(faux_assistant_message(calls, "toolUse"));
		let mut options = AgentOptions::new(Engine { model: faux_model("m", "p", "faux", "Faux", 1000.0, 100.0), respond: scripted });
		options.tools = heal_tool_record(vec![crate::tools::questions::study_quiz_tool(&plan), plot_tool(record, &parts)]).into_iter().map(FnTool::into_arc).collect();
		options.before_tool_call = hooked.then(|| parts.hook());
		let agent = Agent::new(options);
		agent.prompt(vec![json!({ "role": "user", "content": "go", "timestamp": 1 })], Abort::new()).await.unwrap();
		agent.messages().into_iter().filter(|m| m["role"].as_str() == Some("toolResult")).collect()
	}

	/// The test record with a plan holding `reg`.
	struct Planned(Arc<dyn crate::tools::ports::ChatPort>);

	impl gs_core::graph::ports::ChatListing for Planned {
		fn list_chats(&self) -> Vec<Json> {
			Vec::new()
		}
	}

	impl crate::tools::ports::ChatPort for Planned {
		fn get_chat(&self, id: &str) -> Option<Json> {
			let mut chat = self.0.get_chat(id)?;
			chat.as_obj_mut()?.insert("tree", json!({ "nodes": [{ "id": "reg", "title": "Regularization" }], "edges": [] }));
			Some(chat)
		}
		fn save_tree(&self, _id: &str, _tree: &Json) -> Result<(), String> {
			Ok(())
		}
	}

	fn call(id: &str, name: &str, args: Json) -> Json {
		json!({ "type": "toolCall", "id": id, "name": name, "arguments": args })
	}

	#[tokio::test]
	async fn a_valid_pair_draws_the_next_plot_with_its_guess_and_ends_the_turn() {
		let results = run_reply(vec![call("q1", "quiz", guess("B")), call("p9", "plot", leash())]).await;
		let plot = results.iter().find(|r| r["toolCallId"] == json!("p9")).unwrap();
		assert_eq!(plot["isError"], json!(false));
		assert_eq!(plot["content"][0]["text"], json!("p2 drawn. At lambda 1, a = 0, 5, 10: penalty 0, 2.5, 5. leash 0, 2, 2."), "named after the one stored plot");
		assert_eq!(stringify(&plot["details"]), r#"{"part":"plot","v":1,"id":"p2","onPlot":{"toolCallId":"q1","value":4},"y":{"min":0,"max":6}}"#);
		assert_eq!(results.len(), 2, "no step after the pair");
	}

	#[tokio::test]
	async fn a_refused_pair_lists_every_problem_once_without_the_call() {
		let broken = json!({
			"title": "One feature, where the weight ends up",
			"x": { "name": "a", "label": "a", "min": 0, "max": 10 },
			"y": { "label": "w" },
			"slider": { "name": "lambda", "min": 0.5, "max": 4, "start": 6 },
			"lines": [{ "label": "penalty", "expr": "a/(1+lambda)" }, { "label": "leash", "expr": "2a" }],
		});
		let results = run_reply(vec![call("p9", "plot", broken), call("q1", "quiz", guess("B"))]).await;
		let texts: Vec<(&str, &str)> = results.iter().take(2).map(|r| (r["toolCallId"].as_str().unwrap(), r["content"][0]["text"].as_str().unwrap())).collect();
		assert_eq!(
			texts,
			[
				("p9", "slider.start: 6 is outside min 0.5 to max 4.\nlines[1].expr: write * between \"2\" and \"a\"."),
				("q1", "quiz: refused with the plot above. Re-send both, or the guess alone without onPlot."),
			]
		);
		assert!(results.iter().take(2).all(|r| r["isError"] == json!(true)));

		let results = run_reply(vec![call("q1", "quiz", guess("C")), call("p9", "plot", leash())]).await;
		let refusal = results.iter().find(|r| r["toolCallId"] == json!("p9")).unwrap()["content"][0]["text"].as_str().unwrap().to_owned();
		assert_eq!(refusal, "correctAnswer: option C reads \"At 3.\" but penalty at a = 8, lambda = 1 is 4. Fix the option or onPlot.");
		assert!(!refusal.contains("Received arguments"));
	}

	#[tokio::test]
	async fn a_guess_that_fails_its_own_checks_says_why_and_takes_the_plot_with_it() {
		let mut off_plan = guess("B");
		off_plan.as_obj_mut().unwrap().insert("nodeId", Json::from("cv"));
		let results = run_reply(vec![call("p9", "plot", leash()), call("q1", "quiz", off_plan)]).await;
		let texts: Vec<&str> = results.iter().take(2).map(|r| r["content"][0]["text"].as_str().unwrap()).collect();
		assert_eq!(texts[0], "plot: refused with its quiz. Fix the quiz and re-send both.");
		assert_eq!(texts[1], "Invalid tool input for tool \"quiz\":\n- nodeId \"cv\" matches no node in this session's plan map. Copy one of the plan's node ids exactly (reg).");
	}

	/// The window draws the stored call as sent, so the plot is checked as sent: a field sent
	/// JSON-encoded is refused, and its guess with it.
	#[tokio::test]
	async fn a_plot_is_never_healed_so_a_plot_sent_encoded_is_refused_with_its_guess() {
		let mut encoded = leash();
		let lines = stringify(&encoded["lines"]);
		encoded.as_obj_mut().unwrap().insert("lines", Json::from(lines));
		for calls in [vec![call("q1", "quiz", guess("B")), call("p9", "plot", encoded.clone())], vec![call("p9", "plot", encoded.clone()), call("q1", "quiz", guess("B"))]] {
			let results = run_reply(calls).await;
			let text = |id: &str| results.iter().find(|r| r["toolCallId"] == json!(id)).unwrap()["content"][0]["text"].as_str().unwrap().to_owned();
			assert_eq!(text("p9"), "lines: must be a list of 1 or 2 lines.");
			assert_eq!(text("q1"), "quiz: refused with the plot above. Re-send both, or the guess alone without onPlot.");
		}
	}

	/// The guess is read as the quiz tool takes it, after its own preparation: a field it heals
	/// passes with the plot instead of refusing the plot while the quiz goes through, and one it
	/// cannot take refuses both.
	#[tokio::test]
	async fn a_guess_is_read_as_the_quiz_takes_it_so_the_pair_lands_whole_or_not_at_all() {
		let mut typed = guess("B");
		typed.as_obj_mut().unwrap().insert("type", Json::from("\"predict\""));
		let results = run_reply(vec![call("q1", "quiz", typed), call("p9", "plot", leash())]).await;
		assert!(results.iter().all(|r| r["isError"] == json!(false)), "{results:?}");
		let plot = results.iter().find(|r| r["toolCallId"] == json!("p9")).unwrap();
		assert_eq!(plot["details"]["onPlot"], json!({ "toolCallId": "q1", "value": 4 }));

		let mut on_plot = guess("B");
		on_plot.as_obj_mut().unwrap().insert("onPlot", Json::from(r#"{"line":"penalty","x":8}"#));
		let results = run_reply(vec![call("q1", "quiz", on_plot), call("p9", "plot", leash())]).await;
		assert!(results.iter().all(|r| r["isError"] == json!(true)), "{results:?}");
	}

	#[tokio::test]
	async fn a_plot_with_no_passed_guess_is_never_drawn() {
		let results = run_with(vec![call("q1", "quiz", guess("B")), call("p9", "plot", leash())], false).await;
		let plot = results.iter().find(|r| r["toolCallId"] == json!("p9")).unwrap();
		assert_eq!(plot["isError"], json!(true));
		assert_eq!(plot["content"][0]["text"], json!("plot: needs a quiz with onPlot in the same reply."));
	}

	#[test]
	fn the_schema_is_the_plan_shape() {
		let schema = parameters();
		assert_eq!(stringify(&schema["required"]), r#"["title","x","y","slider","lines"]"#);
		assert_eq!(schema["properties"]["lines"]["maxItems"], json!(2));
		assert_eq!(schema["properties"]["title"]["maxLength"], json!(60));
	}
}
