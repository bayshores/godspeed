//! The research job's agent, separate from the teacher, with web_fetch and the PDF tools, so
//! fetch churn never reaches the teacher's context. With the person's Tavily key it also gets
//! web_search; without one it may use the outside agent's own search, or addresses it knows.

use std::path::Path;
use std::sync::Arc;

use gs_engine::bridge::Bridge;
use gs_engine::turn::abort::Abort;
use gs_engine::turn::faux::Engine;
use gs_engine::turn::tool::Tool;
use gs_json::Json;
use gs_pdf::Pdf;

use super::pi_run::{OnToolStart, OnUsage, RunError, SubagentRunOptions, run_subagent};
use crate::fs_tools::pdf_read::create_pdf_read_tools;
use crate::fs_tools::web::{web_search_tool, web_tools};

const INSTRUCTIONS: &str = r#"You are a research specialist. You work for a teacher agent inside a learning
application: given a research question, conduct thorough web research and produce a focused,
well-sourced brief that the teacher can teach from.

You operate in an isolated context with no knowledge of the lesson or any prior conversation.
All necessary context is in the task description.

Process:
1. Break the question into 2-4 facets.
2. {find_sources}
   Follow links found in fetched pages to reach deeper sources.
3. Identify what's well-covered and what has gaps. If the first round doesn't fully answer
   the question, fetch more pages targeting the gaps.
4. PDF sources: when web_fetch says a URL is a PDF, call web_fetch_pdf on it — it downloads
   and triages the document (page count, size space, flagged pages). Then read it with
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

/// Step 2 without a search key. The work item's rule is to use only its tools, so the
/// exception is spelled out.
const OWN_SEARCH: &str = "For each facet, find sources and read them with web_fetch. If you have a web search of your
   own, use it to find pages: that is allowed here, even though the work item says to use only
   its tools. With no search of your own, pick source URLs you know exist (official docs, specs,
   standards bodies, encyclopedia articles such as Wikipedia, primary sources).";

/// Step 2 while the person's search key gives the job web_search.
const WEB_SEARCH: &str = "For each facet, search with web_search, then read the best results with web_fetch. Use
   web_search, not a web search of your own. If web_search fails, carry on with your own web
   search if you have one (allowed here, even though the work item says to use only its tools),
   or pick source URLs you know exist (official docs, specs, standards bodies, encyclopedia
   articles such as Wikipedia, primary sources).";

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
	/// The person's Tavily key; with it the job gets web_search.
	pub search_key: Option<String>,
}

fn instructions(searching: bool) -> String {
	INSTRUCTIONS.replace("{find_sources}", if searching { WEB_SEARCH } else { OWN_SEARCH })
}

fn research_tools(pdf: &Pdf, pdf_dir: &Path, search_key: Option<String>) -> Vec<Arc<dyn Tool>> {
	let mut tools = web_tools();
	tools.extend(search_key.map(web_search_tool));
	tools.extend(create_pdf_read_tools(pdf, pdf_dir));
	tools
}

/// Runs the researcher to the end: its last text is the brief.
pub async fn run_researcher_agent(bridge: &Bridge, prompt: &str, opts: ResearcherRunOptions<'_>) -> Result<String, RunError> {
	let system_prompt = instructions(opts.search_key.is_some());
	let tools = research_tools(opts.pdf, opts.pdf_dir, opts.search_key);
	let mut run = SubagentRunOptions::new(&system_prompt, Json::from(prompt), MAX_TURNS);
	run.engine = opts.engine;
	run.abort_signal = opts.abort_signal;
	run.on_usage = opts.on_usage;
	run.on_tool_start = opts.on_tool_start;
	run.task_label = opts.task_label;
	Ok(run_subagent(bridge, tools, run).await?.text)
}

#[cfg(test)]
mod tests {
	use super::*;

	fn names(search_key: Option<&str>) -> Vec<String> {
		let pdf = Pdf::new(Path::new("/nonexistent"));
		research_tools(&pdf, Path::new("/nonexistent"), search_key.map(str::to_owned)).iter().map(|tool| tool.name().to_owned()).collect()
	}

	#[test]
	fn web_search_is_offered_only_with_a_key() {
		assert!(!names(None).contains(&"web_search".to_owned()));
		assert_eq!(names(Some("tvly-key"))[..2], ["web_fetch", "web_search"]);
		assert_eq!(names(Some("tvly-key")).len(), names(None).len() + 1);
	}

	#[test]
	fn without_a_key_the_agent_may_use_its_own_search() {
		let text = instructions(false);
		assert!(text.contains("If you have a web search of your\n   own, use it to find pages: that is allowed here"));
		assert!(text.contains("With no search of your own, pick source URLs you know exist"));
		assert!(!text.contains("web_search") && !text.contains("{find_sources}"));
	}

	#[test]
	fn with_a_key_the_agent_uses_web_search_and_falls_back_when_it_fails() {
		let text = instructions(true);
		assert!(text.contains("2. For each facet, search with web_search, then read the best results with web_fetch."));
		assert!(text.contains("web_search, not a web search of your own"));
		assert!(text.contains("If web_search fails, carry on with your own web\n   search"));
		assert!(!text.contains("{find_sources}"));
	}
}
