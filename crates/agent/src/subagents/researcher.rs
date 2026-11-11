//! The research job's agent, separate from
//! the teacher, with only web_fetch and the PDF tools, so fetch churn never reaches the
//! teacher's context. There is no search engine: the researcher fetches sources by URL.

use std::path::Path;

use gs_engine::bridge::Bridge;
use gs_engine::turn::abort::Abort;
use gs_engine::turn::faux::Engine;
use gs_json::Json;
use gs_pdf::Pdf;

use super::pi_run::{OnToolStart, OnUsage, RunError, SubagentRunOptions, run_subagent};
use crate::fs_tools::pdf_read::create_pdf_read_tools;
use crate::fs_tools::web::web_tools;

const INSTRUCTIONS: &str = r#"You are a research specialist. You work for a teacher agent inside a learning
application: given a research question, conduct thorough web research and produce a focused,
well-sourced brief that the teacher can teach from.

You operate in an isolated context with no knowledge of the lesson or any prior conversation.
All necessary context is in the task description.

Process:
1. Break the question into 2-4 facets.
2. You have no search engine. For each facet, pick source URLs you know exist — official
   docs, specs, standards bodies, encyclopedia articles (e.g. Wikipedia), primary sources —
   and read them with web_fetch. Follow links found in fetched pages to reach deeper sources.
3. Identify what's well-covered and what has gaps. If the first round doesn't fully answer
   the question, fetch more pages targeting the gaps.
4. PDF sources: when web_fetch says a URL is a PDF, call web_fetch_pdf on it — it downloads
   and triages the document (page count, size class, flagged pages). Then read it with
   pdf_extract — for long ones, pdf_search first and extract only the pages that hit.
   Cite claims from a PDF as (p. N).
5. Synthesize everything into a brief that directly answers the question.

Evaluation — what to keep vs drop:
- Official docs and primary sources outweigh blog posts and forum threads.
- Recent sources outweigh stale ones.
- Sources that directly address the question outweigh tangentially related ones.
- Drop SEO filler, outdated info, and beginner tutorials (unless that's the audience).

Tool outputs may be error strings (e.g. a page that failed to fetch or a URL that does not
exist). Adapt: try another URL; if research is genuinely impossible, say so in the brief
instead of inventing facts. Never invent sources.

Your FINAL assistant message is your entire deliverable — it must stand alone, using this format:

## Summary
2-3 sentence direct answer.

## Findings
Numbered findings with inline source citations:
1. **Finding** — explanation. [Source](url)

## Sources
- Kept: Source Title (url) — why relevant
- Dropped: Source Title — why excluded

## Gaps
What couldn't be answered. Suggested next steps."#;

/// Model calls allowed.
const MAX_TURNS: usize = 12;

pub struct ResearcherRunOptions<'a> {
	pub engine: Option<Engine>,
	pub pdf: &'a Pdf,
	/// The job's temporary folder: web_fetch_pdf downloads land here and every PDF tool is
	/// scoped to it. The runner makes and removes it.
	pub pdf_dir: &'a Path,
	pub abort_signal: Option<Abort>,
	pub on_usage: Option<OnUsage>,
	pub on_tool_start: Option<OnToolStart>,
	/// The task's name on the outside agent's work items.
	pub task_label: Option<String>,
}

/// Runs the researcher to the end: its last text is the brief.
pub async fn run_researcher_agent(bridge: &Bridge, prompt: &str, opts: ResearcherRunOptions<'_>) -> Result<String, RunError> {
	let mut tools = web_tools();
	tools.extend(create_pdf_read_tools(opts.pdf, opts.pdf_dir));
	let mut run = SubagentRunOptions::new(INSTRUCTIONS, Json::from(prompt), MAX_TURNS);
	run.engine = opts.engine;
	run.abort_signal = opts.abort_signal;
	run.on_usage = opts.on_usage;
	run.on_tool_start = opts.on_tool_start;
	run.task_label = opts.task_label;
	Ok(run_subagent(bridge, tools, run).await?.text)
}
