//! The background job tools (src/backend/agent/tools/jobs.ts): research, demo, visual and pdf.
//! Each call creates the job record, starts the runner and answers at once; the result arrives
//! later as a steer message that wakes the teacher.

use std::sync::Arc;

use gs_json::Json;

use super::fn_tool::FnTool;
use super::ports::{JobPort, Spawn};
use gs_core::session::schema::{object, string};

/// What the job tools need at call time.
#[derive(Clone)]
pub struct JobToolContext {
	pub chat_id: String,
	pub job_store: Arc<dyn JobPort>,
	pub spawn: Spawn,
}

/// The four tools, built over one context.
pub struct JobTools {
	pub research: FnTool,
	pub demo: FnTool,
	pub visual: FnTool,
	pub pdf: FnTool,
}

/// Creates the job (once per tool call id), starts its runner, and returns the ack.
fn dispatch(ctx: &JobToolContext, kind: &str, tool_call_id: &str, ack: &str, input: &Json) -> Result<Json, String> {
	let existing = ctx.job_store.find_job_by_tool_call_id(&ctx.chat_id, tool_call_id);
	let job = match &existing {
		Some(job) => job.clone(),
		None => ctx.job_store.create_job(kind, &ctx.chat_id, tool_call_id, input)?,
	};
	if existing.is_none() {
		(ctx.spawn)(&job, input);
	}
	Ok(Json::from(format!("Dispatched (job {}). {ack}", job["id"].as_str().unwrap_or_default())))
}

const FIRE_AND_FORGET: &str = "This call is fire-and-forget: continue your turn and keep teaching \u{2014} do not wait, poll, or mention waiting. ";

fn job_tool(ctx: &JobToolContext, kind: &'static str, description: &str, parameters: Json, ack: String) -> FnTool {
	let ctx = ctx.clone();
	FnTool::server(kind, description, parameters, move |args, call| {
		let (ctx, ack) = (ctx.clone(), ack.clone());
		async move { dispatch(&ctx, kind, &call.tool_call_id, &ack, &args) }
	})
}

pub fn job_tools(ctx: &JobToolContext) -> JobTools {
	let research = job_tool(
		ctx,
		"research",
		"Dispatch a background web-research agent: fact verification, current data, or niche specifics you are not certain about. \
		The call is ASYNC and fire-and-forget \u{2014} it resolves immediately and your turn continues; the research brief arrives later \
		as a new message and the lesson resumes from it. Cite the brief's sources when you use them. \
		NEVER use it for things you know cold, internal reasoning, or math.",
		object(
			&["question"],
			vec![
				("question", string("The single research question to answer. Make it specific \u{2014} the researcher sees nothing else of the lesson.")),
				("context", string("Why you need this / what the lesson needs it for \u{2014} focuses the brief. One or two sentences.")),
			],
		),
		format!("{FIRE_AND_FORGET}The researched brief arrives as a new message when ready and the lesson resumes from it; cite its sources when you use them."),
	);
	let demo = job_tool(
		ctx,
		"demo",
		"Dispatch a background sub-agent that BUILDS and headlessly TESTS an interactive teaching instrument \u{2014} a single-file HTML \
		demo (parameter sweep, simulation, animation, sampling) rendered live in the lesson. Use it when the concept is DYNAMIC: \
		something to sweep, animate, or sample is better experienced than described. \
		The call is ASYNC and fire-and-forget \u{2014} it resolves immediately and your turn continues; the tested demo arrives later \
		as a new message. Write a precise brief: concept, controls, interactions, style.",
		object(
			&["title", "brief"],
			vec![
				("title", string("Short title for the demo card, e.g. 'Damped harmonic oscillator'.")),
				(
					"brief",
					string(
						"Precise brief for the builder: the concept, the parameters/controls and what each does, the interactions, and the visual style. \
						The builder sees NOTHING else of the lesson \u{2014} include everything it needs, including necessary formulas and constants.",
					),
				),
			],
		),
		format!("{FIRE_AND_FORGET}The tested demo arrives as a new message when ready and is rendered in the lesson; teach with it then."),
	);
	let visual = job_tool(
		ctx,
		"visual",
		"Dispatch a background sub-agent that hand-authors ONE precise SVG figure, renders it, LOOKS at the render, and iterates \
		until correct. Use it for exact spatial pictures auto-layout diagrams can't do: coordinate geometry, number lines, vectors, \
		function plots, physical layouts. For flows/relations/taxonomies write mermaid inline instead. \
		The call is ASYNC and fire-and-forget \u{2014} it resolves immediately and your turn continues; the verified figure arrives later \
		as a new message.",
		object(
			&["brief"],
			vec![(
				"brief",
				string(
					"Precise brief for ONE static figure: exactly what it must show \u{2014} coordinates, labels, proportions, orientation. \
					The maker sees NOTHING else of the lesson; a wrong or vague brief produces a wrong figure.",
				),
			)],
		),
		format!("{FIRE_AND_FORGET}The verified figure arrives as a new message when ready and is rendered in the lesson; reference it then."),
	);
	let pdf = job_tool(
		ctx,
		"pdf",
		"Dispatch a background sub-agent that READS a learner-provided PDF on your behalf (triage, targeted extraction, visual page \
		reading for equations and diagrams) and returns a brief with page citations. Use it when the learner gives you a PDF path \
		and you need its CONTENT for the lesson. The call is ASYNC and fire-and-forget \u{2014} it resolves immediately and your turn \
		continues; the brief arrives later as a new message. For quick looks at plain text or image files, use the read tool \
		directly instead of dispatching.",
		object(
			&["path", "question"],
			vec![
				("path", string("Path to the learner's PDF (relative or absolute), exactly as they gave it.")),
				(
					"question",
					string(
						"What you need from the document \u{2014} the specific content, explanation, or answer to extract and brief. \
						The reader sees NOTHING else of the lesson.",
					),
				),
			],
		),
		format!("{FIRE_AND_FORGET}The document brief arrives as a new message when ready; weave it into the lesson and cite its pages."),
	);
	JobTools { research, demo, visual, pdf }
}
