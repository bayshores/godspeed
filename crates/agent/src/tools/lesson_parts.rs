//! Study's lesson-parts hook (the engine's before-tool-call): a reply's plot and its guess
//! (`quiz.onPlot`) pass or are refused as a pair before either runs, whatever order the reply
//! lists them in, since it sees the whole reply. The plot it passes learns its guess's call id and
//! the drawn value the guess asks about, for the plot's result details.

use std::collections::HashMap;
use std::sync::Arc;

use gs_core::session::plot::PLOT_TOOL;
use gs_core::session::question_core::{parse_options_if_string, quiz_input_problems, study_quiz_input_object};
use gs_core::study::topic_parts::reply_parts_problems;
use gs_engine::turn::agent::BeforeToolCallFn;
use gs_engine::turn::validate::argument_problems;
use gs_json::Json;
use parking_lot::Mutex;

use super::plan::PlanContext;
use super::questions::node_id_problem;

pub struct LessonParts {
	plan: PlanContext,
	/// Plot call id to `{ toolCallId, value }` of the guess it passed with.
	passed: Mutex<HashMap<String, Json>>,
}

impl LessonParts {
	pub fn new(plan: &PlanContext) -> Arc<LessonParts> {
		Arc::new(LessonParts { plan: plan.clone(), passed: Mutex::default() })
	}

	/// The guess a plot call passed with.
	pub(super) fn guess_of(&self, plot_call_id: &str) -> Option<Json> {
		self.passed.lock().get(plot_call_id).cloned()
	}

	/// Whether a quiz call, as sent, passes the Study quiz's own checks.
	fn quiz_passes(&self, quiz: &Json) -> bool {
		let mut args = quiz.clone();
		if let (Some(options), Some(obj)) = (parse_options_if_string(Some(&quiz["options"])), args.as_obj_mut()) {
			obj.insert("options", options);
		}
		argument_problems(&study_quiz_input_object(), &args).is_empty() && quiz_input_problems(&args).is_empty() && args["nodeId"].as_str().is_some_and(|id| node_id_problem(&self.plan, id).is_none())
	}

	/// The hook: decides plot calls and guesses, passes every other call.
	pub fn hook(self: &Arc<Self>) -> BeforeToolCallFn {
		let parts = self.clone();
		Box::new(move |ctx| {
			let name = ctx.call["name"].as_str().unwrap_or_default();
			if name != PLOT_TOOL && !(name == "quiz" && ctx.args["onPlot"].as_obj().is_some()) {
				return None;
			}
			let verdict = reply_parts_problems(ctx.messages, ctx.message, &|quiz| parts.quiz_passes(quiz));
			if let Some((plot_call_id, guess)) = verdict.on_plot {
				parts.passed.lock().insert(plot_call_id, guess);
			}
			let id = ctx.call["id"].as_str().unwrap_or_default();
			verdict.refused.into_iter().find(|(call_id, _)| call_id == id).map(|(_, refusal)| refusal)
		})
	}
}
