//! Study's lesson-parts hook (the engine's before-tool-call) and what the plot and its guess
//! (`quiz.onPlot`) do after it. The two pass or are refused as a pair, in either order, within one
//! turn. Claude Code names a step's calls before they run, so a pair in one reply is checked whole
//! at its first call; Codex sends its calls one at a time. The half that comes first, once it
//! passes alone, is held: the agent reads that it waits for the other half, the turn goes on, and
//! the record leaves the half out until the other one comes. Then both are shown as one reply
//! shows them, and the turn ends on the guess as the learner's question. A half sent again replaces
//! the held one; a refused pair takes the held half with it; one still held when the turn ends is
//! dropped and noted for the next reply. While a question waits for the learner, a plot passes
//! alone, with no guess, and is drawn at once.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use gs_core::messages::role::is_ok_tool_result;
use gs_core::session::plot::{PLOT_TOOL, check_plot, plot_details};
use gs_core::study::topic_parts::{GUESS_DROPPED, GUESS_HELD, PLOT_DROPPED, PLOT_HELD, first_topic, question_open, reply_parts_problems};
use gs_engine::turn::agent::BeforeToolCallFn;
use gs_engine::turn::messages::{text_block, tool_calls};
use gs_json::{Json, json};
use parking_lot::Mutex;

use super::fn_tool::FnTool;
use super::plan::PlanContext;
use super::practice::record_messages;
use super::questions::{node_ids_in, study_quiz_call};

/// The tools whose calls it may hold: the plot, and the quiz as a guess.
pub const HOLDS: [&str; 2] = [PLOT_TOOL, "quiz"];

/// What the agent reads for a plot the hook never decided on, which only a plot tool run without
/// its hook can meet.
const UNCHECKED: &str = "plot: its guess was never checked, so it is not drawn.";

/// What the hook decided for a plot or guess call it let through.
#[derive(Clone)]
enum Decision {
	/// A plot drawn with its guess's `{ toolCallId, value }` (null: none, as a question is open),
	/// and the held guess that goes back into the record with it.
	Draw { guess: Json, releases: Option<String> },
	/// A half held for its other half.
	Hold,
	/// A guess that completes the held plot: the plot's `toolCall` block and the guess it is drawn
	/// with.
	Complete { plot: Json, guess: Json },
}

pub struct LessonParts {
	plan: PlanContext,
	decided: Mutex<HashMap<String, Decision>>,
	/// The half held for its other half, as its `toolCall` block.
	held: Mutex<Option<Json>>,
	/// Plots drawn in this turn, for the next one's id.
	drawn: AtomicUsize,
}

fn is_plot(call: &Json) -> bool {
	call["name"].as_str() == Some(PLOT_TOOL)
}

/// The reply with the held half in it, first, as it came first.
fn with_held(message: &Json, held: Option<&Json>) -> Json {
	let Some(held) = held.filter(|held| !tool_calls(message).iter().any(|c| c["id"] == held["id"])) else { return message.clone() };
	let mut content = vec![held.clone()];
	content.extend(message["content"].items().iter().cloned());
	json!({ "role": "assistant", "content": content })
}

/// A held half's result: the agent reads it, the record leaves the call out, the turn goes on.
fn held_result(text: &str) -> Json {
	json!({ "content": [text_block(text)], "held": true })
}

impl LessonParts {
	pub fn new(plan: &PlanContext) -> Arc<LessonParts> {
		Arc::new(LessonParts { plan: plan.clone(), decided: Mutex::default(), held: Mutex::default(), drawn: AtomicUsize::new(0) })
	}

	/// The hook: decides plot calls and guesses, passes every other call.
	pub fn hook(self: &Arc<Self>) -> BeforeToolCallFn {
		let parts = self.clone();
		Box::new(move |ctx| {
			let name = ctx.call["name"].str_or_empty();
			if name != PLOT_TOOL && !(name == "quiz" && ctx.args["onPlot"].as_obj().is_some()) {
				return None;
			}
			let record = parts.plan.chat_store.get_chat(&parts.plan.chat_id);
			let known = node_ids_in(record.as_ref());
			let quiz_call = |quiz: &Json| study_quiz_call(&known, quiz);
			let mut held = parts.held.lock();
			if held.as_ref().is_some_and(|h| is_plot(h) == is_plot(ctx.call)) {
				*held = None;
			}
			// A guess that fails its own checks is refused by them; a held plot goes on waiting.
			if !is_plot(ctx.call) && !quiz_call(&ctx.call["arguments"]).1 {
				return None;
			}
			let reply = with_held(ctx.message, held.as_ref());
			// The model's view answers a question at once around a side question; the record knows it is open.
			let stored = record.as_ref().and_then(|r| r["messages"].as_arr()).map_or(&[][..], Vec::as_slice);
			let open = question_open(stored, &reply);
			let verdict = reply_parts_problems(ctx.messages, first_topic(record.as_ref().map(|r| &r["tree"])), &reply, open, &quiz_call);
			let id = ctx.call["id"].str_or_empty();
			let held_id = held.as_ref().map(|h| h["id"].str_or_empty().to_owned());
			let mut decided = parts.decided.lock();
			if let Some((plot_id, guess)) = verdict.on_plot {
				if plot_id == id {
					let releases = held_id.clone().filter(|held| guess["toolCallId"].as_str() == Some(held));
					if releases.is_some() {
						*held = None;
					}
					decided.insert(plot_id, Decision::Draw { guess, releases });
				} else if let Some(plot) = held.take_if(|h| h["id"].as_str() == Some(plot_id.as_str())) {
					decided.insert(id.to_owned(), Decision::Complete { plot, guess });
				} else {
					// Its plot comes later in this reply.
					*held = Some(ctx.call.clone());
					decided.insert(id.to_owned(), Decision::Hold);
				}
			}
			if verdict.held.as_deref() == Some(id) {
				*held = Some(ctx.call.clone());
				decided.insert(id.to_owned(), Decision::Hold);
			}
			let refusals: Vec<String> = verdict.refused.into_iter().filter(|(call, _)| call == id || held_id.as_deref() == Some(call.as_str())).map(|(_, refusal)| refusal).collect();
			if refusals.is_empty() {
				return None;
			}
			if held.as_ref().is_some_and(|h| h["id"].as_str() != Some(id)) {
				*held = None;
			}
			Some(refusals.join("\n"))
		})
	}

	fn decision(&self, call_id: &str) -> Option<Decision> {
		self.decided.lock().get(call_id).cloned()
	}

	/// A plot drawn: named p1, p2 in lesson order, telling the agent its values, ending the turn.
	fn draw(&self, args: &Json, guess: Json) -> Result<Json, String> {
		let plot = check_plot(args).map_err(|problems| problems.join("\n"))?;
		let stored = record_messages(&self.plan.chat_store, &self.plan.chat_id).iter().filter(|m| is_ok_tool_result(m) && m["toolName"].as_str() == Some(PLOT_TOOL)).count();
		let id = format!("p{}", stored + self.drawn.fetch_add(1, Ordering::SeqCst) + 1);
		Ok(json!({ "content": [text_block(&plot.result_line(&id))], "details": plot_details(&id, guess, plot.y), "terminate": true }))
	}

	/// What a plot call does, as the hook decided.
	pub(super) fn plot(&self, args: &Json, call_id: &str) -> Result<Json, String> {
		match self.decision(call_id) {
			Some(Decision::Draw { guess, releases }) => {
				let mut drawn = self.draw(args, guess)?;
				if let Some(guess_id) = releases {
					drawn.set("releases", json!({ "toolCallId": guess_id }));
				}
				Ok(drawn)
			}
			Some(Decision::Hold) => Ok(held_result(PLOT_HELD)),
			_ => Err(UNCHECKED.to_owned()),
		}
	}

	/// The Study quiz with its part in a pair: a held guess waits for its plot, and the guess that
	/// completes the held plot draws it, telling the agent the plot's values.
	pub fn guessing(self: &Arc<Self>, quiz: FnTool) -> FnTool {
		let parts = self.clone();
		quiz.with_run(move |run| {
			Arc::new(move |args, ctx| {
				let (parts, run) = (parts.clone(), run.clone());
				Box::pin(async move {
					let id = ctx.tool_call_id.clone();
					let asked = run(args, ctx).await?;
					if asked["isError"] == Json::Bool(true) {
						return Ok(asked);
					}
					match parts.decision(&id) {
						Some(Decision::Hold) => Ok(held_result(GUESS_HELD)),
						Some(Decision::Complete { plot, guess }) => {
							let drawn = parts.draw(&plot["arguments"], guess)?;
							let result = json!({ "content": drawn["content"].clone(), "details": drawn["details"].clone() });
							Ok(json!({ "content": drawn["content"].clone(), "terminate": true, "releases": { "toolCallId": plot["id"].clone(), "result": result } }))
						}
						_ => Ok(asked),
					}
				})
			})
		})
	}

	/// The note for the next reply about a half still held at the turn's end, which is dropped.
	pub fn dropped_note(&self) -> Option<String> {
		let held = self.held.lock();
		held.as_ref().map(|h| if is_plot(h) { PLOT_DROPPED } else { GUESS_DROPPED }.to_owned())
	}
}
