//! plot, Study's plot: one or two lines over x, each a formula with one slider or measured points,
//! sent with a guess on it in the same turn. Every rule is checked before validation, so a refused
//! call lists all its problems at once with no echo; its guess is checked with it by the lesson-
//! parts hook, which also holds whichever of the two comes first. A drawn plot is named p1, p2 in
//! lesson order, tells the agent its values, and ends the turn. The window recomputes the lines
//! from the stored call; the result's details hold only its id, its guess and the y range.

use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_core::session::plot::{PLOT_TOOL, check_plot};
use gs_core::session::schema::{described, object};
use gs_engine::turn::tool::{ExecutionMode, Tool, ToolContext};
use gs_json::{Json, json};

use super::fn_tool::FnTool;
use super::lesson_parts::LessonParts;

const DESCRIPTION: &str = "Draws one or two lines over x, instead of demo, when the idea is a curve: a formula with one slider, or measured points. Send it with a prediction on it (quiz.onPlot) in the same turn; it stays locked until he answers. While a question is open, send it with no prediction. Leave one plain reply after a keep.";

fn parameters() -> Json {
	let name = |description: &str| json!({ "type": "string", "pattern": "^[a-z][a-z0-9_]{0,11}$", "description": description });
	let label = |description: &str| json!({ "type": "string", "maxLength": 40, "description": description });
	let number = || json!({ "type": "number" });
	let pair = json!({ "type": "array", "items": number(), "minItems": 2, "maxItems": 2 });
	let line = object(
		&["label"],
		vec![
			("label", label("One word, shown beside the line.")),
			("expr", json!({ "type": "string", "maxLength": 200, "description": "Plain math, not LaTeX, in the x and slider names: + - * / ^, brackets, sin cos tan exp ln log10 sqrt abs, min max, pi, e. Example: min(a, 4/(1+lambda))" })),
			("points", json!({ "type": "array", "items": pair, "minItems": 2, "maxItems": 12, "description": "Instead of expr: measured [x, y] by increasing x. A guess on it asks at one of these x. The point a guess asks at stays hidden until he answers." })),
			("hidden", json!({ "type": "boolean", "description": "Held back until he answers; use it for the true line when the plot tests an analogy." })),
		],
	);
	object(
		&["title", "x", "y", "lines"],
		vec![
			("title", json!({ "type": "string", "maxLength": 60, "description": "What the plot shows." })),
			("x", object(&["label", "min", "max"], vec![("name", name("Its name in expr, like a.")), ("label", label("The axis title.")), ("min", number()), ("max", number())])),
			("y", described(object(&["label"], vec![("label", label("The axis title.")), ("min", number()), ("max", number())]), "Give min and max both, or leave both out and godspeed picks them.")),
			(
				"slider",
				described(
					object(
						&["name", "min", "max", "start"],
						vec![("name", name("Its name in expr; a Greek letter's name shows as its symbol.")), ("min", number()), ("max", number()), ("start", json!({ "type": "number", "description": "where the thumb starts; inside min to max" }))],
					),
					"Only when a line has expr.",
				),
			),
			("lines", json!({ "type": "array", "items": line, "minItems": 1, "maxItems": 2, "description": "First solid, second dashed." })),
		],
	)
}

struct Plot {
	parameters: Json,
	parts: Arc<LessonParts>,
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
		Box::pin(async move { self.parts.plot(&args, &ctx.tool_call_id) })
	}
}

/// The tool for one Study turn, drawn as its hook decides.
pub(crate) fn plot_tool(parts: &Arc<LessonParts>) -> FnTool {
	FnTool::from_tool(Arc::new(Plot { parameters: parameters(), parts: parts.clone() }))
}

#[cfg(test)]
mod tests {
	use std::collections::HashSet;

	use gs_core::study::topic_parts::{GUESS_DROPPED, GUESS_HELD, PLOT_DROPPED, PLOT_HELD};
	use gs_engine::turn::abort::Abort;
	use gs_engine::turn::messages::tool_result_message;
	use gs_engine::turn::tool_host::{Reply, ToolHost};
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

	/// A lesson whose plan holds `reg`, already holding one stored plot, then `after`.
	fn lesson(after: Vec<Json>) -> PlanContext {
		let stored = vec![
			json!({ "role": "toolResult", "toolCallId": "p0", "toolName": "plot", "isError": false, "details": { "part": "plot", "v": 1, "id": "p1" } }),
			json!({ "role": "toolResult", "toolCallId": "px", "toolName": "plot", "isError": true, "details": null }),
		];
		record([stored, after].concat())
	}

	/// One Study turn: the quiz and plot of the Study registry under the hook, healed as the
	/// registry heals them, run as a lesson's session runs them.
	struct Turn {
		parts: Arc<LessonParts>,
		host: ToolHost,
	}

	impl Turn {
		fn new(record: PlanContext, hooked: bool) -> Turn {
			let plan = PlanContext { chat_id: record.chat_id.clone(), chat_store: Arc::new(Planned(record.chat_store.clone())) };
			let parts = LessonParts::new(&plan);
			let quiz = parts.guessing(crate::tools::questions::study_quiz_tool(&plan, &crate::tools::questions::PlanOrder::new(&plan)));
			let tools = heal_tool_record(vec![quiz, plot_tool(&parts)]).into_iter().map(FnTool::into_arc).collect();
			let host = ToolHost::new(tools, hooked.then(|| parts.hook()), HashSet::from(["quiz".to_owned()]));
			Turn { parts, host }
		}

		/// One reply's calls in order, a held one taken out of the reply, until one ends the turn:
		/// each one's result record, with `held`, `endsTurn` and `releases` beside it.
		async fn reply(&self, calls: Vec<Json>) -> Vec<Json> {
			let mut message = json!({ "role": "assistant", "content": calls.clone() });
			let mut out = Vec::new();
			for call in calls {
				let reply = self.host.call(&call, Reply { before: &[], message: &message }, &Abort::new()).await;
				if reply.held
					&& let Some(content) = message.get_mut("content").and_then(Json::as_arr_mut)
				{
					content.retain(|b| b["id"] != call["id"]);
				}
				let mut result = tool_result_message(&call, &reply.result, reply.is_error, None);
				result.set("held", reply.held);
				result.set("endsTurn", reply.ends_turn);
				if let Some(release) = &reply.releases {
					result.set("releases", json!({ "toolCallId": release.id.clone(), "result": release.result.clone().unwrap_or(Json::Null) }));
				}
				out.push(result);
				if reply.ends_turn {
					break;
				}
			}
			out
		}
	}

	async fn run_reply(calls: Vec<Json>) -> Vec<Json> {
		run_in(lesson(Vec::new()), calls).await
	}

	async fn run_in(record: PlanContext, calls: Vec<Json>) -> Vec<Json> {
		Turn::new(record, true).reply(calls).await
	}

	/// The test record with a plan holding `reg`.
	struct Planned(Arc<dyn crate::tools::ports::ChatPort>);

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
		assert_eq!((results[0]["content"][0]["text"].as_str(), &results[0]["held"]), (Some(GUESS_HELD), &json!(true)), "the guess waits for its plot");
		let plot = &results[1];
		assert_eq!(plot["isError"], json!(false));
		assert_eq!(plot["content"][0]["text"], json!("p2 drawn. At lambda 1, a = 0, 5, 10: penalty 0, 2.5, 5. leash 0, 2, 2."), "named after the one stored plot");
		assert_eq!(stringify(&plot["details"]), r#"{"part":"plot","v":1,"id":"p2","onPlot":{"toolCallId":"q1","value":4},"y":{"min":0,"max":6}}"#);
		assert_eq!((&plot["releases"], &plot["endsTurn"]), (&json!({ "toolCallId": "q1", "result": null }), &json!(true)), "the guess goes back unanswered, his question");
		let first = run_reply(vec![call("p9", "plot", leash()), call("q1", "quiz", guess("B"))]).await;
		assert_eq!((first.len(), first[0]["releases"].is_null(), &first[0]["endsTurn"]), (1, true, &json!(true)), "a plot first draws at once with the guess after it");
	}

	/// Codex sends one call at a time: the first half waits, the second completes the pair, and
	/// the guess that completes a plot draws it and tells the agent its values.
	#[tokio::test]
	async fn a_pair_sent_one_call_at_a_time_lands_whole_in_either_order() {
		let turn = Turn::new(lesson(Vec::new()), true);
		let held = turn.reply(vec![call("p9", "plot", leash())]).await;
		assert_eq!((held[0]["content"][0]["text"].as_str(), &held[0]["endsTurn"]), (Some(PLOT_HELD), &json!(false)));
		let guessed = turn.reply(vec![call("q1", "quiz", guess("B"))]).await;
		assert_eq!(guessed[0]["content"][0]["text"], json!("p2 drawn. At lambda 1, a = 0, 5, 10: penalty 0, 2.5, 5. leash 0, 2, 2."));
		assert_eq!(guessed[0]["endsTurn"], json!(true), "the turn ends on his question");
		assert_eq!(guessed[0]["releases"]["toolCallId"], json!("p9"));
		assert_eq!(stringify(&guessed[0]["releases"]["result"]["details"]), r#"{"part":"plot","v":1,"id":"p2","onPlot":{"toolCallId":"q1","value":4},"y":{"min":0,"max":6}}"#);
		assert_eq!(turn.parts.dropped_note(), None);

		let turn = Turn::new(lesson(Vec::new()), true);
		assert_eq!(turn.reply(vec![call("q1", "quiz", guess("B"))]).await[0]["content"][0]["text"].as_str(), Some(GUESS_HELD));
		let drawn = turn.reply(vec![call("p9", "plot", leash())]).await;
		assert_eq!((&drawn[0]["releases"], &drawn[0]["endsTurn"]), (&json!({ "toolCallId": "q1", "result": null }), &json!(true)));
	}

	#[tokio::test]
	async fn a_half_still_held_at_the_end_is_noted_and_a_refused_pair_takes_it_along() {
		let turn = Turn::new(lesson(Vec::new()), true);
		turn.reply(vec![call("p9", "plot", leash())]).await;
		assert_eq!(turn.parts.dropped_note().as_deref(), Some(PLOT_DROPPED));
		let turn = Turn::new(lesson(Vec::new()), true);
		turn.reply(vec![call("q1", "quiz", guess("B"))]).await;
		assert_eq!(turn.parts.dropped_note().as_deref(), Some(GUESS_DROPPED));
		turn.reply(vec![call("q2", "quiz", guess("B"))]).await;
		assert_eq!(turn.parts.dropped_note().as_deref(), Some(GUESS_DROPPED), "a guess sent again replaces the held one");

		let turn = Turn::new(lesson(Vec::new()), true);
		turn.reply(vec![call("p9", "plot", leash())]).await;
		let refused = turn.reply(vec![call("q1", "quiz", guess("C"))]).await;
		assert_eq!(
			refused[0]["content"][0]["text"],
			json!("correctAnswer: option C reads \"At 3.\" but penalty at a = 8, lambda = 1 is 4. Fix the option or onPlot.\nquiz: refused with the plot above. Re-send both, or the guess alone without onPlot.")
		);
		assert_eq!(turn.parts.dropped_note(), None, "the refusal said so");
		let mut off_plan = guess("B");
		off_plan.as_obj_mut().unwrap().insert("nodeId", Json::from("cv"));
		turn.reply(vec![call("p8", "plot", leash())]).await;
		assert!(turn.reply(vec![call("q2", "quiz", off_plan)]).await[0]["content"][0]["text"].as_str().unwrap().starts_with("Invalid tool input for tool \"quiz\""));
		assert_eq!(turn.parts.dropped_note().as_deref(), Some(PLOT_DROPPED), "a guess refused by its own checks leaves the plot waiting");
	}

	#[tokio::test]
	async fn measured_points_draw_with_a_guess_at_one_of_them_and_no_slider() {
		let cv = json!({
			"title": "Cross-validation error by degree",
			"x": { "name": "degree", "label": "polynomial degree", "min": 0, "max": 10 },
			"y": { "label": "CV error" },
			"lines": [{ "label": "cv_error", "points": [[1, 0.8], [3, 0.4], [5, 0.3], [9, 0.9]] }],
		});
		let options = json!([{ "label": "About 0.3.", "value": "A" }, { "label": "About 0.9.", "value": "B" }]);
		let quiz = json!({ "type": "predict", "nodeId": "reg", "question": "Where is the error at degree 5?", "options": options, "explanation": "e", "correctAnswer": "A", "onPlot": { "line": "cv_error", "x": 5 } });
		let results = run_reply(vec![call("q1", "quiz", quiz), call("p9", "plot", cv)]).await;
		let plot = results.iter().find(|r| r["toolCallId"] == json!("p9")).unwrap();
		assert_eq!(plot["content"][0]["text"], json!("p2 drawn. degree = 1, 3, 5, 9: cv_error 0.8, 0.4, 0.3, 0.9."));
		assert_eq!(stringify(&plot["details"]), r#"{"part":"plot","v":1,"id":"p2","onPlot":{"toolCallId":"q1","value":0.3},"y":{"min":0.2,"max":1}}"#);
	}

	fn cv_points() -> Json {
		json!({
			"title": "Cross-validation error by degree",
			"x": { "name": "degree", "label": "polynomial degree", "min": 0, "max": 10 },
			"y": { "label": "CV error" },
			"lines": [{ "label": "cv_error", "points": [[1, 0.8], [3, 0.4], [5, 0.3], [9, 0.9]] }],
		})
	}

	/// While a check quiz or a problem waits for him, a plot sent alone draws at once with no
	/// guess; with nothing open it waits for its guess, and a hidden line needs a guess.
	#[tokio::test]
	async fn a_plot_sent_while_a_question_is_open_draws_with_no_guess() {
		let quiz = vec![json!({ "role": "assistant", "content": [call("q0", "quiz", guess("B"))] }), json!({ "role": "user", "content": "Plot it?", "side": true })];
		let problem = vec![json!({ "role": "assistant", "content": [call("pr0", "problem", json!({ "statement": "s" }))] }), json!({ "role": "toolResult", "toolCallId": "pr0", "toolName": "problem", "isError": false, "details": null })];
		for open in [quiz, problem] {
			let results = run_in(lesson(open), vec![call("p9", "plot", cv_points())]).await;
			assert_eq!(results[0]["isError"], json!(false), "{results:?}");
			assert_eq!(results[0]["content"][0]["text"], json!("p2 drawn. degree = 1, 3, 5, 9: cv_error 0.8, 0.4, 0.3, 0.9."));
			assert_eq!(stringify(&results[0]["details"]), r#"{"part":"plot","v":1,"id":"p2","y":{"min":0.2,"max":1}}"#);
		}
		let closed = run_reply(vec![call("p9", "plot", cv_points())]).await;
		assert_eq!(closed[0]["content"][0]["text"].as_str(), Some(PLOT_HELD), "nothing open: it waits for its guess");
		let open = vec![json!({ "role": "assistant", "content": [call("q0", "quiz", guess("B"))] })];
		let hidden = run_in(lesson(open), vec![call("p9", "plot", leash())]).await;
		assert_eq!(hidden[0]["content"][0]["text"], json!("lines[0].hidden: needs a guess on the plot. Leave hidden out."));
	}

	#[tokio::test]
	async fn a_keep_that_breaks_its_rules_never_refuses_its_quiz() {
		let mut with_keep = guess("B");
		with_keep.as_obj_mut().unwrap().insert("keep", json!({ "text": "x".repeat(212), "fits": "f" }));
		let results = run_reply(vec![call("q1", "quiz", with_keep), call("p9", "plot", leash())]).await;
		assert!(results.iter().all(|r| r["isError"] == json!(false)), "{results:?}");
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
	/// cannot take refuses the quiz while the plot waits for a guess it can take.
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
		assert_eq!(results.iter().map(|r| (r["isError"].clone(), r["held"].clone())).collect::<Vec<_>>(), [(json!(true), json!(false)), (json!(false), json!(true))], "{results:?}");
	}

	#[tokio::test]
	async fn a_plot_its_hook_never_checked_is_never_drawn() {
		let plot = Turn::new(lesson(Vec::new()), false).reply(vec![call("p9", "plot", leash())]).await;
		assert_eq!((&plot[0]["isError"], plot[0]["content"][0]["text"].as_str()), (&json!(true), Some("plot: its guess was never checked, so it is not drawn.")));
	}

	#[test]
	fn the_schema_is_the_plan_shape() {
		let schema = parameters();
		assert_eq!(stringify(&schema["required"]), r#"["title","x","y","lines"]"#);
		assert_eq!(stringify(&schema["properties"]["lines"]["items"]["required"]), r#"["label"]"#);
		assert_eq!(schema["properties"]["lines"]["items"]["properties"]["points"]["maxItems"], json!(12));
		assert_eq!(schema["properties"]["lines"]["maxItems"], json!(2));
		assert_eq!(schema["properties"]["title"]["maxLength"], json!(60));
	}
}
