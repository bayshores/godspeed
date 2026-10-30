import type { Usage } from "@earendil-works/pi-ai";
import { webTools } from "../tools/web.ts";
import { createPdfReadTools } from "../tools/pdf-read.ts";
import type { PiEngine } from "../models.ts";
import { runSubagent } from "./pi-run.ts";

/**
 * The researcher sub-agent (vision §2.5): a SEPARATE ToolLoopAgent instance
 * from the teacher — an isolated loop with only web_fetch (+ the PDF
 * tools), so raw fetch churn never touches the teacher's context window.
 * There is no search engine: the researcher fetches sources by URL.
 *
 * System prompt adapted from the pi researcher agent
 * (~/.pi/agent/extensions/interactive-subagents/agents/researcher.md).
 * The engine is injectable so tests run the loop with a scripted faux engine.
 */

const INSTRUCTIONS = `You are a research specialist. You work for a teacher agent inside a learning
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
What couldn't be answered. Suggested next steps.`;

interface ResearcherRunOptions {
	engine?: PiEngine;
	/** The researcher's PDF dir (PDF wave, 2026-10-07): when present, the
	 *  toolset gains web_fetch_pdf + pdf_info/pdf_extract/pdf_search scoped
	 *  to this per-job temp dir — PDFs from the web, read page-level. The
	 *  runner owns its lifecycle (mkdtemp before, rm after). */
	pdfDir?: string;
	abortSignal?: AbortSignal;
	onUsage?: (usage: Usage) => void;
	onToolStart?: (toolName: string, args: unknown) => void;
	/** The task's name on outside-agent work items (pi-run taskLabel). */
	taskLabel?: string;
}

/**
 * Run the researcher to completion: isolated context, web tools only, final
 * text = the brief. The engine is injectable so tests run the loop
 * scripted.
 */
export async function runResearcherAgent(prompt: string, opts: ResearcherRunOptions = {}): Promise<string> {
	const tools = Object.values(webTools);
	if (opts.pdfDir) tools.push(...Object.values(createPdfReadTools(opts.pdfDir)));
	const { text } = await runSubagent(tools, {
		prompt,
		engine: opts.engine,
		systemPrompt: INSTRUCTIONS,
		maxTurns: 12,
		abortSignal: opts.abortSignal,
		onUsage: opts.onUsage,
		onToolStart: opts.onToolStart,
		taskLabel: opts.taskLabel,
	});
	return text;
}

